import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Document } from '@langchain/core/documents';
import { PGVectorStore } from '@langchain/pgvector';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

import type { SourceType } from '../generated/prisma/enums.js';
import { GeminiEmbeddings } from './gemini-embeddings.js';
import type { LoadedSection } from './loaders/types.js';

/** LangChain owns this table. Never put it in a Prisma migration. */
const TABLE_NAME = 'document_chunks';

/**
 * What the caller knows about a source before it is split. Split out from
 * ChunkMetadata rather than expressed as Omit<ChunkMetadata, …>: the index
 * signature below makes `keyof ChunkMetadata` collapse to `string | number`,
 * so Omit would silently throw away every named property.
 */
export interface SourceMetadata {
  conversationId: string;
  documentId: string;
  userId: string;
  sourceType: SourceType;
  title: string;
}

export interface ChunkMetadata extends SourceMetadata {
  page?: number;
  chunkIndex: number;
  [key: string]: unknown;
}

export interface RetrievedChunk {
  content: string;
  documentId: string;
  title: string;
  page?: number;
  score: number;
}

@Injectable()
export class VectorStoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VectorStoreService.name);
  private readonly dimensions: number;
  private readonly splitter: RecursiveCharacterTextSplitter;

  // Two embedders, one model, different taskType. See gemini-embeddings.ts.
  private readonly documentEmbeddings: GeminiEmbeddings;
  private readonly queryEmbeddings: GeminiEmbeddings;

  private store!: PGVectorStore;

  constructor(private readonly config: ConfigService) {
    this.dimensions = Number(config.get<string>('EMBEDDING_DIMENSIONS') ?? 768);

    const shared = {
      apiKey: config.getOrThrow<string>('GOOGLE_API_KEY'),
      model: config.getOrThrow<string>('GOOGLE_EMBEDDING_MODEL'),
      dimensions: this.dimensions,
    };

    this.documentEmbeddings = new GeminiEmbeddings({
      ...shared,
      taskType: 'RETRIEVAL_DOCUMENT',
    });
    this.queryEmbeddings = new GeminiEmbeddings({
      ...shared,
      taskType: 'RETRIEVAL_QUERY',
    });

    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize: Number(config.get<string>('RAG_CHUNK_SIZE') ?? 1000),
      // Overlap exists because a fact can straddle a boundary. Without it, a
      // sentence split across two chunks is in neither chunk's embedding in a
      // way that matches the question.
      chunkOverlap: Number(config.get<string>('RAG_CHUNK_OVERLAP') ?? 200),
    });
  }

  async onModuleInit(): Promise<void> {
    this.store = await PGVectorStore.initialize(this.documentEmbeddings, {
      postgresConnectionOptions: {
        connectionString: this.config.getOrThrow<string>('DATABASE_URL'),
        max: 5,
      },
      tableName: TABLE_NAME,
      // Passing `dimensions` is what makes the column `vector(768)` rather than
      // an unconstrained `vector`. An unconstrained column cannot carry an HNSW
      // index at all, so this is the difference between indexed search and a
      // sequential scan — and it is fixed at table creation forever.
      dimensions: this.dimensions,
      // Cosine matches how Gemini embeddings are meant to be compared, and it
      // is what makes the un-normalized MRL truncation harmless.
      distanceStrategy: 'cosine',
    });

    // Safe to call repeatedly — it's CREATE INDEX IF NOT EXISTS underneath.
    await this.store.createHnswIndex({ dimensions: this.dimensions });

    this.logger.log(
      `Vector store ready: ${TABLE_NAME} at ${this.dimensions} dims`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    // Its own pg Pool, separate from Prisma's. Closing it lets the process exit.
    await this.store?.end();
  }

  /**
   * Split, embed and store one source. Returns the chunk count.
   */
  async ingest(
    sections: LoadedSection[],
    metadata: SourceMetadata,
  ): Promise<number> {
    const documents: Document[] = [];

    for (const section of sections) {
      const pieces = await this.splitter.splitText(section.text);

      for (const piece of pieces) {
        documents.push(
          new Document({
            pageContent: piece,
            metadata: {
              ...metadata,
              ...(section.page !== undefined ? { page: section.page } : {}),
              chunkIndex: documents.length,
            } satisfies ChunkMetadata,
          }),
        );
      }
    }

    if (documents.length === 0) return 0;

    // addDocuments embeds in batches of 500 by default and our embedder
    // batches again at 100 per Gemini call.
    await this.store.addDocuments(documents);

    return documents.length;
  }

  /**
   * ⚠️ The filter is the entire security model for RAG.
   *
   * Every chunk of every user's every document lives in one table. Drop the
   * filter and a similarity search happily returns another user's private PDF —
   * no error, just wrong answers containing someone else's data.
   *
   * `userId` is in there alongside `conversationId` on purpose. Conversation
   * ownership is already checked upstream in the chat controller, so this is
   * redundant — which is the point. A future refactor that loses the upstream
   * check downgrades this from a leak to a miss.
   */
  async retrieve(
    conversationId: string,
    userId: string,
    query: string,
    k?: number,
  ): Promise<RetrievedChunk[]> {
    const topK = k ?? Number(this.config.get<string>('RAG_TOP_K') ?? 4);

    // Embed with the QUERY embedder, then hand the raw vector to the store.
    // The store itself is constructed with the DOCUMENT embedder, so calling
    // its similaritySearch() would embed the question with the wrong taskType.
    const vector = await this.queryEmbeddings.embedQuery(query);

    const hits = await this.store.similaritySearchVectorWithScore(
      vector,
      topK,
      {
        conversationId,
        userId,
      },
    );

    return hits.map(([document, score]) => {
      const meta = document.metadata as ChunkMetadata;
      return {
        content: document.pageContent,
        documentId: meta.documentId,
        title: meta.title,
        page: meta.page,
        score,
      };
    });
  }

  async deleteByDocument(documentId: string): Promise<void> {
    await this.store.delete({ filter: { documentId } });
  }

  /**
   * Called when a conversation is deleted. Postgres cascades reach Message and
   * Document, but not this table — Prisma has no relation to it and doesn't
   * know it exists. Without this call, embeddings outlive their conversation
   * forever.
   */
  async deleteByConversation(conversationId: string): Promise<void> {
    await this.store.delete({ filter: { conversationId } });
  }
}

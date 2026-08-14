import { GoogleGenAI } from '@google/genai';
import { Embeddings, type EmbeddingsParams } from '@langchain/core/embeddings';

/**
 * Gemini embeddings for LangChain, written by hand.
 *
 * Why not `@langchain/google-genai`: its `GoogleGenerativeAIEmbeddings` has no
 * `outputDimensionality` option, so you cannot ask for 768 — you get the model
 * default of 3072. pgvector's HNSW and IVFFlat indexes cap at 2,000 dimensions,
 * so a 3072-wide column silently falls back to a sequential scan over every
 * chunk. Fine at 50 chunks, unusable at 50,000. It also depends on the older
 * `@google/generative-ai` SDK, which would be a second Google client in the
 * process next to the `@google/genai` mem0 already uses.
 *
 * The base class contract is only two methods, so implementing it costs less
 * than working around the gap.
 */
export interface GeminiEmbeddingsParams extends EmbeddingsParams {
  apiKey: string;
  model: string;
  dimensions: number;
  /**
   * `RETRIEVAL_DOCUMENT` when storing, `RETRIEVAL_QUERY` when searching.
   *
   * Gemini embeds the same text into slightly different vectors depending on
   * this, tuned for the asymmetry of "long passage" vs "short question".
   * Using the matching pair measurably improves ranking — and it is the one
   * thing mem0's embedder cannot do, which is why RAG gets its own embedder
   * rather than sharing mem0's.
   */
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';
}

/** Gemini's embedContent caps a single call well below this; 100 is comfortably safe. */
const MAX_BATCH = 100;

export class GeminiEmbeddings extends Embeddings {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly dimensions: number;
  private readonly taskType: string;

  constructor(params: GeminiEmbeddingsParams) {
    super(params);
    this.client = new GoogleGenAI({ apiKey: params.apiKey });
    this.model = params.model;
    this.dimensions = params.dimensions;
    this.taskType = params.taskType;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([text]);
    return vector;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];

    // Ingesting a 50-page PDF produces hundreds of chunks. One request each
    // would be hundreds of round trips and would hit the rate limit; one giant
    // request would be rejected.
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const batch = texts.slice(i, i + MAX_BATCH);

      // `this.caller` comes from the Embeddings base class and gives retry
      // with backoff plus a concurrency cap — worth routing through rather
      // than calling the SDK directly, since Gemini's free tier rate-limits.
      const response = await this.caller.call(() =>
        this.client.models.embedContent({
          model: this.model,
          contents: batch,
          config: {
            taskType: this.taskType,
            outputDimensionality: this.dimensions,
          },
        }),
      );

      const embeddings = response.embeddings;
      if (!embeddings || embeddings.length !== batch.length) {
        throw new Error(
          `Gemini returned ${embeddings?.length ?? 0} embeddings for ${batch.length} inputs`,
        );
      }

      for (const item of embeddings) {
        if (!item.values)
          throw new Error('Gemini returned an embedding with no values');
        vectors.push(item.values);
      }
    }

    return vectors;
  }
}

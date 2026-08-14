import { ForbiddenException, Injectable, Logger } from '@nestjs/common';

import {
  ChatMode,
  IngestStatus,
  SourceType,
} from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { loadPdf } from './loaders/pdf.loader.js';
import { loadWeb } from './loaders/web.loader.js';
import { loadYoutube } from './loaders/youtube.loader.js';
import type { LoadedSource } from './loaders/types.js';
import { VectorStoreService } from './vector-store.service.js';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly vectors: VectorStoreService,
  ) {}

  /**
   * Accept a PDF and return immediately.
   *
   * A 50-page PDF is 20-30 seconds of embedding. Holding the HTTP request open
   * for that long means proxy timeouts and a UI with no way to show progress,
   * so the row is created PENDING, the work is detached, and the frontend polls
   * GET /api/rag/documents. Durable retries would want BullMQ; this is the
   * version that works without another service.
   */
  async ingestPdf(
    userId: string,
    conversationId: string,
    file: Express.Multer.File,
  ) {
    await this.assertConversation(userId, conversationId);

    const document = await this.prisma.document.create({
      data: {
        conversationId,
        userId,
        sourceType: SourceType.PDF,
        filename: file.originalname,
        status: IngestStatus.PENDING,
      },
    });

    // Uploaded under the document id, so the key is known before the bytes are
    // stored and there is never an object nobody has a row for.
    const objectKey = await this.storage.putPdf(
      userId,
      document.id,
      file.buffer,
    );

    await this.prisma.document.update({
      where: { id: document.id },
      data: { objectKey },
    });

    this.runDetached(document.id, () =>
      loadPdf(file.buffer, file.originalname),
    );

    return { ...document, objectKey };
  }

  async ingestUrl(userId: string, conversationId: string, url: string) {
    await this.assertConversation(userId, conversationId);

    const sourceType = this.classifyUrl(url);

    const document = await this.prisma.document.create({
      data: {
        conversationId,
        userId,
        sourceType,
        sourceUrl: url,
        status: IngestStatus.PENDING,
      },
    });

    this.runDetached(document.id, () =>
      sourceType === SourceType.YOUTUBE ? loadYoutube(url) : loadWeb(url),
    );

    return document;
  }

  async list(userId: string, conversationId: string) {
    await this.assertConversation(userId, conversationId);

    return this.prisma.document.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(userId: string, documentId: string): Promise<void> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, userId },
    });
    if (!document) throw new ForbiddenException('Document not found');

    // Vectors first. If this throws, the row survives and the user can retry;
    // deleting the row first would orphan the chunks with no id left to find
    // them by, and they'd keep surfacing in retrieval forever.
    await this.vectors.deleteByDocument(documentId);
    if (document.objectKey) await this.storage.remove(document.objectKey);

    await this.prisma.document.delete({ where: { id: documentId } });
  }

  // ─────────────────────────────────────────────────────────────────────

  private classifyUrl(url: string): SourceType {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'youtube.com' ||
      host === 'youtu.be' ||
      host === 'm.youtube.com'
      ? SourceType.YOUTUBE
      : SourceType.WEB;
  }

  private async assertConversation(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });
    if (!conversation) throw new ForbiddenException('Conversation not found');
    return conversation;
  }

  /**
   * Fire the pipeline without awaiting it, recording the outcome in `status`.
   *
   * The `.catch` is not optional — an unhandled rejection in a floating promise
   * takes the Nest process down, same as mem0's add() in Phase 4.
   */
  private runDetached(
    documentId: string,
    load: () => Promise<LoadedSource>,
  ): void {
    void this.process(documentId, load).catch((error: unknown) => {
      this.logger.error(
        `Ingestion crashed for ${documentId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  private async process(
    documentId: string,
    load: () => Promise<LoadedSource>,
  ): Promise<void> {
    const document = await this.prisma.document.update({
      where: { id: documentId },
      data: { status: IngestStatus.PROCESSING },
    });

    try {
      const source = await load();

      const chunkCount = await this.vectors.ingest(source.sections, {
        conversationId: document.conversationId,
        documentId: document.id,
        userId: document.userId,
        sourceType: document.sourceType,
        title: source.title,
      });

      if (chunkCount === 0) {
        // The scanned-PDF case: pdfjs found zero text because every page is an
        // image. READY with 0 chunks would look like success and then answer
        // every question with "the context doesn't say".
        await this.fail(
          documentId,
          'No text could be extracted (scanned images or an empty file?)',
        );
        return;
      }

      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: IngestStatus.READY, chunkCount, error: null },
      });

      // Flipping the conversation into RAG mode here means the user doesn't
      // have to upload a document AND remember to toggle a switch — the second
      // step they'd forget every time.
      await this.prisma.conversation.update({
        where: { id: document.conversationId },
        data: { mode: ChatMode.RAG },
      });

      this.logger.log(`Ingested ${documentId}: ${chunkCount} chunks`);
    } catch (error) {
      await this.fail(
        documentId,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async fail(documentId: string, message: string): Promise<void> {
    await this.prisma.document.update({
      where: { id: documentId },
      // Stored, not just logged: the user needs to read "captions are disabled
      // on this video" in the UI, not have it buried in a server log.
      data: { status: IngestStatus.FAILED, error: message.slice(0, 500) },
    });
  }
}

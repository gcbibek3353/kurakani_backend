import { ForbiddenException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { VectorStoreService } from '../rag/vector-store.service.js';
import { StorageService } from '../storage/storage.service.js';
import { ChatMode } from '../generated/prisma/enums.js';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vectors: VectorStoreService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Sidebar list. `select` is not laziness — the sidebar never shows message
   * bodies, and this endpoint fires on every page load, so shipping full
   * conversation rows would be pure waste. Ordered by updatedAt to match the
   * @@index([userId, updatedAt]) already in the schema.
   */
  async list(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, mode: true, updatedAt: true },
    });
  }

  /**
   * Full transcript for one conversation.
   *
   * Note this returns ALL messages, unlike ChatService.loadHistory which caps
   * at 10. Different jobs: this is what the human reads, that is what the
   * model is billed for.
   */
  async findOne(userId: string, id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, userId },
      select: {
        id: true,
        title: true,
        mode: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, role: true, content: true, createdAt: true },
        },
      },
    });

    if (!conversation) throw new ForbiddenException('Conversation not found');
    return conversation;
  }

  /**
   * Flip the RAG tab on or off.
   *
   * Same rowcount-as-authorization pattern as remove(): updateMany scoped by
   * userId does the ownership check in the WHERE clause, then a re-read returns
   * the summary shape the sidebar already knows how to render. Ingestion also
   * flips this to RAG on its own (see IngestionService.process) — this endpoint
   * is what lets the user switch back.
   */
  async setMode(userId: string, id: string, mode: ChatMode) {
    const { count } = await this.prisma.conversation.updateMany({
      where: { id, userId },
      data: { mode },
    });
    if (count === 0) throw new ForbiddenException('Conversation not found');

    return this.prisma.conversation.findFirstOrThrow({
      where: { id, userId },
      select: { id: true, title: true, mode: true, updatedAt: true },
    });
  }

  /**
   * deleteMany, not delete, so ownership is enforced by the same WHERE clause
   * that does the work — `delete` needs a unique field and would let a wrong
   * userId through unless you remembered a separate check.
   *
   * Messages go with it via onDelete: Cascade on the Message relation. In
   * Phase 5 you must also delete this conversation's vectors from
   * document_chunks — Postgres cascades won't reach them, LangChain owns
   * that table and Prisma doesn't know it exists.
   */
  async remove(userId: string, id: string): Promise<void> {
    // Read the objectKeys before the cascade destroys the rows that name them.
    const documents = await this.prisma.document.findMany({
      where: { conversationId: id, userId },
      select: { objectKey: true },
    });

    const { count } = await this.prisma.conversation.deleteMany({
      where: { id, userId },
    });
    if (count === 0) throw new ForbiddenException('Conversation not found');

    // Messages and Documents went with the cascade. These two did not:
    // document_chunks is LangChain's table, and MinIO isn't Postgres at all.
    await this.vectors.deleteByConversation(id);
    for (const doc of documents) {
      if (doc.objectKey) await this.storage.remove(doc.objectKey);
    }
  }
}

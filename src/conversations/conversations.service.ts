import { ForbiddenException, Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

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
   * deleteMany, not delete, so ownership is enforced by the same WHERE clause
   * that does the work — `delete` needs a unique field and would let a wrong
   * userId through unless you remembered a separate check.
   *
   * Messages go with it via onDelete: Cascade on the Message relation. In
   * Phase 5 you must also delete this conversation's vectors from
   * document_chunks — Postgres cascades won't reach them, LangChain owns
   * that table and Prisma doesn't know it exists.
   */
  async remove(userId: string, id: string) {
    const { count } = await this.prisma.conversation.deleteMany({
      where: { id, userId },
    });

    if (count === 0) throw new ForbiddenException('Conversation not found');
  }
}

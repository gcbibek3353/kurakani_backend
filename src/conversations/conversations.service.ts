import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

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
   * Create an empty conversation.
   *
   * Normal chats never come through here — they are still created lazily by
   * the first message, so an opened-and-abandoned chat leaves no row. RAG
   * chats have to exist first: a document is attached to a conversation, and
   * the whole point of the mode is to load sources *before* asking anything.
   *
   * The title stays at its schema default until the first message names it
   * (ChatService.titleIfUnnamed).
   */
  async create(userId: string, mode: ChatMode) {
    return this.prisma.conversation.create({
      data: { userId, mode },
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
        // Owner-only, and safe here precisely because this query is scoped by
        // userId. It lets the chat page render the share button in the right
        // state without a second request.
        shareToken: true,
        sharedAt: true,
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
   * Create or refresh a share link. Returns the token.
   *
   * Idempotent in the token, not in the snapshot: sharing again keeps the same
   * URL — so links already sent to people keep working — but moves `sharedAt`
   * to now, which is what extends the snapshot to cover everything said since.
   * That matches what a "Share" button means to a user: publish the
   * conversation as it stands at the moment they click.
   */
  async share(
    userId: string,
    id: string,
  ): Promise<{ token: string; sharedAt: Date }> {
    const existing = await this.prisma.conversation.findFirst({
      where: { id, userId },
      select: { shareToken: true },
    });
    if (!existing) throw new ForbiddenException('Conversation not found');

    const token = existing.shareToken ?? randomUUID();
    const sharedAt = new Date();

    // updateMany scoped by userId even though ownership was just checked —
    // the same rowcount-as-authorization habit as remove() and setMode(). The
    // check and the write should never be able to drift apart.
    await this.prisma.conversation.updateMany({
      where: { id, userId },
      data: { shareToken: token, sharedAt },
    });

    return { token, sharedAt };
  }

  /**
   * Revoke. Clearing the token is what actually kills the link: findUnique on
   * a null column matches nothing, so the old URL 404s immediately.
   */
  async unshare(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.conversation.updateMany({
      where: { id, userId },
      data: { shareToken: null, sharedAt: null },
    });
    if (count === 0) throw new ForbiddenException('Conversation not found');
  }

  /**
   * The one public read in the app. No userId anywhere — the token is the
   * entire credential, which is why it comes from randomUUID() rather than
   * anything derived from the conversation.
   *
   * 404 rather than the 403 used everywhere else, and that inversion is
   * deliberate: elsewhere a uniform 403 stops id enumeration, but an
   * unguessable token leaks nothing by admitting it doesn't exist — so the
   * visitor gets a truthful answer instead of a misleading one.
   *
   * Two queries rather than one nested include, because the message cutoff
   * depends on `sharedAt`, which isn't known until the first query returns.
   * Splitting it puts the cutoff in a SQL WHERE clause instead of a JS filter,
   * so messages sent after the snapshot are never loaded into the process.
   */
  async findByShareToken(token: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { shareToken: token },
      select: { id: true, title: true, sharedAt: true },
    });

    // The sharedAt check is not redundant with the token check. A row could
    // only carry a token with a null timestamp through a bug — but if that
    // ever happened, the cutoff below would silently become "no cutoff" and
    // publish the entire conversation, including messages sent later.
    if (!conversation?.sharedAt) {
      throw new NotFoundException('This share link is no longer valid');
    }

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        createdAt: { lte: conversation.sharedAt },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, createdAt: true },
    });

    // Note what is absent: no conversation id, no userId, no mode, no attached
    // documents. Returning the row as-is would publish all of them.
    return {
      title: conversation.title,
      sharedAt: conversation.sharedAt,
      messages,
    };
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

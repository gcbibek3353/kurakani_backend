import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { ChatGroq } from '@langchain/groq';

import { MessageRole } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * How many past messages of THIS conversation get replayed to the model.
 *
 * This is "short-term memory" (§2.4). It is not a summary and not a vector
 * search — just the tail of the transcript, resent verbatim on every request,
 * because the model itself is stateless and remembers nothing between calls.
 *
 * 10 is a deliberate trade-off: every message here costs input tokens on every
 * single turn. Long-term memory (Phase 4, mem0) is what carries facts beyond
 * this window and across conversations.
 */
const HISTORY_WINDOW = 10;

const SYSTEM_PROMPT = [
  'You are Kurakani, a helpful assistant.',
  'Answer clearly and concisely. Use markdown when it aids readability.',
].join(' ');

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly model: ChatGroq;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    // Built ONCE, in the constructor. ChatGroq holds an HTTP client with a
    // connection pool; constructing one per request would open a new pool per
    // message and leak sockets under load.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.model = new ChatGroq({
      apiKey: config.getOrThrow<string>('GROQ_API_KEY'),
      model: config.getOrThrow<string>('GROQ_CHAT_MODEL'),
      temperature: 0.7,
      // `streaming: true` makes .stream() use Groq's SSE transport. Without it
      // LangChain still returns an async iterable, but it yields the entire
      // response as one chunk after the full call completes — the UI would
      // look exactly like it does today, and you'd think your code was broken.
      streaming: true,
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // 3c — conversation + persistence
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Returns the conversation to write into, creating one if the client didn't
   * name one.
   *
   * The `userId` in the WHERE clause is the entire authorization model for
   * chat. Looking up by id alone and checking ownership afterwards works too,
   * but this way there is no code path where a wrong id reaches a query
   * unscoped — the row simply isn't found.
   */
  async resolveConversation(userId: string, conversationId?: string) {
    if (conversationId) {
      const existing = await this.prisma.conversation.findFirst({
        where: { id: conversationId, userId },
      });

      // Deliberately not NotFound: "this id does not exist" and "this id is
      // someone else's" must be indistinguishable, or the error becomes an
      // oracle for probing which conversation ids are real.
      if (!existing) throw new ForbiddenException('Conversation not found');
      return existing;
    }

    return this.prisma.conversation.create({
      data: { userId },
    });
  }

  async saveMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
  ) {
    return this.prisma.message.create({
      data: { conversationId, role, content },
    });
  }

  /**
   * Bumps `updatedAt` so the Phase 3f sidebar can order by "most recent".
   *
   * Needed explicitly because `@updatedAt` only fires when THIS row is
   * updated — inserting a child Message row does not touch its parent.
   * Also carries the auto-title: the first user message, truncated. An
   * LLM-written title is a Phase 8 nicety, not worth a second Groq call now.
   */
  async touchConversation(
    conversationId: string,
    currentTitle: string,
    firstMessage: string,
  ) {
    const isUntitled = currentTitle === 'New chat';

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        updatedAt: new Date(),
        ...(isUntitled ? { title: firstMessage.slice(0, 60) } : {}),
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // 3d — short-term memory
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Loads the last N messages and converts them to LangChain message objects.
   *
   * The two-step "take the newest N, then reverse" is the standard shape:
   * `orderBy: desc` + `take` lets Postgres use the (conversationId, createdAt)
   * index and stop after N rows. Ordering ascending and slicing in JS would
   * read the entire conversation into memory first.
   *
   * Call this AFTER saving the user's message — then the current turn is
   * simply the last element and there is no "history plus the new one"
   * special case anywhere.
   */
  async loadHistory(conversationId: string): Promise<BaseMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_WINDOW,
      select: { role: true, content: true },
    });

    const history = rows.reverse().map((row) => {
      switch (row.role) {
        case MessageRole.USER:
          return new HumanMessage(row.content);
        case MessageRole.ASSISTANT:
          return new AIMessage(row.content);
        default:
          return new SystemMessage(row.content);
      }
    });

    // The system prompt is prepended fresh every time rather than stored as a
    // row, so changing it takes effect on old conversations too. Phase 4 will
    // append the user's mem0 facts to this same string.
    return [new SystemMessage(SYSTEM_PROMPT), ...history];
  }

  // ─────────────────────────────────────────────────────────────────────
  // 3b — the real LLM
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Same signature as the Phase 3a fake: an async generator of text chunks.
   * The controller never learned it was fake, so nothing there changes.
   */
  async *streamReply(messages: BaseMessage[]): AsyncGenerator<string> {
    // Note the `await` before the for-await: .stream() returns a Promise of an
    // IterableReadableStream, not the stream itself. Forgetting it gives you
    // "is not async iterable" at runtime.
    const stream = await this.model.stream(messages);

    for await (const chunk of stream) {
      // `content` is typed `string | MessageContentComplex[]` because the same
      // interface serves multimodal models. Groq text chat always gives a
      // string; guarding keeps TypeScript honest and avoids emitting
      // "[object Object]" into the UI if that ever changes.
      const text = typeof chunk.content === 'string' ? chunk.content : '';
      if (text) yield text;
    }
  }

  logStreamFailure(error: unknown) {
    this.logger.error(error instanceof Error ? error.message : String(error));
  }
}

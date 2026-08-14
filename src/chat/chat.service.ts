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
   * Loads a conversation the user owns, or throws.
   *
   * Split out from creation (which used to live here) because credits are now
   * charged between the two: verify the id → debit → only then create a row.
   * Creating first meant every rejected 402 left an orphan conversation.
   */
  async findConversation(userId: string, conversationId: string) {
    const existing = await this.prisma.conversation.findFirst({
      where: { id: conversationId, userId },
    });

    // Deliberately not NotFound: "does not exist" and "belongs to someone
    // else" must be indistinguishable, or the error is an oracle for probing
    // which conversation ids are real.
    if (!existing) throw new ForbiddenException('Conversation not found');
    return existing;
  }

  /**
   * The title is set at creation from the first message rather than patched in
   * afterwards, so the `conversation` SSE event can carry a real title and the
   * sidebar never has to render a placeholder it will replace a second later.
   */
  async createConversation(userId: string, firstMessage: string) {
    return this.prisma.conversation.create({
      data: { userId, title: firstMessage.slice(0, 60) },
    });
  }

  /**
   * Bumps `updatedAt` so the sidebar can order by "most recent".
   * Needed explicitly: `@updatedAt` only fires when THIS row is updated, and
   * inserting a child Message does not touch its parent.
   */
  async bumpConversation(conversationId: string) {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
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
  async loadHistory(
    conversationId: string,
    facts: string[] = [],
  ): Promise<BaseMessage[]> {
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
    return [new SystemMessage(this.buildSystemPrompt(facts)), ...history];
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

  /**
   * Long-term facts go in the SYSTEM message, not as a fake user turn.
   *
   * Two reasons. The model weights system content differently from dialogue,
   * and — more practically — anything you put in the transcript gets saved to
   * the Message table and replayed by loadHistory forever. Facts belong in the
   * prompt scaffolding, which is rebuilt fresh on every request.
   *
   * The "don't announce it" instruction matters: without it the model opens
   * replies with "I remember you're vegetarian!", which reads as creepy rather
   * than helpful.
   */
  private buildSystemPrompt(facts: string[]): string {
    if (facts.length === 0) return SYSTEM_PROMPT;

    return [
      SYSTEM_PROMPT,
      '',
      'Things you already know about this user, from earlier conversations:',
      ...facts.map((fact) => `- ${fact}`),
      '',
      'Use these only when they are relevant to the question. Do not mention',
      'that you have stored notes, and do not repeat a fact back unless it',
      'helps answer what was asked.',
    ].join('\n');
  }
}

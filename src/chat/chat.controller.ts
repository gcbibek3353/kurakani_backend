import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MemoryService } from '../memory/memory.service.js';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';
import {
  ErrorResponseDto,
  InsufficientCreditsDto,
} from '../common/dto/error.dto.js';
import { CreditsService } from '../credits/credits.service.js';

import { ChatMode, MessageRole } from '../generated/prisma/enums.js';
import { VectorStoreService } from '../rag/vector-store.service.js';
import type { RetrievedChunk } from '../rag/vector-store.service.js';

import { ChatDto, isValidChatDto } from './chat.dto.js';
import { CHAT_STREAM_EVENTS } from './dto/chat-stream.dto.js';
import { ChatService } from './chat.service.js';

@ApiTags('chat')
@ApiCookieAuth()
@Controller('api')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly credits: CreditsService,
    private readonly memory: MemoryService,
    private readonly vectors: VectorStoreService,
  ) {}

  @Post('chat')
  // Far below the global default. Credits already cap how much a user can
  // spend overall; this caps how fast, which is what protects the Groq key
  // and the connection pool from a stuck retry loop.
  @Throttle({
    burst: { limit: 1, ttl: 2_000 },
    sustained: { limit: 20, ttl: 60_000 },
  })
  @ApiOperation({
    summary: 'Send a message and stream the reply',
    description: [
      'Server-sent events. Each frame is `data: <json>\\n\\n`; parse the JSON and',
      'narrow on `type`. `credits` and `conversation` always arrive first, then a',
      'run of `token` deltas, then `done`.',
      '',
      'Failures that can still carry a real status code (auth, ownership, credits)',
      'are settled before the headers flush — so a 402 arrives as JSON, never as a',
      'frame inside a 200 stream.',
    ].join(' '),
  })
  @ApiBody({ type: ChatDto })
  @ApiExtraModels(...CHAT_STREAM_EVENTS)
  @ApiOkResponse({
    description: 'An SSE stream. The schema describes one decoded frame.',
    content: {
      'text/event-stream': {
        schema: {
          oneOf: CHAT_STREAM_EVENTS.map((event) => ({
            $ref: getSchemaPath(event),
          })),
        },
      },
    },
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'conversationId is unknown or belongs to another user.',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 402,
    description: 'Out of credits — the frontend shows the top-up prompt.',
    type: InsufficientCreditsDto,
  })
  async stream(
    @Session() session: UserSession,
    @Body() body: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!isValidChatDto(body)) {
      throw new BadRequestException('`message` must be a non-empty string');
    }

    const userId = session.user.id;
    const userMessage = body.message.trim();

    // ── Everything that can still return a real HTTP status ───────────────
    // Once flushHeaders() runs the status is 200 forever, so ownership and
    // payment are both settled here, above it.

    const existing = body.conversationId
      ? await this.chatService.findConversation(userId, body.conversationId)
      : null;

    const remaining = await this.credits.spend(userId);

    if (remaining === null) {
      // Nest has no PaymentRequiredException, so build it from HttpStatus.
      // 402 is the whole point: the frontend keys off the status, not a
      // message string, to decide whether to show the "buy credits" prompt.
      throw new HttpException(
        {
          statusCode: 402,
          error: 'INSUFFICIENT_CREDITS',
          message: 'Out of credits',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    // Charged and cleared — safe to create the row now.
    const conversation =
      existing ??
      (await this.chatService.createConversation(userId, userMessage));

    // Regenerate and edit-and-resend both land here: drop the turn being
    // replaced, and everything after it, before the replacement is written.
    // Done after the credit charge because a redo costs a credit like any
    // other message — and before the history load, which must not see the
    // rows that are going away.
    if (body.fromMessageId) {
      await this.chatService.truncateFrom(conversation.id, body.fromMessageId);
    }

    // A RAG chat is created empty and still carries the default title at this
    // point; a normal one was just named from this very message. Either way
    // the frame below carries the real title, so the sidebar never shows a
    // placeholder it has to replace a second later.
    const title = await this.chatService.titleIfUnnamed(
      conversation,
      userMessage,
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (payload: unknown) =>
      res.write(`data: ${JSON.stringify(payload)}\n\n`);

    send({ type: 'credits', value: remaining });
    // First frame: tell the client which conversation this is. On a brand-new
    // chat this is how the browser learns the id to send with turn 2.
    send({
      type: 'conversation',
      value: { id: conversation.id, title, mode: conversation.mode },
    });

    let clientGone = false;
    req.on('close', () => {
      // 'close' also fires on a NORMAL completion, after res.end(). Without the
      // writableEnded guard every successful request would look like an abort
      // and you'd log disconnects that never happened.
      if (!res.writableEnded) clientGone = true;
    });

    // Declared out here so the finally block can persist whatever arrived,
    // including a half-finished answer from an aborted request.
    let assistantReply = '';

    try {
      // The save runs BEFORE the model is called. If Groq is down, the user's
      // message is still in the transcript — losing the user's own words to a
      // provider outage is the worst possible failure here.
      const [savedUser, facts, context] = await Promise.all([
        this.chatService.saveMessage(
          conversation.id,
          MessageRole.USER,
          userMessage,
        ),
        this.memory.recall(userId, userMessage),
        // Retrieval only in RAG mode. A NORMAL conversation must not pay an
        // embedding round trip on every turn for chunks that don't exist.
        conversation.mode === ChatMode.RAG
          ? this.retrieveSafely(conversation.id, userId, userMessage)
          : Promise.resolve<RetrievedChunk[]>([]),
      ]);

      // Before the first token, so a user who stops the generation a second
      // later can still hit regenerate on this turn.
      send({ type: 'saved', value: savedUser.id });

      if (context.length > 0) {
        // Before the first token, so the UI can render citations while the
        // answer is still streaming in.
        send({
          type: 'sources',
          value: context.map((chunk) => ({
            documentId: chunk.documentId,
            title: chunk.title,
            page: chunk.page,
            score: chunk.score,
            excerpt: chunk.content.slice(0, 300),
          })),
        });
      }

      const messages = await this.chatService.loadHistory(conversation.id, {
        facts,
        context,
      });

      for await (const token of this.chatService.streamReply(messages)) {
        if (clientGone) break;
        assistantReply += token;
        send({ type: 'token', value: token });
      }
    } catch (error) {
      this.chatService.logStreamFailure(error);

      // Refund only when we delivered nothing. If the stream died halfway the
      // user already read a partial answer and Groq already billed us for
      // those tokens — refunding there means a flaky connection becomes free
      // unlimited chat.
      if (assistantReply.length === 0) {
        const restored = await this.credits.refund(userId, conversation.id);
        send({ type: 'credits', value: restored });
      }

      send({
        type: 'error',
        value: error instanceof Error ? error.message : 'Stream failed',
      });
    } finally {
      // Persist the partial reply too. The user watched those words appear on
      // screen — if they aren't saved, reloading the page silently deletes
      // half the conversation and the next turn's history is wrong.
      if (assistantReply.length > 0) {
        await this.chatService.saveMessage(
          conversation.id,
          MessageRole.ASSISTANT,
          assistantReply,
        );
      }

      // Fire-and-forget: returns void, does not delay res.end(). Runs even
      // for a partial reply from an aborted stream — half an exchange still
      // contains facts worth keeping.
      this.memory.remember(userId, userMessage, assistantReply);

      await this.chatService.bumpConversation(conversation.id);

      // Sent from the finally rather than the try, so it follows an `error`
      // frame too — the client then has exactly one signal for "this turn is
      // over", however it ended. Skipped when the client has already gone;
      // there is nobody to read it.
      if (!clientGone) send({ type: 'done' });

      // Unconditional. On an aborted request the socket is already torn down
      // and this is a no-op, but leaving the response un-ended on any path is
      // how you end up holding connections open.
      res.end();
    }
  }

  /**
   * Retrieval must degrade, not 500. A Gemini hiccup should cost the user
   * grounding on one message, not the whole reply — and it sits inside a
   * Promise.all, where one rejection would abort the other branches.
   */
  private async retrieveSafely(
    conversationId: string,
    userId: string,
    query: string,
  ): Promise<RetrievedChunk[]> {
    try {
      return await this.vectors.retrieve(conversationId, userId, query);
    } catch {
      return [];
    }
  }
}

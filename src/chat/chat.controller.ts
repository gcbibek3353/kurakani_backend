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
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';
import { CreditsService } from '../credits/credits.service.js';

import { MessageRole } from '../generated/prisma/enums.js';
import { isValidChatDto } from './chat.dto.js';
import { ChatService } from './chat.service.js';

@Controller('api')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly credits: CreditsService,
  ) {}

  @Post('chat')
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

    // Lets the badge update without a second round trip to /api/me.

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
      value: { id: conversation.id, title: conversation.title },
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
      // Saved BEFORE the model is called. If Groq is down, the user's message
      // is still in the transcript — losing the user's own words to a provider
      // outage is the worst possible failure here.
      await this.chatService.saveMessage(
        conversation.id,
        MessageRole.USER,
        userMessage,
      );

      const messages = await this.chatService.loadHistory(conversation.id);

      for await (const token of this.chatService.streamReply(messages)) {
        if (clientGone) break;
        assistantReply += token;
        send({ type: 'token', value: token });
      }

      if (!clientGone) send({ type: 'done' });
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

      await this.chatService.bumpConversation(conversation.id);

      if (!clientGone) res.end();
    }
  }
}

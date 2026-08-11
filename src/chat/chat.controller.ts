import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';

import { MessageRole } from '../generated/prisma/enums.js';
import { isValidChatDto } from './chat.dto.js';
import { ChatService } from './chat.service.js';

@Controller('api')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

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

    // Everything that can legitimately produce an HTTP error status happens
    // BEFORE flushHeaders(). Once headers are on the wire the status is 200
    // forever, and a thrown ForbiddenException can only be reported as text
    // inside a stream the client already believes succeeded.
    const conversation = await this.chatService.resolveConversation(
      userId,
      body.conversationId,
    );

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const send = (payload: unknown) =>
      res.write(`data: ${JSON.stringify(payload)}\n\n`);

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

      await this.chatService.touchConversation(
        conversation.id,
        conversation.title,
        userMessage,
      );

      if (!clientGone) res.end();
    }
  }
}

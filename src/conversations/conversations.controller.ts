import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ConversationsService } from './conversations.service.js';

/**
 * No POST here on purpose. A conversation is created lazily by the first
 * message (see ChatController), so "New chat" in the UI is pure client state —
 * no request, and no rows for chats the user opened and abandoned.
 */
@Controller('api/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  async list(@Session() session: UserSession) {
    return this.conversations.list(session.user.id);
  }

  @Get(':id')
  async findOne(@Session() session: UserSession, @Param('id') id: string) {
    return this.conversations.findOne(session.user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Session() session: UserSession, @Param('id') id: string) {
    await this.conversations.remove(session.user.id, id);
  }
}

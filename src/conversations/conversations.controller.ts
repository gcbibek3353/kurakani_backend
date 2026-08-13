import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDto } from '../common/dto/error.dto.js';
import { ConversationsService } from './conversations.service.js';
import {
  ConversationDetailDto,
  ConversationSummaryDto,
} from './dto/conversation.dto.js';

/**
 * No POST here on purpose. A conversation is created lazily by the first
 * message (see ChatController), so "New chat" in the UI is pure client state —
 * no request, and no rows for chats the user opened and abandoned.
 */
@ApiTags('conversations')
@ApiCookieAuth()
@ApiUnauthorizedResponse({ type: ErrorResponseDto })
@Controller('api/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: 'List the signed-in user’s conversations' })
  @ApiOkResponse({ type: [ConversationSummaryDto] })
  async list(@Session() session: UserSession) {
    return this.conversations.list(session.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One conversation with its full transcript' })
  @ApiParam({ name: 'id', description: 'Conversation id (cuid)' })
  @ApiOkResponse({ type: ConversationDetailDto })
  // 403 rather than 404 even when the id simply does not exist — see the
  // service; the two cases are deliberately indistinguishable.
  @ApiForbiddenResponse({
    description: 'Unknown id, or owned by another user.',
    type: ErrorResponseDto,
  })
  async findOne(@Session() session: UserSession, @Param('id') id: string) {
    return this.conversations.findOne(session.user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a conversation and its messages' })
  @ApiParam({ name: 'id', description: 'Conversation id (cuid)' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiForbiddenResponse({
    description: 'Unknown id, or owned by another user.',
    type: ErrorResponseDto,
  })
  async remove(@Session() session: UserSession, @Param('id') id: string) {
    await this.conversations.remove(session.user.id, id);
  }
}

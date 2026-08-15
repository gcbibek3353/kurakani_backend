import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
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
  CreateConversationDto,
  ShareLinkDto,
} from './dto/conversation.dto.js';
import { ChatMode } from '../generated/prisma/enums.js';

/**
 * POST is the exception, not the rule. A NORMAL conversation is still created
 * lazily by its first message (see ChatController), so "New chat" in the UI
 * costs no request and leaves no row behind if the user walks away. RAG is the
 * case that cannot work that way — sources attach to a conversation id, and
 * they are chosen before the first question is asked.
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

  @Post()
  @ApiOperation({
    summary: 'Create an empty conversation',
    description:
      'Only needed to start a RAG chat, where sources must be attached before ' +
      'the first message. A normal chat is created by POST /api/chat itself.',
  })
  @ApiBody({ type: CreateConversationDto })
  @ApiCreatedResponse({ type: ConversationSummaryDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async create(
    @Session() session: UserSession,
    @Body() body: CreateConversationDto,
  ) {
    const mode = body?.mode ?? ChatMode.NORMAL;
    if (mode !== ChatMode.NORMAL && mode !== ChatMode.RAG) {
      throw new BadRequestException('mode must be NORMAL or RAG');
    }
    return this.conversations.create(session.user.id, mode);
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

  @Post(':id/share')
  @ApiOperation({
    summary: 'Create or refresh the public read-only link',
    description:
      'Calling this again keeps the same token but moves the snapshot cutoff ' +
      'to now, publishing anything said since the link was first created.',
  })
  @ApiParam({ name: 'id', description: 'Conversation id (cuid)' })
  @ApiOkResponse({ type: ShareLinkDto })
  @ApiForbiddenResponse({
    description: 'Unknown id, or owned by another user.',
    type: ErrorResponseDto,
  })
  async share(@Session() session: UserSession, @Param('id') id: string) {
    return this.conversations.share(session.user.id, id);
  }

  @Delete(':id/share')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the public link' })
  @ApiParam({ name: 'id', description: 'Conversation id (cuid)' })
  @ApiNoContentResponse({ description: 'Revoked; the old URL now 404s.' })
  @ApiForbiddenResponse({
    description: 'Unknown id, or owned by another user.',
    type: ErrorResponseDto,
  })
  async unshare(@Session() session: UserSession, @Param('id') id: string) {
    await this.conversations.unshare(session.user.id, id);
  }

  @Patch(':id/mode')
  @ApiOkResponse({ type: ConversationSummaryDto })
  setMode(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body('mode') mode: ChatMode,
  ) {
    if (mode !== ChatMode.NORMAL && mode !== ChatMode.RAG) {
      throw new BadRequestException('mode must be NORMAL or RAG');
    }
    return this.conversations.setMode(session.user.id, id, mode);
  }
}

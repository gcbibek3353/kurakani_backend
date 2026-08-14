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
  ApiTags,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDto } from '../common/dto/error.dto.js';
import { MemoryItemDto } from './dto/memory.dto.js';
import { MemoryService } from './memory.service.js';

@ApiTags('memory')
@ApiCookieAuth()
@Controller('api/memory')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  @Get()
  @ApiOperation({
    summary: 'List everything the assistant remembers about you',
    description:
      'Long-term facts extracted from past conversations, stored in pgvector. ' +
      'Separate from conversation history, which lives in the Message table.',
  })
  @ApiOkResponse({ type: [MemoryItemDto] })
  async list(@Session() session: UserSession): Promise<MemoryItemDto[]> {
    const items = await this.memory.list(session.user.id);

    // Explicit projection, not a spread. mem0's MemoryItem carries metadata and
    // scoring internals that have no business reaching a browser.
    return items.map((item) => ({
      id: item.id,
      memory: item.memory,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Forget one fact' })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({
    description: 'Unknown id, or a memory belonging to another user.',
    type: ErrorResponseDto,
  })
  async forget(
    @Session() session: UserSession,
    @Param('id') id: string,
  ): Promise<void> {
    await this.memory.forget(session.user.id, id);
  }
}

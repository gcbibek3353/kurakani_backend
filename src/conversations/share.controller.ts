import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDto } from '../common/dto/error.dto.js';
import { ConversationsService } from './conversations.service.js';
import { SharedConversationDto } from './dto/conversation.dto.js';

/**
 * The one public route in the application.
 *
 * Its own controller rather than another method on ConversationsController,
 * because that class carries a class-level @ApiCookieAuth and every route on
 * it is owner-scoped. Mixing an anonymous route in would mean the next person
 * adding an endpoint there inherits the wrong default.
 */
@ApiTags('share')
@Controller('api/share')
export class ShareController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get(':token')
  // This is what exempts the route from the globally-registered AuthGuard.
  // Forget it and the share link 401s for exactly the people it exists for.
  // (The library also exports @Public, but it is deprecated in favour of this.)
  @AllowAnonymous()
  @ApiOperation({
    summary: 'Read a shared conversation',
    description:
      'No authentication. Returns the transcript as it stood when the link was ' +
      'created — messages added afterwards are excluded.',
  })
  @ApiOkResponse({ type: SharedConversationDto })
  @ApiNotFoundResponse({
    description: 'Unknown or revoked token.',
    type: ErrorResponseDto,
  })
  async findByToken(@Param('token') token: string) {
    return this.conversations.findByShareToken(token);
  }
}

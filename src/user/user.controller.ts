import { Controller, Get } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Session } from '@thallesp/nestjs-better-auth';
// `import type` is required: with isolatedModules + emitDecoratorMetadata, a
// value import used only as a decorated parameter's type is a compile error.
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDto } from '../common/dto/error.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UserProfileDto } from './dto/user-profile.dto.js';

/**
 * No guard here on purpose: @thallesp/nestjs-better-auth registers its AuthGuard
 * globally, so every route is protected unless marked @AllowAnonymous. An
 * unauthenticated request gets a 401 before this handler runs, which is what
 * the frontend uses to decide whether to bounce to /login.
 */
@ApiTags('user')
@ApiCookieAuth()
@Controller('api')
export class UserController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Current user and credit balance',
    description:
      'Also doubles as the session check: a 401 here is what tells the frontend to redirect to /login.',
  })
  @ApiOkResponse({ type: UserProfileDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async me(@Session() session: UserSession): Promise<UserProfileDto> {
    const credits = await this.prisma.creditBalance.findUnique({
      where: { userId: session.user.id },
      select: { balance: true },
    });

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      credits: credits?.balance ?? 0,
    };
  }
}

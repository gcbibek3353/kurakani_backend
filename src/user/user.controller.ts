import { Controller, Get } from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
// `import type` is required: with isolatedModules + emitDecoratorMetadata, a
// value import used only as a decorated parameter's type is a compile error.
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { PrismaService } from '../prisma/prisma.service.js';

/**
 * No guard here on purpose: @thallesp/nestjs-better-auth registers its AuthGuard
 * globally, so every route is protected unless marked @AllowAnonymous. An
 * unauthenticated request gets a 401 before this handler runs, which is what
 * the frontend uses to decide whether to bounce to /login.
 */
@Controller('api')
export class UserController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async me(@Session() session: UserSession) {
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

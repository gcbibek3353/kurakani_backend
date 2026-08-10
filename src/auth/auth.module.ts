import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';

import { PrismaService } from '../prisma/prisma.service.js';
import { createAuth } from './auth.config.js';

@Module({
  imports: [
    // `forRootAsync` (not `forRoot`) because the auth instance depends on
    // providers — PrismaService and ConfigService — that only exist once the
    // DI container is up. PrismaModule is @Global, so no `imports` needed here.
    BetterAuthModule.forRootAsync({
      inject: [PrismaService, ConfigService],
      useFactory: (prisma: PrismaService, config: ConfigService) => ({
        auth: createAuth(prisma, {
          secret: config.getOrThrow<string>('BETTER_AUTH_SECRET'),
          baseURL: config.getOrThrow<string>('BETTER_AUTH_URL'),
          frontendURL:
            config.get<string>('FRONTEND_URL') ?? 'http://localhost:3001',
        }),
      }),
    }),
  ],
  // Re-exported so feature modules can inject `AuthService` / use `AuthGuard`
  // by importing this module alone.
  exports: [BetterAuthModule],
})
export class AuthModule {}

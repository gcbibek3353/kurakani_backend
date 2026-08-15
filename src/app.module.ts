import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { MemoryModule } from './memory/memory.module.js';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UserController } from './user/user.controller.js';
import { ChatModule } from './chat/chat.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';
import { StorageModule } from './storage/storage.module.js';
import { RagModule } from './rag/rag.module.js';
import { PaymentsModule } from './payments/payments.module.js';

@Module({
  imports: [
    // Must come first: PrismaService and AuthModule both read env at construction.
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    // Two named windows rather than one. `burst` stops a hammering client
    // dead; `sustained` is what actually caps a session's volume over a
    // minute. A single limit can only do one of those — set it low and normal
    // typing trips it, set it high and a script gets a free minute.
    ThrottlerModule.forRoot([
      { name: 'burst', ttl: 1_000, limit: 8 },
      { name: 'sustained', ttl: 60_000, limit: 120 },
    ]),
    PrismaModule,
    AuthModule,
    StorageModule,
    RagModule,
    MemoryModule,
    ChatModule,
    ConversationsModule,
    PaymentsModule,
  ],
  controllers: [AppController, UserController],
  providers: [
    AppService,
    // Registered after Better Auth's own global guard, so an unauthenticated
    // request is rejected before it can consume anyone's quota.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}

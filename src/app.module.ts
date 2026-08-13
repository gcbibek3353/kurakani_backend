import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UserController } from './user/user.controller.js';
import { ChatModule } from './chat/chat.module.js';
import { ConversationsModule } from './conversations/conversations.module.js';

@Module({
  imports: [
    // Must come first: PrismaService and AuthModule both read env at construction.
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    PrismaModule,
    AuthModule,
    ChatModule,
    ConversationsModule,
  ],
  controllers: [AppController, UserController],
  providers: [AppService],
})
export class AppModule {}

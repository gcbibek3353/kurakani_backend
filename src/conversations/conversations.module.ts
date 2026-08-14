import { Module } from '@nestjs/common';

import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';
import { ShareController } from './share.controller.js';

@Module({
  controllers: [ConversationsController, ShareController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}

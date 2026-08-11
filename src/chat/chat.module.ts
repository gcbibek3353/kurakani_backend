import { Module } from '@nestjs/common';

import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

@Module({
  controllers: [ChatController],
  providers: [ChatService],
  // Exported so Phase 5's RAG module can reuse the streaming service rather
  // than duplicating the prompt-assembly logic.
  exports: [ChatService],
})
export class ChatModule {}

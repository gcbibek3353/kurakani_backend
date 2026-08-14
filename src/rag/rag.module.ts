import { Global, Module } from '@nestjs/common';

import { IngestionService } from './ingestion.service.js';
import { RagController } from './rag.controller.js';
import { VectorStoreService } from './vector-store.service.js';

/**
 * @Global for the same reason MemoryModule is: exactly one VectorStoreService,
 * because it owns a pg Pool and a table-creation handshake. ChatModule and
 * ConversationsModule both inject it.
 */
@Global()
@Module({
  controllers: [RagController],
  providers: [VectorStoreService, IngestionService],
  exports: [VectorStoreService, IngestionService],
})
export class RagModule {}

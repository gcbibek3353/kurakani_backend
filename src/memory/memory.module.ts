import { Global, Module } from '@nestjs/common';

import { MemoryController } from './memory.controller.js';
import { MemoryService } from './memory.service.js';

/**
 * @Global so ChatModule can inject MemoryService without importing this, and —
 * more importantly — so there is exactly ONE Memory instance in the process.
 *
 * Its constructor opens a `pg` client and kicks off table creation. A
 * per-request instance would open a connection per message and exhaust
 * Postgres in a few minutes.
 */
@Global()
@Module({
  controllers: [MemoryController],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}

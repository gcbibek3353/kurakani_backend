import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service.js';

// Global so auth/credits/chat/RAG can inject PrismaService without importing
// this module everywhere. Still a single instance, so a single connection pool.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}

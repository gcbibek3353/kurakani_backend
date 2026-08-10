import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';

// `.js` on a file that is `client.ts` on disk is correct, not a typo: under
// `module: nodenext` you write the path as it will exist after compilation.
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    // Prisma 7 dropped the Rust query engine: the client no longer reads `url`
    // from schema.prisma and cannot reach Postgres without a driver adapter.
    // That is why `new PrismaClient()` with no args is a type error.
    super({
      adapter: new PrismaPg({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      }),
      log: ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    // Prisma connects lazily; connecting here makes a bad DATABASE_URL fail at
    // boot instead of as a 500 on the user's first message.
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

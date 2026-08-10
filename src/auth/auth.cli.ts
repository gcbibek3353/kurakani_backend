import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';
import { createAuth } from './auth.config.js';

/**
 * Config entrypoint for `npx @better-auth/cli`, which can only read a top-level
 * `export const auth`. The running app never imports this file — it builds auth
 * through `createAuth()` in auth.module.ts with the DI-managed PrismaService.
 *
 * The CLI only inspects the config to emit schema, so these values are inert.
 */
export const auth = createAuth(
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString:
        process.env.DATABASE_URL ?? 'postgresql://localhost:5432/placeholder',
    }),
  }),
  {
    secret: process.env.BETTER_AUTH_SECRET ?? 'cli-placeholder-secret',
    baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    frontendURL: process.env.FRONTEND_URL ?? 'http://localhost:3001',
  },
);

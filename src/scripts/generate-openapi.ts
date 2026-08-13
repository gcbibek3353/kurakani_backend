import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module.js';
import { buildOpenApiDocument } from '../swagger.js';

/**
 * Writes backend/openapi.json — the single source of truth the frontend
 * generates its TypeScript types from (`bun run openapi:types` over there).
 *
 * This boots the real application container rather than parsing source,
 * because that is the only way the document reflects what the app actually
 * routes. It needs the same .env and a reachable Postgres as `start:dev`:
 * PrismaService connects in onModuleInit and ChatService reads GROQ_* at
 * construction. It never calls listen(), so nothing binds a port.
 */
async function generate() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    // The point of this script is one line of output — the written path.
    logger: ['error'],
  });

  // init() is what maps the routes; without it the document comes out empty.
  await app.init();

  const document = buildOpenApiDocument(app);
  const outPath = resolve(process.cwd(), 'openapi.json');

  await writeFile(outPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await app.close();

  const routes = Object.keys(document.paths ?? {}).length;
  console.log(`openapi: wrote ${routes} paths to ${outPath}`);
}

void generate();

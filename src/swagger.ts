import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

/** Interactive docs. */
export const SWAGGER_UI_PATH = 'api/docs';
/** Raw spec, and what `bun run openapi` writes to disk for the frontend. */
export const SWAGGER_JSON_PATH = 'api/docs-json';

/**
 * Builds the OpenAPI document from the live Nest container.
 *
 * Kept separate from `setupSwagger` because two callers need it: the running
 * server (to serve the UI) and scripts/generate-openapi.ts (to write the file
 * the frontend generates its types from). One builder, so the served docs and
 * the checked-in spec can never drift.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Kurakani API')
    .setDescription(
      [
        'Backend for the Kurakani chat app.',
        '',
        'Auth is a session cookie issued by Better Auth. Its own routes live under',
        '`/api/auth/*` and are handled by the Better Auth handler rather than a Nest',
        'controller, so they are not listed here — the frontend talks to them through',
        'the `better-auth/react` client, which ships its own types.',
        '',
        'Every route below is protected by a global guard: no cookie means 401,',
        'before the handler runs.',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    // Documents the cookie so "Try it out" in the UI works against a real
    // session, and so generated clients know the endpoints aren't public.
    .addCookieAuth('better-auth.session_token', {
      type: 'apiKey',
      in: 'cookie',
      name: 'better-auth.session_token',
      description: 'Set by Better Auth on sign-in.',
    })
    .addServer('http://localhost:3001', 'Local backend (direct)')
    .addServer('http://localhost:3000', 'Local frontend (proxied by Next.js)')
    .build();

  return SwaggerModule.createDocument(app, config);
}

/**
 * Mounts the docs. Note these are Express-level routes registered by
 * SwaggerModule, not Nest controllers — the global Better Auth guard never
 * sees them, which is why /api/docs stays reachable while logged out.
 */
export function setupSwagger(app: INestApplication): OpenAPIObject {
  const document = buildOpenApiDocument(app);

  SwaggerModule.setup(SWAGGER_UI_PATH, app, document, {
    jsonDocumentUrl: SWAGGER_JSON_PATH,
    swaggerOptions: {
      // Keeps the cookie/auth selection across page reloads while developing.
      persistAuthorization: true,
      // The spec is small; expanding everything is more useful than a wall of
      // collapsed rows.
      docExpansion: 'list',
    },
  });

  return document;
}

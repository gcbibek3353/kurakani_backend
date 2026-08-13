import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { setupSwagger, SWAGGER_UI_PATH } from './swagger.js';

async function bootstrap() {
  // `bodyParser: false` is required by @thallesp/nestjs-better-auth: Better Auth
  // needs the raw request stream, and Nest's default parser would consume it
  // first, hanging every auth request. The library re-adds the JSON and
  // urlencoded parsers itself for all non-auth routes.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  const config = app.get(ConfigService);

  // The library applies CORS to its own /api/auth routes; this covers ours
  // (/api/me and everything in later phases). `credentials` is what allows the
  // session cookie to travel when the frontend calls the API directly rather
  // than through the Next.js rewrite.
  app.enableCors({
    origin: config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000',
    credentials: true,
  });

  setupSwagger(app);

  const port = config.get<number>('PORT') ?? 3001;
  await app.listen(port);

  console.log(`API docs: http://localhost:${port}/${SWAGGER_UI_PATH}`);
}
void bootstrap();

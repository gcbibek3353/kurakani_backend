import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

import type { PrismaClient } from '../generated/prisma/client.js';
import {
  AUTH_BASE_PATH,
  SESSION_COOKIE_CACHE_SECONDS,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from './auth.constants.js';

export interface AuthEnv {
  secret: string;
  baseURL: string;
  frontendURL: string;
}

/**
 * A factory rather than a top-level `export const auth`, so the PrismaClient is
 * injected by Nest instead of being constructed at import time. That keeps one
 * connection pool for the whole app and makes this testable with a fake client.
 */
export function createAuth(prisma: PrismaClient, env: AuthEnv) {
  return betterAuth({
    secret: env.secret,
    baseURL: env.baseURL,
    basePath: AUTH_BASE_PATH,

    // The Next.js frontend is a different origin, so it must be whitelisted or
    // Better Auth rejects its requests and refuses to set the session cookie.
    trustedOrigins: [env.frontendURL],

    database: prismaAdapter(prisma, { provider: 'postgresql' }),

    emailAndPassword: { enabled: true },

    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      // Without this, every authenticated request costs a session SELECT.
      cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
    },

    advanced: {
      // Cross-origin cookie between the Next.js app and this API.
      defaultCookieAttributes: {
        sameSite: 'lax',
        secure: env.baseURL.startsWith('https://'),
      },
    },

    // The free-credit grant on sign-up belongs here, as a
    // `databaseHooks.user.create.after` hook using SIGNUP_FREE_CREDITS — added
    // once the credits model exists in schema.prisma.
  });
}

export type Auth = ReturnType<typeof createAuth>;

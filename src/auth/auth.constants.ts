/**
 * Values that are referenced from more than one place and must not drift apart.
 *
 * They live in their own file (rather than inline in `auth.config.ts`) because
 * the Next.js client, the auth guards, and future feature modules all need to
 * agree on them. A magic string duplicated in three files is the classic source
 * of "login works locally but 404s in prod" bugs.
 */

/**
 * Path prefix Better Auth mounts all of its own routes under
 * (`/api/auth/sign-in/email`, `/api/auth/get-session`, ...).
 *
 * The Next.js `createAuthClient({ baseURL })` on the frontend must point at this
 * exact same prefix, otherwise the client silently calls routes that don't exist.
 */
export const AUTH_BASE_PATH = '/api/auth';

/**
 * How long a session stays valid before the user must sign in again.
 * Better Auth expects seconds, not milliseconds.
 */
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Sliding-window refresh: whenever a request arrives and the session is older
 * than this, its expiry is pushed forward. This is what keeps an active user
 * logged in indefinitely without issuing a long-lived, never-rotating session.
 */
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24; // 1 day

/**
 * Session data is cached in a signed cookie for this long so that the common
 * case (every authenticated request) does not hit Postgres just to read the
 * session row. Keep it short — revocation only takes effect once it expires.
 */
export const SESSION_COOKIE_CACHE_SECONDS = 60 * 5; // 5 minutes

/**
 * Free credits granted on sign-up, per the product spec: a new user can chat
 * until these run out, after which the chat endpoint must refuse.
 *
 * It is defined here (not in the credits module) because the grant happens
 * inside Better Auth's `databaseHooks.user.create` hook — the credits module
 * will import this same constant when it implements the debit side.
 */
export const SIGNUP_FREE_CREDITS = 5;

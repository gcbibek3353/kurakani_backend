// backend/src/payments/credit-packs.ts

/**
 * What you can buy. Defined here, never sent by the client.
 *
 * The browser posts a pack id — "starter" — and the server looks up both the
 * amount and the credits. If the client sent an amount, someone would post
 * { amountPaise: 100, credits: 10000 } and buy 10,000 credits for one rupee.
 * A price the client can name is a price the client can choose.
 */
export const CREDIT_PACKS = {
  starter: { credits: 100, amountPaise: 9900 }, // ₹99
  plus: { credits: 500, amountPaise: 39900 }, // ₹399
  pro: { credits: 2000, amountPaise: 129900 }, // ₹1,299
} as const;

export type CreditPackId = keyof typeof CREDIT_PACKS;

export function isCreditPackId(value: unknown): value is CreditPackId {
  return typeof value === 'string' && value in CREDIT_PACKS;
}

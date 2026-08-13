import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CreditReason } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class CreditsService {
  readonly messageCost: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.messageCost = Number(config.get<string>('CREDITS_PER_MESSAGE') ?? 1);
  }

  /**
   * Atomically debit the user, or refuse.
   *
   * Returns the remaining balance, or `null` if they could not afford it.
   * `null` rather than a thrown exception because "out of credits" is a normal
   * business outcome, not an error — the caller decides what HTTP status that
   * deserves.
   *
   * ── Why this shape and not read-then-write ──────────────────────────────
   *
   *   const b = await findUnique(...);      // both requests read 1
   *   if (b.balance < cost) throw;          // both pass
   *   await update({ balance: b.balance-1 });  // both write 0 — 2 messages, 1 credit
   *
   * The check has to happen INSIDE the UPDATE statement. `where: { balance:
   * { gte: cost } }` compiles to `UPDATE ... WHERE balance >= 1`, and Postgres
   * takes a row lock for the duration, so two concurrent requests serialise:
   * the second one re-evaluates the predicate against the already-decremented
   * value, matches zero rows, and `count` comes back 0. That rowcount is the
   * authorization decision — never a preceding SELECT.
   */
  async spend(
    userId: string,
    reason: CreditReason = CreditReason.MESSAGE_SPEND,
    refId?: string,
  ): Promise<number | null> {
    const cost = this.messageCost;

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.creditBalance.updateMany({
        where: { userId, balance: { gte: cost } },
        data: { balance: { decrement: cost } },
      });

      // Insufficient funds — or no balance row at all, which is the same
      // answer from the caller's point of view.
      if (count === 0) return null;

      // The ledger is append-only and lives in the same transaction as the
      // balance change. If they can ever diverge, you lose the ability to
      // answer "why is my balance 7?" — which is the only reason the ledger
      // table exists.
      await tx.creditTransaction.create({
        data: { userId, amount: -cost, reason, refId },
      });

      const row = await tx.creditBalance.findUnique({
        where: { userId },
        select: { balance: true },
      });

      return row?.balance ?? 0;
    });
  }

  /**
   * Give the credit back when we charged but delivered nothing.
   *
   * No conditional `where` here: adding credits can't overdraw, so a plain
   * increment is safe and must not be allowed to fail silently.
   */
  async refund(userId: string, refId?: string): Promise<number> {
    const cost = this.messageCost;

    return this.prisma.$transaction(async (tx) => {
      const balance = await tx.creditBalance.update({
        where: { userId },
        data: { balance: { increment: cost } },
        select: { balance: true },
      });

      await tx.creditTransaction.create({
        data: { userId, amount: cost, reason: CreditReason.REFUND, refId },
      });

      return balance.balance;
    });
  }

  async getBalance(userId: string): Promise<number> {
    const row = await this.prisma.creditBalance.findUnique({
      where: { userId },
      select: { balance: true },
    });
    return row?.balance ?? 0;
  }
}

// backend/src/payments/payments.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Razorpay from 'razorpay';

import { CreditReason, PaymentStatus } from '../generated/prisma/enums.js';
import { CreditsService } from '../credits/credits.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CREDIT_PACKS, type CreditPackId } from './credit-packs.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { RazorpayWebhookBody } from './razorpay-webhook.types.js';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly razorpay: Razorpay;
  private readonly webhookSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
    config: ConfigService,
  ) {
    this.razorpay = new Razorpay({
      key_id: config.getOrThrow<string>('RAZORPAY_KEY_ID'),
      key_secret: config.getOrThrow<string>('RAZORPAY_KEY_SECRET'),
    });
    this.webhookSecret = config.getOrThrow<string>('RAZORPAY_WEBHOOK_SECRET');
  }

  /**
   * Create the Razorpay order and the local row that mirrors it.
   *
   * Order at Razorpay first, then the local row — because razorpayOrderId is
   * NOT NULL and unique, so there's nothing to write until Razorpay has
   * answered. If the local insert then fails you have an orphan order at
   * Razorpay that nobody can pay against, which is harmless. The reverse
   * order would risk a paid order with no local row, which is not.
   */
  async createOrder(userId: string, packId: CreditPackId) {
    const pack = CREDIT_PACKS[packId];

    const order = await this.razorpay.orders.create({
      amount: pack.amountPaise,
      currency: 'INR',
      // Echoed back on the webhook. Useful in the dashboard for support, but
      // NEVER trusted for authorization — see handleWebhook.
      notes: { userId, packId },
    });

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        razorpayOrderId: order.id,
        amountPaise: pack.amountPaise,
        // Recorded now, at the price the user was quoted. Granting from the
        // pack table at webhook time would silently repricing anyone who was
        // mid-checkout when you edited credit-packs.ts.
        creditsGranted: pack.credits,
        status: PaymentStatus.CREATED,
      },
    });

    return {
      orderId: order.id,
      amountPaise: pack.amountPaise,
      credits: pack.credits,
      paymentId: payment.id,
    };
  }

  /**
   * Process one webhook. Called only after the signature has been verified.
   *
   * Returns quietly for events we don't handle: Razorpay retries anything that
   * isn't a 2xx, so answering 400 to an event you simply don't care about
   * earns you the same event every few minutes for a day.
   */
  async handleWebhook(
    event: string,
    payload: RazorpayWebhookBody,
  ): Promise<void> {
    console.log('Razorpay webhook called me ... :joy');
    console.log('Razorpay webhook called me ... :joy');

    const entity = payload.payload?.payment?.entity;
    if (!entity?.order_id) return;

    if (event === 'payment.captured') {
      await this.markPaid(entity.order_id, entity.id);
    } else if (event === 'payment.failed') {
      await this.prisma.payment.updateMany({
        where: {
          razorpayOrderId: entity.order_id,
          status: PaymentStatus.CREATED,
        },
        data: { status: PaymentStatus.FAILED },
      });
    }
  }

  /**
   * The idempotency guard — the single most important lines in this phase.
   *
   * Razorpay delivers at-least-once. A retry after a timeout, a manual
   * "resend" from the dashboard, or two events for one payment all deliver the
   * same order_id twice. Read-then-write would grant twice.
   *
   * `status: CREATED` in the WHERE clause is what makes the transition
   * one-way: the first call matches one row and flips it to PAID; every
   * subsequent call matches zero, because the row is no longer CREATED.
   * `count === 1` is therefore not "did the update work" — it's "am I the one
   * who won the race", and only the winner grants credits.
   *
   * Same conditional-update-and-check-rowcount shape as spending a credit in
   * Phase 3e, used for the opposite direction.
   */
  private async markPaid(
    orderId: string,
    razorpayPaymentId: string,
  ): Promise<void> {
    console.log('marking paid');

    const { count } = await this.prisma.payment.updateMany({
      where: { razorpayOrderId: orderId, status: PaymentStatus.CREATED },
      data: { status: PaymentStatus.PAID, razorpayPaymentId },
    });

    console.log('count val is :', count);
    if (count === 0) {
      this.logger.log(`Ignoring duplicate webhook for ${orderId}`);
      return;
    }

    // Re-read rather than trusting anything from the webhook body. The amount
    // and credits come from the row WE wrote at checkout time, so a forged or
    // replayed payload can't change what gets granted.
    const payment = await this.prisma.payment.findUnique({
      where: { razorpayOrderId: orderId },
    });
    console.log(payment);

    if (!payment) return;

    await this.credits.grant(
      payment.userId,
      payment.creditsGranted,
      CreditReason.PURCHASE,
      payment.id,
    );

    this.logger.log(
      `Granted ${payment.creditsGranted} credits to ${payment.userId}`,
    );
  }

  /**
   * Razorpay ships `Razorpay.validateWebhookSignature(body, signature, secret)`
   * and it works — but I read its source: it compares with `===`, which is not
   * constant-time. `timingSafeEqual` costs one extra line and removes the
   * class of attack entirely. It also needs equal-length buffers, hence the
   * length check first — timingSafeEqual throws otherwise.
   */
  verifySignature(rawBody: Buffer, signature: string): boolean {
    const expected = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');

    return a.length === b.length && timingSafeEqual(a, b);
  }
}

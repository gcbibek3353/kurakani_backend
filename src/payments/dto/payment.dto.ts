import { ApiProperty } from '@nestjs/swagger';

import { CREDIT_PACKS } from '../credit-packs.js';

export class CreateOrderDto {
  @ApiProperty({
    enum: Object.keys(CREDIT_PACKS),
    enumName: 'CreditPackId',
    description: 'Which pack to buy. The server owns the price.',
    example: 'starter',
  })
  packId: string;
}

/**
 * A pack as offered to the browser.
 *
 * Served from GET /api/payments/packs rather than hardcoded in the frontend,
 * so prices live in exactly one place. The billing page renders whatever this
 * returns; editing credit-packs.ts is the whole deployment.
 */
export class CreditPackDto {
  @ApiProperty({ example: 'starter' })
  id: string;

  @ApiProperty({ description: 'Credits granted once the payment is captured.' })
  credits: number;

  @ApiProperty({
    description: 'Price in paise — integer subunits, never a float. ₹99 is 9900.',
    example: 9900,
  })
  amountPaise: number;
}

/**
 * What the browser needs to open Razorpay checkout.
 *
 * No key secret, obviously — checkout is opened with the public key id, which
 * the frontend already has from NEXT_PUBLIC_RAZORPAY_KEY_ID.
 */
export class OrderDto {
  @ApiProperty({
    description: 'Razorpay order id. Pass as `order_id` to checkout.',
    example: 'order_MkT8xY2zAbCdEf',
  })
  orderId: string;

  @ApiProperty({ example: 9900 })
  amountPaise: number;

  @ApiProperty({ description: 'Credits this purchase will grant, once captured.' })
  credits: number;

  @ApiProperty({
    description:
      'Local Payment row id. Useful for support; credits are granted by the ' +
      'webhook, never by the browser reporting success.',
  })
  paymentId: string;
}

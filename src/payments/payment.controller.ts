import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AllowAnonymous, Session } from '@thallesp/nestjs-better-auth';
// `import type` is required: with isolatedModules + emitDecoratorMetadata, a
// value import used only as a decorated parameter's type is a compile error.
import type { UserSession } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';

import { CREDIT_PACKS, isCreditPackId } from './credit-packs.js';
import {
  CreateOrderDto,
  CreditPackDto,
  OrderDto,
} from './dto/payment.dto.js';
import { PaymentsService } from './payments.service.js';
import type { RazorpayWebhookBody } from './razorpay-webhook.types.js';

@ApiTags('payments')
@Controller('api/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('packs')
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'The credit packs on offer',
    description:
      'Served from the server so prices live in one place. The billing page ' +
      'renders whatever this returns rather than hardcoding amounts.',
  })
  @ApiOkResponse({ type: [CreditPackDto] })
  listPacks(): CreditPackDto[] {
    return Object.entries(CREDIT_PACKS).map(([id, pack]) => ({
      id,
      credits: pack.credits,
      amountPaise: pack.amountPaise,
    }));
  }

  @Post('order')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Create a Razorpay order for a pack' })
  @ApiBody({ type: CreateOrderDto })
  @ApiOkResponse({ type: OrderDto })
  async createOrder(
    @Session() session: UserSession,
    @Body('packId') packId: unknown,
  ): Promise<OrderDto> {
    if (!isCreditPackId(packId)) throw new BadRequestException('Unknown pack');
    return this.payments.createOrder(session.user.id, packId);
  }

  @Post('webhook')
  // Excluded from the docs: it is called by Razorpay, never by the frontend,
  // so publishing it into the generated client would only add a route nobody
  // should call from a browser.
  @ApiExcludeEndpoint()
  // Razorpay has no session cookie. Same escape hatch as the share route —
  // but here the request is authenticated by HMAC instead, so the route is
  // anonymous, not unauthenticated.
  @AllowAnonymous()
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: Request,
    @Headers('x-razorpay-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    const raw = req.rawBody;
    if (!raw || !signature)
      throw new BadRequestException('Missing body or signature');

    // Verify BEFORE looking at the body. Until this passes, the payload is
    // just bytes an anonymous caller posted to a public URL.
    if (!this.payments.verifySignature(raw, signature)) {
      throw new UnauthorizedException('Bad signature');
    }

    const body = JSON.parse(raw.toString('utf8')) as RazorpayWebhookBody;
    await this.payments.handleWebhook(body.event, body);

    // 200 tells Razorpay to stop retrying. Anything else and it comes back.
    return { received: true };
  }
}

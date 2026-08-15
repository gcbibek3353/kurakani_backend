import { Module } from '@nestjs/common';

import { CreditsModule } from '../credits/credits.module.js';
import { PaymentsController } from './payment.controller.js';
import { PaymentsService } from './payments.service.js';

/**
 * Imports CreditsModule rather than touching CreditBalance directly, so every
 * balance change in the app still goes through the one service that writes the
 * ledger alongside it.
 */
@Module({
  imports: [CreditsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}

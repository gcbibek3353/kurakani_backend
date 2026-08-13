import { Module } from '@nestjs/common';

import { CreditsService } from './credits.service.js';

@Module({
  providers: [CreditsService],
  // Exported for ChatModule now, and for PaymentsModule in Phase 7 — which
  // will grant credits through the same ledger-writing path.
  exports: [CreditsService],
})
export class CreditsModule {}

import { Controller, Get } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // The AuthGuard from @thallesp/nestjs-better-auth is global, so every route is
  // protected by default and this liveness check would 401 without opting out.
  @Get()
  @AllowAnonymous()
  getHello(): string {
    return this.appService.getHello();
  }
}

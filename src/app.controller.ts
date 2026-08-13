import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { AppService } from './app.service.js';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // The AuthGuard from @thallesp/nestjs-better-auth is global, so every route is
  // protected by default and this liveness check would 401 without opting out.
  @Get()
  @AllowAnonymous()
  @ApiOperation({ summary: 'Liveness check' })
  @ApiOkResponse({ type: String })
  getHello(): string {
    return this.appService.getHello();
  }
}

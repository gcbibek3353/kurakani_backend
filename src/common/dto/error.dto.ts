import { ApiProperty } from '@nestjs/swagger';

/**
 * Nest's default exception body (`{ statusCode, message, error }`). Declared
 * once here so every controller can point its error responses at the same
 * schema instead of re-describing it.
 */
export class ErrorResponseDto {
  @ApiProperty({ example: 403 })
  statusCode: number;

  @ApiProperty({ example: 'Conversation not found' })
  message: string;

  @ApiProperty({ required: false, example: 'Forbidden' })
  error?: string;
}

/**
 * The 402 from POST /api/chat. Split out from ErrorResponseDto because the
 * frontend keys off `error: 'INSUFFICIENT_CREDITS'` — a stable machine-readable
 * code, unlike `message`, which is prose and may change.
 */
export class InsufficientCreditsDto {
  @ApiProperty({ example: 402 })
  statusCode: number;

  @ApiProperty({ enum: ['INSUFFICIENT_CREDITS'] })
  error: 'INSUFFICIENT_CREDITS';

  @ApiProperty({ example: 'Out of credits' })
  message: string;
}

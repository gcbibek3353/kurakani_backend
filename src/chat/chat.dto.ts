import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Shape of the POST /api/chat request body.
 *
 * `conversationId` is optional on purpose: omitting it means "start a new
 * conversation". The server creates the row and tells the client the new id
 * through a `conversation` SSE event, so the browser never invents ids.
 *
 * A class rather than an interface so @nestjs/swagger can read it at runtime —
 * interfaces vanish at compile time and would document as an empty object.
 * Validation is still the hand-rolled guard below, not class-validator.
 */
export class ChatDto {
  @ApiProperty({
    description: 'The user turn. Must be non-empty after trimming.',
    example: 'Explain SSE in one paragraph.',
  })
  message: string;

  @ApiPropertyOptional({
    description:
      'Omit to start a new conversation; the id comes back in the first SSE frame.',
  })
  conversationId?: string;
}

export function isValidChatDto(body: unknown): body is ChatDto {
  if (typeof body !== 'object' || body === null) return false;
  const dto = body as ChatDto;

  if (typeof dto.message !== 'string' || dto.message.trim().length === 0)
    return false;
  if (
    dto.conversationId !== undefined &&
    typeof dto.conversationId !== 'string'
  )
    return false;

  return true;
}

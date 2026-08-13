import { ApiProperty } from '@nestjs/swagger';

import { ChatMode } from '../../generated/prisma/enums.js';

/**
 * The frames POST /api/chat writes to the SSE body, one class per `type`.
 *
 * OpenAPI has no vocabulary for "a stream of JSON objects", so the response is
 * declared as a `oneOf` over these and the frontend applies it per parsed
 * frame. Single-value `enum` on each `type` is what turns them into a
 * discriminated union on the client — narrowing on `event.type` then works the
 * same way the old hand-written union did, except it comes from the server.
 *
 * Ordering note for anyone editing the controller: `credits` and
 * `conversation` are always sent first, before any `token`.
 */
export class ConversationRefDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Derived from the first message, 60 chars max.' })
  title: string;

  // Carried here so a client that inserts this conversation into its sidebar
  // has the whole summary and never has to invent a default.
  @ApiProperty({ enum: ChatMode, enumName: 'ChatMode' })
  mode: ChatMode;
}

export class ChatConversationEventDto {
  @ApiProperty({ enum: ['conversation'] })
  type: 'conversation';

  @ApiProperty({ type: ConversationRefDto })
  value: ConversationRefDto;
}

export class ChatCreditsEventDto {
  @ApiProperty({ enum: ['credits'] })
  type: 'credits';

  @ApiProperty({
    description: 'Balance remaining after this turn was charged.',
  })
  value: number;
}

export class ChatTokenEventDto {
  @ApiProperty({ enum: ['token'] })
  type: 'token';

  @ApiProperty({ description: 'A text delta. Append it; do not replace.' })
  value: string;
}

export class ChatDoneEventDto {
  @ApiProperty({ enum: ['done'] })
  type: 'done';
}

export class ChatErrorEventDto {
  @ApiProperty({ enum: ['error'] })
  type: 'error';

  @ApiProperty()
  value: string;
}

export const CHAT_STREAM_EVENTS = [
  ChatConversationEventDto,
  ChatCreditsEventDto,
  ChatTokenEventDto,
  ChatDoneEventDto,
  ChatErrorEventDto,
] as const;

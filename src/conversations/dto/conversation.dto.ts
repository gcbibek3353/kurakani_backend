import { ApiProperty } from '@nestjs/swagger';

import { ChatMode, MessageRole } from '../../generated/prisma/enums.js';

/**
 * `enumName` is what makes these emit a *named*, reusable component
 * (`#/components/schemas/ChatMode`) instead of being inlined at every use
 * site — so the generated frontend types get one `ChatMode` union to import
 * rather than five identical anonymous ones.
 */
export class ConversationSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'How do I set up Swagger in Nest?' })
  title: string;

  @ApiProperty({ enum: ChatMode, enumName: 'ChatMode' })
  mode: ChatMode;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'Bumped on every turn. The sidebar is ordered by this, descending.',
  })
  updatedAt: Date;
}

export class MessageDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: MessageRole, enumName: 'MessageRole' })
  role: MessageRole;

  @ApiProperty()
  content: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

/**
 * GET /api/conversations/:id — the full transcript, unlike the summary the
 * sidebar list returns.
 */
export class ConversationDetailDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ enum: ChatMode, enumName: 'ChatMode' })
  mode: ChatMode;

  @ApiProperty({ type: [MessageDto], description: 'Oldest first.' })
  messages: MessageDto[];
}

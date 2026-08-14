import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Set when an active share link exists. Owner-only — this endpoint is ' +
      'already scoped to the signed-in user.',
  })
  shareToken?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Snapshot cutoff of the current share link.',
  })
  sharedAt?: Date | null;
}

export class ShareLinkDto {
  @ApiProperty({
    description: 'Opaque token. The public URL is <frontend>/share/<token>.',
    example: '2f6b1c30-9a4e-4c1d-8f21-6b0e3a7c5d99',
  })
  token: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Snapshot cutoff — messages sent after this are not published.',
  })
  sharedAt: Date;
}

/**
 * GET /api/share/:token — the public view.
 *
 * Deliberately narrower than ConversationDetailDto: no conversation id, no
 * mode, no attached documents, nothing that identifies the author. A public
 * payload should carry the minimum that renders the page.
 */
export class SharedConversationDto {
  @ApiProperty()
  title: string;

  @ApiProperty({ type: String, format: 'date-time' })
  sharedAt: Date;

  @ApiProperty({
    type: [MessageDto],
    description: 'Oldest first, and only those sent at or before sharedAt.',
  })
  messages: MessageDto[];
}

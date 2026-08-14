import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { IngestStatus, SourceType } from '../../generated/prisma/enums.js';

export class DocumentDto {
  @ApiProperty() id: string;
  @ApiProperty() conversationId: string;

  @ApiProperty({ enum: SourceType, enumName: 'SourceType' })
  sourceType: SourceType;

  @ApiProperty({ enum: IngestStatus, enumName: 'IngestStatus' })
  status: IngestStatus;

  @ApiPropertyOptional({ type: String, nullable: true }) filename:
    string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) sourceUrl:
    string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Populated when status is FAILED — show it to the user verbatim.',
  })
  error: string | null;

  @ApiProperty({ description: 'Chunks embedded. Zero while pending.' })
  chunkCount: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
}

export class IngestUrlDto {
  @ApiProperty({
    description: 'A YouTube link or any web page. The backend classifies it.',
    example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  })
  url: string;

  @ApiProperty() conversationId: string;
}

/** One retrieved chunk, surfaced as a citation in the chat stream. */
export class SourceChunkDto {
  @ApiProperty() documentId: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional() page?: number;

  @ApiProperty({ description: 'Cosine distance — lower is closer.' })
  score: number;

  @ApiProperty({ description: 'The chunk text, truncated for display.' })
  excerpt: string;
}

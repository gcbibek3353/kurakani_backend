import { ApiProperty } from '@nestjs/swagger';

/**
 * One long-term fact, as shown on the settings page.
 *
 * Deliberately narrower than mem0's own `MemoryItem`: no `metadata`, no
 * `score`. The payload mem0 stores carries internal scoping keys (`user_id`,
 * `hash`, lemmatized text) and there is no reason to hand any of that to a
 * browser. Mapping explicitly in the controller means a future mem0 upgrade
 * that adds a field can't silently start leaking it.
 */
export class MemoryItemDto {
  @ApiProperty({ description: 'mem0 id — pass to DELETE /api/memory/:id.' })
  id: string;

  @ApiProperty({
    description: 'The extracted fact, e.g. "Is vegetarian".',
    example: 'Prefers TypeScript over JavaScript',
  })
  memory: string;

  @ApiProperty({
    required: false,
    description: 'ISO timestamp, if mem0 recorded one.',
  })
  createdAt?: string;

  @ApiProperty({ required: false })
  updatedAt?: string;
}

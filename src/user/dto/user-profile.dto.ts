import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shape of GET /api/me.
 *
 * This class exists purely so the OpenAPI document has something concrete to
 * point at — the handler still returns a plain object. Keeping it as a class
 * (not an interface) is what lets @nestjs/swagger read it at runtime: types
 * are erased at compile time, decorators are not.
 */
export class UserProfileDto {
  @ApiProperty({ example: 'cm4x2k9p0000abcdef' })
  id: string;

  @ApiProperty({ format: 'email', example: 'hi@hyperce.io' })
  email: string;

  @ApiProperty({ example: 'Bivek' })
  name: string;

  @ApiProperty({
    description:
      'Remaining credits. One is spent per chat message; at 0 the chat endpoint answers 402.',
    example: 25,
  })
  credits: number;
}

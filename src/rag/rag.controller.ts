import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { DocumentDto, IngestUrlDto } from './dto/rag.dto.js';
import { IngestionService } from './ingestion.service.js';

const MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * Ingestion spends real money and real time — an embedding call per chunk —
 * and unlike chat it costs no credits, so a rate limit is the only thing
 * standing between one user and the Gemini quota.
 */
const INGEST_LIMIT = {
  burst: { limit: 2, ttl: 5_000 },
  sustained: { limit: 20, ttl: 60_000 },
};

@ApiTags('rag')
@ApiCookieAuth()
@Controller('api/rag')
export class RagController {
  constructor(private readonly ingestion: IngestionService) {}

  @Post('upload')
  @Throttle(INGEST_LIMIT)
  @ApiOperation({
    summary: 'Upload a PDF for retrieval',
    description:
      'Returns immediately with status PENDING. Poll GET /api/rag/documents until ' +
      'READY or FAILED — embedding a long PDF takes tens of seconds.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'conversationId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        conversationId: { type: 'string' },
      },
    },
  })
  @ApiCreatedResponse({ type: DocumentDto })
  // memoryStorage: the buffer goes straight to MinIO and the parser, so writing
  // it to local disk first would just be a temp file to clean up.
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES } }),
  )
  async upload(
    @Session() session: UserSession,
    @UploadedFile() file: Express.Multer.File,
    @Body('conversationId') conversationId: string,
  ): Promise<DocumentDto> {
    if (!file) throw new BadRequestException('No file uploaded');
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Only PDF uploads are supported');
    }
    if (!conversationId)
      throw new BadRequestException('conversationId is required');

    return this.ingestion.ingestPdf(session.user.id, conversationId, file);
  }

  @Post('url')
  @Throttle(INGEST_LIMIT)
  @ApiOperation({ summary: 'Ingest a YouTube or web URL' })
  @ApiCreatedResponse({ type: DocumentDto })
  async url(
    @Session() session: UserSession,
    @Body() body: IngestUrlDto,
  ): Promise<DocumentDto> {
    if (!body?.url || !body?.conversationId) {
      throw new BadRequestException('url and conversationId are required');
    }

    try {
      new URL(body.url);
    } catch {
      throw new BadRequestException('Not a valid URL');
    }

    return this.ingestion.ingestUrl(
      session.user.id,
      body.conversationId,
      body.url,
    );
  }

  @Get('documents')
  @ApiOperation({ summary: 'Ingestion status for one conversation' })
  @ApiOkResponse({ type: [DocumentDto] })
  async list(
    @Session() session: UserSession,
    @Query('conversationId') conversationId: string,
  ): Promise<DocumentDto[]> {
    if (!conversationId)
      throw new BadRequestException('conversationId is required');
    return this.ingestion.list(session.user.id, conversationId);
  }

  @Delete('documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a document, its vectors and its stored file',
  })
  async remove(
    @Session() session: UserSession,
    @Param('id') id: string,
  ): Promise<void> {
    await this.ingestion.remove(session.user.id, id);
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    // MINIO_ENDPOINT is a URL, but the client wants the pieces separately —
    // passing "http://localhost:9000" as endPoint produces a DNS lookup for a
    // host literally named "http://localhost:9000".
    const endpoint = new URL(config.getOrThrow<string>('MINIO_ENDPOINT'));
    const useSSL = endpoint.protocol === 'https:';

    this.bucket = config.get<string>('MINIO_BUCKET') ?? 'kurakani-documents';

    this.client = new Client({
      endPoint: endpoint.hostname,
      port: Number(endpoint.port || (useSSL ? 443 : 80)),
      useSSL,
      accessKey: config.getOrThrow<string>('MINIO_ROOT_USER'),
      secretKey: config.getOrThrow<string>('MINIO_ROOT_PASSWORD'),
    });
  }

  async onModuleInit(): Promise<void> {
    // Creating it here means a fresh `docker compose down -v` doesn't leave
    // uploads failing with a confusing NoSuchBucket at request time.
    if (!(await this.client.bucketExists(this.bucket))) {
      await this.client.makeBucket(this.bucket);
      this.logger.log(`Created bucket ${this.bucket}`);
    }
  }

  /**
   * Store the raw PDF and return its key.
   *
   * The userId prefix is not access control — nothing here reads it to make a
   * decision — but it makes the bucket browsable and means a leaked key can't
   * be walked backwards into a filename-only guess.
   */
  async putPdf(
    userId: string,
    documentId: string,
    buffer: Buffer,
  ): Promise<string> {
    const objectKey = `${userId}/${documentId}.pdf`;

    await this.client.putObject(this.bucket, objectKey, buffer, buffer.length, {
      'Content-Type': 'application/pdf',
    });

    return objectKey;
  }

  async getBuffer(objectKey: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, objectKey);

    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);

    return Buffer.concat(chunks);
  }

  /**
   * Best-effort. A deleted Document row with an orphaned object costs disk;
   * a failed delete that aborts the whole request costs the user their action.
   */
  async remove(objectKey: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, objectKey);
    } catch (error) {
      this.logger.warn(
        `Failed to remove ${objectKey}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

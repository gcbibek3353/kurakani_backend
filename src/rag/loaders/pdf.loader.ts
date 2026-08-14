import { PDFParse } from 'pdf-parse';

import type { LoadedSource } from './types.js';

/**
 * pdf-parse v2 is a pdfjs-based rewrite: a `PDFParse` class, not v1's default
 * function. LangChain's PDFLoader still imports `pdf-parse/lib/pdf-parse.js`,
 * a path that no longer exists in v2 — which is why this calls the library
 * directly instead.
 *
 * The upside is per-page text, which v1 didn't expose without custom callbacks.
 */
export async function loadPdf(
  buffer: Buffer,
  filename: string,
): Promise<LoadedSource> {
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();

    return {
      title: filename,
      sections: result.pages
        .map((page) => ({ text: page.text.trim(), page: page.num }))
        // A scanned PDF is images: pdfjs extracts nothing and every page is
        // empty. Dropping them here makes the caller's chunkCount === 0 check
        // the single place that detects it.
        .filter((section) => section.text.length > 0),
    };
  } finally {
    // Releases the pdfjs worker. Skip it and long-running ingestion leaks
    // workers until the process runs out of memory.
    await parser.destroy();
  }
}

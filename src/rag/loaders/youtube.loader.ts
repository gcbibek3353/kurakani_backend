import { YoutubeTranscript, YoutubeTranscriptError } from 'youtube-transcript';

import type { LoadedSource } from './types.js';

/**
 * Transcripts arrive as hundreds of ~2-second fragments. They're joined into
 * one blob and handed to the splitter, which produces chunks on sentence
 * boundaries — splitting on the raw fragments would cut mid-sentence and
 * embed meaningless slivers.
 */
export async function loadYoutube(url: string): Promise<LoadedSource> {
  try {
    // Takes a full URL or a bare video id; it extracts the id itself.
    const fragments = await YoutubeTranscript.fetchTranscript(url);

    const text = fragments
      .map((fragment) => fragment.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) throw new Error('Transcript was empty');

    return { title: url, sections: [{ text }] };
  } catch (error) {
    // The library throws typed errors for the common cases. Surfacing the real
    // reason matters: "captions are disabled on this video" is actionable,
    // "ingestion failed" is not. A large share of YouTube videos have no
    // transcript at all.
    if (error instanceof YoutubeTranscriptError) {
      throw new Error(`No usable transcript: ${error.message}`);
    }
    throw error;
  }
}

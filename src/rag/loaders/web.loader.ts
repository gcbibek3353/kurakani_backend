import * as cheerio from 'cheerio';

import type { LoadedSource } from './types.js';

export async function loadWeb(url: string): Promise<LoadedSource> {
  const response = await fetch(url, {
    // Some sites 403 an unrecognised agent. Being honest about who we are is
    // better than impersonating a browser.
    headers: { 'User-Agent': 'KurakaniBot/1.0' },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw new Error(`Fetch failed with ${response.status}`);

  const $ = cheerio.load(await response.text());

  // Strip the furniture first. Without this, every page's chunks are half
  // navigation menus and cookie banners, which embed as noise and crowd out
  // the actual content at retrieval time.
  $('script, style, nav, header, footer, aside, noscript, iframe').remove();

  const title = $('title').first().text().trim() || url;
  const text = $('body').text().replace(/\s+/g, ' ').trim();

  if (!text) throw new Error('No readable text found at that URL');

  return { title, sections: [{ text }] };
}

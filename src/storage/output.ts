import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { slugFromUrl } from '../utils/url.ts';
import type { ScrapeResult } from '../core/scraper.ts';
import type { ShuvcrawlConfig } from '../config/schema.ts';

export async function writeScrapeOutput(result: ScrapeResult, config: ShuvcrawlConfig): Promise<{ markdownPath: string; jsonPath: string; metaPath?: string }> {
  const url = new URL(result.url);
  const domainDir = path.join(config.output.dir, url.hostname);
  await mkdir(domainDir, { recursive: true });
  const slug = slugFromUrl(result.url);
  const markdownPath = path.join(domainDir, `${slug}.md`);
  const jsonPath = path.join(domainDir, `${slug}.json`);

  await writeFile(markdownPath, result.content, 'utf8');
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  let metaPath: string | undefined;
  if (config.output.metaLog) {
    metaPath = path.join(domainDir, '_meta.jsonl');
    await appendFile(metaPath, `${JSON.stringify({
      requestId: result.metadata.requestId,
      url: result.url,
      scrapedAt: result.metadata.scrapedAt,
      bypassMethod: result.metadata.bypassMethod,
      elapsed: result.metadata.elapsed,
      wordCount: result.metadata.wordCount,
      status: result.metadata.status,
    })}\n`, 'utf8');
  }

  return { markdownPath, jsonPath, metaPath };
}

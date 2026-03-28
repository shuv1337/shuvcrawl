import { appendFile, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { slugFromUrl, slugFromUrlWithHash } from '../utils/url.ts';
import type { ScrapeResult } from '../core/scraper.ts';
import type { ShuvcrawlConfig } from '../config/schema.ts';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getExistingUrlFromJson(jsonPath: string): Promise<string | null> {
  try {
    const content = await readFile(jsonPath, 'utf8');
    const data = JSON.parse(content) as { url?: string };
    return data.url ?? null;
  } catch {
    return null;
  }
}

async function findUniqueSlug(
  domainDir: string,
  url: string,
): Promise<string> {
  let baseSlug = slugFromUrlWithHash(url);
  let slug = baseSlug;
  let counter = 0;

  while (true) {
    const jsonPath = path.join(domainDir, `${slug}.json`);

    if (!(await fileExists(jsonPath))) {
      return slug;
    }

    // File exists - check if it's the same URL
    const existingUrl = await getExistingUrlFromJson(jsonPath);
    if (existingUrl === url) {
      // Same URL - use this slug
      return slug;
    }

    // Different URL (hash collision) - add suffix and try again
    counter++;
    slug = `${baseSlug}-${counter}`;
  }
}

export async function writeScrapeOutput(
  result: ScrapeResult,
  config: ShuvcrawlConfig,
): Promise<{ markdownPath?: string; jsonPath: string; metaPath?: string }> {
  const url = new URL(result.url);
  const domainDir = path.join(config.output.dir, url.hostname);
  await mkdir(domainDir, { recursive: true });

  const slug = await findUniqueSlug(domainDir, result.url);
  const jsonPath = path.join(domainDir, `${slug}.json`);

  // Always write JSON
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  // Write markdown only when format is 'markdown' (the default)
  let markdownPath: string | undefined;
  if (config.output.format === 'markdown') {
    markdownPath = path.join(domainDir, `${slug}.md`);
    await writeFile(markdownPath, result.content, 'utf8');
  }

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

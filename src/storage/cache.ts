import { readFile, writeFile, readdir, unlink, stat, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { expandHome } from '../utils/paths.ts';
import type { ScrapeResult } from '../core/scraper.ts';

export type CacheKeyInput = {
  url: string;
  format: string;
  mobile: boolean;
  fastPath: boolean;
  bpc: boolean;
  selector?: string | null;
  proxy?: string | null;
  wait?: string | null;
  waitFor?: string | null;
  sleep?: number | null;
  headers?: Record<string, string> | null;
  onlyMainContent?: boolean | null;
  rawHtml?: boolean;
};

export type CacheEntry = {
  key: string;
  cachedAt: number;
  result: ScrapeResult;
};

export function buildCacheKey(input: CacheKeyInput): string {
  return JSON.stringify({
    url: input.url,
    format: input.format,
    mobile: input.mobile,
    fastPath: input.fastPath,
    bpc: input.bpc,
    selector: input.selector ?? null,
    proxy: input.proxy ?? null,
    wait: input.wait ?? null,
    waitFor: input.waitFor ?? null,
    sleep: input.sleep ?? null,
    headers: input.headers ?? null,
    onlyMainContent: input.onlyMainContent ?? null,
    rawHtml: input.rawHtml ?? false,
  });
}

export function hashCacheKey(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export async function readCache(
  cacheDir: string,
  key: string,
  ttl: number,
): Promise<ScrapeResult | null> {
  const expandedDir = expandHome(cacheDir);
  const hash = hashCacheKey(key);
  const cachePath = path.join(expandedDir, `${hash}.json`);

  try {
    const content = await readFile(cachePath, 'utf8');
    const entry: CacheEntry = JSON.parse(content);

    // Verify key matches to detect hash collision
    if (entry.key !== key) {
      // Hash collision - treat as cache miss
      return null;
    }

    // Check TTL
    const now = Date.now();
    if (now - entry.cachedAt > ttl * 1000) {
      return null;
    }

    return entry.result;
  } catch {
    // File doesn't exist or is corrupt - cache miss
    return null;
  }
}

export async function writeCache(
  cacheDir: string,
  key: string,
  result: ScrapeResult,
): Promise<void> {
  const expandedDir = expandHome(cacheDir);
  await mkdir(expandedDir, { recursive: true });

  const hash = hashCacheKey(key);
  const cachePath = path.join(expandedDir, `${hash}.json`);

  const entry: CacheEntry = {
    key,
    cachedAt: Date.now(),
    result,
  };

  await writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf8');
}

export async function listCache(cacheDir: string): Promise<Array<{ hash: string; key: string; cachedAt: number; size: number }>> {
  const expandedDir = expandHome(cacheDir);

  try {
    const entries = await readdir(expandedDir, { withFileTypes: true });
    const results: Array<{ hash: string; key: string; cachedAt: number; size: number }> = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

      const hash = entry.name.slice(0, -5); // Remove .json
      const cachePath = path.join(expandedDir, entry.name);

      try {
        const [content, stats] = await Promise.all([
          readFile(cachePath, 'utf8'),
          stat(cachePath),
        ]);

        const cacheEntry: CacheEntry = JSON.parse(content);
        results.push({
          hash,
          key: cacheEntry.key,
          cachedAt: cacheEntry.cachedAt,
          size: stats.size,
        });
      } catch {
        // Skip corrupt entries
      }
    }

    return results.sort((a, b) => b.cachedAt - a.cachedAt);
  } catch {
    return [];
  }
}

export async function clearCache(
  cacheDir: string,
  olderThan?: number,
): Promise<{ deleted: number; skipped: number }> {
  const expandedDir = expandHome(cacheDir);

  try {
    const entries = await readdir(expandedDir, { withFileTypes: true });
    let deleted = 0;
    let skipped = 0;
    const cutoff = olderThan ? Date.now() - olderThan * 1000 : 0;

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        skipped++;
        continue;
      }

      const cachePath = path.join(expandedDir, entry.name);

      if (olderThan) {
        try {
          const content = await readFile(cachePath, 'utf8');
          const cacheEntry: CacheEntry = JSON.parse(content);

          if (cacheEntry.cachedAt >= cutoff) {
            skipped++;
            continue;
          }
        } catch {
          // If we can't read it, delete it anyway
        }
      }

      try {
        await unlink(cachePath);
        deleted++;
      } catch {
        skipped++;
      }
    }

    return { deleted, skipped };
  } catch {
    return { deleted: 0, skipped: 0 };
  }
}

export async function getCacheStats(cacheDir: string): Promise<{ entries: number; totalSize: number }> {
  const entries = await listCache(cacheDir);
  return {
    entries: entries.length,
    totalSize: entries.reduce((sum, e) => sum + e.size, 0),
  };
}

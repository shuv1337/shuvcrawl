import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildCacheKey,
  hashCacheKey,
  readCache,
  writeCache,
  listCache,
  clearCache,
  getCacheStats,
} from '../../src/storage/cache.ts';
import type { ScrapeResult } from '../../src/core/scraper.ts';

describe('cache key building', () => {
  it('includes material dimensions', () => {
    const a = buildCacheKey({
      url: 'https://example.com/article',
      format: 'markdown',
      mobile: false,
      fastPath: true,
      bpc: true,
      selector: null,
      proxy: null,
    });
    const b = buildCacheKey({
      url: 'https://example.com/article',
      format: 'markdown',
      mobile: true,
      fastPath: true,
      bpc: true,
      selector: null,
      proxy: null,
    });

    expect(a).not.toEqual(b);
  });

  it('includes rawHtml and sleep in the key', () => {
    const a = buildCacheKey({
      url: 'https://example.com/article',
      format: 'markdown',
      mobile: false,
      fastPath: true,
      bpc: true,
      rawHtml: false,
      sleep: null,
    });
    const b = buildCacheKey({
      url: 'https://example.com/article',
      format: 'markdown',
      mobile: false,
      fastPath: true,
      bpc: true,
      rawHtml: true,
      sleep: 250,
    });

    expect(a).not.toEqual(b);
  });

  it('produces stable 16-char hash', () => {
    const key = buildCacheKey({
      url: 'https://example.com',
      format: 'markdown',
      mobile: false,
      fastPath: true,
      bpc: true,
    });
    const hash = hashCacheKey(key);
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  it('different keys produce different hashes', () => {
    const key1 = buildCacheKey({ url: 'https://a.com', format: 'markdown', mobile: false, fastPath: true, bpc: true });
    const key2 = buildCacheKey({ url: 'https://b.com', format: 'markdown', mobile: false, fastPath: true, bpc: true });
    expect(hashCacheKey(key1)).not.toEqual(hashCacheKey(key2));
  });
});

describe('cache read/write', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'shuvcrawl-cache-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const mockResult: ScrapeResult = {
    url: 'https://example.com',
    originalUrl: 'https://example.com',
    content: '# Test',
    html: '<h1>Test</h1>',
    metadata: {
      requestId: 'test-123',
      url: 'https://example.com',
      originalUrl: 'https://example.com',
      finalUrl: 'https://example.com',
      canonicalUrl: null,
      scrapedAt: new Date().toISOString(),
      title: 'Test',
      author: null,
      publishedAt: null,
      modifiedAt: null,
      description: null,
      siteName: null,
      language: null,
      wordCount: 1,
      extractionMethod: 'readability',
      extractionConfidence: 0.9,
      bypassMethod: 'direct',
      waitStrategy: 'load',
      browserUsed: false,
      elapsed: 100,
      status: 'success',
      openGraph: null,
      twitterCards: null,
      ldJson: null,
    },
  };

  it('writes and reads cache entry', async () => {
    const key = buildCacheKey({ url: 'https://example.com', format: 'markdown', mobile: false, fastPath: true, bpc: true });

    await writeCache(tmpDir, key, mockResult);
    const result = await readCache(tmpDir, key, 3600);

    expect(result).toEqual(mockResult);
  });

  it('returns null for cache miss', async () => {
    const key = buildCacheKey({ url: 'https://notfound.com', format: 'markdown', mobile: false, fastPath: true, bpc: true });
    const result = await readCache(tmpDir, key, 3600);
    expect(result).toBeNull();
  });

  it('returns null for expired TTL', async () => {
    const key = buildCacheKey({ url: 'https://example.com', format: 'markdown', mobile: false, fastPath: true, bpc: true });

    await writeCache(tmpDir, key, mockResult);
    // TTL of -1 means everything is already expired (cachedAt + ttl*1000 < now)
    const result = await readCache(tmpDir, key, -1);
    expect(result).toBeNull();
  });

  it('detects hash collision and returns null', async () => {
    // Create two different keys that could potentially collide
    const key1 = buildCacheKey({ url: 'https://a.com', format: 'markdown', mobile: false, fastPath: true, bpc: true });
    const key2 = buildCacheKey({ url: 'https://b.com', format: 'markdown', mobile: false, fastPath: true, bpc: true });

    // Manually write key1's result to key2's hash location to simulate collision
    const hash2 = hashCacheKey(key2);
    const entry = {
      key: key1, // Wrong key stored
      cachedAt: Date.now(),
      result: mockResult,
    };
    const fs = await import('node:fs/promises');
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, `${hash2}.json`), JSON.stringify(entry), 'utf8');

    // Reading with key2 should detect collision and return null
    const result = await readCache(tmpDir, key2, 3600);
    expect(result).toBeNull();
  });

  it('lists cache entries', async () => {
    const key = buildCacheKey({ url: 'https://example.com', format: 'markdown', mobile: false, fastPath: true, bpc: true });
    await writeCache(tmpDir, key, mockResult);

    const entries = await listCache(tmpDir);
    expect(entries.length).toBe(1);
    expect(entries[0].key).toBe(key);
  });

  it('clears all cache entries', async () => {
    const key = buildCacheKey({ url: 'https://example.com', format: 'markdown', mobile: false, fastPath: true, bpc: true });
    await writeCache(tmpDir, key, mockResult);

    const result = await clearCache(tmpDir);
    expect(result.deleted).toBe(1);

    const entries = await listCache(tmpDir);
    expect(entries.length).toBe(0);
  });

  it('clears only entries older than threshold', async () => {
    const key = buildCacheKey({ url: 'https://example.com', format: 'markdown', mobile: false, fastPath: true, bpc: true });
    await writeCache(tmpDir, key, mockResult);

    // Clear entries older than 1 hour - our entry is fresh so it should stay
    const result = await clearCache(tmpDir, 3600);
    expect(result.deleted).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('reports cache stats', async () => {
    const key = buildCacheKey({ url: 'https://example.com', format: 'markdown', mobile: false, fastPath: true, bpc: true });
    await writeCache(tmpDir, key, mockResult);

    const stats = await getCacheStats(tmpDir);
    expect(stats.entries).toBe(1);
    expect(stats.totalSize).toBeGreaterThan(0);
  });
});

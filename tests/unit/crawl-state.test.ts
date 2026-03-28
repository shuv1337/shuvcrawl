import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadCrawlState, writeCrawlState, type CrawlState } from '../../src/storage/crawl-state.ts';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'shuvcrawl-crawl-state-'));
  tempDirs.push(dir);
  return dir;
}

describe('crawl state persistence', () => {
  it('preserves queued depth information', async () => {
    const outputDir = await createTempDir();
    const state: CrawlState = {
      jobId: 'crawl_123',
      status: 'running',
      seedUrl: 'https://example.com',
      options: {
        depth: 3,
        limit: 50,
        include: ['https://example.com/**'],
        exclude: [],
        delay: 1000,
        source: 'links',
        resume: true,
      },
      queue: [
        { url: 'https://example.com/docs', depth: 1 },
        { url: 'https://example.com/docs/api', depth: 2 },
      ],
      visited: ['https://example.com'],
      results: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await writeCrawlState(outputDir, 'example.com', state);
    const loaded = await loadCrawlState(outputDir, 'example.com');

    expect(loaded?.queue).toEqual(state.queue);
  });

  it('upgrades legacy string queues to depth-aware entries', async () => {
    const outputDir = await createTempDir();
    const domainDir = path.join(outputDir, 'example.com');
    await mkdir(domainDir, { recursive: true });
    const statePath = path.join(domainDir, '_crawl-state.json');
    await writeFile(statePath, JSON.stringify({
      jobId: 'crawl_legacy',
      status: 'running',
      seedUrl: 'https://example.com',
      options: {
        depth: 3,
        limit: 50,
        include: ['https://example.com/**'],
        exclude: [],
        delay: 1000,
        source: 'links',
        resume: true,
      },
      queue: ['https://example.com/docs'],
      visited: [],
      results: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }), 'utf8');

    const loaded = await loadCrawlState(outputDir, 'example.com');

    expect(loaded?.queue).toEqual([{ url: 'https://example.com/docs', depth: 0 }]);
  });
});

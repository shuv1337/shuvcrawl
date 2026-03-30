import { describe, expect, it, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crawlSite, type CrawlOptions } from '../../src/core/crawl.ts';
import { DomainRateLimiter } from '../../src/utils/rate-limit.ts';
import type { ShuvcrawlConfig } from '../../src/config/schema.ts';
import type { Logger } from '../../src/utils/logger.ts';
import type { BrowserPool } from '../../src/core/browser.ts';
import type { ScrapeResult } from '../../src/core/scraper.ts';
import type { ScrapeMetadata } from '../../src/core/metadata.ts';
import type { MapResult } from '../../src/core/map.ts';
import type { CrawlState } from '../../src/storage/crawl-state.ts';

// ============================================================================
// Test Helpers
// ============================================================================

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'shuvcrawl-resume-test-'));
  tempDirs.push(dir);
  return dir;
}

function createMockConfig(outputDir: string): ShuvcrawlConfig {
  return {
    output: {
      dir: outputDir,
      format: 'markdown',
      includeMetadata: true,
      metaLog: true,
      writeArtifactsOnFailure: true,
    },
    browser: {
      headless: true,
      executablePath: null,
      args: [],
      defaultTimeout: 30_000,
      viewport: { width: 1920, height: 1080 },
      profileRoot: '~/.shuvcrawl/browser',
      templateProfile: '~/.shuvcrawl/browser/template',
      runtimeProfile: '~/.shuvcrawl/browser/runtime',
      resetOnStart: false,
    },
    bpc: {
      enabled: true,
      sourceMode: 'bundled',
      path: './bpc-chrome',
      source: null,
      mode: 'conservative',
      enableUpdatedSites: true,
      enableCustomSites: false,
      excludeDomains: [],
      storageOverrides: {},
    },
    fastPath: {
      enabled: true,
      userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
      referer: 'https://www.google.com/',
      minContentLength: 500,
      tls: {
        rejectUnauthorized: true,
        caBundlePath: null,
      },
    },
    extraction: {
      selectorOverrides: {},
      stripSelectors: ['nav', 'footer', 'header'],
      minConfidence: 0.5,
    },
    artifacts: {
      enabled: true,
      dir: './output/_artifacts',
      onFailure: true,
      includeRawHtml: false,
      includeCleanHtml: true,
      includeScreenshot: true,
      includeConsole: true,
    },
    proxy: {
      url: null,
      rotatePerRequest: false,
    },
    api: {
      port: 3777,
      host: '0.0.0.0',
      token: null,
      rateLimit: 0,
    },
    cache: {
      enabled: false, // Disable cache for tests
      ttl: 3600,
      dir: '~/.shuvcrawl/cache',
      cacheFailures: false,
      staleOnError: false,
    },
    crawl: {
      defaultDepth: 3,
      defaultLimit: 50,
      delay: 0, // No delay for tests
      respectRobots: false, // Don't respect robots for tests
    },
    telemetry: {
      logs: true,
      logLevel: 'error', // Only show errors in tests
      otlpHttpEndpoint: null,
      serviceName: 'shuvcrawl',
      exporter: 'none',
    },
    storage: {
      jobDbPath: ':memory:',
    },
  };
}

/** Build a type-safe mock ScrapeMetadata with sensible defaults */
function createMockMetadata(url: string, overrides: Partial<ScrapeMetadata> = {}): ScrapeMetadata {
  return {
    requestId: 'test-req',
    url,
    originalUrl: url,
    finalUrl: url,
    canonicalUrl: null,
    scrapedAt: new Date().toISOString(),
    title: 'Mock',
    author: null,
    publishedAt: null,
    modifiedAt: null,
    description: null,
    siteName: null,
    language: null,
    wordCount: 10,
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
    ...overrides,
  };
}

function createMockLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function createMockBrowserPool(): BrowserPool {
  return {
    acquire: async () => ({
      context: {} as any,
      page: {} as any,
      extensionId: 'test-ext',
      release: async () => {},
      profileDir: '/tmp/test',
      consoleLogs: [],
    }),
  } as unknown as BrowserPool;
}

async function writeFakeCrawlState(
  outputDir: string,
  hostname: string,
  overrides: Partial<CrawlState> = {},
): Promise<void> {
  const domainDir = path.join(outputDir, hostname);
  await mkdir(domainDir, { recursive: true });
  const statePath = path.join(domainDir, '_crawl-state.json');

  const defaultState: CrawlState = {
    jobId: 'crawl_test_123',
    status: 'running',
    seedUrl: 'https://example.com/',
    options: {
      depth: 3,
      limit: 50,
      include: ['https://example.com/**'],
      exclude: [],
      delay: 0,
      source: 'links',
      resume: true,
    },
    queue: [],
    visited: [],
    results: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const state = { ...defaultState, ...overrides };
  await import('node:fs/promises').then((fs) =>
    fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8'),
  );
}

// ============================================================================
// Mocked Modules
// ============================================================================

const mockScrapeResults = new Map<string, ScrapeResult>();
const mockMapResults = new Map<string, MapResult>();
const mockOutputPaths = new Map<string, { jsonPath: string; markdownPath?: string; metaPath?: string }>();

// Helper to normalize URLs (must match the normalizeUrl function in src/utils/url.ts)
function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = '';
  return url.toString();
}

// Mock scraper module
// WARNING: Bun's mock.module() is process-global and irreversible within a
// test run. Integration tests are excluded from the default `bun test` via
// bunfig.toml to prevent these mocks from leaking into browser-based tests.
// See bunfig.toml [test].pathIgnorePatterns and package.json test:integration.
mock.module('../../src/core/scraper.ts', () => ({
  scrapeUrl: async (url: string): Promise<ScrapeResult> => {
    const normalizedUrl = normalizeUrl(url);
    const result = mockScrapeResults.get(normalizedUrl);
    if (result) return result;
    // Default fallback
    return {
      url: normalizedUrl,
      originalUrl: normalizedUrl,
      content: `# Mock content for ${normalizedUrl}`,
      html: `<h1>Mock</h1>`,
      metadata: createMockMetadata(normalizedUrl),
    };
  },
}));

// Mock map module
mock.module('../../src/core/map.ts', () => ({
  mapUrl: async (url: string): Promise<MapResult> => {
    const normalizedUrl = normalizeUrl(url);
    const result = mockMapResults.get(normalizedUrl);
    if (result) return result;
    // Default fallback - no discovered links
    return {
      requestId: 'test-req',
      url: normalizedUrl,
      originalUrl: normalizedUrl,
      finalUrl: normalizedUrl,
      discovered: [],
      summary: {
        discoveredCount: 0,
        filteredCount: 0,
        bypassMethod: 'direct',
        browserUsed: false,
        elapsed: 100,
      },
    };
  },
}));

// Mock output module
mock.module('../../src/storage/output.ts', () => ({
  writeScrapeOutput: async (result: ScrapeResult): Promise<{ jsonPath: string; markdownPath?: string; metaPath?: string }> => {
    const cached = mockOutputPaths.get(result.url);
    if (cached) return cached;
    return {
      jsonPath: `/tmp/mock/${result.url.replace(/[^a-z0-9]/gi, '_')}.json`,
    };
  },
}));

// Restore mocked modules after all tests to prevent leaking into other test files
afterAll(() => {
  mock.restore();
});

// ============================================================================
// Test Suite
// ============================================================================

describe('crawl resume end-to-end', () => {
  beforeEach(() => {
    mockScrapeResults.clear();
    mockMapResults.clear();
    mockOutputPaths.clear();
  });

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // Test: Resume skips already-visited URLs
  // ==========================================================================
  it('resume skips already-visited URLs', async () => {
    const outputDir = await createTempDir();
    const config = createMockConfig(outputDir);
    const logger = createMockLogger();
    const browserPool = createMockBrowserPool();
    const rateLimiter = new DomainRateLimiter();

    // Set up mock scrape results for queued pages
    mockScrapeResults.set('https://example.com/page2', {
      url: 'https://example.com/page2',
      originalUrl: 'https://example.com/page2',
      content: '# Page 2',
      html: '<h1>Page 2</h1>',
      metadata: createMockMetadata('https://example.com/page2', { requestId: 'test-req-2', title: 'Page 2' }),
    });

    mockScrapeResults.set('https://example.com/page3', {
      url: 'https://example.com/page3',
      originalUrl: 'https://example.com/page3',
      content: '# Page 3',
      html: '<h1>Page 3</h1>',
      metadata: createMockMetadata('https://example.com/page3', { requestId: 'test-req-3', title: 'Page 3' }),
    });

    // Write a crawl state where:
    // - seed and page1 are already visited (should NOT be re-scraped)
    // - page2 and page3 are in the queue (should be scraped)
    await writeFakeCrawlState(outputDir, 'example.com', {
      jobId: 'crawl_resume_test_1',
      seedUrl: 'https://example.com/',
      status: 'running',
      queue: [
        { url: 'https://example.com/page2', depth: 1 },
        { url: 'https://example.com/page3', depth: 1 },
      ],
      visited: ['https://example.com/', 'https://example.com/page1'],
      results: [
        { url: 'https://example.com/', depth: 0, status: 'success' },
        { url: 'https://example.com/page1', depth: 1, status: 'success' },
      ],
    });

    const options: CrawlOptions = {
      resume: true,
      depth: 2,
      limit: 10,
    };

    const result = await crawlSite(
      'https://example.com',
      options,
      config,
      logger,
      browserPool,
      rateLimiter,
    );

    // Verify the crawl completed
    expect(result.status).toBe('completed');

    // Check that we have results for all pages including the resumed ones
    const resultUrls = result.results.map((r) => r.url);

    // Should have results from the saved state (visited pages)
    expect(resultUrls).toContain('https://example.com/');
    expect(resultUrls).toContain('https://example.com/page1');

    // Should have processed the queued pages
    expect(resultUrls).toContain('https://example.com/page2');
    expect(resultUrls).toContain('https://example.com/page3');

    // Verify the summary counts
    expect(result.summary.visited).toBe(4); // seed + page1 + page2 + page3
    expect(result.summary.succeeded).toBe(4);
  });

  // ==========================================================================
  // Test: Resume preserves depth information
  // ==========================================================================
  it('resume preserves depth information', async () => {
    const outputDir = await createTempDir();
    const config = createMockConfig(outputDir);
    const logger = createMockLogger();
    const browserPool = createMockBrowserPool();
    const rateLimiter = new DomainRateLimiter();

    // Set up mock scrape results
    mockScrapeResults.set('https://example.com/level1', {
      url: 'https://example.com/level1',
      originalUrl: 'https://example.com/level1',
      content: '# Level 1',
      html: '<h1>Level 1</h1>',
      metadata: createMockMetadata('https://example.com/level1', { title: 'Level 1' }),
    });

    mockScrapeResults.set('https://example.com/level2', {
      url: 'https://example.com/level2',
      originalUrl: 'https://example.com/level2',
      content: '# Level 2',
      html: '<h1>Level 2</h1>',
      metadata: createMockMetadata('https://example.com/level2', { title: 'Level 2' }),
    });

    // Write a crawl state with queue entries at different depths
    await writeFakeCrawlState(outputDir, 'example.com', {
      jobId: 'crawl_resume_depth_test',
      seedUrl: 'https://example.com/',
      status: 'running',
      queue: [
        { url: 'https://example.com/level1', depth: 1 },
        { url: 'https://example.com/level2', depth: 2 },
      ],
      visited: ['https://example.com/'],
      results: [
        { url: 'https://example.com/', depth: 0, status: 'success' },
      ],
    });

    const options: CrawlOptions = {
      resume: true,
      depth: 3,
      limit: 10,
    };

    const result = await crawlSite(
      'https://example.com',
      options,
      config,
      logger,
      browserPool,
      rateLimiter,
    );

    // Verify depth is preserved in results
    const level1Result = result.results.find((r) => r.url === 'https://example.com/level1');
    const level2Result = result.results.find((r) => r.url === 'https://example.com/level2');

    expect(level1Result).toBeDefined();
    expect(level1Result?.depth).toBe(1);

    expect(level2Result).toBeDefined();
    expect(level2Result?.depth).toBe(2);
  });

  // ==========================================================================
  // Test: Resume rejects mismatched seed URL
  // ==========================================================================
  it('resume rejects mismatched seed URL', async () => {
    const outputDir = await createTempDir();
    const config = createMockConfig(outputDir);
    const logger = createMockLogger();
    const browserPool = createMockBrowserPool();
    const rateLimiter = new DomainRateLimiter();

    // Write a crawl state with a specific seed URL (normalized with trailing slash)
    await writeFakeCrawlState(outputDir, 'different.com', {
      jobId: 'crawl_mismatched_seed',
      seedUrl: 'https://different.com/', // Note: different hostname
      status: 'running',
      queue: [
        { url: 'https://different.com/page1', depth: 1 },
      ],
      visited: ['https://different.com/'],
      results: [
        { url: 'https://different.com/', depth: 0, status: 'success' },
      ],
    });

    // Set up a mock for the example.com seed to verify fresh crawl starts
    mockScrapeResults.set('https://example.com/', {
      url: 'https://example.com/',
      originalUrl: 'https://example.com/',
      content: '# Fresh Start',
      html: '<h1>Fresh Start</h1>',
      metadata: createMockMetadata('https://example.com/', { requestId: 'test-req-fresh', title: 'Fresh Start' }),
    });

    // Mock map to return empty discovered links
    mockMapResults.set('https://example.com/', {
      requestId: 'test-req-map',
      url: 'https://example.com/',
      originalUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      discovered: [],
      summary: {
        discoveredCount: 0,
        filteredCount: 0,
        bypassMethod: 'direct',
        browserUsed: false,
        elapsed: 100,
      },
    });

    // Now try to resume with a DIFFERENT seed URL
    const options: CrawlOptions = {
      resume: true,
      depth: 2,
      limit: 10,
    };

    const result = await crawlSite(
      'https://example.com', // Different from the saved state's hostname
      options,
      config,
      logger,
      browserPool,
      rateLimiter,
    );

    // The crawl should complete (with fresh start, not resume)
    expect(result.status).toBe('completed');

    // The seed URL should be in results (fresh crawl started)
    const seedResult = result.results.find((r) => r.url === 'https://example.com/');
    expect(seedResult).toBeDefined();

    // The queue from the mismatched state should NOT have been used
    // (different.com URLs should not appear because we're looking at example.com/ dir)
    const differentComUrls = result.results.filter((r) => r.url.includes('different.com'));
    expect(differentComUrls.length).toBe(0);

    // Summary should show only the fresh crawl results
    expect(result.summary.visited).toBeGreaterThanOrEqual(1);
  });

  // ==========================================================================
  // Test: Resume with empty queue completes immediately
  // ==========================================================================
  it('resume with empty queue completes immediately', async () => {
    const outputDir = await createTempDir();
    const config = createMockConfig(outputDir);
    const logger = createMockLogger();
    const browserPool = createMockBrowserPool();
    const rateLimiter = new DomainRateLimiter();

    // Write a crawl state with an empty queue but some results
    const savedResults = [
      { url: 'https://example.com/', depth: 0, status: 'success' as const },
      { url: 'https://example.com/page1', depth: 1, status: 'success' as const },
      { url: 'https://example.com/page2', depth: 1, status: 'success' as const },
    ];

    await writeFakeCrawlState(outputDir, 'example.com', {
      jobId: 'crawl_empty_queue',
      seedUrl: 'https://example.com/',
      status: 'running',
      queue: [], // Empty queue
      visited: ['https://example.com/', 'https://example.com/page1', 'https://example.com/page2'],
      results: savedResults,
    });

    const options: CrawlOptions = {
      resume: true,
      depth: 2,
      limit: 10,
    };

    const result = await crawlSite(
      'https://example.com',
      options,
      config,
      logger,
      browserPool,
      rateLimiter,
    );

    // Should complete immediately
    expect(result.status).toBe('completed');

    // Should preserve the saved results
    expect(result.results).toHaveLength(3);
    expect(result.results.map((r) => r.url)).toContain('https://example.com/');
    expect(result.results.map((r) => r.url)).toContain('https://example.com/page1');
    expect(result.results.map((r) => r.url)).toContain('https://example.com/page2');

    // Summary should match the saved results
    expect(result.summary.visited).toBe(3);
    expect(result.summary.succeeded).toBe(3);
    expect(result.summary.queued).toBe(0);
  });

  // ==========================================================================
  // Test: State file round-trip
  // ==========================================================================
  it('state file round-trip - interrupt and resume', async () => {
    const outputDir = await createTempDir();
    const config = createMockConfig(outputDir);
    const logger = createMockLogger();
    const browserPool = createMockBrowserPool();
    const rateLimiter = new DomainRateLimiter();

    // Set up mock for pages
    mockScrapeResults.set('https://example.com/', {
      url: 'https://example.com/',
      originalUrl: 'https://example.com/',
      content: '# Home',
      html: '<h1>Home</h1>',
      metadata: createMockMetadata('https://example.com/', { requestId: 'test-req-home', title: 'Home' }),
    });

    mockScrapeResults.set('https://example.com/page1', {
      url: 'https://example.com/page1',
      originalUrl: 'https://example.com/page1',
      content: '# Page 1',
      html: '<h1>Page 1</h1>',
      metadata: createMockMetadata('https://example.com/page1', { requestId: 'test-req-p1', title: 'Page 1' }),
    });

    mockScrapeResults.set('https://example.com/page2', {
      url: 'https://example.com/page2',
      originalUrl: 'https://example.com/page2',
      content: '# Page 2',
      html: '<h1>Page 2</h1>',
      metadata: createMockMetadata('https://example.com/page2', { requestId: 'test-req-p2', title: 'Page 2' }),
    });

    // Mock map to return discovered URLs
    mockMapResults.set('https://example.com/', {
      requestId: 'test-req-map',
      url: 'https://example.com/',
      originalUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      discovered: [
        { url: 'https://example.com/page1', source: 'page', text: 'Page 1', rel: null },
        { url: 'https://example.com/page2', source: 'page', text: 'Page 2', rel: null },
      ],
      summary: {
        discoveredCount: 2,
        filteredCount: 0,
        bypassMethod: 'direct',
        browserUsed: false,
        elapsed: 100,
      },
    });

    mockMapResults.set('https://example.com/page1', {
      requestId: 'test-req-map-p1',
      url: 'https://example.com/page1',
      originalUrl: 'https://example.com/page1',
      finalUrl: 'https://example.com/page1',
      discovered: [],
      summary: {
        discoveredCount: 0,
        filteredCount: 0,
        bypassMethod: 'direct',
        browserUsed: false,
        elapsed: 100,
      },
    });

    mockMapResults.set('https://example.com/page2', {
      requestId: 'test-req-map-p2',
      url: 'https://example.com/page2',
      originalUrl: 'https://example.com/page2',
      finalUrl: 'https://example.com/page2',
      discovered: [],
      summary: {
        discoveredCount: 0,
        filteredCount: 0,
        bypassMethod: 'direct',
        browserUsed: false,
        elapsed: 100,
      },
    });

    // For this test, we'll simulate interruption by creating a state file directly
    // with a 'cancelled' status and then manually changing it to 'running' to test resume
    const fs = await import('node:fs/promises');
    const domainDir = path.join(outputDir, 'example.com');
    await mkdir(domainDir, { recursive: true });

    // Create a state file simulating a partial crawl (seed + page1 done, page2 in queue)
    const interruptedState: CrawlState = {
      jobId: 'crawl_roundtrip_test',
      status: 'running', // We'll use 'running' since that's what loadCrawlState requires
      seedUrl: 'https://example.com/',
      options: {
        depth: 2,
        limit: 10,
        include: ['https://example.com/**'],
        exclude: [],
        delay: 0,
        source: 'links',
        resume: true,
      },
      queue: [
        { url: 'https://example.com/page2', depth: 1 }, // Only page2 remains
      ],
      visited: ['https://example.com/', 'https://example.com/page1'],
      results: [
        { url: 'https://example.com/', depth: 0, status: 'success' },
        { url: 'https://example.com/page1', depth: 1, status: 'success' },
      ],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await fs.writeFile(
      path.join(domainDir, '_crawl-state.json'),
      JSON.stringify(interruptedState, null, 2),
      'utf8',
    );

    // Resume the crawl with only page2 remaining in queue
    const resumeOptions: CrawlOptions = {
      resume: true,
      depth: 2,
      limit: 10,
    };

    const resumedResult = await crawlSite(
      'https://example.com',
      resumeOptions,
      config,
      logger,
      browserPool,
      rateLimiter,
    );

    // Should complete successfully
    expect(resumedResult.status).toBe('completed');

    // The resumed crawl should have the same job ID
    expect(resumedResult.jobId).toBe('crawl_roundtrip_test');

    // Should have results from both the interrupted crawl and the resumed crawl
    const resultUrls = resumedResult.results.map((r) => r.url);

    // Should have seed and page1 from saved state
    expect(resultUrls).toContain('https://example.com/');
    expect(resultUrls).toContain('https://example.com/page1');

    // Should have page2 from resumed crawl
    expect(resultUrls).toContain('https://example.com/page2');

    // All 3 pages should be accounted for
    expect(resumedResult.summary.visited).toBe(3);
    expect(resumedResult.summary.succeeded).toBe(3);
    expect(resumedResult.summary.queued).toBe(0);
  });
});

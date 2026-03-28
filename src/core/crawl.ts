import { randomUUID } from 'node:crypto';
import type { ShuvcrawlConfig } from '../config/schema.ts';
import type { Logger } from '../utils/logger.ts';
import type { BrowserPool } from './browser.ts';
import { createTelemetryContext } from '../utils/telemetry.ts';
import { normalizeUrl } from '../utils/url.ts';
import { defaultMapInclude, shouldIncludeUrl, discoverSitemapUrls } from './discovery.ts';
import { mapUrl, type MapOptions } from './map.ts';
import { scrapeUrl, type ScrapeOptions } from './scraper.ts';
import { writeScrapeOutput } from '../storage/output.ts';
import { writeCrawlState, loadCrawlState, type CrawlPageRecord, type CrawlState } from '../storage/crawl-state.ts';
import { DomainRateLimiter } from '../utils/rate-limit.ts';

export type WaitStrategy = 'load' | 'networkidle' | 'selector' | 'sleep';

export type CrawlOptions = {
  depth?: number;
  limit?: number;
  include?: string[];
  exclude?: string[];
  delay?: number;
  source?: 'links' | 'sitemap' | 'both';
  resume?: boolean;
  noFastPath?: boolean;
  noBpc?: boolean;
  noCache?: boolean;
  debugArtifacts?: boolean;
  // Wait strategies
  wait?: WaitStrategy;
  waitFor?: string;
  waitTimeout?: number;
  sleep?: number;
};

export type CrawlProgressCallback = (page: {
  url: string;
  depth: number;
  status: string;
  elapsed?: number;
}) => void;

export type CrawlResult = {
  jobId: string;
  status: CrawlState['status'];
  statePath: string;
  summary: {
    visited: number;
    queued: number;
    succeeded: number;
    failed: number;
    skipped: number;
  };
  results: CrawlPageRecord[];
};

export async function crawlSite(
  inputUrl: string,
  options: CrawlOptions,
  config: ShuvcrawlConfig,
  logger: Logger,
  browserPool: BrowserPool,
  rateLimiter?: DomainRateLimiter,
  onProgress?: CrawlProgressCallback,
  signal?: AbortSignal,
  jobIdOverride?: string,
): Promise<CrawlResult> {
  const seedUrl = normalizeUrl(inputUrl);
  let jobId = jobIdOverride ?? `crawl_${randomUUID()}`;
  const hostname = new URL(seedUrl).hostname;
  const include = options.include?.length ? options.include : [defaultMapInclude(seedUrl)];
  const exclude = options.exclude ?? [];
  const maxDepth = options.depth ?? config.crawl.defaultDepth;
  const limit = options.limit ?? config.crawl.defaultLimit;

  let queue: Array<{ url: string; depth: number }> = [{ url: seedUrl, depth: 0 }];
  let visited = new Set<string>();
  let results: CrawlPageRecord[] = [];

  // Seed from sitemap if requested
  const source = options.source ?? 'links';
  if (source === 'sitemap' || source === 'both') {
    const origin = new URL(seedUrl).origin;
    const sitemapUrls = await discoverSitemapUrls(origin, logger);

    if (sitemapUrls.length > 0) {
      logger.info('crawl.sitemap.seeded', { jobId, urls: sitemapUrls.length });

      // Add sitemap URLs to queue (only if not already there)
      const existingUrls = new Set(queue.map(q => q.url));
      for (const sitemapUrl of sitemapUrls) {
        if (!existingUrls.has(sitemapUrl.url)) {
          queue.push({ url: sitemapUrl.url, depth: 1 }); // Sitemap URLs start at depth 1
        }
      }
    } else if (source === 'sitemap') {
      logger.warn('crawl.sitemap.empty', { origin });
    }
  }

  // Check for resume state
  if (options.resume) {
    const state = await loadCrawlState(config.output.dir, hostname);
    if (state) {
      // Validate seed URL matches
      if (state.seedUrl !== seedUrl) {
        logger.warn('crawl.resume.mismatched-seed', { expected: seedUrl, found: state.seedUrl });
      } else {
        if (!jobIdOverride) {
          jobId = state.jobId;
        }
        queue = state.queue.map(q => ({ url: q.url, depth: q.depth }));
        visited = new Set(state.visited);
        results = state.results;
        logger.info('crawl.resume.loaded', { jobId, visited: visited.size, queued: queue.length });
      }
    }
  }

  const state: CrawlState = {
    jobId,
    status: 'running',
    seedUrl,
    options: {
      depth: maxDepth,
      limit,
      include,
      exclude,
      delay: options.delay ?? config.crawl.delay,
      source: options.source ?? 'links',
      resume: options.resume ?? false,
    },
    queue: queue.map(q => ({ url: q.url, depth: q.depth })),
    visited: Array.from(visited),
    results,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let statePath = await writeCrawlState(config.output.dir, hostname, state);

  while (queue.length > 0 && visited.size < limit) {
    // Check for cancellation
    if (signal?.aborted) {
      state.status = 'cancelled';
      break;
    }

    const next = queue.shift()!;
    state.queue = queue.map(q => ({ url: q.url, depth: q.depth }));

    if (visited.has(next.url)) {
      results.push({ url: next.url, depth: next.depth, status: 'skipped-duplicate' });
      state.results = [...results];
      state.visited = Array.from(visited);
      statePath = await writeCrawlState(config.output.dir, hostname, state);
      if (onProgress) {
        onProgress({ url: next.url, depth: next.depth, status: 'skipped-duplicate' });
      }
      continue;
    }

    const inclusion = shouldIncludeUrl(next.url, {
      include,
      exclude,
      sameOriginSeed: seedUrl,
    });
    if (!inclusion.included) {
      results.push({ url: next.url, depth: next.depth, status: 'skipped-filtered', error: inclusion.reason });
      state.results = [...results];
      state.visited = Array.from(visited);
      statePath = await writeCrawlState(config.output.dir, hostname, state);
      if (onProgress) {
        onProgress({ url: next.url, depth: next.depth, status: 'skipped-filtered' });
      }
      continue;
    }

    visited.add(next.url);
    const telemetry = createTelemetryContext({ jobId });

    // Apply rate limiting before the request
    if (rateLimiter) {
      await rateLimiter.waitForDomain(hostname, options.delay ?? config.crawl.delay);
    }

    const pageStartTime = Date.now();

    try {
      const scrape = await scrapeUrl(next.url, {
        noFastPath: options.noFastPath,
        noBpc: options.noBpc,
        noCache: options.noCache,
        wait: options.wait,
        waitFor: options.waitFor,
        waitTimeout: options.waitTimeout,
        sleep: options.sleep,
        debugArtifacts: options.debugArtifacts,
      } satisfies ScrapeOptions, config, logger, telemetry, browserPool);
      const output = await writeScrapeOutput(scrape, config);
      results.push({
        url: next.url,
        depth: next.depth,
        status: scrape.metadata.status === 'success' ? 'success' : 'partial',
        requestId: scrape.metadata.requestId,
        title: scrape.metadata.title,
        elapsed: scrape.metadata.elapsed,
        bypassMethod: scrape.metadata.bypassMethod,
        discoveredCount: 0,
        output,
      });

      if (next.depth < maxDepth && source !== 'sitemap') {
        const map = await mapUrl(next.url, {
          noFastPath: options.noFastPath,
          noBpc: options.noBpc,
          include,
          exclude,
          sameOriginOnly: true,
          source: 'links',
          wait: options.wait,
          waitFor: options.waitFor,
          waitTimeout: options.waitTimeout,
          sleep: options.sleep,
        } satisfies MapOptions, config, logger, createTelemetryContext({ jobId }), browserPool);

        const latest = results[results.length - 1];
        if (latest) latest.discoveredCount = map.summary.discoveredCount;

        for (const link of map.discovered) {
          if (!visited.has(link.url) && !queue.some(item => item.url === link.url)) {
            queue.push({ url: link.url, depth: next.depth + 1 });
          }
        }
      }

      if (onProgress) {
        onProgress({
          url: next.url,
          depth: next.depth,
          status: 'success',
          elapsed: Date.now() - pageStartTime,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lowered = message.toLowerCase();
      const status = lowered.includes('robots') ? 'robots-denied' : 'failed';
      results.push({
        url: next.url,
        depth: next.depth,
        status,
        error: message,
      });

      if (onProgress) {
        onProgress({
          url: next.url,
          depth: next.depth,
          status,
          elapsed: Date.now() - pageStartTime,
        });
      }
    }

    state.queue = queue.map(q => ({ url: q.url, depth: q.depth }));
    state.visited = Array.from(visited);
    state.results = [...results];
    statePath = await writeCrawlState(config.output.dir, hostname, state);

    // Rate limiter now handles the delay - no explicit delay here
  }

  if (state.status !== 'cancelled') {
    state.status = queue.length === 0 ? 'completed' : 'stopped';
  }
  state.completedAt = new Date().toISOString();
  state.queue = queue.map(q => ({ url: q.url, depth: q.depth }));
  state.visited = Array.from(visited);
  state.results = [...results];
  statePath = await writeCrawlState(config.output.dir, hostname, state);

  return {
    jobId,
    status: state.status,
    statePath,
    summary: {
      visited: visited.size,
      queued: queue.length,
      succeeded: results.filter(result => result.status === 'success' || result.status === 'partial').length,
      failed: results.filter(result => result.status === 'failed' || result.status === 'robots-denied' || result.status === 'blocked').length,
      skipped: results.filter(result => result.status === 'skipped-duplicate' || result.status === 'skipped-filtered').length,
    },
    results,
  };
}

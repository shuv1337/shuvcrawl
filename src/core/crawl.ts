import { randomUUID } from 'node:crypto';
import type { ShuvcrawlConfig } from '../config/schema.ts';
import type { Logger } from '../utils/logger.ts';
import type { BrowserPool } from './browser.ts';
import { createTelemetryContext } from '../utils/telemetry.ts';
import { normalizeUrl } from '../utils/url.ts';
import { defaultMapInclude, shouldIncludeUrl } from './discovery.ts';
import { mapUrl, type MapOptions } from './map.ts';
import { scrapeUrl, type ScrapeOptions } from './scraper.ts';
import { writeScrapeOutput } from '../storage/output.ts';
import { writeCrawlState, type CrawlPageRecord, type CrawlState } from '../storage/crawl-state.ts';

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
  debugArtifacts?: boolean;
};

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

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function crawlSite(
  inputUrl: string,
  options: CrawlOptions,
  config: ShuvcrawlConfig,
  logger: Logger,
  browserPool: BrowserPool,
): Promise<CrawlResult> {
  const seedUrl = normalizeUrl(inputUrl);
  const jobId = `crawl_${randomUUID()}`;
  const hostname = new URL(seedUrl).hostname;
  const include = options.include?.length ? options.include : [defaultMapInclude(seedUrl)];
  const exclude = options.exclude ?? [];
  const maxDepth = options.depth ?? config.crawl.defaultDepth;
  const limit = options.limit ?? config.crawl.defaultLimit;
  const crawlDelay = options.delay ?? config.crawl.delay;

  const queue: Array<{ url: string; depth: number }> = [{ url: seedUrl, depth: 0 }];
  const visited = new Set<string>();
  const results: CrawlPageRecord[] = [];

  const state: CrawlState = {
    jobId,
    status: 'running',
    seedUrl,
    options: {
      depth: maxDepth,
      limit,
      include,
      exclude,
      delay: crawlDelay,
      source: options.source ?? 'links',
      resume: options.resume ?? false,
    },
    queue: [...queue],
    visited: [],
    results: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let statePath = await writeCrawlState(config.output.dir, hostname, state);

  while (queue.length > 0 && visited.size < limit) {
    const next = queue.shift()!;
    state.queue = [...queue];

    if (visited.has(next.url)) {
      results.push({ url: next.url, depth: next.depth, status: 'skipped-duplicate' });
      state.results = [...results];
      state.visited = Array.from(visited);
      statePath = await writeCrawlState(config.output.dir, hostname, state);
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
      continue;
    }

    visited.add(next.url);
    const telemetry = createTelemetryContext({ jobId });

    try {
      const scrape = await scrapeUrl(next.url, {
        noFastPath: options.noFastPath,
        noBpc: options.noBpc,
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

      if (next.depth < maxDepth) {
        const map = await mapUrl(next.url, {
          noFastPath: options.noFastPath,
          noBpc: options.noBpc,
          include,
          exclude,
          sameOriginOnly: true,
        } satisfies MapOptions, config, logger, createTelemetryContext({ jobId }), browserPool);

        const latest = results[results.length - 1];
        if (latest) latest.discoveredCount = map.summary.discoveredCount;

        for (const link of map.discovered) {
          if (!visited.has(link.url) && !queue.some(item => item.url === link.url)) {
            queue.push({ url: link.url, depth: next.depth + 1 });
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lowered = message.toLowerCase();
      results.push({
        url: next.url,
        depth: next.depth,
        status: lowered.includes('robots') ? 'robots-denied' : 'failed',
        error: message,
      });
    }

    state.queue = [...queue];
    state.visited = Array.from(visited);
    state.results = [...results];
    statePath = await writeCrawlState(config.output.dir, hostname, state);

    if (queue.length > 0 && crawlDelay > 0) {
      await delay(crawlDelay);
    }
  }

  state.status = 'completed';
  state.completedAt = new Date().toISOString();
  state.queue = [...queue];
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

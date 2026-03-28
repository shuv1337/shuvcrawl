import type { ShuvcrawlConfig } from '../config/schema.ts';
import type { Logger } from '../utils/logger.ts';
import type { TelemetryContext } from '../utils/telemetry.ts';
import { measureStage } from '../utils/telemetry.ts';
import { allowByRobots } from '../utils/robots.ts';
import { normalizeUrl } from '../utils/url.ts';
import { tryFastPath } from './fast-path.ts';
import type { BrowserPool } from './browser.ts';
import { discoverPageLinks, discoverSitemapUrls, defaultMapInclude, shouldIncludeUrl } from './discovery.ts';

export type WaitStrategy = 'load' | 'networkidle' | 'selector' | 'sleep';

export type MapOptions = {
  noFastPath?: boolean;
  noBpc?: boolean;
  include?: string[];
  exclude?: string[];
  sameOriginOnly?: boolean;
  source?: 'links' | 'sitemap' | 'both';
  // Wait strategies
  wait?: WaitStrategy;
  waitFor?: string;
  waitTimeout?: number;
  sleep?: number;
};

export type MapResult = {
  requestId: string;
  url: string;
  originalUrl: string;
  finalUrl: string;
  discovered: Array<{
    url: string;
    source: 'page' | 'sitemap';
    text: string | null;
    rel: string | null;
  }>;
  summary: {
    discoveredCount: number;
    filteredCount: number;
    bypassMethod: 'fast-path' | 'bpc-extension' | 'direct';
    browserUsed: boolean;
    elapsed: number;
  };
};

async function applyWaitStrategy(
  page: Awaited<ReturnType<BrowserPool['acquire']>>['page'],
  strategy: WaitStrategy,
  options: {
    waitFor?: string;
    waitTimeout?: number;
    sleep?: number;
    defaultTimeout: number;
  },
): Promise<void> {
  const timeout = options.waitTimeout ?? options.defaultTimeout;

  switch (strategy) {
    case 'load':
      // Already waited for load in goto
      break;
    case 'networkidle':
      await page.waitForLoadState('networkidle', { timeout });
      break;
    case 'selector':
      if (options.waitFor) {
        await page.waitForSelector(options.waitFor, { timeout });
      }
      break;
    case 'sleep':
      if (options.sleep) {
        await page.waitForTimeout(options.sleep);
      }
      break;
  }
}

export async function mapUrl(
  inputUrl: string,
  options: MapOptions,
  config: ShuvcrawlConfig,
  logger: Logger,
  telemetry: TelemetryContext,
  browserPool: BrowserPool,
): Promise<MapResult> {
  const originalUrl = inputUrl;
  const url = normalizeUrl(inputUrl);
  const origin = new URL(url).origin;

  const preflight = await measureStage(logger, 'map.preflight', telemetry, async () => {
    return await allowByRobots(url, config.crawl.respectRobots);
  });
  if (!preflight.result.allowed) {
    throw new Error(preflight.result.reason ?? 'robots denied');
  }

  let html = '';
  let finalUrl = url;
  let bypassMethod: MapResult['summary']['bypassMethod'] = 'direct';
  let browserUsed = false;
  let renderElapsed = 0;

  // Determine if we need to fetch the page at all
  const source = options.source ?? 'links';
  const needsPageFetch = source === 'links' || source === 'both';

  if (needsPageFetch) {
    if (!options.noFastPath && config.fastPath.enabled) {
      try {
        const fastPath = await tryFastPath(url, config, logger, telemetry);
        if (fastPath.accepted) {
          html = fastPath.html;
          finalUrl = fastPath.finalUrl;
          bypassMethod = 'fast-path';
        }
      } catch (error) {
        logger.warn('map.fastpath.degraded', {
          ...telemetry,
          error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
        });
      }
    }

    if (!html) {
      const browser = await browserPool.acquire(telemetry);
      browserUsed = true;
      try {
        const waitStrategy = options.wait ?? 'load';
        const browserStage = await measureStage(logger, 'map.browser', telemetry, async () => {
          const timeout = options.waitTimeout ?? config.browser.defaultTimeout;
          let gotoWaitUntil: 'load' | 'networkidle' = 'load';
          if (waitStrategy === 'networkidle') {
            gotoWaitUntil = 'networkidle';
          }

          await browser.page.goto(url, { waitUntil: gotoWaitUntil, timeout });

          // Apply additional wait strategies
          await applyWaitStrategy(browser.page, waitStrategy, {
            waitFor: options.waitFor,
            waitTimeout: options.waitTimeout,
            sleep: options.sleep,
            defaultTimeout: config.browser.defaultTimeout,
          });

          return {
            html: await browser.page.content(),
            finalUrl: browser.page.url(),
          };
        });
        html = browserStage.result.html;
        finalUrl = browserStage.result.finalUrl;
        bypassMethod = options.noBpc ? 'direct' : 'bpc-extension';
        renderElapsed += browserStage.elapsed;
      } finally {
        await browser.release();
      }
    }
  }

  const include = options.include?.length ? options.include : [defaultMapInclude(url)];
  const sameOriginSeed = options.sameOriginOnly === false ? undefined : url;

  // Discover URLs from both page links and sitemap
  const allDiscovered: MapResult['discovered'] = [];
  const seenUrls = new Set<string>();
  let filteredCount = 0;

  // Get page links if needed
  if (needsPageFetch) {
    const pageLinks = discoverPageLinks(html, finalUrl);
    for (const link of pageLinks) {
      const decision = shouldIncludeUrl(link.url, {
        include,
        exclude: options.exclude,
        sameOriginSeed,
      });
      if (decision.included && !seenUrls.has(link.url)) {
        seenUrls.add(link.url);
        allDiscovered.push(link);
      } else {
        filteredCount++;
      }
    }
  }

  // Get sitemap URLs if needed
  if (source === 'sitemap' || source === 'both') {
    const sitemapUrls = await discoverSitemapUrls(origin, logger);
    let sitemapFiltered = 0;

    for (const link of sitemapUrls) {
      const decision = shouldIncludeUrl(link.url, {
        include,
        exclude: options.exclude,
        sameOriginSeed,
      });
      if (decision.included && !seenUrls.has(link.url)) {
        seenUrls.add(link.url);
        allDiscovered.push(link);
      } else {
        sitemapFiltered++;
        filteredCount++;
      }
    }

    if (sitemapUrls.length > 0) {
      logger.info('map.sitemap.results', {
        ...telemetry,
        found: sitemapUrls.length,
        included: sitemapUrls.length - sitemapFiltered,
        filtered: sitemapFiltered,
      });
    }
  }

  return {
    requestId: telemetry.requestId,
    url,
    originalUrl,
    finalUrl,
    discovered: allDiscovered,
    summary: {
      discoveredCount: allDiscovered.length,
      filteredCount,
      bypassMethod,
      browserUsed,
      elapsed: preflight.elapsed + renderElapsed,
    },
  };
}

import type { ShuvcrawlConfig } from '../config/schema.ts';
import type { Logger } from '../utils/logger.ts';
import type { TelemetryContext } from '../utils/telemetry.ts';
import { measureStage } from '../utils/telemetry.ts';
import { allowByRobots } from '../utils/robots.ts';
import { normalizeUrl } from '../utils/url.ts';
import { tryFastPath } from './fast-path.ts';
import type { BrowserPool } from './browser.ts';
import { discoverPageLinks, defaultMapInclude, shouldIncludeUrl } from './discovery.ts';

export type MapOptions = {
  noFastPath?: boolean;
  noBpc?: boolean;
  include?: string[];
  exclude?: string[];
  sameOriginOnly?: boolean;
};

export type MapResult = {
  requestId: string;
  url: string;
  originalUrl: string;
  finalUrl: string;
  discovered: Array<{
    url: string;
    source: 'page';
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
      const browserStage = await measureStage(logger, 'map.browser', telemetry, async () => {
        await browser.page.goto(url, { waitUntil: 'load', timeout: config.browser.defaultTimeout });
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

  const include = options.include?.length ? options.include : [defaultMapInclude(url)];
  const sameOriginSeed = options.sameOriginOnly === false ? undefined : url;

  const discoveryStage = await measureStage(logger, 'map.discover', telemetry, async () => {
    const links = discoverPageLinks(html, finalUrl);
    const discovered: MapResult['discovered'] = [];
    let filteredCount = 0;

    for (const link of links) {
      const decision = shouldIncludeUrl(link.url, {
        include,
        exclude: options.exclude,
        sameOriginSeed,
      });
      if (!decision.included) {
        filteredCount += 1;
        continue;
      }
      discovered.push(link);
    }

    return { discovered, filteredCount };
  });

  return {
    requestId: telemetry.requestId,
    url,
    originalUrl,
    finalUrl,
    discovered: discoveryStage.result.discovered,
    summary: {
      discoveredCount: discoveryStage.result.discovered.length,
      filteredCount: discoveryStage.result.filteredCount,
      bypassMethod,
      browserUsed,
      elapsed: preflight.elapsed + renderElapsed + discoveryStage.elapsed,
    },
  };
}

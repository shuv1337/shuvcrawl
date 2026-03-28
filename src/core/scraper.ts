import type { ShuvcrawlConfig } from '../config/schema.ts';
import type { Logger } from '../utils/logger.ts';
import type { TelemetryContext } from '../utils/telemetry.ts';
import { measureStage } from '../utils/telemetry.ts';
import { allowByRobots } from '../utils/robots.ts';
import { normalizeUrl } from '../utils/url.ts';
import { tryFastPath } from './fast-path.ts';
import { BrowserPool } from './browser.ts';
import { extractDocument } from './extractor.ts';
import { htmlToMarkdown } from './converter.ts';
import { buildMetadata, type ScrapeMetadata } from './metadata.ts';
import { ensureArtifactDir, writeArtifact } from '../storage/artifacts.ts';
import { buildCacheKey, readCache, writeCache } from '../storage/cache.ts';

export type WaitStrategy = 'load' | 'networkidle' | 'selector' | 'sleep';

export type ScrapeOptions = {
  selector?: string;
  noFastPath?: boolean;
  noBpc?: boolean;
  noCache?: boolean;
  mobile?: boolean;
  proxy?: string | null;
  debugArtifacts?: boolean;
  // Wait strategies
  wait?: WaitStrategy;
  waitFor?: string;
  waitTimeout?: number;
  sleep?: number;
  // Request options
  headers?: Record<string, string | number | boolean>;
  rawHtml?: boolean;
  onlyMainContent?: boolean;
};

export type ScrapeResult = {
  url: string;
  originalUrl: string;
  content: string;
  html: string;
  rawHtml?: string;
  metadata: ScrapeMetadata;
  artifacts?: {
    requestId: string;
    dir: string | null;
    screenshot?: string | null;
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
      // Wait for network to be idle
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

export async function scrapeUrl(
  inputUrl: string,
  options: ScrapeOptions,
  config: ShuvcrawlConfig,
  logger: Logger,
  telemetry: TelemetryContext,
  browserPool: BrowserPool,
): Promise<ScrapeResult> {
  const originalUrl = inputUrl;
  const url = normalizeUrl(inputUrl);
  const hostname = new URL(url).hostname;
  const cacheKey = buildCacheKey({
    url,
    format: config.output.format,
    mobile: options.mobile ?? false,
    fastPath: !options.noFastPath,
    bpc: !options.noBpc,
    selector: options.selector ?? null,
    proxy: options.proxy ?? null,
    wait: options.wait ?? null,
    waitFor: options.waitFor ?? null,
    sleep: options.sleep ?? null,
    headers: options.headers
      ? Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key, String(value)]))
      : null,
    onlyMainContent: options.onlyMainContent ?? null,
    rawHtml: options.rawHtml ?? false,
  });

  // Check cache first (unless disabled)
  if (config.cache.enabled && !options.noCache) {
    const cached = await readCache(config.cache.dir, cacheKey, config.cache.ttl);
    if (cached) {
      logger.debug('scrape.cache.hit', { ...telemetry, url, hostname });
      const hydrated = structuredClone(cached);
      hydrated.metadata.requestId = telemetry.requestId;
      hydrated.artifacts = undefined;
      return hydrated;
    }
  }

  // Helper to create child telemetry context with parent span
  const withParentSpan = (parentSpanId?: string): TelemetryContext => ({
    ...telemetry,
    parentSpanId,
  });

  const preflight = await measureStage(logger, 'scrape.preflight', telemetry, async () => {
    return await allowByRobots(url, config.crawl.respectRobots);
  });
  if (!preflight.result.allowed) {
    throw new Error(preflight.result.reason ?? 'robots denied');
  }

  let html = '';
  let finalUrl = url;
  let bypassMethod: ScrapeMetadata['bypassMethod'] = 'direct';
  let browserUsed = false;
  let renderElapsed = 0;
  let waitStrategy: WaitStrategy = 'load';
  let requestParentSpanId: string | undefined;
  const artifactsDir = options.debugArtifacts || config.artifacts.enabled ? await ensureArtifactDir(config.artifacts.dir, telemetry.requestId) : null;

  // Set up custom headers for fast path (convert to strings)
  const customHeaders = options.headers
    ? Object.fromEntries(Object.entries(options.headers).map(([k, v]) => [k, String(v)]))
    : undefined;

  if (!options.noFastPath && config.fastPath.enabled) {
    try {
      const fastPath = await tryFastPath(url, config, logger, withParentSpan(preflight.spanId || undefined), customHeaders);
      if (fastPath.result.accepted) {
        html = fastPath.result.html;
        finalUrl = fastPath.result.finalUrl;
        bypassMethod = 'fast-path';
        waitStrategy = 'load';
        requestParentSpanId = fastPath.parentSpanId;
      }
    } catch (error) {
      logger.warn('fastpath.fetch.degraded', {
        ...telemetry,
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      });
    }
  }

  if (!html) {
    const browser = await browserPool.acquire(telemetry, {
      viewport: options.mobile
        ? { width: 390, height: 844 } // iPhone 12-like mobile viewport
        : undefined,
      extraHTTPHeaders: customHeaders,
    });
    browserUsed = true;
    try {
      waitStrategy = options.wait ?? 'load';

      const browserStage = await measureStage(logger, 'scrape.browser', withParentSpan(preflight.spanId || undefined), async () => {
        const timeout = options.waitTimeout ?? config.browser.defaultTimeout;

        // Determine waitUntil for goto
        let gotoWaitUntil: 'load' | 'networkidle' | 'domcontentloaded' = 'load';
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
          screenshot: artifactsDir && config.artifacts.includeScreenshot ? `${artifactsDir}/page.png` : null,
        };
      });
      html = browserStage.result.html;
      finalUrl = browserStage.result.finalUrl;
      bypassMethod = options.noBpc ? 'direct' : 'bpc-extension';
      renderElapsed += browserStage.elapsed;
      requestParentSpanId = browserStage.spanId || undefined;
      if (browserStage.result.screenshot) {
        await browser.page.screenshot({ path: browserStage.result.screenshot, fullPage: true });
      }
    } finally {
      await browser.release();

      // Write console logs as artifact if enabled
      if (artifactsDir && config.artifacts.includeConsole && browser.consoleLogs.length > 0) {
        await writeArtifact(artifactsDir, 'console.json', JSON.stringify(browser.consoleLogs, null, 2));
      }
    }
  }

  const extractedStage = await measureStage(logger, 'scrape.extract', withParentSpan(requestParentSpanId), async () =>
    extractDocument(html, finalUrl, config, options.selector, options.onlyMainContent),
  );
  const markdownStage = await measureStage(logger, 'scrape.convert', withParentSpan(requestParentSpanId), async () => htmlToMarkdown(extractedStage.result.html));
  const wordCount = extractedStage.result.textContent.split(/\s+/).filter(Boolean).length;
  const metadata = buildMetadata({
    requestId: telemetry.requestId,
    url,
    originalUrl,
    finalUrl,
    html,
    title: extractedStage.result.title,
    wordCount,
    extractionMethod: extractedStage.result.extractionMethod,
    extractionConfidence: extractedStage.result.extractionConfidence,
    bypassMethod,
    browserUsed,
    elapsed: preflight.elapsed + renderElapsed + extractedStage.elapsed + markdownStage.elapsed,
    waitStrategy,
  });

  if (artifactsDir && (options.rawHtml || config.artifacts.includeRawHtml)) {
    await writeArtifact(artifactsDir, 'raw.html', html);
  }
  if (artifactsDir && config.artifacts.includeCleanHtml) {
    await writeArtifact(artifactsDir, 'clean.html', extractedStage.result.html);
  }

  const result: ScrapeResult = {
    url,
    originalUrl,
    content: markdownStage.result,
    html: extractedStage.result.html,
    rawHtml: (options.rawHtml || config.artifacts.includeRawHtml) ? html : undefined,
    metadata,
    artifacts: artifactsDir ? {
      requestId: telemetry.requestId,
      dir: artifactsDir,
      screenshot: config.artifacts.includeScreenshot ? `${artifactsDir}/page.png` : null,
    } : undefined,
  };

  // Write to cache (unless disabled or failed and not caching failures)
  if (config.cache.enabled && !options.noCache) {
    if (result.metadata.status === 'success' || result.metadata.status === 'partial' || config.cache.cacheFailures) {
      await writeCache(config.cache.dir, cacheKey, result);
    }
  }

  return result;
}

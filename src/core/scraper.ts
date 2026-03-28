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

export type ScrapeOptions = {
  selector?: string;
  noFastPath?: boolean;
  noBpc?: boolean;
  mobile?: boolean;
  proxy?: string | null;
  debugArtifacts?: boolean;
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
  const artifactsDir = options.debugArtifacts || config.artifacts.enabled ? await ensureArtifactDir(config.artifacts.dir, telemetry.requestId) : null;

  if (!options.noFastPath && config.fastPath.enabled) {
    try {
      const fastPath = await tryFastPath(url, config, logger, telemetry);
      if (fastPath.accepted) {
        html = fastPath.html;
        finalUrl = fastPath.finalUrl;
        bypassMethod = 'fast-path';
      }
    } catch (error) {
      logger.warn('fastpath.fetch.degraded', {
        ...telemetry,
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      });
    }
  }

  if (!html) {
    const browser = await browserPool.acquire(telemetry);
    browserUsed = true;
    const browserStage = await measureStage(logger, 'scrape.browser', telemetry, async () => {
      await browser.page.goto(url, { waitUntil: 'load', timeout: config.browser.defaultTimeout });
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
    if (browserStage.result.screenshot) {
      await browser.page.screenshot({ path: browserStage.result.screenshot, fullPage: true });
    }
    await browser.release();
  }

  const extractedStage = await measureStage(logger, 'scrape.extract', telemetry, async () => extractDocument(html, finalUrl, config, options.selector));
  const markdownStage = await measureStage(logger, 'scrape.convert', telemetry, async () => htmlToMarkdown(extractedStage.result.html));
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
  });

  if (artifactsDir && config.artifacts.includeRawHtml) {
    await writeArtifact(artifactsDir, 'raw.html', html);
  }
  if (artifactsDir && config.artifacts.includeCleanHtml) {
    await writeArtifact(artifactsDir, 'clean.html', extractedStage.result.html);
  }

  return {
    url,
    originalUrl,
    content: markdownStage.result,
    html: extractedStage.result.html,
    rawHtml: config.artifacts.includeRawHtml ? html : undefined,
    metadata,
    artifacts: artifactsDir ? {
      requestId: telemetry.requestId,
      dir: artifactsDir,
      screenshot: config.artifacts.includeScreenshot ? `${artifactsDir}/page.png` : null,
    } : undefined,
  };
}

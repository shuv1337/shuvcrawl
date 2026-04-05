import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ShuvcrawlConfig } from '../config/schema.ts';
import type { Logger } from '../utils/logger.ts';
import type { TelemetryContext } from '../utils/telemetry.ts';
import { measureStage } from '../utils/telemetry.ts';
import { allowByRobots } from '../utils/robots.ts';
import { expandHome } from '../utils/paths.ts';
import { normalizeUrl } from '../utils/url.ts';
import { ensureArtifactDir, writeArtifact } from '../storage/artifacts.ts';
import type { BrowserPoolLike } from './browser.ts';

export type WaitStrategy = 'load' | 'networkidle' | 'selector' | 'sleep';

export type ScreenshotOptions = {
  fullPage?: boolean;
  // Wait strategies
  wait?: WaitStrategy;
  waitFor?: string;
  waitTimeout?: number;
  sleep?: number;
  noRobots?: boolean;
};

export type PdfOptions = {
  format?: string;
  landscape?: boolean;
  // Wait strategies
  wait?: WaitStrategy;
  waitFor?: string;
  waitTimeout?: number;
  sleep?: number;
  noRobots?: boolean;
};

export type ScreenshotResult = {
  requestId: string;
  url: string;
  originalUrl: string;
  finalUrl: string;
  path: string;
  fullPage: boolean;
  width: number;
  height: number;
  elapsed: number;
  bypassMethod: 'bpc-extension';
  browserUsed: true;
};

export type PdfResult = {
  requestId: string;
  url: string;
  originalUrl: string;
  finalUrl: string;
  path: string;
  format: string;
  landscape: boolean;
  elapsed: number;
  bypassMethod: 'bpc-extension';
  browserUsed: true;
};

async function applyWaitStrategy(
  page: Awaited<ReturnType<BrowserPoolLike['acquire']>>['page'],
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

export async function captureScreenshot(
  inputUrl: string,
  options: ScreenshotOptions,
  config: ShuvcrawlConfig,
  logger: Logger,
  telemetry: TelemetryContext,
  browserPool: BrowserPoolLike,
): Promise<ScreenshotResult> {
  const originalUrl = inputUrl;
  const url = normalizeUrl(inputUrl);
  const preflight = await measureStage(logger, 'screenshot.preflight', telemetry, async () => {
    return await allowByRobots(url, options.noRobots ? false : config.crawl.respectRobots);
  });
  if (!preflight.result.allowed) {
    throw new Error(preflight.result.reason ?? 'robots denied');
  }

  const artifactDir = await ensureArtifactDir(config.artifacts.dir, telemetry.requestId);
  const browser = await browserPool.acquire(telemetry);
  try {
    const fullPage = options.fullPage ?? true;
    const waitStrategy = options.wait ?? 'load';
    const capture = await measureStage(logger, 'screenshot.capture', telemetry, async () => {
      const timeout = options.waitTimeout ?? config.browser.defaultTimeout;
      const waitUntil = waitStrategy === 'networkidle' ? 'networkidle' : 'load';

      await browser.page.goto(url, { waitUntil, timeout });
      await applyWaitStrategy(browser.page, waitStrategy, {
        waitFor: options.waitFor,
        waitTimeout: options.waitTimeout,
        sleep: options.sleep,
        defaultTimeout: config.browser.defaultTimeout,
      });

      const finalUrl = browser.page.url();
      const filePath = path.join(artifactDir, 'page.png');
      await browser.page.screenshot({ path: filePath, fullPage });
      const viewport = browser.page.viewportSize() ?? config.browser.viewport;
      return { finalUrl, filePath, viewport };
    });

    // Write console logs if enabled
    if (config.artifacts.includeConsole && browser.consoleLogs.length > 0) {
      const consolePath = path.join(artifactDir, 'console.json');
      await writeArtifact(artifactDir, 'console.json', JSON.stringify(browser.consoleLogs, null, 2));
    }

    return {
      requestId: telemetry.requestId,
      url,
      originalUrl,
      finalUrl: capture.result.finalUrl,
      path: capture.result.filePath,
      fullPage,
      width: capture.result.viewport.width,
      height: capture.result.viewport.height,
      elapsed: preflight.elapsed + capture.elapsed,
      bypassMethod: 'bpc-extension',
      browserUsed: true,
    };
  } finally {
    await browser.release();
  }
}

export async function renderPdf(
  inputUrl: string,
  options: PdfOptions,
  config: ShuvcrawlConfig,
  logger: Logger,
  telemetry: TelemetryContext,
  browserPool: BrowserPoolLike,
): Promise<PdfResult> {
  const originalUrl = inputUrl;
  const url = normalizeUrl(inputUrl);
  const preflight = await measureStage(logger, 'pdf.preflight', telemetry, async () => {
    return await allowByRobots(url, options.noRobots ? false : config.crawl.respectRobots);
  });
  if (!preflight.result.allowed) {
    throw new Error(preflight.result.reason ?? 'robots denied');
  }

  const artifactDir = await ensureArtifactDir(config.artifacts.dir, telemetry.requestId);
  const browser = await browserPool.acquire(telemetry);
  try {
    const format = options.format ?? 'A4';
    const landscape = options.landscape ?? false;
    const waitStrategy = options.wait ?? 'load';
    const pdf = await measureStage(logger, 'pdf.render', telemetry, async () => {
      const timeout = options.waitTimeout ?? config.browser.defaultTimeout;
      const waitUntil = waitStrategy === 'networkidle' ? 'networkidle' : 'load';

      await browser.page.goto(url, { waitUntil, timeout });
      await applyWaitStrategy(browser.page, waitStrategy, {
        waitFor: options.waitFor,
        waitTimeout: options.waitTimeout,
        sleep: options.sleep,
        defaultTimeout: config.browser.defaultTimeout,
      });

      const finalUrl = browser.page.url();
      const filePath = path.join(artifactDir, 'page.pdf');
      await browser.page.pdf({ path: filePath, format: format as any, landscape, printBackground: true });
      return { finalUrl, filePath };
    });

    // Write console logs if enabled
    if (config.artifacts.includeConsole && browser.consoleLogs.length > 0) {
      await writeArtifact(artifactDir, 'console.json', JSON.stringify(browser.consoleLogs, null, 2));
    }

    return {
      requestId: telemetry.requestId,
      url,
      originalUrl,
      finalUrl: pdf.result.finalUrl,
      path: pdf.result.filePath,
      format,
      landscape,
      elapsed: preflight.elapsed + pdf.elapsed,
      bypassMethod: 'bpc-extension',
      browserUsed: true,
    };
  } finally {
    await browser.release();
  }
}

export async function readBpcManifest(config: ShuvcrawlConfig): Promise<{ version: string | null; name: string | null; sourceMode: string; path: string }> {
  const resolvedPath = path.resolve(expandHome(config.bpc.path));

  try {
    const manifestPath = path.join(resolvedPath, 'manifest.json');
    const raw = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as { version?: string; name?: string };
    return {
      version: manifest.version ?? null,
      name: manifest.name ?? null,
      sourceMode: config.bpc.sourceMode,
      path: resolvedPath,
    };
  } catch {
    return {
      version: null,
      name: null,
      sourceMode: config.bpc.sourceMode,
      path: resolvedPath,
    };
  }
}

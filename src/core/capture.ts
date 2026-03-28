import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ShuvcrawlConfig } from '../config/schema.ts';
import type { Logger } from '../utils/logger.ts';
import type { TelemetryContext } from '../utils/telemetry.ts';
import { measureStage } from '../utils/telemetry.ts';
import { allowByRobots } from '../utils/robots.ts';
import { normalizeUrl } from '../utils/url.ts';
import { ensureArtifactDir } from '../storage/artifacts.ts';
import type { BrowserPool } from './browser.ts';

export type ScreenshotOptions = {
  fullPage?: boolean;
};

export type PdfOptions = {
  format?: string;
  landscape?: boolean;
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

export async function captureScreenshot(
  inputUrl: string,
  options: ScreenshotOptions,
  config: ShuvcrawlConfig,
  logger: Logger,
  telemetry: TelemetryContext,
  browserPool: BrowserPool,
): Promise<ScreenshotResult> {
  const originalUrl = inputUrl;
  const url = normalizeUrl(inputUrl);
  const preflight = await measureStage(logger, 'screenshot.preflight', telemetry, async () => {
    return await allowByRobots(url, config.crawl.respectRobots);
  });
  if (!preflight.result.allowed) {
    throw new Error(preflight.result.reason ?? 'robots denied');
  }

  const artifactDir = await ensureArtifactDir(config.artifacts.dir, telemetry.requestId);
  const browser = await browserPool.acquire(telemetry);
  try {
    const fullPage = options.fullPage ?? true;
    const capture = await measureStage(logger, 'screenshot.capture', telemetry, async () => {
      await browser.page.goto(url, { waitUntil: 'load', timeout: config.browser.defaultTimeout });
      const finalUrl = browser.page.url();
      const filePath = path.join(artifactDir, 'page.png');
      await browser.page.screenshot({ path: filePath, fullPage });
      const viewport = browser.page.viewportSize() ?? config.browser.viewport;
      return { finalUrl, filePath, viewport };
    });
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
  browserPool: BrowserPool,
): Promise<PdfResult> {
  const originalUrl = inputUrl;
  const url = normalizeUrl(inputUrl);
  const preflight = await measureStage(logger, 'pdf.preflight', telemetry, async () => {
    return await allowByRobots(url, config.crawl.respectRobots);
  });
  if (!preflight.result.allowed) {
    throw new Error(preflight.result.reason ?? 'robots denied');
  }

  const artifactDir = await ensureArtifactDir(config.artifacts.dir, telemetry.requestId);
  const browser = await browserPool.acquire(telemetry);
  try {
    const format = options.format ?? 'A4';
    const landscape = options.landscape ?? false;
    const pdf = await measureStage(logger, 'pdf.render', telemetry, async () => {
      await browser.page.goto(url, { waitUntil: 'load', timeout: config.browser.defaultTimeout });
      const finalUrl = browser.page.url();
      const filePath = path.join(artifactDir, 'page.pdf');
      await browser.page.pdf({ path: filePath, format: format as any, landscape, printBackground: true });
      return { finalUrl, filePath };
    });
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
  try {
    const manifestPath = path.join(path.resolve(config.bpc.path), 'manifest.json');
    const raw = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as { version?: string; name?: string };
    return {
      version: manifest.version ?? null,
      name: manifest.name ?? null,
      sourceMode: config.bpc.sourceMode,
      path: path.resolve(config.bpc.path),
    };
  } catch {
    return {
      version: null,
      name: null,
      sourceMode: config.bpc.sourceMode,
      path: path.resolve(config.bpc.path),
    };
  }
}

import type { ShuvcrawlConfig } from '../config/schema.ts';
import type { Logger } from '../utils/logger.ts';
import { BrowserPool } from './browser.ts';
import { scrapeUrl, type ScrapeOptions, type ScrapeResult } from './scraper.ts';
import { createTelemetryContext } from '../utils/telemetry.ts';
import { writeScrapeOutput } from '../storage/output.ts';
import { captureScreenshot, readBpcManifest, renderPdf, type PdfOptions, type PdfResult, type ScreenshotOptions, type ScreenshotResult } from './capture.ts';
import { redactConfig } from '../config/redact.ts';
import { mapUrl, type MapOptions, type MapResult } from './map.ts';
import { crawlSite, type CrawlOptions, type CrawlResult } from './crawl.ts';

export class Engine {
  private readonly browserPool: BrowserPool;

  constructor(
    private readonly config: ShuvcrawlConfig,
    private readonly logger: Logger,
  ) {
    this.browserPool = new BrowserPool(config, logger);
  }

  async scrape(url: string, options: ScrapeOptions = {}): Promise<{ result: ScrapeResult; output: Awaited<ReturnType<typeof writeScrapeOutput>> }> {
    const telemetry = createTelemetryContext();
    const result = await scrapeUrl(url, options, this.config, this.logger, telemetry, this.browserPool);
    const output = await writeScrapeOutput(result, this.config);
    return { result, output };
  }

  async screenshot(url: string, options: ScreenshotOptions = {}): Promise<{ result: ScreenshotResult }> {
    const telemetry = createTelemetryContext();
    const result = await captureScreenshot(url, options, this.config, this.logger, telemetry, this.browserPool);
    return { result };
  }

  async pdf(url: string, options: PdfOptions = {}): Promise<{ result: PdfResult }> {
    const telemetry = createTelemetryContext();
    const result = await renderPdf(url, options, this.config, this.logger, telemetry, this.browserPool);
    return { result };
  }

  async map(url: string, options: MapOptions = {}): Promise<{ result: MapResult }> {
    const telemetry = createTelemetryContext();
    const result = await mapUrl(url, options, this.config, this.logger, telemetry, this.browserPool);
    return { result };
  }

  async crawl(url: string, options: CrawlOptions = {}): Promise<{ result: CrawlResult }> {
    const result = await crawlSite(url, options, this.config, this.logger, this.browserPool);
    return { result };
  }

  async health(): Promise<Record<string, unknown>> {
    const bpc = await readBpcManifest(this.config);
    return {
      ok: true,
      service: this.config.telemetry.serviceName,
      browser: {
        executablePath: this.config.browser.executablePath,
        headless: this.config.browser.headless,
        profileRoot: this.config.browser.profileRoot,
      },
      bpc,
      telemetry: {
        exporter: this.config.telemetry.exporter,
        logLevel: this.config.telemetry.logLevel,
        otlpEnabled: Boolean(this.config.telemetry.otlpHttpEndpoint),
      },
      config: redactConfig(this.config),
    };
  }

  getConfig(): Record<string, unknown> {
    return redactConfig(this.config);
  }
}

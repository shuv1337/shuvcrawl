import type { ShuvcrawlConfig } from '../config/schema.ts';
import type { Logger } from '../utils/logger.ts';
import { BrowserPool } from './browser.ts';
import { scrapeUrl, type ScrapeOptions, type ScrapeResult } from './scraper.ts';
import { createTelemetryContext, startOtlpExporter } from '../utils/telemetry.ts';
import { writeScrapeOutput } from '../storage/output.ts';
import { captureScreenshot, readBpcManifest, renderPdf, type PdfOptions, type PdfResult, type ScreenshotOptions, type ScreenshotResult } from './capture.ts';
import { redactConfig } from '../config/redact.ts';
import { mapUrl, type MapOptions, type MapResult } from './map.ts';
import { crawlSite, type CrawlOptions, type CrawlResult, type CrawlProgressCallback } from './crawl.ts';
import { DomainRateLimiter } from '../utils/rate-limit.ts';
import { JobRegistry } from './job-registry.ts';
import { JobStore } from '../storage/job-store.ts';

export class Engine {
  private readonly browserPool: BrowserPool;
  private readonly rateLimiter: DomainRateLimiter;
  private readonly jobRegistry: JobRegistry;
  private readonly jobStore: JobStore;

  constructor(
    private readonly config: ShuvcrawlConfig,
    private readonly logger: Logger,
  ) {
    this.browserPool = new BrowserPool(config, logger);
    this.rateLimiter = new DomainRateLimiter();
    this.jobStore = new JobStore(config.storage.jobDbPath);
    this.jobRegistry = new JobRegistry(this.jobStore);

    if (config.telemetry.exporter === 'otlp-http' && config.telemetry.otlpHttpEndpoint) {
      startOtlpExporter(config.telemetry.otlpHttpEndpoint, config.telemetry.serviceName);
    }
  }

  async scrape(url: string, options: ScrapeOptions = {}): Promise<{ result: ScrapeResult; output: Awaited<ReturnType<typeof writeScrapeOutput>> }> {
    const telemetry = createTelemetryContext();
    const hostname = new URL(url).hostname;
    await this.rateLimiter.waitForDomain(hostname, this.config.crawl.delay);
    const result = await scrapeUrl(url, options, this.config, this.logger, telemetry, this.browserPool);
    const output = await writeScrapeOutput(result, this.config);
    return { result, output };
  }

  async screenshot(url: string, options: ScreenshotOptions = {}): Promise<{ result: ScreenshotResult }> {
    const telemetry = createTelemetryContext();
    const hostname = new URL(url).hostname;
    await this.rateLimiter.waitForDomain(hostname, this.config.crawl.delay);
    const result = await captureScreenshot(url, options, this.config, this.logger, telemetry, this.browserPool);
    return { result };
  }

  async pdf(url: string, options: PdfOptions = {}): Promise<{ result: PdfResult }> {
    const telemetry = createTelemetryContext();
    const hostname = new URL(url).hostname;
    await this.rateLimiter.waitForDomain(hostname, this.config.crawl.delay);
    const result = await renderPdf(url, options, this.config, this.logger, telemetry, this.browserPool);
    return { result };
  }

  async map(url: string, options: MapOptions = {}): Promise<{ result: MapResult }> {
    const telemetry = createTelemetryContext();
    const hostname = new URL(url).hostname;
    await this.rateLimiter.waitForDomain(hostname, this.config.crawl.delay);
    const result = await mapUrl(url, options, this.config, this.logger, telemetry, this.browserPool);
    return { result };
  }

  async crawl(
    url: string,
    options: CrawlOptions = {},
    onProgress?: CrawlProgressCallback,
  ): Promise<{ result: CrawlResult }> {
    const result = await crawlSite(url, options, this.config, this.logger, this.browserPool, this.rateLimiter, onProgress);
    return { result };
  }

  async crawlAsync(url: string, options: CrawlOptions = {}): Promise<{ jobId: string; status: string }> {
    return this.jobRegistry.startCrawl(url, options, this.config, this.logger, this.browserPool, this.rateLimiter);
  }

  async getCrawlJob(jobId: string): Promise<ReturnType<JobRegistry['getJob']>> {
    return this.jobRegistry.getJob(jobId);
  }

  async cancelCrawlJob(jobId: string): Promise<boolean> {
    return this.jobRegistry.cancelJob(jobId);
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
      rateLimiter: this.rateLimiter.getStats(),
    };
  }

  getConfig(): Record<string, unknown> {
    return redactConfig(this.config);
  }
}

import { randomUUID } from 'node:crypto';
import type { ShuvcrawlConfig } from '../config/schema.ts';
import type { Logger } from '../utils/logger.ts';
import type { BrowserPool } from './browser.ts';
import { crawlSite, type CrawlOptions, type CrawlResult } from './crawl.ts';
import { DomainRateLimiter } from '../utils/rate-limit.ts';

type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

type CrawlJob = {
  jobId: string;
  status: JobStatus;
  hostname: string;
  statePath?: string;
  result?: CrawlResult;
  error?: string;
  promise: Promise<void>;
  cancel: () => void;
  startedAt: string;
  completedAt?: string;
};

export class JobRegistry {
  private jobs: Map<string, CrawlJob> = new Map();

  async startCrawl(
    url: string,
    options: CrawlOptions,
    config: ShuvcrawlConfig,
    logger: Logger,
    browserPool: BrowserPool,
    rateLimiter?: DomainRateLimiter,
  ): Promise<{ jobId: string; status: string }> {
    const hostname = new URL(url).hostname;
    const jobId = `crawl_${randomUUID()}`;
    const abortController = new AbortController();

    const job: CrawlJob = {
      jobId,
      status: 'running',
      hostname,
      startedAt: new Date().toISOString(),
      cancel: () => abortController.abort(),
      promise: Promise.resolve(), // Will be set below
    };

    // Create the actual promise that runs the crawl
    job.promise = (async () => {
      try {
        const result = await crawlSite(
          url,
          options,
          config,
          logger,
          browserPool,
          rateLimiter,
          undefined,
          abortController.signal,
          jobId,
        );
        job.result = result;
        job.status = result.status === 'cancelled' ? 'cancelled' : 'completed';
        job.statePath = result.statePath;
      } catch (error) {
        job.error = error instanceof Error ? error.message : String(error);
        job.status = 'failed';
      } finally {
        job.completedAt = new Date().toISOString();
      }
    })();

    this.jobs.set(jobId, job);

    // Fire and forget - don't await
    job.promise.catch(() => {
      // Errors are already captured in job.error
    });

    return { jobId, status: 'running' };
  }

  getJob(jobId: string): CrawlJob | undefined {
    return this.jobs.get(jobId);
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status !== 'running') return false;

    job.cancel();
    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();
    return true;
  }

  listJobs(): Array<{ jobId: string; status: JobStatus; hostname: string; startedAt: string }> {
    return Array.from(this.jobs.values()).map(job => ({
      jobId: job.jobId,
      status: job.status,
      hostname: job.hostname,
      startedAt: job.startedAt,
    }));
  }

  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [jobId, job] of this.jobs) {
      if (job.completedAt && new Date(job.completedAt).getTime() < cutoff) {
        this.jobs.delete(jobId);
      }
    }
  }
}

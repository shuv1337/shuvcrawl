import { randomUUID } from 'node:crypto';
import type { ShuvcrawlConfig } from '../config/schema.ts';
import type { Logger } from '../utils/logger.ts';
import type { BrowserPool } from './browser.ts';
import { crawlSite, type CrawlOptions, type CrawlResult } from './crawl.ts';
import { DomainRateLimiter } from '../utils/rate-limit.ts';
import { JobStore, type PersistedJob, type JobStatus } from '../storage/job-store.ts';

type CrawlJob = {
  jobId: string;
  status: JobStatus;
  hostname: string;
  seedUrl: string;
  options: CrawlOptions;
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
  private store?: JobStore;

  constructor(store?: JobStore) {
    this.store = store;
  }

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
    const seedUrl = url;

    const job: CrawlJob = {
      jobId,
      status: 'running',
      hostname,
      seedUrl,
      options,
      startedAt: new Date().toISOString(),
      cancel: () => abortController.abort(),
      promise: Promise.resolve(), // Will be set below
    };

    // Persist to store immediately if available
    if (this.store) {
      this.store.upsert({
        jobId,
        status: 'running',
        hostname,
        seedUrl,
        options,
        startedAt: job.startedAt,
      });
    }

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
        // Update store with final state
        if (this.store) {
          this.store.upsert({
            jobId,
            status: job.status,
            hostname,
            seedUrl,
            options,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            error: job.error,
            result: job.result,
            crawlStatePath: job.statePath,
          });
        }
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
    // Check in-memory first (for running jobs with live promises/AbortControllers)
    const inMemoryJob = this.jobs.get(jobId);
    if (inMemoryJob) {
      return inMemoryJob;
    }

    // Fall back to store for historical jobs
    if (this.store) {
      const persistedJob = this.store.get(jobId);
      if (persistedJob) {
        // Reconstruct a CrawlJob from persisted data (without live promise/cancel)
        return {
          jobId: persistedJob.jobId,
          status: persistedJob.status,
          hostname: persistedJob.hostname,
          seedUrl: persistedJob.seedUrl,
          options: persistedJob.options,
          startedAt: persistedJob.startedAt,
          completedAt: persistedJob.completedAt,
          error: persistedJob.error,
          result: persistedJob.result,
          statePath: persistedJob.crawlStatePath,
          promise: Promise.resolve(), // Historical jobs have no live promise
          cancel: () => { /* No-op for historical jobs */ },
        };
      }
    }

    return undefined;
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status !== 'running') return false;

    job.cancel();
    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();

    // Update store
    if (this.store) {
      this.store.upsert({
        jobId: job.jobId,
        status: job.status,
        hostname: job.hostname,
        seedUrl: job.seedUrl,
        options: job.options,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error,
        result: job.result,
        crawlStatePath: job.statePath,
      });
    }

    return true;
  }

  listJobs(): Array<{ jobId: string; status: JobStatus; hostname: string; startedAt: string }> {
    // Get in-memory running jobs
    const inMemoryJobs = Array.from(this.jobs.values());

    // Get historical jobs from store
    const historicalJobs: PersistedJob[] = this.store?.list() ?? [];

    // Create a map to deduplicate (in-memory takes precedence for any overlap)
    const jobMap = new Map<string, { jobId: string; status: JobStatus; hostname: string; startedAt: string }>();

    // Add historical jobs first
    for (const job of historicalJobs) {
      jobMap.set(job.jobId, {
        jobId: job.jobId,
        status: job.status,
        hostname: job.hostname,
        startedAt: job.startedAt,
      });
    }

    // Overwrite with in-memory jobs (they have more current state)
    for (const job of inMemoryJobs) {
      jobMap.set(job.jobId, {
        jobId: job.jobId,
        status: job.status,
        hostname: job.hostname,
        startedAt: job.startedAt,
      });
    }

    // Return sorted by startedAt desc
    return Array.from(jobMap.values()).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;

    // Clean in-memory jobs
    for (const [jobId, job] of this.jobs) {
      if (job.completedAt && new Date(job.completedAt).getTime() < cutoff) {
        this.jobs.delete(jobId);
      }
    }

    // Clean store jobs
    if (this.store) {
      this.store.cleanup(maxAgeMs);
    }
  }
}

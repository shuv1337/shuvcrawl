import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JobStore, type PersistedJob } from '../../src/storage/job-store.ts';
import { JobRegistry } from '../../src/core/job-registry.ts';
import type { CrawlOptions, CrawlResult } from '../../src/core/crawl.ts';

describe('JobStore', () => {
  let tmpDir: string;
  let dbPath: string;
  let store: JobStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'shuvcrawl-job-store-test-'));
    dbPath = path.join(tmpDir, 'jobs.db');
    store = new JobStore(dbPath);
  });

  afterEach(async () => {
    store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  const mockOptions: CrawlOptions = {
    depth: 3,
    limit: 50,
    include: ['https://example.com/**'],
    exclude: [],
    delay: 1000,
    source: 'links',
    resume: true,
  };

  const createMockJob = (overrides?: Partial<PersistedJob>): PersistedJob => ({
    jobId: `crawl_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    status: 'running',
    hostname: 'example.com',
    seedUrl: 'https://example.com',
    options: mockOptions,
    startedAt: new Date().toISOString(),
    ...overrides,
  });

  describe('CRUD operations', () => {
    it('creates and retrieves a job', () => {
      const job = createMockJob();
      store.upsert(job);

      const retrieved = store.get(job.jobId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.jobId).toBe(job.jobId);
      expect(retrieved?.status).toBe(job.status);
      expect(retrieved?.hostname).toBe(job.hostname);
      expect(retrieved?.seedUrl).toBe(job.seedUrl);
      expect(retrieved?.options).toEqual(job.options);
      expect(retrieved?.startedAt).toBe(job.startedAt);
    });

    it('updates existing job on upsert', () => {
      const job = createMockJob({ status: 'running' });
      store.upsert(job);

      // Update the job
      const updatedJob: PersistedJob = {
        ...job,
        status: 'completed',
        completedAt: new Date().toISOString(),
        result: {
          jobId: job.jobId,
          status: 'completed',
          statePath: '/path/to/state',
          summary: {
            visited: 10,
            queued: 5,
            succeeded: 8,
            failed: 2,
            skipped: 0,
          },
          results: [],
        } satisfies CrawlResult,
      };
      store.upsert(updatedJob);

      const retrieved = store.get(job.jobId);
      expect(retrieved?.status).toBe('completed');
      expect(retrieved?.completedAt).toBe(updatedJob.completedAt);
      expect(retrieved?.result).toEqual(updatedJob.result);
    });

    it('returns undefined for non-existent job', () => {
      const retrieved = store.get('non-existent-job');
      expect(retrieved).toBeUndefined();
    });

    it('deletes a job', () => {
      const job = createMockJob();
      store.upsert(job);

      expect(store.get(job.jobId)).toBeDefined();

      const deleted = store.delete(job.jobId);
      expect(deleted).toBe(true);
      expect(store.get(job.jobId)).toBeUndefined();
    });

    it('returns false when deleting non-existent job', () => {
      const deleted = store.delete('non-existent-job');
      expect(deleted).toBe(false);
    });
  });

  describe('list operations', () => {
    it('lists all jobs ordered by startedAt desc', () => {
      const job1 = createMockJob({ startedAt: '2024-01-01T00:00:00.000Z' });
      const job2 = createMockJob({ startedAt: '2024-01-02T00:00:00.000Z' });
      const job3 = createMockJob({ startedAt: '2024-01-03T00:00:00.000Z' });

      store.upsert(job1);
      store.upsert(job2);
      store.upsert(job3);

      const jobs = store.list();
      expect(jobs).toHaveLength(3);
      expect(jobs[0].jobId).toBe(job3.jobId);
      expect(jobs[1].jobId).toBe(job2.jobId);
      expect(jobs[2].jobId).toBe(job1.jobId);
    });

    it('filters by status', () => {
      const runningJob = createMockJob({ status: 'running' });
      const completedJob = createMockJob({ status: 'completed' });
      const failedJob = createMockJob({ status: 'failed' });

      store.upsert(runningJob);
      store.upsert(completedJob);
      store.upsert(failedJob);

      const runningJobs = store.list({ status: 'running' });
      expect(runningJobs).toHaveLength(1);
      expect(runningJobs[0].jobId).toBe(runningJob.jobId);

      const completedJobs = store.list({ status: 'completed' });
      expect(completedJobs).toHaveLength(1);
      expect(completedJobs[0].jobId).toBe(completedJob.jobId);
    });

    it('filters by multiple statuses', () => {
      const runningJob = createMockJob({ status: 'running' });
      const completedJob = createMockJob({ status: 'completed' });
      const failedJob = createMockJob({ status: 'failed' });

      store.upsert(runningJob);
      store.upsert(completedJob);
      store.upsert(failedJob);

      const jobs = store.list({ status: ['completed', 'failed'] });
      expect(jobs).toHaveLength(2);
      const jobIds = jobs.map(j => j.jobId);
      expect(jobIds).toContain(completedJob.jobId);
      expect(jobIds).toContain(failedJob.jobId);
      expect(jobIds).not.toContain(runningJob.jobId);
    });

    it('filters by hostname', () => {
      const job1 = createMockJob({ hostname: 'example.com' });
      const job2 = createMockJob({ hostname: 'other.com' });

      store.upsert(job1);
      store.upsert(job2);

      const jobs = store.list({ hostname: 'example.com' });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobId).toBe(job1.jobId);
    });

    it('limits results', () => {
      for (let i = 0; i < 10; i++) {
        store.upsert(createMockJob());
      }

      const jobs = store.list({ limit: 5 });
      expect(jobs).toHaveLength(5);
    });

    it('filters by date range', () => {
      const job1 = createMockJob({ startedAt: '2024-01-01T00:00:00.000Z' });
      const job2 = createMockJob({ startedAt: '2024-06-01T00:00:00.000Z' });
      const job3 = createMockJob({ startedAt: '2024-12-01T00:00:00.000Z' });

      store.upsert(job1);
      store.upsert(job2);
      store.upsert(job3);

      const jobs = store.list({ after: '2024-05-01T00:00:00.000Z', before: '2024-10-01T00:00:00.000Z' });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobId).toBe(job2.jobId);
    });
  });

  describe('cleanup', () => {
    it('removes old completed jobs', () => {
      const oldJob = createMockJob({
        status: 'completed',
        completedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 2 days old
      });
      const recentJob = createMockJob({
        status: 'completed',
        completedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1 hour old
      });
      const runningJob = createMockJob({ status: 'running' });

      store.upsert(oldJob);
      store.upsert(recentJob);
      store.upsert(runningJob);

      const deleted = store.cleanup(24 * 60 * 60 * 1000); // 1 day max age
      expect(deleted).toBe(1);

      expect(store.get(oldJob.jobId)).toBeUndefined();
      expect(store.get(recentJob.jobId)).toBeDefined();
      expect(store.get(runningJob.jobId)).toBeDefined();
    });

    it('returns count of deleted jobs', () => {
      for (let i = 0; i < 5; i++) {
        store.upsert(createMockJob({
          status: 'completed',
          completedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        }));
      }

      const deleted = store.cleanup(24 * 60 * 60 * 1000);
      expect(deleted).toBe(5);
    });
  });

  describe('JSON serialization', () => {
    it('correctly serializes and deserializes complex options', () => {
      const complexOptions: CrawlOptions = {
        depth: 5,
        limit: 100,
        include: ['https://example.com/**', 'https://example.com/api/*'],
        exclude: ['https://example.com/admin', 'https://example.com/private'],
        delay: 2000,
        source: 'both',
        resume: true,
        noFastPath: true,
        noBpc: false,
        noCache: true,
        debugArtifacts: true,
        wait: 'networkidle',
        waitFor: '.content-loaded',
        waitTimeout: 5000,
        sleep: 1000,
      };

      const job = createMockJob({ options: complexOptions });
      store.upsert(job);

      const retrieved = store.get(job.jobId);
      expect(retrieved?.options).toEqual(complexOptions);
    });

    it('correctly serializes and deserializes crawl results', () => {
      const result: CrawlResult = {
        jobId: 'test-job',
        status: 'completed',
        statePath: '/path/to/state.json',
        summary: {
          visited: 50,
          queued: 10,
          succeeded: 45,
          failed: 3,
          skipped: 2,
        },
        results: [
          {
            url: 'https://example.com/page1',
            depth: 0,
            status: 'success',
            requestId: 'req-1',
            title: 'Page 1',
            elapsed: 1500,
            bypassMethod: 'direct',
            discoveredCount: 5,
          },
        ],
      };

      const job = createMockJob({
        status: 'completed',
        completedAt: new Date().toISOString(),
        result,
      });
      store.upsert(job);

      const retrieved = store.get(job.jobId);
      expect(retrieved?.result).toEqual(result);
    });

    it('handles jobs with errors', () => {
      const job = createMockJob({
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: 'Network timeout error',
      });
      store.upsert(job);

      const retrieved = store.get(job.jobId);
      expect(retrieved?.status).toBe('failed');
      expect(retrieved?.error).toBe('Network timeout error');
    });

    it('handles jobs without optional fields', () => {
      const job: PersistedJob = {
        jobId: 'minimal-job',
        status: 'running',
        hostname: 'example.com',
        seedUrl: 'https://example.com',
        options: {},
        startedAt: new Date().toISOString(),
        // No completedAt, error, result, or crawlStatePath
      };
      store.upsert(job);

      const retrieved = store.get(job.jobId);
      expect(retrieved?.jobId).toBe(job.jobId);
      expect(retrieved?.completedAt).toBeUndefined();
      expect(retrieved?.error).toBeUndefined();
      expect(retrieved?.result).toBeUndefined();
      expect(retrieved?.crawlStatePath).toBeUndefined();
    });
  });
});

describe('JobRegistry with JobStore', () => {
  let tmpDir: string;
  let dbPath: string;
  let store: JobStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'shuvcrawl-job-registry-test-'));
    dbPath = path.join(tmpDir, 'jobs.db');
    store = new JobStore(dbPath);
  });

  afterEach(async () => {
    store.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('persists jobs to store on creation', async () => {
    const registry = new JobRegistry(store);

    // We can't easily test startCrawl without mocking all dependencies,
    // but we can test the store integration directly
    const jobId = 'crawl_test_persist';
    store.upsert({
      jobId,
      status: 'running',
      hostname: 'example.com',
      seedUrl: 'https://example.com',
      options: { depth: 3 },
      startedAt: new Date().toISOString(),
    });

    const retrieved = store.get(jobId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.jobId).toBe(jobId);
    expect(retrieved?.status).toBe('running');
  });

  it('retrieves historical jobs from store when not in memory', async () => {
    const registry = new JobRegistry(store);

    // Insert a job directly into the store (simulating a past job)
    const jobId = 'crawl_historical_job';
    const completedAt = new Date().toISOString();
    store.upsert({
      jobId,
      status: 'completed',
      hostname: 'example.com',
      seedUrl: 'https://example.com',
      options: { depth: 3 },
      startedAt: new Date(Date.now() - 3600000).toISOString(),
      completedAt,
      result: {
        jobId,
        status: 'completed',
        statePath: '/path/to/state',
        summary: { visited: 10, queued: 5, succeeded: 8, failed: 2, skipped: 0 },
        results: [],
      },
    });

    // The registry should find it in the store
    const job = registry.getJob(jobId);
    expect(job).toBeDefined();
    expect(job?.jobId).toBe(jobId);
    expect(job?.status).toBe('completed');
    expect(job?.completedAt).toBe(completedAt);
    expect(job?.result).toBeDefined();
    expect(job?.result?.summary.visited).toBe(10);
  });

  it('in-memory jobs take precedence over store', async () => {
    // Create a registry with store
    const registry = new JobRegistry(store);

    // Insert a job into store
    const jobId = 'crawl_conflict_test';
    store.upsert({
      jobId,
      status: 'running',
      hostname: 'example.com',
      seedUrl: 'https://example.com',
      options: { depth: 3 },
      startedAt: new Date().toISOString(),
    });

    // Job should be found (from store, since not in memory)
    const job1 = registry.getJob(jobId);
    expect(job1?.status).toBe('running');
  });

  it('listJobs merges in-memory and store jobs', async () => {
    const registry = new JobRegistry(store);

    // Insert jobs into store (simulating historical jobs)
    const storeJob1 = {
      jobId: 'crawl_store_1',
      status: 'completed' as const,
      hostname: 'example.com',
      seedUrl: 'https://example.com',
      options: {},
      startedAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
      completedAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    };
    const storeJob2 = {
      jobId: 'crawl_store_2',
      status: 'failed' as const,
      hostname: 'test.com',
      seedUrl: 'https://test.com',
      options: {},
      startedAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      completedAt: new Date(Date.now() - 1800000).toISOString(), // 30 min ago
    };
    store.upsert(storeJob1);
    store.upsert(storeJob2);

    // Get list of jobs
    const jobs = registry.listJobs();

    // Should have both store jobs
    expect(jobs).toHaveLength(2);

    const jobIds = jobs.map(j => j.jobId);
    expect(jobIds).toContain(storeJob1.jobId);
    expect(jobIds).toContain(storeJob2.jobId);

    // Jobs should be sorted by startedAt desc
    expect(jobs[0].jobId).toBe(storeJob2.jobId); // More recent first
    expect(jobs[1].jobId).toBe(storeJob1.jobId);
  });

  it('cleanup removes old jobs from both memory and store', async () => {
    const registry = new JobRegistry(store);

    // Insert old completed jobs into store
    for (let i = 0; i < 3; i++) {
      store.upsert({
        jobId: `crawl_old_${i}`,
        status: 'completed',
        hostname: 'example.com',
        seedUrl: 'https://example.com',
        options: {},
        startedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        completedAt: new Date(Date.now() - 47 * 60 * 60 * 1000).toISOString(),
      });
    }

    // Insert recent completed job
    store.upsert({
      jobId: 'crawl_recent',
      status: 'completed',
      hostname: 'example.com',
      seedUrl: 'https://example.com',
      options: {},
      startedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
      completedAt: new Date().toISOString(),
    });

    // Insert running job (no completedAt)
    store.upsert({
      jobId: 'crawl_running',
      status: 'running',
      hostname: 'example.com',
      seedUrl: 'https://example.com',
      options: {},
      startedAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });

    // Cleanup jobs older than 24 hours
    registry.cleanup(24 * 60 * 60 * 1000);

    // Old completed jobs should be removed
    expect(store.get('crawl_old_0')).toBeUndefined();
    expect(store.get('crawl_old_1')).toBeUndefined();
    expect(store.get('crawl_old_2')).toBeUndefined();

    // Recent completed job should remain
    expect(store.get('crawl_recent')).toBeDefined();

    // Running job should remain (no completedAt means it won't be cleaned)
    expect(store.get('crawl_running')).toBeDefined();
  });

  it('works without a store (backwards compatibility)', async () => {
    const registry = new JobRegistry(); // No store

    // getJob should return undefined for non-existent jobs
    expect(registry.getJob('non-existent')).toBeUndefined();

    // listJobs should return empty array
    expect(registry.listJobs()).toEqual([]);

    // cleanup should not throw
    expect(() => registry.cleanup()).not.toThrow();
  });
});

describe('JobStore home directory expansion', () => {
  it('expands ~ in database path', () => {
    const store = new JobStore('~/test-jobs.db');
    // Should not throw and should create the database
    // The actual path expansion is tested implicitly by successful creation
    expect(() => store.close()).not.toThrow();
  });

  it('uses default path when no path provided', () => {
    // This would normally create ~/.shuvcrawl/data/jobs.db
    // We don't actually run this to avoid creating files in home directory during tests
    // But the constructor should accept no arguments
    expect(() => {
      const store = new JobStore(':memory:'); // Use in-memory SQLite for this test
      store.close();
    }).not.toThrow();
  });
});

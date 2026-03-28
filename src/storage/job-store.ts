import { Database } from 'bun:sqlite';
import { expandHome } from '../utils/paths.ts';
import type { CrawlOptions, CrawlResult } from '../core/crawl.ts';

export type JobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type PersistedJob = {
  jobId: string;
  status: JobStatus;
  hostname: string;
  seedUrl: string;
  options: CrawlOptions;
  startedAt: string;
  completedAt?: string;
  error?: string;
  result?: CrawlResult;
  crawlStatePath?: string;
};

export type JobFilters = {
  status?: JobStatus | JobStatus[];
  hostname?: string;
  limit?: number;
  before?: string; // ISO date string
  after?: string; // ISO date string
};

export class JobStore {
  private db: Database;

  constructor(dbPath: string = '~/.shuvcrawl/data/jobs.db') {
    const resolvedPath = expandHome(dbPath);

    // Ensure parent directory exists
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.initTable();
  }

  private initTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        hostname TEXT NOT NULL,
        seed_url TEXT NOT NULL,
        options TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error TEXT,
        result TEXT,
        crawl_state_path TEXT
      )
    `);

    // Create indexes for common queries
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_hostname ON jobs(hostname)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_started_at ON jobs(started_at)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_completed_at ON jobs(completed_at)`);
  }

  upsert(job: PersistedJob): void {
    const stmt = this.db.prepare(`
      INSERT INTO jobs (job_id, status, hostname, seed_url, options, started_at, completed_at, error, result, crawl_state_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        status = excluded.status,
        completed_at = excluded.completed_at,
        error = excluded.error,
        result = excluded.result,
        crawl_state_path = excluded.crawl_state_path
    `);

    stmt.run(
      job.jobId,
      job.status,
      job.hostname,
      job.seedUrl,
      JSON.stringify(job.options),
      job.startedAt,
      job.completedAt ?? null,
      job.error ?? null,
      job.result ? JSON.stringify(job.result) : null,
      job.crawlStatePath ?? null,
    );
    stmt.finalize();
  }

  get(jobId: string): PersistedJob | undefined {
    const stmt = this.db.prepare('SELECT * FROM jobs WHERE job_id = ?');
    const row = stmt.get(jobId) as {
      job_id: string;
      status: JobStatus;
      hostname: string;
      seed_url: string;
      options: string;
      started_at: string;
      completed_at: string | null;
      error: string | null;
      result: string | null;
      crawl_state_path: string | null;
    } | undefined;
    stmt.finalize();

    if (!row) return undefined;

    return this.rowToJob(row);
  }

  list(filters?: JobFilters): PersistedJob[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        conditions.push(`status IN (${filters.status.map(() => '?').join(',')})`);
        params.push(...filters.status);
      } else {
        conditions.push('status = ?');
        params.push(filters.status);
      }
    }

    if (filters?.hostname) {
      conditions.push('hostname = ?');
      params.push(filters.hostname);
    }

    if (filters?.before) {
      conditions.push('started_at < ?');
      params.push(filters.before);
    }

    if (filters?.after) {
      conditions.push('started_at > ?');
      params.push(filters.after);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderClause = 'ORDER BY started_at DESC';
    const limitClause = filters?.limit ? 'LIMIT ?' : '';

    if (filters?.limit) {
      params.push(filters.limit);
    }

    const sql = `SELECT * FROM jobs ${whereClause} ${orderClause} ${limitClause}`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      job_id: string;
      status: JobStatus;
      hostname: string;
      seed_url: string;
      options: string;
      started_at: string;
      completed_at: string | null;
      error: string | null;
      result: string | null;
      crawl_state_path: string | null;
    }>;
    stmt.finalize();

    return rows.map(row => this.rowToJob(row));
  }

  delete(jobId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM jobs WHERE job_id = ?');
    const result = stmt.run(jobId);
    stmt.finalize();
    return result.changes > 0;
  }

  cleanup(maxAgeMs: number): number {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const stmt = this.db.prepare('DELETE FROM jobs WHERE completed_at IS NOT NULL AND completed_at < ?');
    const result = stmt.run(cutoff);
    stmt.finalize();
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  private rowToJob(row: {
    job_id: string;
    status: JobStatus;
    hostname: string;
    seed_url: string;
    options: string;
    started_at: string;
    completed_at: string | null;
    error: string | null;
    result: string | null;
    crawl_state_path: string | null;
  }): PersistedJob {
    return {
      jobId: row.job_id,
      status: row.status,
      hostname: row.hostname,
      seedUrl: row.seed_url,
      options: JSON.parse(row.options) as CrawlOptions,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      error: row.error ?? undefined,
      result: row.result ? (JSON.parse(row.result) as CrawlResult) : undefined,
      crawlStatePath: row.crawl_state_path ?? undefined,
    };
  }
}

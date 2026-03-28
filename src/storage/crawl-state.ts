import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type CrawlJobStatus = 'queued' | 'running' | 'paused' | 'cancelling' | 'cancelled' | 'completed' | 'failed';

export type CrawlPageStatus =
  | 'success'
  | 'partial'
  | 'failed'
  | 'blocked'
  | 'robots-denied'
  | 'skipped-duplicate'
  | 'skipped-filtered';

export type CrawlPageRecord = {
  url: string;
  depth: number;
  status: CrawlPageStatus;
  requestId?: string;
  title?: string | null;
  elapsed?: number;
  bypassMethod?: string;
  discoveredCount?: number;
  output?: Record<string, unknown>;
  error?: string;
};

export type CrawlState = {
  jobId: string;
  status: CrawlJobStatus;
  seedUrl: string;
  options: {
    depth: number;
    limit: number;
    include: string[];
    exclude: string[];
    delay: number;
    source: 'links' | 'sitemap' | 'both';
    resume: boolean;
  };
  queue: Array<{ url: string; depth: number }>;
  visited: string[];
  results: CrawlPageRecord[];
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
};

export async function writeCrawlState(outputDir: string, hostname: string, state: CrawlState): Promise<string> {
  const domainDir = path.join(outputDir, hostname);
  await mkdir(domainDir, { recursive: true });
  const statePath = path.join(domainDir, '_crawl-state.json');
  const payload = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(statePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return statePath;
}

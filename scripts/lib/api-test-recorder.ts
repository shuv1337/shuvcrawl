import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ApiTestStatus = 'passed' | 'failed' | 'skipped';
export type ApiEventType =
  | 'test.start'
  | 'request.sent'
  | 'response.received'
  | 'artifact.recorded'
  | 'note.recorded'
  | 'test.pass'
  | 'test.fail'
  | 'test.skip';

export type ApiHarnessEnv = {
  runId: string;
  runDir: string;
  runtimeDir: string;
  containerRuntimeDir: string;
  apiBaseUrl: string;
  fixtureInternalBaseUrl: string;
  fixtureExternalBaseUrl: string;
  apiToken: string | null;
  eventsPath: string;
  requestsPath: string;
  failuresDir: string;
  jobsDir: string;
  verifyOtlp: boolean;
};

export type ApiEventRecord = {
  runId: string;
  testId: string;
  eventType: ApiEventType;
  ts: string;
  endpoint?: string;
  method?: string;
  url?: string;
  requestId?: string;
  jobId?: string;
  elapsedMs?: number;
  statusCode?: number;
  artifactPath?: string;
  details?: Record<string, unknown>;
};

export type ApiRequestLedgerRecord = {
  runId: string;
  testId: string;
  ts: string;
  method: string;
  endpoint: string;
  url: string;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  statusCode: number;
  elapsedMs: number;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  requestId?: string;
  jobId?: string;
};

export type ApiTestRecord = {
  id: string;
  runId: string;
  category: string;
  name: string;
  status: ApiTestStatus;
  startedAt: string;
  elapsedMs: number;
  request?: {
    method?: string;
    endpoint?: string;
    url?: string;
  };
  response?: {
    statusCode?: number;
  };
  requestId?: string;
  jobId?: string;
  artifacts: string[];
  notes: string[];
  error?: {
    message: string;
    stack?: string;
  };
};

export type RunSummary = {
  runId: string;
  status: 'passed' | 'failed';
  generatedAt: string;
  startedAt: string;
  elapsedMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  categories: Array<{
    category: string;
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  }>;
  telemetry: {
    verifyOtlp: boolean;
    otlpCaptureFile: string | null;
    otlpCapturedSpans: number;
  };
  docker?: Record<string, unknown>;
};

export type RunManifest = {
  runId: string;
  generatedAt: string;
  files: Array<{
    path: string;
    size: number;
  }>;
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function envValue(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export async function getApiHarnessEnv(): Promise<ApiHarnessEnv> {
  const runId = envValue('SHUVCRAWL_TEST_RUN_ID', 'dev-run');
  const runDir = path.resolve(envValue('SHUVCRAWL_TEST_RUN_DIR', path.join(process.cwd(), 'test-results', runId)));
  const runtimeDir = path.resolve(envValue('SHUVCRAWL_TEST_RUNTIME_DIR', path.join(runDir, 'runtime')));
  const apiDir = path.join(runDir, 'api');
  const failuresDir = path.join(apiDir, 'failures');
  const jobsDir = path.join(apiDir, 'jobs');
  await mkdir(apiDir, { recursive: true });
  await mkdir(failuresDir, { recursive: true });
  await mkdir(jobsDir, { recursive: true });

  return {
    runId,
    runDir,
    runtimeDir,
    containerRuntimeDir: envValue('SHUVCRAWL_TEST_CONTAINER_RUNTIME_DIR', '/app/test-runtime'),
    apiBaseUrl: envValue('SHUVCRAWL_API_BASE_URL', 'http://localhost:3777'),
    fixtureInternalBaseUrl: envValue('SHUVCRAWL_FIXTURE_INTERNAL_BASE_URL', 'http://fixtures:4444'),
    fixtureExternalBaseUrl: envValue('SHUVCRAWL_FIXTURE_EXTERNAL_BASE_URL', 'http://localhost:4444'),
    apiToken: process.env.SHUVCRAWL_API_TOKEN ?? null,
    eventsPath: envValue('SHUVCRAWL_TEST_EVENTS_PATH', path.join(apiDir, 'events.jsonl')),
    requestsPath: envValue('SHUVCRAWL_TEST_REQUESTS_PATH', path.join(apiDir, 'requests.jsonl')),
    failuresDir,
    jobsDir,
    verifyOtlp: envValue('SHUVCRAWL_TEST_VERIFY_OTLP', 'false') === 'true',
  };
}

async function appendJsonLine(targetPath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await appendFile(targetPath, `${JSON.stringify(payload)}\n`, 'utf8');
}

export class ApiTestTrace {
  private readonly startedAt = new Date().toISOString();
  private readonly startedAtMs = Date.now();
  private readonly artifacts = new Set<string>();
  private readonly notes: string[] = [];
  private requestSummary: ApiTestRecord['request'];
  private responseSummary: ApiTestRecord['response'];
  private requestId?: string;
  private jobId?: string;

  constructor(
    readonly env: ApiHarnessEnv,
    readonly category: string,
    readonly name: string,
    readonly testId: string = `${slugify(category)}--${slugify(name)}`,
  ) {}

  async start(details: Record<string, unknown> = {}): Promise<void> {
    await this.event('test.start', { details });
  }

  async event(eventType: ApiEventType, payload: Omit<ApiEventRecord, 'runId' | 'testId' | 'eventType' | 'ts'> = {}): Promise<void> {
    await appendJsonLine(this.env.eventsPath, {
      runId: this.env.runId,
      testId: this.testId,
      eventType,
      ts: new Date().toISOString(),
      ...payload,
    } satisfies ApiEventRecord);
  }

  async request(record: Omit<ApiRequestLedgerRecord, 'runId' | 'testId' | 'ts'>): Promise<void> {
    this.requestSummary = {
      method: record.method,
      endpoint: record.endpoint,
      url: record.url,
    };
    this.responseSummary = { statusCode: record.statusCode };
    this.requestId = record.requestId ?? this.requestId;
    this.jobId = record.jobId ?? this.jobId;

    await appendJsonLine(this.env.requestsPath, {
      runId: this.env.runId,
      testId: this.testId,
      ts: new Date().toISOString(),
      ...record,
    } satisfies ApiRequestLedgerRecord);
  }

  async note(note: string, details: Record<string, unknown> = {}): Promise<void> {
    this.notes.push(note);
    await this.event('note.recorded', { details: { note, ...details } });
  }

  async artifact(artifactPath: string, details: Record<string, unknown> = {}): Promise<void> {
    const relativePath = path.relative(this.env.runDir, artifactPath) || path.basename(artifactPath);
    this.artifacts.add(relativePath);
    await this.event('artifact.recorded', { artifactPath: relativePath, details });
  }

  setCorrelation(fields: { requestId?: string; jobId?: string }) {
    this.requestId = fields.requestId ?? this.requestId;
    this.jobId = fields.jobId ?? this.jobId;
  }

  async pass(details: Record<string, unknown> = {}): Promise<ApiTestRecord> {
    const record = this.buildRecord('passed');
    await this.event('test.pass', {
      elapsedMs: record.elapsedMs,
      requestId: this.requestId,
      jobId: this.jobId,
      details,
    });
    return record;
  }

  async skip(details: Record<string, unknown> = {}): Promise<ApiTestRecord> {
    const record = this.buildRecord('skipped');
    await this.event('test.skip', {
      elapsedMs: record.elapsedMs,
      requestId: this.requestId,
      jobId: this.jobId,
      details,
    });
    return record;
  }

  async fail(error: unknown, details: Record<string, unknown> = {}): Promise<ApiTestRecord> {
    const record = this.buildRecord('failed', error);
    await this.event('test.fail', {
      elapsedMs: record.elapsedMs,
      requestId: this.requestId,
      jobId: this.jobId,
      details: {
        ...details,
        error: record.error,
      },
    });
    return record;
  }

  buildRecord(status: ApiTestStatus, error?: unknown): ApiTestRecord {
    const elapsedMs = Date.now() - this.startedAtMs;
    return {
      id: this.testId,
      runId: this.env.runId,
      category: this.category,
      name: this.name,
      status,
      startedAt: this.startedAt,
      elapsedMs,
      request: this.requestSummary,
      response: this.responseSummary,
      requestId: this.requestId,
      jobId: this.jobId,
      artifacts: Array.from(this.artifacts),
      notes: [...this.notes],
      ...(error instanceof Error
        ? {
            error: {
              message: error.message,
              stack: error.stack,
            },
          }
        : error
          ? { error: { message: String(error) } }
          : {}),
    };
  }
}

export async function writeTestRecord(env: ApiHarnessEnv, record: ApiTestRecord): Promise<void> {
  const target = path.join(env.runDir, 'api', `${record.id}.json`);
  await writeFile(target, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

export async function collectTestRecords(env: ApiHarnessEnv): Promise<ApiTestRecord[]> {
  const apiDir = path.join(env.runDir, 'api');
  const files = await readdir(apiDir, { withFileTypes: true });
  const records: ApiTestRecord[] = [];

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.json') || file.name === 'suite.json') {
      continue;
    }
    const target = path.join(apiDir, file.name);
    try {
      const parsed = JSON.parse(await readFile(target, 'utf8')) as ApiTestRecord;
      records.push(parsed);
    } catch {
      // ignore malformed sidecars
    }
  }

  return records.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export async function buildManifest(runDir: string): Promise<RunManifest> {
  const files: RunManifest['files'] = [];

  async function walk(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(currentDir, entry.name);
      try {
        if (entry.isDirectory()) {
          await walk(target);
          continue;
        }
        const fileStat = await stat(target);
        files.push({
          path: path.relative(runDir, target),
          size: fileStat.size,
        });
      } catch {
        // Skip files we cannot stat/read (e.g. root-owned browser profile internals)
      }
    }
  }

  await walk(runDir);
  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    runId: path.basename(runDir),
    generatedAt: new Date().toISOString(),
    files,
  };
}

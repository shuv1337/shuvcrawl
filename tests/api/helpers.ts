import { expect } from 'bun:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ApiTestTrace,
  type ApiHarnessEnv,
  type ApiTestRecord,
  getApiHarnessEnv,
  writeTestRecord,
} from '../../scripts/lib/api-test-recorder.ts';

export async function withApiTrace(
  category: string,
  name: string,
  fn: (ctx: ApiTestContext) => Promise<void>,
): Promise<void> {
  const env = await getApiHarnessEnv();
  const trace = new ApiTestTrace(env, category, name);
  const ctx = new ApiTestContext(env, trace);
  await trace.start();

  let record: ApiTestRecord | null = null;

  try {
    await fn(ctx);
    record = await trace.pass();
  } catch (error) {
    record = await trace.fail(error);
    throw error;
  } finally {
    if (record) {
      await writeTestRecord(env, record);
    }
  }
}

export class ApiTestContext {
  constructor(readonly env: ApiHarnessEnv, readonly trace: ApiTestTrace) {}

  fixture = (pathname: string): string => {
    return new URL(pathname, this.env.fixtureInternalBaseUrl).toString();
  };

  fixtureExternal = (pathname: string): string => {
    return new URL(pathname, this.env.fixtureExternalBaseUrl).toString();
  };

  hostRuntimePath = (containerPath: string): string => {
    if (!containerPath.startsWith(this.env.containerRuntimeDir)) {
      return containerPath;
    }
    return path.join(this.env.runtimeDir, containerPath.slice(this.env.containerRuntimeDir.length).replace(/^\//, ''));
  };

  request = async (
    endpoint: string,
    init: RequestInit & {
      auth?: 'valid' | 'invalid' | 'none';
      note?: string;
    } = {},
  ): Promise<{ response: Response; body: any; elapsedMs: number; rawText: string }> => {
    const url = new URL(endpoint, this.env.apiBaseUrl).toString();
    const headers = new Headers(init.headers ?? {});

    const authMode = init.auth ?? 'valid';
    if (authMode === 'valid' && this.env.apiToken) {
      headers.set('authorization', `Bearer ${this.env.apiToken}`);
    } else if (authMode === 'invalid') {
      headers.set('authorization', 'Bearer definitely-wrong');
    }

    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const started = Date.now();
    const response = await fetch(url, {
      ...init,
      headers,
    });
    const elapsedMs = Date.now() - started;
    const rawText = await response.text();

    let body: any;
    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch {
      body = { rawText };
    }

    const requestId = body?.meta?.requestId ?? body?.data?.metadata?.requestId ?? body?.data?.requestId;
    const jobId = body?.job?.jobId ?? body?.meta?.jobId;

    this.trace.setCorrelation({ requestId, jobId });
    await this.trace.request({
      method: init.method ?? 'GET',
      endpoint,
      url,
      requestHeaders: Object.fromEntries(headers.entries()),
      requestBody: typeof init.body === 'string' ? safeParseJson(init.body) ?? init.body : init.body,
      statusCode: response.status,
      elapsedMs,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      responseBody: body,
      requestId,
      jobId,
    });
    await this.trace.event('response.received', {
      endpoint,
      method: init.method ?? 'GET',
      url,
      statusCode: response.status,
      elapsedMs,
      requestId,
      jobId,
      details: init.note ? { note: init.note } : undefined,
    });

    if (!response.ok) {
      await this.captureFailure(`${this.trace.testId}-${slug(endpoint)}.json`, {
        endpoint,
        request: {
          method: init.method ?? 'GET',
          headers: Object.fromEntries(headers.entries()),
          body: typeof init.body === 'string' ? safeParseJson(init.body) ?? init.body : init.body,
        },
        response: {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body,
          rawText,
        },
      });
    }

    return { response, body, elapsedMs, rawText };
  };

  captureFailure = async (name: string, payload: unknown): Promise<string> => {
    const failurePath = path.join(this.env.failuresDir, name);
    await mkdir(path.dirname(failurePath), { recursive: true });
    await writeFile(failurePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await this.trace.artifact(failurePath, { kind: 'failure' });
    return failurePath;
  };

  captureJobSnapshot = async (jobId: string, body: unknown, suffix = ''): Promise<string> => {
    const name = `${jobId}${suffix ? `-${suffix}` : ''}.json`;
    const target = path.join(this.env.jobsDir, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    await this.trace.artifact(target, { kind: 'job-snapshot', jobId });
    return target;
  };

  assertFileExists = async (containerPath: string): Promise<string> => {
    const hostPath = this.hostRuntimePath(containerPath);
    const file = Bun.file(hostPath);
    const exists = await file.exists();
    expect(exists).toBe(true);
    await this.trace.artifact(hostPath, { containerPath });
    return hostPath;
  };

  readHostFile = async (containerPath: string): Promise<string> => {
    const hostPath = this.hostRuntimePath(containerPath);
    await this.trace.artifact(hostPath, { containerPath });
    return await readFile(hostPath, 'utf8');
  };

  pollJob = async (jobId: string, predicate: (body: any) => boolean, timeoutMs = 60_000, intervalMs = 1000): Promise<any> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { body } = await this.request(`/crawl/${jobId}`, { method: 'GET' });
      await this.captureJobSnapshot(jobId, body, body?.job?.status ?? 'snapshot');
      if (predicate(body)) {
        return body;
      }
      await Bun.sleep(intervalMs);
    }
    throw new Error(`Timed out waiting for crawl job ${jobId}`);
  };
}

function safeParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function slug(input: string): string {
  return input.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

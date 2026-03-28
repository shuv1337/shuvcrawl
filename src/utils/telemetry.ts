import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Logger } from './logger.ts';

export type TelemetryContext = {
  requestId: string;
  jobId?: string;
};

export function createTelemetryContext(overrides: Partial<TelemetryContext> = {}): TelemetryContext {
  return {
    requestId: overrides.requestId ?? `req_${randomUUID()}`,
    ...(overrides.jobId ? { jobId: overrides.jobId } : {}),
  };
}

// Simple span type for OTLP export
type Span = {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime: number;
  attributes: Record<string, string | number | boolean>;
  status: 'ok' | 'error';
};

// In-memory span buffer
const spanBuffer: Span[] = [];
let flushInterval: ReturnType<typeof setInterval> | null = null;
let activeExporter: { endpoint: string; serviceName: string; version: string } | null = null;
let exitHandlersRegistered = false;
let exporterToken = 0;

// Get service version from package.json
async function getServiceVersion(): Promise<string> {
  try {
    const pkg = await readFile(new URL('../../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(pkg);
    return parsed.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// Convert spans to OTLP format
function toOtlpFormat(spans: Span[], serviceName: string, serviceVersion: string) {
  return {
    resourceSpans: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: serviceName } },
          { key: 'service.version', value: { stringValue: serviceVersion } },
          { key: 'host.name', value: { stringValue: process.env.HOSTNAME ?? 'localhost' } },
        ],
      },
      instrumentationLibrarySpans: [{
        instrumentationLibrary: { name: 'shuvcrawl', version: serviceVersion },
        spans: spans.map(span => ({
          traceId: span.traceId,
          spanId: span.spanId,
          parentSpanId: span.parentSpanId,
          name: span.name,
          kind: 1, // SPAN_KIND_INTERNAL
          startTimeUnixNano: span.startTime * 1_000_000,
          endTimeUnixNano: span.endTime * 1_000_000,
          attributes: Object.entries(span.attributes).map(([key, value]) => {
            if (typeof value === 'string') {
              return { key, value: { stringValue: value } };
            } else if (typeof value === 'number') {
              return { key, value: { intValue: Math.floor(value) } };
            } else {
              return { key, value: { boolValue: value } };
            }
          }),
          status: { code: span.status === 'ok' ? 1 : 2 },
        })),
      }],
    }],
  };
}

// Flush spans to OTLP endpoint
async function flushSpans(endpoint: string, serviceName: string, serviceVersion: string): Promise<void> {
  if (spanBuffer.length === 0) return;

  const spans = spanBuffer.splice(0, spanBuffer.length);
  const payload = toOtlpFormat(spans, serviceName, serviceVersion);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    await fetch(`${endpoint}/v1/traces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    // Silently fail - telemetry shouldn't break the app
    console.error('Failed to flush telemetry spans:', error);
  } finally {
    clearTimeout(timeout);
  }
}

async function flushActiveExporter(): Promise<void> {
  if (!activeExporter) return;
  await flushSpans(activeExporter.endpoint, activeExporter.serviceName, activeExporter.version);
}

// Start background flush if OTLP is configured
export function startOtlpExporter(
  endpoint: string,
  serviceName: string,
  flushIntervalMs: number = 30000,
): void {
  if (flushInterval) {
    clearInterval(flushInterval);
  }

  if (!exitHandlersRegistered) {
    const cleanup = () => {
      if (flushInterval) {
        clearInterval(flushInterval);
        flushInterval = null;
      }
      void flushActiveExporter();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('beforeExit', cleanup);
    exitHandlersRegistered = true;
  }

  const token = ++exporterToken;

  void getServiceVersion().then(version => {
    if (token !== exporterToken) {
      return;
    }

    activeExporter = { endpoint, serviceName, version };
    flushInterval = setInterval(() => {
      void flushSpans(endpoint, serviceName, version);
    }, flushIntervalMs);
  });
}

// Create a span and add it to the buffer
function createSpan(
  name: string,
  startTime: number,
  endTime: number,
  context: TelemetryContext,
  attributes: Record<string, string | number | boolean> = {},
  status: 'ok' | 'error' = 'ok',
): Span {
  const span: Span = {
    traceId: context.jobId ?? context.requestId,
    spanId: randomUUID().replace(/-/g, '').slice(0, 16),
    name,
    startTime,
    endTime,
    attributes: {
      requestId: context.requestId,
      ...context.jobId ? { jobId: context.jobId } : {},
      ...attributes,
    },
    status,
  };

  spanBuffer.push(span);
  return span;
}

export async function measureStage<T>(
  logger: Logger,
  stage: string,
  context: TelemetryContext,
  fn: () => Promise<T>,
  // Optional OTLP config
  otlpConfig?: { endpoint: string; serviceName: string },
): Promise<{ result: T; elapsed: number }> {
  const startedAt = Date.now();
  logger.info(`${stage}.start`, context);

  try {
    const result = await fn();
    const elapsed = Date.now() - startedAt;
    logger.info(`${stage}.success`, { ...context, elapsed });

    // Create span for OTLP if configured
    if (otlpConfig) {
      createSpan(
        stage,
        startedAt,
        Date.now(),
        context,
        { elapsed, status: 'success' },
        'ok',
      );
    }

    return { result, elapsed };
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    logger.error(`${stage}.failed`, {
      ...context,
      elapsed,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    });

    // Create error span for OTLP if configured
    if (otlpConfig) {
      createSpan(
        stage,
        startedAt,
        Date.now(),
        context,
        {
          elapsed,
          error: error instanceof Error ? error.message : String(error),
        },
        'error',
      );
    }

    throw error;
  }
}

// Export for testing
export { spanBuffer, createSpan, toOtlpFormat };

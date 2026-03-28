import { randomUUID, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Logger } from './logger.ts';

export type TelemetryContext = {
  requestId: string;
  jobId?: string;
  traceId: string;
  parentSpanId?: string;
};

// Generate a 32-hex-character trace ID (16 bytes)
function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

// Generate a 16-hex-character span ID (8 bytes)
function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

export function createTelemetryContext(overrides: Partial<TelemetryContext> = {}): TelemetryContext {
  return {
    requestId: overrides.requestId ?? `req_${randomUUID()}`,
    traceId: overrides.traceId ?? generateTraceId(),
    ...(overrides.jobId ? { jobId: overrides.jobId } : {}),
    ...(overrides.parentSpanId ? { parentSpanId: overrides.parentSpanId } : {}),
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
let isShuttingDown = false;

// Track if spans should be created (exporter is configured)
let spansEnabled = false;

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
          { key: 'deployment.environment', value: { stringValue: process.env.NODE_ENV ?? 'development' } },
          { key: 'process.pid', value: { intValue: process.pid } },
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
  if (!activeExporter) {
    // If no active exporter but we have spans, we need a way to flush them for testing
    // This shouldn't happen in production since startOtlpExporter is required
    return;
  }
  await flushSpans(activeExporter.endpoint, activeExporter.serviceName, activeExporter.version);
}

// Flush spans for testing (uses provided endpoint info)
export async function flushSpansForTest(endpoint: string, serviceName: string, version: string): Promise<void> {
  await flushSpans(endpoint, serviceName, version);
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

  // Enable spans immediately so they start being created
  spansEnabled = true;

  if (!exitHandlersRegistered) {
    const cleanup = () => {
      if (flushInterval) {
        clearInterval(flushInterval);
        flushInterval = null;
      }
      isShuttingDown = true;
      // Use sync approach for exit handlers - schedule immediate flush
      void flushActiveExporter();
    };

    const beforeExitCleanup = async () => {
      if (!isShuttingDown && activeExporter) {
        await flushActiveExporter();
      }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('beforeExit', beforeExitCleanup);
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

// Stop the OTLP exporter and clear state (for testing)
export function stopOtlpExporter(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
  }
  activeExporter = null;
  spansEnabled = false;
  exporterToken++;
  spanBuffer.splice(0, spanBuffer.length);
}

// Check if OTLP exporter is active (for testing)
export function isOtlpExporterActive(): boolean {
  return spansEnabled;
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
    traceId: context.traceId,
    spanId: generateSpanId(),
    parentSpanId: context.parentSpanId,
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
): Promise<{ result: T; elapsed: number; spanId: string }> {
  const startedAt = Date.now();
  logger.info(`${stage}.start`, context);

  // Check if OTLP exporter is active
  const otlpEnabled = spansEnabled;
  let spanId = '';

  try {
    const result = await fn();
    const elapsed = Date.now() - startedAt;
    logger.info(`${stage}.success`, { ...context, elapsed });

    // Create span for OTLP if exporter is active
    if (otlpEnabled) {
      const span = createSpan(
        stage,
        startedAt,
        Date.now(),
        context,
        { elapsed, status: 'success' },
        'ok',
      );
      spanId = span.spanId;
    }

    return { result, elapsed, spanId };
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    logger.error(`${stage}.failed`, {
      ...context,
      elapsed,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    });

    // Create error span for OTLP if exporter is active
    if (otlpEnabled) {
      const span = createSpan(
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
      spanId = span.spanId;
    }

    throw error;
  }
}

// Export for testing
export { spanBuffer, createSpan, toOtlpFormat, generateTraceId, generateSpanId, flushActiveExporter };

import { describe, expect, it, beforeEach, mock } from 'bun:test';
import {
  createTelemetryContext,
  toOtlpFormat,
  createSpan,
  measureStage,
  startOtlpExporter,
  stopOtlpExporter,
  flushActiveExporter,
  flushSpansForTest,
  generateTraceId,
  generateSpanId,
  spanBuffer,
} from '../../src/utils/telemetry.ts';

// Mock logger for testing
const createMockLogger = () => ({
  info: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  warn: mock(() => {}),
});

describe('createTelemetryContext', () => {
  it('generates unique requestId', () => {
    const ctx1 = createTelemetryContext();
    const ctx2 = createTelemetryContext();
    expect(ctx1.requestId).not.toBe(ctx2.requestId);
  });

  it('includes jobId when provided', () => {
    const ctx = createTelemetryContext({ jobId: 'crawl_123' });
    expect(ctx.jobId).toBe('crawl_123');
  });

  it('omits jobId when not provided', () => {
    const ctx = createTelemetryContext();
    expect(ctx.jobId).toBeUndefined();
  });

  it('generates 32-hex-char traceId', () => {
    const ctx = createTelemetryContext();
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('allows custom traceId', () => {
    const customTraceId = 'a'.repeat(32);
    const ctx = createTelemetryContext({ traceId: customTraceId });
    expect(ctx.traceId).toBe(customTraceId);
  });

  it('includes parentSpanId when provided', () => {
    const ctx = createTelemetryContext({ parentSpanId: 'abc123' });
    expect(ctx.parentSpanId).toBe('abc123');
  });
});

describe('generateTraceId', () => {
  it('generates 32 hex characters', () => {
    const traceId = generateTraceId();
    expect(traceId).toHaveLength(32);
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generates unique trace IDs', () => {
    const traceId1 = generateTraceId();
    const traceId2 = generateTraceId();
    expect(traceId1).not.toBe(traceId2);
  });
});

describe('generateSpanId', () => {
  it('generates 16 hex characters', () => {
    const spanId = generateSpanId();
    expect(spanId).toHaveLength(16);
    expect(spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('generates unique span IDs', () => {
    const spanId1 = generateSpanId();
    const spanId2 = generateSpanId();
    expect(spanId1).not.toBe(spanId2);
  });
});

describe('OTLP export', () => {
  beforeEach(() => {
    // Clear the span buffer and reset exporter state before each test
    stopOtlpExporter();
  });

  it('converts spans to OTLP format', async () => {
    const spans = [
      createSpan('test.stage', 1000, 2000, { requestId: 'req_123', traceId: 'a'.repeat(32) }, { url: 'https://example.com' }, 'ok'),
    ];

    const otlp = toOtlpFormat(spans, 'shuvcrawl', '1.0.0');

    expect(otlp.resourceSpans).toHaveLength(1);
    expect(otlp.resourceSpans[0].resource.attributes).toContainEqual(
      expect.objectContaining({ key: 'service.name', value: { stringValue: 'shuvcrawl' } }),
    );
    expect(otlp.resourceSpans[0].instrumentationLibrarySpans[0].spans).toHaveLength(1);
    expect(otlp.resourceSpans[0].instrumentationLibrarySpans[0].spans[0].name).toBe('test.stage');
  });

  it('includes deployment.environment resource attribute', async () => {
    const spans = [
      createSpan('test.stage', 1000, 2000, { requestId: 'req_123', traceId: 'a'.repeat(32) }, {}, 'ok'),
    ];

    const otlp = toOtlpFormat(spans, 'shuvcrawl', '1.0.0');

    const attrs = otlp.resourceSpans[0].resource.attributes;
    expect(attrs).toContainEqual(
      expect.objectContaining({ key: 'deployment.environment', value: { stringValue: expect.any(String) } }),
    );
  });

  it('includes process.pid resource attribute', async () => {
    const spans = [
      createSpan('test.stage', 1000, 2000, { requestId: 'req_123', traceId: 'a'.repeat(32) }, {}, 'ok'),
    ];

    const otlp = toOtlpFormat(spans, 'shuvcrawl', '1.0.0');

    const attrs = otlp.resourceSpans[0].resource.attributes;
    expect(attrs).toContainEqual(
      expect.objectContaining({ key: 'process.pid', value: { intValue: expect.any(Number) } }),
    );
  });
});

describe('measureStage', () => {
  beforeEach(() => {
    // Clear the span buffer and reset exporter state before each test
    stopOtlpExporter();
  });

  it('returns result and elapsed time', async () => {
    const logger = createMockLogger();
    const telemetry = createTelemetryContext();

    const { result, elapsed } = await measureStage(
      logger,
      'test.stage',
      telemetry,
      async () => 'test result',
    );

    expect(result).toBe('test result');
    expect(elapsed).toBeGreaterThanOrEqual(0);
  });

  it('logs start and success', async () => {
    const logger = createMockLogger();
    const telemetry = createTelemetryContext();

    await measureStage(logger, 'test.stage', telemetry, async () => 'test');

    expect(logger.info).toHaveBeenCalledWith('test.stage.start', telemetry);
    expect(logger.info).toHaveBeenCalledWith('test.stage.success', expect.objectContaining({ elapsed: expect.any(Number) }));
  });

  it('logs error on failure', async () => {
    const logger = createMockLogger();
    const telemetry = createTelemetryContext();

    const error = new Error('test error');
    await expect(
      measureStage(logger, 'test.stage', telemetry, async () => {
        throw error;
      }),
    ).rejects.toThrow('test error');

    expect(logger.info).toHaveBeenCalledWith('test.stage.start', telemetry);
    expect(logger.error).toHaveBeenCalledWith('test.stage.failed', expect.objectContaining({ error: expect.any(Object) }));
  });

  it('does not create spans when OTLP exporter is not active', async () => {
    const logger = createMockLogger();
    const telemetry = createTelemetryContext();
    const initialBufferLength = spanBuffer.length;

    await measureStage(logger, 'test.stage', telemetry, async () => 'test');

    // Span buffer should remain unchanged when no exporter is active
    expect(spanBuffer.length).toBe(initialBufferLength);
  });

  it('returns empty spanId when OTLP exporter is not active', async () => {
    const logger = createMockLogger();
    const telemetry = createTelemetryContext();

    const { spanId } = await measureStage(logger, 'test.stage', telemetry, async () => 'test');

    expect(spanId).toBe('');
  });
});

describe('measureStage with OTLP exporter', () => {
  let mockFetch: ReturnType<typeof mock>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    // Reset exporter state before each test
    stopOtlpExporter();

    // Mock fetch
    originalFetch = globalThis.fetch;
    mockFetch = mock(() => Promise.resolve(new Response('{}', { status: 200 })));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  // Cleanup function to be called at the end of each test
  const cleanup = () => {
    globalThis.fetch = originalFetch;
    stopOtlpExporter();
  };

  it('creates spans when OTLP exporter is active', async () => {
    try {
      // Start the exporter to activate span creation
      startOtlpExporter('http://localhost:4318', 'test-service', 30000);

      const logger = createMockLogger();
      const telemetry = createTelemetryContext();

      await measureStage(logger, 'test.stage', telemetry, async () => 'test');

      // Span should have been created immediately (spansEnabled is synchronous)
      expect(spanBuffer.length).toBeGreaterThan(0);
      expect(spanBuffer[0].name).toBe('test.stage');
      expect(spanBuffer[0].traceId).toBe(telemetry.traceId);
    } finally {
      cleanup();
    }
  });

  it('returns spanId when OTLP exporter is active', async () => {
    try {
      // Start the exporter to activate span creation
      startOtlpExporter('http://localhost:4318', 'test-service', 30000);

      const logger = createMockLogger();
      const telemetry = createTelemetryContext();

      const { spanId } = await measureStage(logger, 'test.stage', telemetry, async () => 'test');

      // Span ID should be a valid 16-char hex string
      expect(spanId).toMatch(/^[0-9a-f]{16}$/);
    } finally {
      cleanup();
    }
  });

  it('creates error span on failure when OTLP exporter is active', async () => {
    try {
      // Start the exporter to activate span creation
      startOtlpExporter('http://localhost:4318', 'test-service', 30000);

      const logger = createMockLogger();
      const telemetry = createTelemetryContext();
      const initialBufferLength = spanBuffer.length;

      await expect(
        measureStage(logger, 'test.stage', telemetry, async () => {
          throw new Error('test error');
        }),
      ).rejects.toThrow('test error');

      // Error span should have been created
      expect(spanBuffer.length).toBeGreaterThan(initialBufferLength);
      const errorSpan = spanBuffer[spanBuffer.length - 1];
      expect(errorSpan.status).toBe('error');
      expect(errorSpan.attributes.error).toBe('test error');
    } finally {
      cleanup();
    }
  });

  it('respects parentSpanId in telemetry context', async () => {
    try {
      // Start the exporter to activate span creation
      startOtlpExporter('http://localhost:4318', 'test-service', 30000);

      const logger = createMockLogger();
      const parentSpanId = 'parentspanid1234';
      const telemetry = createTelemetryContext({ parentSpanId });

      await measureStage(logger, 'test.stage', telemetry, async () => 'test');

      // Span should have the parentSpanId
      expect(spanBuffer.length).toBeGreaterThan(0);
      expect(spanBuffer[0].parentSpanId).toBe(parentSpanId);
    } finally {
      cleanup();
    }
  });

  it('sends correct OTLP JSON format on flush', async () => {
    try {
      // Start the exporter
      startOtlpExporter('http://localhost:4318', 'test-service', 30000);

      const logger = createMockLogger();
      const telemetry = createTelemetryContext();

      await measureStage(logger, 'test.stage', telemetry, async () => 'test');

      // Use test flush with explicit endpoint info since activeExporter isn't ready yet
      await flushSpansForTest('http://localhost:4318', 'test-service', '1.0.0');

      // Verify fetch was called with correct OTLP format
      expect(mockFetch).toHaveBeenCalled();
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toBe('http://localhost:4318/v1/traces');

      const requestInit = fetchCall[1] as RequestInit;
      expect(requestInit.method).toBe('POST');
      expect(requestInit.headers).toMatchObject({ 'Content-Type': 'application/json' });

      const body = JSON.parse(requestInit.body as string);
      expect(body).toHaveProperty('resourceSpans');
      expect(body.resourceSpans).toHaveLength(1);
      expect(body.resourceSpans[0]).toHaveProperty('resource');
      expect(body.resourceSpans[0]).toHaveProperty('instrumentationLibrarySpans');

      const span = body.resourceSpans[0].instrumentationLibrarySpans[0].spans[0];
      expect(span).toHaveProperty('traceId', telemetry.traceId);
      expect(span).toHaveProperty('spanId');
      expect(span).toHaveProperty('name', 'test.stage');
      expect(span).toHaveProperty('startTimeUnixNano');
      expect(span).toHaveProperty('endTimeUnixNano');
      expect(span).toHaveProperty('attributes');
      expect(span).toHaveProperty('status');
    } finally {
      cleanup();
    }
  });
});

describe('parent-child span relationships', () => {
  beforeEach(() => {
    stopOtlpExporter();
  });

  it('createSpan stores parentSpanId from telemetry context', () => {
    const traceId = generateTraceId();
    const parentSpanId = generateSpanId();
    const telemetry: { requestId: string; traceId: string; parentSpanId?: string } = {
      requestId: 'req_123',
      traceId,
      parentSpanId,
    };

    createSpan('child.span', 1000, 2000, telemetry, {}, 'ok');

    expect(spanBuffer.length).toBe(1);
    expect(spanBuffer[0].parentSpanId).toBe(parentSpanId);
    expect(spanBuffer[0].traceId).toBe(traceId);
  });

  it('createSpan omits parentSpanId when not in telemetry', () => {
    const traceId = generateTraceId();
    const telemetry = {
      requestId: 'req_123',
      traceId,
    };

    createSpan('root.span', 1000, 2000, telemetry, {}, 'ok');

    expect(spanBuffer.length).toBe(1);
    expect(spanBuffer[0].parentSpanId).toBeUndefined();
    expect(spanBuffer[0].traceId).toBe(traceId);
  });
});

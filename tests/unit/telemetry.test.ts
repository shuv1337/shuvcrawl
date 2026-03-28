import { describe, expect, it, beforeEach } from 'bun:test';
import { createTelemetryContext, toOtlpFormat, createSpan } from '../../src/utils/telemetry.ts';

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
});

describe('OTLP export', () => {
  it('converts spans to OTLP format', async () => {
    const spans = [
      createSpan('test.stage', 1000, 2000, { requestId: 'req_123' }, { url: 'https://example.com' }, 'ok'),
    ];

    const otlp = toOtlpFormat(spans, 'shuvcrawl', '1.0.0');

    expect(otlp.resourceSpans).toHaveLength(1);
    expect(otlp.resourceSpans[0].resource.attributes).toContainEqual(
      expect.objectContaining({ key: 'service.name', value: { stringValue: 'shuvcrawl' } }),
    );
    expect(otlp.resourceSpans[0].instrumentationLibrarySpans[0].spans).toHaveLength(1);
    expect(otlp.resourceSpans[0].instrumentationLibrarySpans[0].spans[0].name).toBe('test.stage');
  });
});

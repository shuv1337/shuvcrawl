import { expect, test } from 'bun:test';
import { withApiTrace } from './helpers.ts';

const category = 'cache-telemetry';

test('scrape cache can be bypassed with noCache', async () => {
  await withApiTrace(category, 'scrape cache and nocache behavior', async ({ request, fixture }) => {
    const payload = {
      url: fixture('/article.html'),
      options: { rawHtml: false },
    };

    const first = await request('/scrape', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    expect(first.response.status).toBe(200);

    const second = await request('/scrape', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    expect(second.response.status).toBe(200);
    expect(second.body.data.metadata.bypassMethod).toBe('fast-path');

    const third = await request('/scrape', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        options: { ...payload.options, noCache: true },
      }),
    });
    expect(third.response.status).toBe(200);
    expect(third.body.meta.requestId).not.toBe(second.body.meta.requestId);
  });
});

test('telemetry verification captures OTLP export side effects', async () => {
  await withApiTrace(category, 'telemetry otlp capture', async ({ env, request, fixture, trace }) => {
    if (!env.verifyOtlp) {
      await trace.note('OTLP verification disabled for this run.');
      return;
    }

    const { response } = await request('/scrape', {
      method: 'POST',
      body: JSON.stringify({
        url: fixture('/article.html'),
        options: { noFastPath: true },
      }),
    });
    expect(response.status).toBe(200);

    await Bun.sleep(500);
    const otlpPath = `${env.runtimeDir}/telemetry/otlp-traces.jsonl`;
    const file = Bun.file(otlpPath);
    expect(await file.exists()).toBe(true);
    const content = await file.text();
    expect(content).toContain('resourceSpans');
    await trace.artifact(otlpPath, { kind: 'otlp-capture' });
  });
});

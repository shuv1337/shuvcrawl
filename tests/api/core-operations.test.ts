import { expect, test } from 'bun:test';
import { withApiTrace } from './helpers.ts';

const category = 'core-operations';

test('POST /scrape succeeds against fixture article', async () => {
  await withApiTrace(category, 'scrape basic success', async ({ request, fixture, assertFileExists, readHostFile }) => {
    const { response, body } = await request('/scrape', {
      method: 'POST',
      body: JSON.stringify({
        url: fixture('/article.html'),
        options: { noFastPath: true, rawHtml: true, onlyMainContent: true },
      }),
    });

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.content).toContain('deterministic article');
    expect(body.data.metadata.bypassMethod).toBe('bpc-extension');
    expect(body.data.metadata.title).toBe('Fixture Article');
    expect(body.data.rawHtml).toContain('deterministic article');
    expect(body.data.links.length).toBeGreaterThan(0);
    expect(body.data.linkDetails.length).toBeGreaterThan(0);
    expect(typeof body.data.linkDetails[0].domPath).toBe('string');
    expect(body.meta.requestId).toBeTruthy();

    await assertFileExists(body.output.jsonPath);
    const metaContent = await readHostFile(body.output.metaPath);
    expect(metaContent).toContain(body.meta.requestId);
  });
});

test('POST /scrape supports wait selector and headers', async () => {
  await withApiTrace(category, 'scrape selector wait and headers', async ({ request, fixture }) => {
    const { response, body } = await request('/scrape', {
      method: 'POST',
      body: JSON.stringify({
        url: fixture('/delayed.html?ms=250'),
        options: {
          noFastPath: true,
          wait: 'selector',
          waitFor: '#loaded',
          headers: { 'x-test-header': 'api-suite' },
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.content).toContain('Loaded after 250ms');
  });
});

test('POST /map discovers fixture links', async () => {
  await withApiTrace(category, 'map basic success', async ({ request, fixture }) => {
    const { response, body } = await request('/map', {
      method: 'POST',
      body: JSON.stringify({
        url: fixture('/links.html'),
        options: { noFastPath: true, source: 'links' },
      }),
    });

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    const discoveredUrls = body.data.discovered.map((entry: { url: string }) => entry.url);
    expect(discoveredUrls).toContain(fixture('/article.html'));
    expect(discoveredUrls).toContain(fixture('/site/page-1.html'));
    expect(discoveredUrls).not.toContain('https://example.com/offsite');
    expect(body.data.discovered.some((entry: { domPath?: string | null }) => typeof entry.domPath === 'string')).toBe(true);
  });
});

test('POST /crawl and GET /crawl/:jobId reach terminal state', async () => {
  await withApiTrace(category, 'crawl async completion', async ({ request, fixture, pollJob }) => {
    const { response, body } = await request('/crawl', {
      method: 'POST',
      body: JSON.stringify({
        url: fixture('/site/page-1.html'),
        options: { depth: 2, limit: 5, delay: 0, source: 'links', noFastPath: true },
      }),
    });

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    const jobId = body.job.jobId as string;
    expect(jobId).toMatch(/^crawl_/);

    const terminal = await pollJob(jobId, payload => ['completed', 'failed', 'cancelled', 'stopped'].includes(payload.job.status));
    expect(terminal.success).toBe(true);
    expect(['completed', 'stopped']).toContain(terminal.job.status);
    expect(terminal.job.result.summary.visited).toBeGreaterThanOrEqual(1);
  });
});

test('DELETE /crawl/:jobId cancels a running job', async () => {
  await withApiTrace(category, 'crawl cancel path', async ({ request, fixture, pollJob }) => {
    const { body: createBody } = await request('/crawl', {
      method: 'POST',
      body: JSON.stringify({
        url: fixture('/site/page-1.html'),
        options: { depth: 4, limit: 5, delay: 1500, source: 'links', noFastPath: true },
      }),
    });

    const jobId = createBody.job.jobId as string;
    const { response, body } = await request(`/crawl/${jobId}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain('cancelled');

    const terminal = await pollJob(jobId, payload => ['cancelled', 'failed', 'completed', 'stopped'].includes(payload.job.status), 10000, 500);
    expect(['cancelled', 'failed', 'completed', 'stopped']).toContain(terminal.job.status);
    await Bun.sleep(250);
  });
});

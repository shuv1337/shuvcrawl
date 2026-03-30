import { expect, test } from 'bun:test';
import { withApiTrace } from './helpers.ts';

const category = 'validation-errors';

test('POST /scrape rejects invalid URL payload', async () => {
  await withApiTrace(category, 'invalid url payload', async ({ request }) => {
    const { response, body } = await request('/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: 'not-a-url' }),
    });
    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
    expect(Array.isArray(body.error.details.issues)).toBe(true);
  });
});

test('POST /scrape normalizes malformed JSON into invalid request envelope', async () => {
  await withApiTrace(category, 'malformed json envelope', async ({ request }) => {
    const { response, body } = await request('/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"url":',
    });
    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });
});

test('GET missing crawl job returns 404 invalid request envelope', async () => {
  await withApiTrace(category, 'missing crawl job', async ({ request }) => {
    const { response, body } = await request('/crawl/crawl_missing_job', { method: 'GET' });
    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });
});

test('DELETE missing crawl job returns 404 invalid request envelope', async () => {
  await withApiTrace(category, 'missing crawl cancel', async ({ request }) => {
    const { response, body } = await request('/crawl/crawl_missing_job', { method: 'DELETE' });
    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });
});

test('unreachable URL surfaces network error envelope', async () => {
  await withApiTrace(category, 'unreachable target network error', async ({ request }) => {
    const { response, body } = await request('/scrape', {
      method: 'POST',
      body: JSON.stringify({
        url: 'http://does-not-resolve.invalid/',
        options: { noFastPath: true, waitTimeout: 1000 },
      }),
    });
    expect(response.status).toBe(502);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NETWORK_ERROR');
  });
});

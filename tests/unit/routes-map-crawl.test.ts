import { expect, test } from 'bun:test';
import { buildApi } from '../../src/api/routes.ts';
import { defaultConfig } from '../../src/config/defaults.ts';

function createStubApp() {
  const engine = {
    health: async () => ({ ok: true }),
    getConfig: () => ({ ok: true }),
    scrape: async () => ({ result: { metadata: { requestId: 'req_1', elapsed: 10, bypassMethod: 'fast-path' } }, output: {} }),
    screenshot: async () => ({ result: { requestId: 'req_2', elapsed: 11, bypassMethod: 'bpc-extension' } }),
    pdf: async () => ({ result: { requestId: 'req_3', elapsed: 12, bypassMethod: 'bpc-extension' } }),
    map: async () => ({ result: { requestId: 'req_map', summary: { elapsed: 13, bypassMethod: 'fast-path' }, discovered: [] } }),
    crawl: async () => ({ result: { jobId: 'crawl_1', status: 'completed', summary: { visited: 1 }, results: [], statePath: './output/example.com/_crawl-state.json' } }),
  } as any;
  const config = { ...defaultConfig, api: { ...defaultConfig.api, token: null } };
  return buildApi(engine, config);
}

test('POST /map returns success envelope', async () => {
  const app = createStubApp();
  const res = await app.request('http://localhost/map', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com' }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.meta.requestId).toBe('req_map');
});

test('POST /crawl returns job envelope', async () => {
  const app = createStubApp();
  const res = await app.request('http://localhost/crawl', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com' }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.success).toBe(true);
  expect(body.job.jobId).toBe('crawl_1');
  expect(body.job.status).toBe('completed');
});

import { Hono } from 'hono';
import { CrawlRequestSchema, MapRequestSchema, PdfRequestSchema, ScrapeRequestSchema, ScreenshotRequestSchema } from './schemas.ts';
import { authMiddleware } from './middleware.ts';
import type { Engine } from '../core/engine.ts';
import type { ShuvcrawlConfig } from '../config/schema.ts';
import { mapError } from './errors.ts';

export function buildApi(engine: Engine, config: ShuvcrawlConfig) {
  const app = new Hono();
  app.use('*', authMiddleware(config));

  app.get('/health', async c => c.json(await engine.health()));
  app.get('/config', c => c.json({ success: true, data: engine.getConfig() }));

  app.post('/scrape', async c => {
    try {
      const json = await c.req.json();
      const request = ScrapeRequestSchema.parse(json);
      const response = await engine.scrape(request.url, request.options);
      return c.json({ success: true, data: response.result, output: response.output, meta: { requestId: response.result.metadata.requestId, elapsed: response.result.metadata.elapsed, bypassMethod: response.result.metadata.bypassMethod } });
    } catch (error) {
      const mapped = mapError(error);
      return c.json(mapped.body, mapped.status as any);
    }
  });

  app.post('/map', async c => {
    try {
      const json = await c.req.json();
      const request = MapRequestSchema.parse(json);
      const response = await engine.map(request.url, request.options);
      return c.json({ success: true, data: response.result, meta: { requestId: response.result.requestId, elapsed: response.result.summary.elapsed, bypassMethod: response.result.summary.bypassMethod } });
    } catch (error) {
      const mapped = mapError(error);
      return c.json(mapped.body, mapped.status as any);
    }
  });

  app.post('/crawl', async c => {
    try {
      const json = await c.req.json();
      const request = CrawlRequestSchema.parse(json);
      const response = await engine.crawl(request.url, request.options);
      return c.json({ success: true, job: { jobId: response.result.jobId, status: response.result.status }, data: response.result });
    } catch (error) {
      const mapped = mapError(error);
      return c.json(mapped.body, mapped.status as any);
    }
  });

  app.post('/screenshot', async c => {
    try {
      const json = await c.req.json();
      const request = ScreenshotRequestSchema.parse(json);
      const response = await engine.screenshot(request.url, request.options);
      return c.json({ success: true, data: response.result, meta: { requestId: response.result.requestId, elapsed: response.result.elapsed, bypassMethod: response.result.bypassMethod } });
    } catch (error) {
      const mapped = mapError(error);
      return c.json(mapped.body, mapped.status as any);
    }
  });

  app.post('/pdf', async c => {
    try {
      const json = await c.req.json();
      const request = PdfRequestSchema.parse(json);
      const response = await engine.pdf(request.url, request.options);
      return c.json({ success: true, data: response.result, meta: { requestId: response.result.requestId, elapsed: response.result.elapsed, bypassMethod: response.result.bypassMethod } });
    } catch (error) {
      const mapped = mapError(error);
      return c.json(mapped.body, mapped.status as any);
    }
  });

  return app;
}

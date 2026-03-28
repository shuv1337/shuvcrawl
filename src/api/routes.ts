import { Hono } from 'hono';
import { CrawlRequestSchema, MapRequestSchema, PdfRequestSchema, ScrapeRequestSchema, ScreenshotRequestSchema } from './schemas.ts';
import { authMiddleware } from './middleware.ts';
import type { Engine } from '../core/engine.ts';
import type { ShuvcrawlConfig } from '../config/schema.ts';
import { errorResponse, mapError } from './errors.ts';

export function buildApi(engine: Engine, config: ShuvcrawlConfig) {
  const app = new Hono();
  app.use('*', authMiddleware(config));

  app.get('/health', async c => c.json(await engine.health()));
  app.get('/config', c => c.json({ success: true, data: engine.getConfig() }));

  app.post('/scrape', async c => {
    try {
      const json = await c.req.json();
      const request = ScrapeRequestSchema.parse(json);
      // Convert headers to strings if needed
      const options = { ...request.options };
      if (options.headers) {
        options.headers = Object.fromEntries(
          Object.entries(options.headers).map(([k, v]) => [k, String(v)]),
        );
      }
      const response = await engine.scrape(request.url, options);
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

  // Async crawl - returns immediately with job ID
  app.post('/crawl', async c => {
    try {
      const json = await c.req.json();
      const request = CrawlRequestSchema.parse(json);
      const job = await engine.crawlAsync(request.url, request.options);
      return c.json({ success: true, job });
    } catch (error) {
      const mapped = mapError(error);
      return c.json(mapped.body, mapped.status as any);
    }
  });

  // Get crawl job status
  app.get('/crawl/:jobId', async c => {
    try {
      const jobId = c.req.param('jobId');
      const job = await engine.getCrawlJob(jobId);
      if (!job) {
        return c.json(errorResponse('INVALID_REQUEST', 'Job not found', { jobId }), 404);
      }
      return c.json({
        success: true,
        job: {
          jobId: job.jobId,
          status: job.status,
          hostname: job.hostname,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          error: job.error,
          result: job.result,
        },
      });
    } catch (error) {
      const mapped = mapError(error);
      return c.json(mapped.body, mapped.status as any);
    }
  });

  // Cancel crawl job
  app.delete('/crawl/:jobId', async c => {
    try {
      const jobId = c.req.param('jobId');
      const cancelled = await engine.cancelCrawlJob(jobId);
      if (!cancelled) {
        return c.json(errorResponse('INVALID_REQUEST', 'Job not found or not running', { jobId }), 404);
      }
      return c.json({ success: true, message: 'Job cancelled' });
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

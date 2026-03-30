import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const port = Number(process.env.PORT ?? 4444);
const runtimeDir = process.env.TEST_RUNTIME_DIR ?? '/tmp/shuvcrawl-fixtures';
const captureOtlp = process.env.TEST_FIXTURES_CAPTURE_OTLP === 'true';
const siteRoot = path.resolve(import.meta.dir, 'site');

function html(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

async function appendTelemetry(body: string) {
  const dir = path.join(runtimeDir, 'telemetry');
  await mkdir(dir, { recursive: true });
  await appendFile(
    path.join(dir, 'otlp-traces.jsonl'),
    `${JSON.stringify({ ts: new Date().toISOString(), body: JSON.parse(body) })}\n`,
    'utf8',
  );
}

function delayedPage(delayMs: number) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Delayed Fixture</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 32px; }
      .status { color: #0f766e; font-weight: 700; }
    </style>
  </head>
  <body>
    <article>
      <h1>Delayed fixture page</h1>
      <p id="status">Waiting for async content…</p>
      <div id="loaded" hidden>Loaded after ${delayMs}ms.</div>
    </article>
    <script>
      setTimeout(() => {
        document.getElementById('status').textContent = 'Ready';
        const loaded = document.getElementById('loaded');
        loaded.hidden = false;
      }, ${delayMs});
    </script>
  </body>
</html>`;
}

function slowHtml(ms: number) {
  return `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Slow ${ms}</title></head>
  <body>
    <article>
      <h1>Slow fixture ${ms}ms</h1>
      <p>This route intentionally responds slowly.</p>
      <a href="/site/page-1.html">Continue</a>
    </article>
  </body>
</html>`;
}

Bun.serve({
  port,
  fetch: async (request) => {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'fixtures', port });
    }

    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    if (url.pathname === '/v1/traces') {
      const raw = await request.text();
      if (captureOtlp) {
        await appendTelemetry(raw);
      }
      return Response.json({ ok: true, captured: captureOtlp });
    }

    if (url.pathname === '/timeout') {
      return new Promise<Response>(() => {});
    }

    if (url.pathname === '/error-500') {
      return html('<h1>Fixture error</h1><p>Intentional 500.</p>', 500);
    }

    if (url.pathname.startsWith('/slow/')) {
      const ms = Number(url.pathname.split('/').pop() ?? '0');
      await Bun.sleep(Number.isFinite(ms) ? ms : 0);
      return html(slowHtml(ms));
    }

    if (url.pathname === '/delayed.html') {
      const ms = Number(url.searchParams.get('ms') ?? '350');
      return html(delayedPage(ms));
    }

    const targetPath = path.resolve(siteRoot, `.${url.pathname}`);
    if (!targetPath.startsWith(siteRoot)) {
      return new Response('Forbidden', { status: 403 });
    }

    const file = Bun.file(targetPath);
    if (await file.exists()) {
      return new Response(file, {
        headers: {
          'cache-control': 'no-store',
        },
      });
    }

    return new Response('Not found', { status: 404 });
  },
});

console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'fixtures.start', port, runtimeDir, captureOtlp }));

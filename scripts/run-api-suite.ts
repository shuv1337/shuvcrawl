import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  buildManifest,
  collectTestRecords,
  getApiHarnessEnv,
  type RunSummary,
} from './lib/api-test-recorder.ts';

async function main() {
  const env = await getApiHarnessEnv();
  await mkdir(env.runDir, { recursive: true });

  const startedAt = Date.now();
  const junitPath = path.join(env.runDir, 'api', 'junit.xml');
  const runnerArgs = [
    'bun',
    'test',
    '--path-ignore-patterns',
    '',
    '--max-concurrency=1',
    '--timeout=30000',
    'tests/api/',
    '--reporter=junit',
    `--reporter-outfile=${junitPath}`,
  ];
  const command = runnerArgs
    .map(arg => (arg === '' ? "''" : arg))
    .join(' ');

  const proc = Bun.spawn(runnerArgs, {
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  });

  const exitCode = await proc.exited;
  const elapsedMs = Date.now() - startedAt;

  let records = await collectTestRecords(env);
  if (records.length === 0 && existsSync(junitPath)) {
    records = await synthesizeRecordsFromJunit(junitPath, env.runId);
  }
  const summary = await buildSummary(env.runDir, env.verifyOtlp, records, elapsedMs, startedAt, exitCode);
  const suitePath = path.join(env.runDir, 'suite.json');
  await writeFile(suitePath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  await writeFile(path.join(env.runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await writeFile(path.join(env.runDir, 'run-command.txt'), `${command}\n`, 'utf8');

  const manifest = await buildManifest(env.runDir);
  await writeFile(path.join(env.runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const reportHtml = renderHtmlReport(summary, records);
  await writeFile(path.join(env.runDir, 'report.html'), reportHtml, 'utf8');

  if (process.platform === 'linux' && process.env.SHUVCRAWL_TEST_OPEN_REPORT === 'true') {
    Bun.spawn(['xdg-open', path.join(env.runDir, 'report.html')], {
      stdout: 'ignore',
      stderr: 'ignore',
      stdin: 'ignore',
    });
  }

  process.exit(exitCode === 0 && summary.failed === 0 ? 0 : 1);
}

async function buildSummary(
  runDir: string,
  verifyOtlp: boolean,
  records: Awaited<ReturnType<typeof collectTestRecords>>,
  elapsedMs: number,
  startedAtMs: number,
  exitCode: number,
): Promise<RunSummary> {
  const otlpCapturePath = path.join(runDir, 'runtime', 'telemetry', 'otlp-traces.jsonl');
  let otlpCapturedSpans = 0;
  let otlpCaptureFile: string | null = null;

  try {
    const raw = await readFile(otlpCapturePath, 'utf8');
    otlpCapturedSpans = raw.trim() ? raw.trim().split('\n').length : 0;
    otlpCaptureFile = path.relative(runDir, otlpCapturePath);
  } catch {
    // optional
  }

  const categories = new Map<string, { total: number; passed: number; failed: number; skipped: number }>();
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const record of records) {
    const bucket = categories.get(record.category) ?? { total: 0, passed: 0, failed: 0, skipped: 0 };
    bucket.total += 1;
    if (record.status === 'passed') {
      bucket.passed += 1;
      passed += 1;
    } else if (record.status === 'failed') {
      bucket.failed += 1;
      failed += 1;
    } else {
      bucket.skipped += 1;
      skipped += 1;
    }
    categories.set(record.category, bucket);
  }

  return {
    runId: path.basename(runDir),
    status: exitCode === 0 && failed === 0 ? 'passed' : 'failed',
    generatedAt: new Date().toISOString(),
    startedAt: new Date(startedAtMs).toISOString(),
    elapsedMs,
    total: records.length,
    passed,
    failed,
    skipped,
    categories: Array.from(categories.entries()).map(([category, bucket]) => ({ category, ...bucket })),
    telemetry: {
      verifyOtlp,
      otlpCaptureFile,
      otlpCapturedSpans,
    },
  };
}

async function synthesizeRecordsFromJunit(junitPath: string, runId: string) {
  const xml = await readFile(junitPath, 'utf8');
  const records: Array<{
    id: string;
    runId: string;
    category: string;
    name: string;
    status: 'passed' | 'failed';
    startedAt: string;
    elapsedMs: number;
    artifacts: string[];
    notes: string[];
    error?: { message: string };
  }> = [];

  const testcaseRegex = /<testcase[^>]*classname="([^"]+)"[^>]*name="([^"]+)"[^>]*time="([^"]+)"[^>]*>([\s\S]*?)<\/testcase>/g;
  let match: RegExpExecArray | null;
  while ((match = testcaseRegex.exec(xml))) {
    const [, classname, name, seconds, inner] = match;
    const failed = /<failure/.test(inner);
    const failureMessage = inner.match(/<failure[^>]*message="([^"]*)"/)?.[1];
    records.push({
      id: `${classname}-${name}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
      runId,
      category: classname,
      name,
      status: failed ? 'failed' : 'passed',
      startedAt: new Date().toISOString(),
      elapsedMs: Math.round(Number(seconds) * 1000),
      artifacts: [],
      notes: ['Synthesized from JUnit reporter output.'],
      ...(failureMessage ? { error: { message: failureMessage } } : {}),
    });
  }

  return records;
}

function renderHtmlReport(summary: RunSummary, records: Awaited<ReturnType<typeof collectTestRecords>>) {
  const statusClass = summary.status === 'passed' ? 'green' : 'rose';
  const rows = records
    .map(record => {
      const artifactLinks = record.artifacts
        .map(artifact => `<a href="${escapeHtml(artifact)}">${escapeHtml(path.basename(artifact))}</a>`)
        .join('<br/>') || '<span class="muted">—</span>';
      const error = record.error ? `<details class="collapsible"><summary>Error</summary><div class="collapsible__body"><pre>${escapeHtml(record.error.message + '\n' + (record.error.stack ?? ''))}</pre></div></details>` : '';
      return `<tr>
        <td><span class="tag ${record.status === 'passed' ? 't-green' : record.status === 'failed' ? 't-rose' : 't-amber'}">${record.status}</span></td>
        <td><code>${escapeHtml(record.category)}</code><br/>${escapeHtml(record.name)}</td>
        <td>${record.request ? `<code>${escapeHtml(record.request.method ?? '')}</code> ${escapeHtml(record.request.endpoint ?? '')}` : '<span class="muted">—</span>'}</td>
        <td>${record.response?.statusCode ?? '—'}</td>
        <td>${record.elapsedMs}</td>
        <td>${artifactLinks}${error}</td>
      </tr>`;
    })
    .join('\n');

  const categoryCards = summary.categories
    .map(category => `<div class="card anim" style="--i:1"><div class="label blue">CATEGORY</div><h3>${escapeHtml(category.category)}</h3><p class="lead">${category.passed}/${category.total} passed</p><p class="muted">failed ${category.failed} · skipped ${category.skipped}</p></div>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>shuvcrawl API Docker report — ${escapeHtml(summary.runId)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root { color-scheme: dark; --bg:#0c1220; --surface:#121a2b; --surface-2:#0f1726; --border:rgba(56,189,248,.16); --text:#e6eef8; --muted:#93a4bb; --blue:#38bdf8; --green:#34d399; --amber:#fbbf24; --rose:#fb7185; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:'IBM Plex Sans',system-ui,sans-serif; background:radial-gradient(circle, rgba(56,189,248,.05) 1px, transparent 1px), var(--bg); background-size:20px 20px; color:var(--text); }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 32px 24px 80px; }
    .hero,.card { background:linear-gradient(180deg, rgba(18,26,43,.98), rgba(15,23,38,.96)); border:1px solid var(--border); border-radius:14px; }
    .hero { padding:28px; margin-bottom:24px; }
    .eyebrow,.label,code,.tag,th { font-family:'IBM Plex Mono',monospace; }
    .eyebrow { color:var(--blue); font-size:12px; letter-spacing:.12em; text-transform:uppercase; }
    h1,h2,h3,p { margin:0; }
    h1 { font-size:36px; margin-top:10px; }
    .subtitle { margin-top:10px; color:var(--muted); max-width: 70ch; }
    .kpi-row,.grid { display:grid; gap:16px; }
    .kpi-row { grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); margin-top:24px; }
    .kpi,.card { padding:18px; }
    .kpi-value { font-size:28px; font-weight:700; }
    .kpi-label,.muted { color:var(--muted); }
    .grid { grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); margin: 16px 0 24px; }
    .label { font-size:11px; color:var(--blue); margin-bottom:8px; }
    table { width:100%; border-collapse: collapse; overflow:hidden; }
    th,td { text-align:left; vertical-align:top; padding:14px 12px; border-bottom:1px solid rgba(148,163,184,.12); }
    th { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; }
    tbody tr:hover { background: rgba(56,189,248,.04); }
    .table-card { padding: 8px 18px 18px; }
    .tag { display:inline-flex; align-items:center; border-radius:999px; padding:4px 10px; font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
    .t-green { background: rgba(52,211,153,.12); color: var(--green); }
    .t-rose { background: rgba(251,113,133,.12); color: var(--rose); }
    .t-amber { background: rgba(251,191,36,.12); color: var(--amber); }
    a { color: var(--blue); text-decoration:none; }
    a:hover { text-decoration:underline; }
    details { margin-top:10px; }
    pre { white-space: pre-wrap; word-break: break-word; color:#f8fafc; }
    .sec-head { display:flex; align-items:center; justify-content:space-between; margin: 30px 0 12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero" data-sharecard-root>
      <div class="eyebrow">[01] SHUVCRAWL API DOCKER REPORT</div>
      <h1>${escapeHtml(summary.runId)}</h1>
      <p class="subtitle">Black-box API validation against the Dockerized shuvcrawl service, including fixture-backed scrape/map/crawl/capture coverage and structured artifact collection.</p>
      <div class="kpi-row">
        <div class="kpi"><div class="kpi-value">${summary.status.toUpperCase()}</div><div class="kpi-label">overall status</div></div>
        <div class="kpi"><div class="kpi-value">${summary.total}</div><div class="kpi-label">tests</div></div>
        <div class="kpi"><div class="kpi-value">${summary.passed}</div><div class="kpi-label">passed</div></div>
        <div class="kpi"><div class="kpi-value">${summary.failed}</div><div class="kpi-label">failed</div></div>
        <div class="kpi"><div class="kpi-value">${summary.elapsedMs}ms</div><div class="kpi-label">elapsed</div></div>
        <div class="kpi"><div class="kpi-value">${summary.telemetry.otlpCapturedSpans}</div><div class="kpi-label">captured OTLP payloads</div></div>
      </div>
    </section>

    <div class="sec-head"><h2>Category coverage</h2><span class="tag t-${statusClass}">${summary.status}</span></div>
    <div class="grid">${categoryCards}</div>

    <div class="sec-head"><h2>Detailed results</h2><span class="muted">Artifacts link to run-local files</span></div>
    <section class="card table-card">
      <table>
        <thead>
          <tr><th>Status</th><th>Test</th><th>Request</th><th>HTTP</th><th>Elapsed (ms)</th><th>Artifacts / evidence</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  </div>
</body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

await main();

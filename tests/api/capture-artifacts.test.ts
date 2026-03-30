import { expect, test } from 'bun:test';
import { withApiTrace } from './helpers.ts';

const category = 'capture-artifacts';

test('POST /screenshot creates image artifact', async () => {
  await withApiTrace(category, 'screenshot artifact', async ({ request, fixture, assertFileExists, trace }) => {
    const attempts = [1, 2];
    let lastBody: any;
    for (const attempt of attempts) {
      const { response, body } = await request('/screenshot', {
        method: 'POST',
        body: JSON.stringify({
          url: fixture('/visual.html'),
          options: { fullPage: true, wait: 'load' },
        }),
        note: `attempt-${attempt}`,
      });
      lastBody = body;
      if (response.status === 200) {
        expect(body.success).toBe(true);
        expect(body.data.path).toMatch(/page\.png$/);
        const filePath = await assertFileExists(body.data.path);
        const bytes = await Bun.file(filePath).arrayBuffer();
        const header = Array.from(new Uint8Array(bytes.slice(0, 4)));
        expect(header).toEqual([137, 80, 78, 71]);
        return;
      }
      await trace.note('Screenshot attempt failed; retrying once.', { attempt, status: response.status, code: body?.error?.code });
      await Bun.sleep(500);
    }
    expect(lastBody?.success).toBe(true);
  });
});

test('POST /pdf creates pdf artifact', async () => {
  await withApiTrace(category, 'pdf artifact', async ({ request, fixture, assertFileExists }) => {
    const { response, body } = await request('/pdf', {
      method: 'POST',
      body: JSON.stringify({
        url: fixture('/printable.html'),
        options: { format: 'Letter', landscape: false, wait: 'load' },
      }),
    });

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.path).toMatch(/page\.pdf$/);
    const filePath = await assertFileExists(body.data.path);
    const text = await Bun.file(filePath).text();
    expect(text.startsWith('%PDF')).toBe(true);
  });
});

test('scrape with debug artifacts captures clean/raw html artifacts', async () => {
  await withApiTrace(category, 'html artifact capture', async ({ request, fixture, assertFileExists, readHostFile }) => {
    const { response, body } = await request('/scrape', {
      method: 'POST',
      body: JSON.stringify({
        url: fixture('/console.html'),
        options: { noFastPath: true, debugArtifacts: true },
      }),
    });

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    const cleanPath = `${body.data.artifacts.dir}/clean.html`;
    const rawPath = `${body.data.artifacts.dir}/raw.html`;
    await assertFileExists(cleanPath);
    await assertFileExists(rawPath);
    const rawContent = await readHostFile(rawPath);
    expect(rawContent).toContain('fixture-console-log');
  });
});

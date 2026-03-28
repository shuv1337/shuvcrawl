import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config/loader.ts';

const originalEnv = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('loadConfig env overrides', () => {
  it('maps camelCase config keys from SHUVCRAWL_* env vars', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'shuvcrawl-config-test-'));

    try {
      const configPath = path.join(dir, 'config.json');
      await writeFile(configPath, '{}', 'utf8');

      process.env.SHUVCRAWL_TELEMETRY_OTLPHTTPENDPOINT = 'http://localhost:4318';
      process.env.SHUVCRAWL_CRAWL_RESPECTROBOTS = 'false';
      process.env.SHUVCRAWL_BROWSER_EXECUTABLE = '/custom/chromium';

      const config = await loadConfig(configPath);

      expect(config.telemetry.otlpHttpEndpoint).toBe('http://localhost:4318');
      expect(config.crawl.respectRobots).toBe(false);
      expect(config.browser.executablePath).toBe('/custom/chromium');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

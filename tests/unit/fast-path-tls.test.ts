import { describe, expect, it, beforeEach, afterEach, mock } from 'bun:test';
import { tryFastPath } from '../../src/core/fast-path.ts';
import { ShuvcrawlConfigSchema } from '../../src/config/schema.ts';
import { defaultConfig } from '../../src/config/defaults.ts';
import type { ShuvcrawlConfig } from '../../src/config/schema.ts';
import type { TelemetryContext } from '../../src/utils/telemetry.ts';

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
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

function buildConfig(overrides: Partial<ShuvcrawlConfig> = {}): ShuvcrawlConfig {
  return ShuvcrawlConfigSchema.parse({
    ...defaultConfig,
    ...overrides,
    fastPath: {
      ...defaultConfig.fastPath,
      ...overrides.fastPath,
    },
  });
}

describe('fast-path TLS config', () => {
  it('defaults have rejectUnauthorized=true', () => {
    const config = buildConfig();
    expect(config.fastPath.tls.rejectUnauthorized).toBe(true);
    expect(config.fastPath.tls.caBundlePath).toBeNull();
  });

  it('can set rejectUnauthorized to false via config', () => {
    const config = buildConfig({
      fastPath: {
        ...defaultConfig.fastPath,
        tls: {
          rejectUnauthorized: false,
          caBundlePath: null,
        },
      },
    });
    expect(config.fastPath.tls.rejectUnauthorized).toBe(false);
  });

  it('can set caBundlePath via config', () => {
    const config = buildConfig({
      fastPath: {
        ...defaultConfig.fastPath,
        tls: {
          rejectUnauthorized: true,
          caBundlePath: '/path/to/ca-bundle.crt',
        },
      },
    });
    expect(config.fastPath.tls.caBundlePath).toBe('/path/to/ca-bundle.crt');
  });

  it('fetch is called with TLS options when rejectUnauthorized is false', async () => {
    const mockFetch = mock(() => {
      return Promise.resolve(new Response('test content', { status: 200 }));
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const warnMock = mock(() => {});
    const logger = {
      debug: () => {},
      info: () => {},
      warn: warnMock,
      error: () => {},
    };

    const telemetry: TelemetryContext = {
      requestId: 'test-request',
      traceId: '00000000000000000000000000000000',
    };

    const config: ShuvcrawlConfig = buildConfig({
      fastPath: {
        ...defaultConfig.fastPath,
        tls: {
          rejectUnauthorized: false,
          caBundlePath: null,
        },
      },
    });

    await tryFastPath('https://example.com', config, logger, telemetry);

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0] as unknown as [string, (RequestInit & { tls?: { rejectUnauthorized?: boolean } })?];
    const fetchOptions = callArgs[1];
    expect(fetchOptions?.tls).toBeDefined();
    expect(fetchOptions?.tls?.rejectUnauthorized).toBe(false);
  });

  it('fetch is called without TLS options when rejectUnauthorized is true (default)', async () => {
    const mockFetch = mock(() => {
      return Promise.resolve(new Response('test content', { status: 200 }));
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    const telemetry: TelemetryContext = {
      requestId: 'test-request',
      traceId: '00000000000000000000000000000000',
    };

    const config: ShuvcrawlConfig = buildConfig();

    await tryFastPath('https://example.com', config, logger, telemetry);

    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0] as unknown as [string, (RequestInit & { tls?: { rejectUnauthorized?: boolean } })?];
    const fetchOptions = callArgs[1];
    // When rejectUnauthorized is true (default), we should not add TLS options
    expect(fetchOptions?.tls?.rejectUnauthorized).toBeUndefined();
  });

  it('logs warning when TLS verification is disabled', async () => {
    const mockFetch = mock(() => {
      return Promise.resolve(new Response('test content', { status: 200 }));
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const warnMock = mock(() => {});
    const logger = {
      debug: () => {},
      info: () => {},
      warn: warnMock,
      error: () => {},
    };

    const telemetry: TelemetryContext = {
      requestId: 'test-request',
      traceId: '00000000000000000000000000000000',
    };

    const config: ShuvcrawlConfig = buildConfig({
      fastPath: {
        ...defaultConfig.fastPath,
        tls: {
          rejectUnauthorized: false,
          caBundlePath: null,
        },
      },
    });

    await tryFastPath('https://example.com', config, logger, telemetry);

    expect(warnMock).toHaveBeenCalled();
    const warnCall = warnMock.mock.calls[0] as unknown[];
    expect(warnCall[0]).toBe('fastpath.tls.reject-unauthorized-disabled');
  });

  it('env var SHUVCRAWL_TLS_REJECT_UNAUTHORIZED=false maps to config', async () => {
    const { loadConfig } = await import('../../src/config/loader.ts');
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');

    const dir = await mkdtemp(path.join(tmpdir(), 'shuvcrawl-tls-test-'));

    try {
      const configPath = path.join(dir, 'config.json');
      await writeFile(configPath, '{}', 'utf8');

      process.env.SHUVCRAWL_TLS_REJECT_UNAUTHORIZED = 'false';

      const config = await loadConfig(configPath);

      expect(config.fastPath.tls.rejectUnauthorized).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('env var SHUVCRAWL_FASTPATH_TLS_CABUNDLE sets caBundlePath', async () => {
    const { loadConfig } = await import('../../src/config/loader.ts');
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');

    const dir = await mkdtemp(path.join(tmpdir(), 'shuvcrawl-tls-test-'));

    try {
      const configPath = path.join(dir, 'config.json');
      await writeFile(configPath, '{}', 'utf8');

      process.env.SHUVCRAWL_FASTPATH_TLS_CABUNDLE = '/custom/ca-bundle.crt';

      const config = await loadConfig(configPath);

      expect(config.fastPath.tls.caBundlePath).toBe('/custom/ca-bundle.crt');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('default config has secure TLS defaults', () => {
    const config = buildConfig();
    // TLS should be enabled by default (rejectUnauthorized: true)
    expect(config.fastPath.tls.rejectUnauthorized).toBe(true);
    // No custom CA bundle by default
    expect(config.fastPath.tls.caBundlePath).toBeNull();
  });
});

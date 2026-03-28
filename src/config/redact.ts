import type { ShuvcrawlConfig } from './schema.ts';

export function redactConfig(config: ShuvcrawlConfig): Record<string, unknown> {
  return {
    ...config,
    api: {
      ...config.api,
      token: config.api.token ? '[redacted]' : null,
      hasToken: Boolean(config.api.token),
    },
    telemetry: {
      ...config.telemetry,
      otlpHttpEndpoint: config.telemetry.otlpHttpEndpoint ? '[redacted]' : null,
      hasOtlpHttpEndpoint: Boolean(config.telemetry.otlpHttpEndpoint),
    },
    proxy: {
      ...config.proxy,
      url: config.proxy.url ? '[redacted]' : null,
      hasProxy: Boolean(config.proxy.url),
    },
  };
}

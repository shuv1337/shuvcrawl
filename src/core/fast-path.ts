import type { ShuvcrawlConfig } from '../config/schema.ts';
import type { Logger } from '../utils/logger.ts';
import type { TelemetryContext } from '../utils/telemetry.ts';
import { measureStage } from '../utils/telemetry.ts';
import { readFile } from 'node:fs/promises';

export type FastPathResult = {
  accepted: boolean;
  html: string;
  reason: string;
  status: number;
  finalUrl: string;
};

async function buildTlsOptions(config: ShuvcrawlConfig, logger: Logger): Promise<{ tls?: { rejectUnauthorized?: boolean; ca?: string } }> {
  const tlsConfig = config.fastPath.tls;
  const options: { tls?: { rejectUnauthorized?: boolean; ca?: string } } = {};

  if (!tlsConfig) {
    return options;
  }

  // Handle CA bundle if provided
  if (tlsConfig.caBundlePath) {
    try {
      const caBundle = await readFile(tlsConfig.caBundlePath, 'utf8');
      options.tls = { ca: caBundle };
    } catch (error) {
      logger.warn('fastpath.tls.ca-bundle-read-failed', { path: tlsConfig.caBundlePath, error: String(error) });
    }
  }

  // Handle rejectUnauthorized setting
  if (tlsConfig.rejectUnauthorized === false) {
    if (!options.tls) {
      options.tls = {};
    }
    options.tls.rejectUnauthorized = false;
    logger.warn('fastpath.tls.reject-unauthorized-disabled', { message: 'TLS certificate verification is disabled for fast-path fetch. This is insecure and should only be used in development/homelab environments.' });
  }

  return options;
}

export async function tryFastPath(
  url: string,
  config: ShuvcrawlConfig,
  logger: Logger,
  telemetry: TelemetryContext,
  customHeaders?: Record<string, string>,
): Promise<FastPathResult> {
  const { result } = await measureStage(logger, 'fastpath.fetch', telemetry, async () => {
    // Merge custom headers with defaults (custom headers take precedence)
    const headers: Record<string, string> = {
      'user-agent': config.fastPath.userAgent,
      referer: config.fastPath.referer,
      ...customHeaders,
    };

    // Build TLS options based on config
    const tlsOptions = await buildTlsOptions(config, logger);

    const fetchOptions: RequestInit & { tls?: { rejectUnauthorized?: boolean; ca?: string } } = {
      headers,
      redirect: 'follow',
      ...tlsOptions,
    };

    const response = await fetch(url, fetchOptions);
    const html = await response.text();
    const accepted = response.ok && html.length >= config.fastPath.minContentLength;
    const reason = accepted ? 'content-length-ok' : `rejected:${response.status}:${html.length}`;
    return {
      accepted,
      html,
      reason,
      status: response.status,
      finalUrl: response.url,
    };
  });
  logger.info('fastpath.result', { ...telemetry, accepted: result.accepted, reason: result.reason, status: result.status });
  return result;
}

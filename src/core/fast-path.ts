import type { ShuvcrawlConfig } from '../config/schema.ts';
import type { Logger } from '../utils/logger.ts';
import type { TelemetryContext } from '../utils/telemetry.ts';
import { measureStage } from '../utils/telemetry.ts';

export type FastPathResult = {
  accepted: boolean;
  html: string;
  reason: string;
  status: number;
  finalUrl: string;
};

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

    const response = await fetch(url, {
      headers,
      redirect: 'follow',
    });
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

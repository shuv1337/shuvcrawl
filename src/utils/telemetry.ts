import { randomUUID } from 'node:crypto';
import type { Logger } from './logger.ts';

export type TelemetryContext = {
  requestId: string;
  jobId?: string;
};

export function createTelemetryContext(overrides: Partial<TelemetryContext> = {}): TelemetryContext {
  return {
    requestId: overrides.requestId ?? `req_${randomUUID()}`,
    ...(overrides.jobId ? { jobId: overrides.jobId } : {}),
  };
}

export async function measureStage<T>(
  logger: Logger,
  stage: string,
  context: TelemetryContext,
  fn: () => Promise<T>,
): Promise<{ result: T; elapsed: number }> {
  const startedAt = Date.now();
  logger.info(`${stage}.start`, context);
  try {
    const result = await fn();
    const elapsed = Date.now() - startedAt;
    logger.info(`${stage}.success`, { ...context, elapsed });
    return { result, elapsed };
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    logger.error(`${stage}.failed`, {
      ...context,
      elapsed,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    });
    throw error;
  }
}

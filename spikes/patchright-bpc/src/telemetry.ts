import type { SpikeLogger } from './logger.ts';

export async function withStage<T>(
  logger: SpikeLogger,
  stageName: string,
  fn: () => Promise<T>,
  extra: Record<string, unknown> = {},
): Promise<{ result: T; durationMs: number }> {
  const startedAt = Date.now();
  await logger.log(`${stageName}.start`, extra);
  try {
    const result = await fn();
    const durationMs = Date.now() - startedAt;
    await logger.log(`${stageName}.success`, { ...extra, durationMs });
    return { result, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    await logger.log(`${stageName}.failed`, {
      ...extra,
      durationMs,
      error: serializeError(error),
    });
    throw error;
  }
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    };
  }
  return { message: String(error) };
}

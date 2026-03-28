import { classifyError, type ErrorCode } from '../errors/classify.ts';

export type ApiErrorCode = ErrorCode;

export function errorResponse(code: ApiErrorCode, message: string, meta: Record<string, unknown> = {}, details: Record<string, unknown> = {}) {
  return {
    success: false,
    error: {
      code,
      message,
      details,
    },
    meta,
  };
}

export function mapError(error: unknown): { status: number; body: ReturnType<typeof errorResponse> } {
  const classified = classifyError(error);
  return {
    status: classified.status,
    body: errorResponse(classified.code, classified.message, {}, classified.details ?? {}),
  };
}

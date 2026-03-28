import { ZodError } from 'zod';

export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'EXTRACTION_FAILED'
  | 'ROBOTS_DENIED'
  | 'LLM_ERROR'
  | 'RATE_LIMITED'
  | 'CONFIG_ERROR'
  | 'BROWSER_INIT_FAILED'
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR';

export type ClassifiedError = {
  code: ErrorCode;
  message: string;
  status: number;
  exitCode: number;
  details?: Record<string, unknown>;
};

export class ConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'ConfigError';
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof ZodError) {
    return {
      code: 'INVALID_REQUEST',
      message: 'Invalid request payload',
      status: 400,
      exitCode: 4,
      details: { issues: error.issues },
    };
  }

  if (error instanceof ConfigError) {
    return {
      code: 'CONFIG_ERROR',
      message: error.message,
      status: 500,
      exitCode: 2,
    };
  }

  if (error instanceof Error) {
    const message = error.message || 'Unknown error';

    if (error.name === 'CommanderError') {
      return {
        code: 'INVALID_REQUEST',
        message,
        status: 400,
        exitCode: 4,
      };
    }

    if (/unauthorized|forbidden|invalid token|auth/i.test(message)) {
      return {
        code: 'UNAUTHORIZED',
        message,
        status: 401,
        exitCode: 2,
      };
    }

    if (/robots/i.test(message)) {
      return {
        code: 'ROBOTS_DENIED',
        message,
        status: 403,
        exitCode: 6,
      };
    }

    if (/rate limit|too many requests|429/i.test(message)) {
      return {
        code: 'RATE_LIMITED',
        message,
        status: 429,
        exitCode: 7,
      };
    }

    if (/Timeout/i.test(error.name) || /timeout/i.test(message)) {
      return {
        code: 'TIMEOUT',
        message,
        status: 504,
        exitCode: 3,
      };
    }

    if (/serviceworker|patchright|chromium|browser launch|failed to launch browser|processsingleton|extension.+(load|ready|init)|browser init|executable path/i.test(message)) {
      return {
        code: 'BROWSER_INIT_FAILED',
        message,
        status: 502,
        exitCode: 8,
      };
    }

    if (/extract|readability|turndown|markdown conversion/i.test(message)) {
      return {
        code: 'EXTRACTION_FAILED',
        message,
        status: 500,
        exitCode: 5,
      };
    }

    if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_CERT|certificate|fetch failed|network|TLS|socket hang up/i.test(message)) {
      return {
        code: 'NETWORK_ERROR',
        message,
        status: 502,
        exitCode: 3,
      };
    }

    return {
      code: 'INTERNAL_ERROR',
      message,
      status: 500,
      exitCode: 1,
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'Unknown error',
    status: 500,
    exitCode: 1,
  };
}

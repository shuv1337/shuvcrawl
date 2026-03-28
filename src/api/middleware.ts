import type { Context, Next } from 'hono';
import type { ShuvcrawlConfig } from '../config/schema.ts';
import { errorResponse } from './errors.ts';

export function authMiddleware(config: ShuvcrawlConfig) {
  return async (c: Context, next: Next) => {
    if (!config.api.token) return next();
    const header = c.req.header('authorization');
    if (header !== `Bearer ${config.api.token}`) {
      return c.json(errorResponse('UNAUTHORIZED', 'Unauthorized'), 401);
    }
    return next();
  };
}

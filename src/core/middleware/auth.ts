/**
 * Authentication Middleware — lightweight bearer token check
 */

import type { Context } from '../context.ts';
import type { MiddlewareFn } from '../middleware.ts';

export interface AuthOptions {
  /** Function that verifies a token and returns user object or null */
  verify: (token: string) => unknown | null | Promise<unknown | null>;
  /** Paths to exclude from auth (exact match) */
  exclude?: string[];
}

export function auth(opts: AuthOptions): MiddlewareFn {
  const { verify } = opts;
  const excludeSet = opts.exclude ? new Set(opts.exclude) : null;

  return async function authMiddleware(ctx: Context, next: () => Promise<void> | void): Promise<void> {
    if (excludeSet && excludeSet.has(ctx.path)) {
      await next();
      return;
    }

    const authHeader = ctx.getHeader('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ctx.json({ error: 'Unauthorized', statusCode: 401 }, 401);
      return;
    }

    const token = authHeader.substring(7);
    const user = await verify(token);

    if (!user) {
      ctx.json({ error: 'Invalid token', statusCode: 401 }, 401);
      return;
    }

    ctx.state.user = user;
    await next();
  };
}

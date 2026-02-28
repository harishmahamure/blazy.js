/**
 * Rate Limiter Middleware — in-memory, zero dependencies
 */

import type { Context } from '../../core/context.js';
import type { MiddlewareFn } from '../../core/middleware.js';

export interface RateLimitOptions {
  max?: number;
  windowMs?: number;
  message?: string;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export function rateLimit(opts: RateLimitOptions = {}): MiddlewareFn {
  const max = opts.max || 100;
  const windowMs = opts.windowMs || 60_000;
  const message = opts.message || 'Too many requests';

  const store = new Map<string, RateLimitEntry>();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of store) {
      if (now > entry.resetTime) {
        store.delete(ip);
      }
    }
  }, windowMs);

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return function rateLimitMiddleware(ctx: Context, next: () => Promise<void> | void) {
    const ip = ctx.getHeader('x-forwarded-for') || 'unknown';
    const now = Date.now();

    let entry = store.get(ip);
    if (!entry || now > entry.resetTime) {
      entry = { count: 1, resetTime: now + windowMs };
      store.set(ip, entry);
    } else {
      entry.count++;
    }

    ctx.setHeader('X-RateLimit-Limit', String(max));
    ctx.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));

    if (entry.count > max) {
      ctx.setHeader('Retry-After', String(Math.ceil((entry.resetTime - now) / 1000)));
      ctx.json({ error: message, statusCode: 429 }, 429);
      return;
    }

    return next();
  };
}

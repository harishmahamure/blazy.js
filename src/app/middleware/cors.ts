/**
 * CORS Middleware — lightweight, zero-dependency
 */

import type { Context } from '../../core/context.js';
import type { MiddlewareFn } from '../../core/middleware.js';

export interface CorsOptions {
  origin?: string | string[];
  methods?: string[];
  headers?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export function cors(opts: CorsOptions = {}): MiddlewareFn {
  const origin = opts.origin || '*';
  const methods = opts.methods ? opts.methods.join(', ') : 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
  const headers = opts.headers ? opts.headers.join(', ') : 'Content-Type, Authorization';
  const credentials = opts.credentials ? 'true' : null;
  const maxAge = opts.maxAge ? String(opts.maxAge) : '86400';

  const isWildcard = origin === '*';
  const allowedOrigins = Array.isArray(origin) ? new Set(origin) : null;

  return function corsMiddleware(ctx: Context, next: () => Promise<void> | void) {
    let allowOrigin: string | null;
    if (isWildcard) {
      allowOrigin = '*';
    } else if (allowedOrigins) {
      const reqOrigin = ctx.getHeader('origin');
      allowOrigin = reqOrigin && allowedOrigins.has(reqOrigin) ? reqOrigin : null;
    } else {
      allowOrigin = origin as string;
    }

    if (!allowOrigin) {
      return next();
    }

    ctx.setHeader('Access-Control-Allow-Origin', allowOrigin);

    if (credentials) {
      ctx.setHeader('Access-Control-Allow-Credentials', credentials);
    }

    if (ctx.method === 'OPTIONS') {
      ctx.setHeader('Access-Control-Allow-Methods', methods);
      ctx.setHeader('Access-Control-Allow-Headers', headers);
      ctx.setHeader('Access-Control-Max-Age', maxAge);
      ctx.empty(204);
      return;
    }

    return next();
  };
}

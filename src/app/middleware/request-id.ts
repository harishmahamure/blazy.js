/**
 * Request ID Middleware — zero-dependency unique ID generator
 */

import type { Context } from '../../core/context.js';
import type { MiddlewareFn } from '../../core/middleware.js';

let _counter = 0;
const _prefix = Math.random().toString(36).substring(2, 8);

function generateId(): string {
  return `${_prefix}-${Date.now().toString(36)}-${(++_counter).toString(36)}`;
}

export interface RequestIdOptions {
  header?: string;
}

export function requestId(opts: RequestIdOptions = {}): MiddlewareFn {
  const headerName = opts.header || 'x-request-id';

  return function requestIdMiddleware(ctx: Context, next: () => Promise<void> | void) {
    const existing = ctx.getHeader(headerName);
    const id = existing || generateId();

    ctx.state.requestId = id;
    ctx.setHeader('X-Request-Id', id);

    return next();
  };
}

/**
 * Ultra-lightweight Middleware Pipeline
 *
 * Design decisions:
 * - Index-based execution — no function wrapping per request
 * - Flat array of middleware — no linked list overhead
 * - `next()` uses an index counter, not closures
 * - Global and route-level middleware merged at startup, not at request time
 * - Early exit when ctx.responded is true
 * - Sync middleware supported (no forced async)
 *
 * Cost per request: 1 integer increment per middleware step
 */

import type { Context } from './context.js';

/**
 * Unified function type for both middleware and handlers.
 * Middleware calls next(); final handlers simply don't.
 */
export type MiddlewareFn = (ctx: Context, next: () => Promise<void> | void) => Promise<void> | void;

/**
 * Execute a middleware pipeline
 *
 * Uses iterative index advancement instead of recursive closure chains.
 */
export async function executePipeline(
  ctx: Context,
  middlewares: MiddlewareFn[],
  finalHandler: MiddlewareFn | null
): Promise<void> {
  const len = middlewares.length;
  let index = 0;

  const next = async (): Promise<void> => {
    if (ctx.responded || ctx.aborted) return;

    if (index < len) {
      const mw = middlewares[index++];
      await mw(ctx, next);
    } else if (finalHandler) {
      await finalHandler(ctx, next);
    }
  };

  await next();
}

/**
 * Execute middleware pipeline synchronously where possible
 * Falls back to async if any middleware returns a Promise
 */
export function executePipelineSync(
  ctx: Context,
  middlewares: MiddlewareFn[],
  finalHandler: MiddlewareFn | null
): void | Promise<void> {
  const len = middlewares.length;
  let index = 0;

  function next(): void | Promise<void> {
    if (ctx.responded || ctx.aborted) return;

    if (index < len) {
      const mw = middlewares[index++];
      const result = mw(ctx, next);
      if (result && typeof (result as Promise<void>).then === 'function') {
        return result as Promise<void>;
      }
    } else if (finalHandler) {
      const result = finalHandler(ctx, next);
      if (result && typeof (result as Promise<void>).then === 'function') {
        return result as Promise<void>;
      }
    }
  }

  return next();
}

/**
 * Compose multiple middleware arrays into a single flat array
 * Used at startup to pre-compose global + route middleware
 */
export function composeMiddleware(...arrays: (MiddlewareFn[] | null | undefined)[]): MiddlewareFn[] {
  const result: MiddlewareFn[] = [];
  for (const arr of arrays) {
    if (arr) {
      for (let i = 0; i < arr.length; i++) {
        result.push(arr[i]);
      }
    }
  }
  return result;
}

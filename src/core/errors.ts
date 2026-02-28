/**
 * Lightweight Error Handling
 *
 * Design decisions:
 * - Single AppError class for all application errors
 * - No stack trace capture in production (configurable)
 * - Error handler middleware wraps the entire pipeline
 * - Errors serialized to JSON with minimal allocation
 * - No error class hierarchy — flat and simple
 */

import type { Context } from './context.js';
import type { MiddlewareFn } from './middleware.js';
import type { ILogger } from './logger.js';

export interface ErrorJson {
  error: string;
  statusCode: number;
  code?: string;
  details?: unknown;
}

/**
 * Application error with HTTP status code
 */
export class AppError extends Error {
  statusCode: number;
  code: string | null;
  details: unknown | null;

  constructor(statusCode: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || null;
    this.details = details || null;

    // Skip stack trace in production — saves ~2ms per error
    if (process.env.NODE_ENV === 'production') {
      this.stack = undefined;
    }
  }

  toJSON(): ErrorJson {
    const obj: ErrorJson = {
      error: this.message,
      statusCode: this.statusCode,
    };
    if (this.code) obj.code = this.code;
    if (this.details) obj.details = this.details;
    return obj;
  }
}

// =================== Pre-built Error Factories ===================

export function badRequest(msg = 'Bad Request', code?: string, details?: unknown): AppError {
  return new AppError(400, msg, code, details);
}

export function unauthorized(msg = 'Unauthorized', code?: string): AppError {
  return new AppError(401, msg, code);
}

export function forbidden(msg = 'Forbidden', code?: string): AppError {
  return new AppError(403, msg, code);
}

export function notFound(msg = 'Not Found', code?: string): AppError {
  return new AppError(404, msg, code);
}

export function conflict(msg = 'Conflict', code?: string): AppError {
  return new AppError(409, msg, code);
}

export function tooManyRequests(msg = 'Too Many Requests', code?: string): AppError {
  return new AppError(429, msg, code);
}

export function internal(msg = 'Internal Server Error', code?: string): AppError {
  return new AppError(500, msg, code);
}

// =================== Error Handler Middleware ===================

export interface ErrorHandlerOptions {
  logger?: ILogger | null;
  expose?: boolean;
}

/**
 * Create an error handler middleware
 * Wraps the entire pipeline — catches any thrown error
 */
export function createErrorHandler(opts: ErrorHandlerOptions = {}): MiddlewareFn {
  const logger = opts.logger || null;
  const expose = opts.expose ?? process.env.NODE_ENV !== 'production';

  return async function errorHandler(ctx: Context, next: () => Promise<void> | void): Promise<void> {
    try {
      await next();
    } catch (err: unknown) {
      if (ctx.aborted) return;

      if (err instanceof AppError) {
        ctx.json(err.toJSON(), err.statusCode);
      } else {
        const error = err as Error;
        if (logger) {
          logger.error({
            msg: 'Unhandled error',
            error: error.message,
            stack: expose ? error.stack : undefined,
            url: ctx.url,
            method: ctx.method,
          });
        }

        const body: Record<string, unknown> = { error: 'Internal Server Error', statusCode: 500 };
        if (expose && error.message) {
          body.message = error.message;
          body.stack = error.stack;
        }

        ctx.json(body, 500);
      }
    }
  };
}

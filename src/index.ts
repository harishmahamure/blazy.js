/**
 * Ultra-light Backend — Public API
 *
 * ESM-only, tree-shakable exports
 * Import only what you need:
 *   import { App } from 'ultra-light-backend';
 *   import { compileSchema, validateBody } from 'ultra-light-backend';
 */

// Core
export { App } from './core/app.js';
export type { PluginFn, LifecycleHook, WebSocketBehavior, AppStats } from './core/app.js';
export { Router } from './core/router.js';
export type { Handler, RouteMatch } from './core/router.js';
export { Context, ContextPool } from './core/context.js';
export { Container } from './core/container.js';

// Middleware
export { executePipeline, composeMiddleware } from './core/middleware.js';
export type { MiddlewareFn } from './core/middleware.js';

// Errors
export {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooManyRequests,
  internal,
  createErrorHandler,
} from './core/errors.js';
export type { ErrorJson, ErrorHandlerOptions } from './core/errors.js';

// Logging
export { Logger, createLogger, noopLogger, LogLevel } from './core/logger.js';
export type { LoggerOptions, ILogger } from './core/logger.js';

// Config
export { loadConfig, env, envInt, envBool } from './core/config.js';
export type { AppConfig, ConfigOverrides } from './core/config.js';

// Validation (optional — tree-shaken if not imported)
export { compileSchema, validateBody } from './core/validation.js';
export type { SchemaField, Schema, ValidatorFn } from './core/validation.js';

// Protobuf (optional — tree-shaken if not imported)
export {
  ProtoRegistry,
  protobufMiddleware,
  readProto,
  sendProto,
  sendNegotiated,
  decodeProto,
  isProtobufRequest,
  acceptsProtobuf,
} from './app/middleware/protobuf.js';
export type { ProtobufMiddlewareOptions } from './app/middleware/protobuf.js';

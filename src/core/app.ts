/**
 * Ultra-lightweight Application Runtime
 *
 * Built directly on uWebSockets.js — no Node HTTP server
 *
 * Design decisions:
 * - Single App class orchestrates all components
 * - Routes registered at startup, precompiled into radix tree
 * - Context pooled and reused across requests
 * - Middleware pipeline precomposed at startup
 * - Lifecycle hooks for startup/shutdown/connection
 * - WebSocket support via uWS native API
 * - No magic — explicit registration only
 *
 * Total core code: ~250 LOC
 * Memory overhead: ~5KB for App instance
 */

import uWS from 'uWebSockets.js';
import { Router } from './router.js';
import type { Handler } from './router.js';
import { Context, ContextPool } from './context.js';
import { executePipeline, composeMiddleware } from './middleware.js';
import type { MiddlewareFn } from './middleware.js';
import { Container } from './container.js';
import { createLogger, noopLogger } from './logger.js';
import type { ILogger } from './logger.js';
import { loadConfig } from './config.js';
import type { AppConfig, ConfigOverrides } from './config.js';
import { AppError } from './errors.js';

export type PluginFn = (app: App, config?: unknown) => void | Promise<void>;
export type LifecycleHook = (app: App) => void | Promise<void>;

export interface WebSocketBehavior<UserData = unknown> {
  compression?: number;
  maxPayloadLength?: number;
  idleTimeout?: number;
  maxBackpressure?: number;
  open?: (ws: uWS.WebSocket<UserData>) => void;
  message?: (ws: uWS.WebSocket<UserData>, message: ArrayBuffer, isBinary: boolean) => void;
  drain?: (ws: uWS.WebSocket<UserData>) => void;
  close?: (ws: uWS.WebSocket<UserData>, code: number, message: ArrayBuffer) => void;
  upgrade?: (
    res: uWS.HttpResponse,
    req: uWS.HttpRequest,
    context: uWS.us_socket_context_t
  ) => void;
}

export interface AppStats {
  isRunning: boolean;
  routes: number;
  pool: { poolSize: number; maxSize: number; totalAcquired: number; overflowCreated: number };
  memory: { rss: number; heapUsed: number; heapTotal: number };
  uptime: number;
}

export class App {
  static readonly DEFAULT_CONTEXT_SIZE = 64;

  readonly config: Readonly<AppConfig>;
  readonly router: Router;
  readonly container: Container;
  readonly logger: ILogger;
  readonly pool: ContextPool;

  private _globalMiddleware: MiddlewareFn[] = [];
  private _onStartup: LifecycleHook[] = [];
  private _onShutdown: LifecycleHook[] = [];
  private _uwsApp: uWS.TemplatedApp | null = null;
  private _listenSocket: uWS.us_listen_socket | null = null;
  private _isRunning = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _wsBehaviors = new Map<string, WebSocketBehavior<any>>();
  private _routeCount = 0;

  constructor(configOverrides: ConfigOverrides = {}) {
    this.config = loadConfig(configOverrides);

    this.router = new Router();
    this.container = new Container();
    this.logger = this.config.logging.enabled
      ? createLogger({
          level: this.config.logging.level,
          timestamp: this.config.logging.timestamp,
          name: 'app',
        })
      : noopLogger;

    this.pool = new ContextPool(this.config.pool.contextSize ?? App.DEFAULT_CONTEXT_SIZE, this);
  }

  // =================== MIDDLEWARE ===================

  use(middleware: MiddlewareFn): this {
    this._globalMiddleware.push(middleware);
    return this;
  }

  // =================== ROUTE REGISTRATION ===================

  get(path: string, ...handlers: Handler[]): this {
    return this._route('GET', path, handlers);
  }

  post(path: string, ...handlers: Handler[]): this {
    return this._route('POST', path, handlers);
  }

  put(path: string, ...handlers: Handler[]): this {
    return this._route('PUT', path, handlers);
  }

  patch(path: string, ...handlers: Handler[]): this {
    return this._route('PATCH', path, handlers);
  }

  delete(path: string, ...handlers: Handler[]): this {
    return this._route('DELETE', path, handlers);
  }

  options(path: string, ...handlers: Handler[]): this {
    return this._route('OPTIONS', path, handlers);
  }

  head(path: string, ...handlers: Handler[]): this {
    return this._route('HEAD', path, handlers);
  }

  all(path: string, ...handlers: Handler[]): this {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
    for (const method of methods) {
      this._route(method, path, [...handlers]);
    }
    return this;
  }

  private _route(method: string, path: string, handlers: Handler[]): this {
    const handler = handlers.pop()!;
    const middleware = handlers.length > 0 ? handlers : null;
    this.router.add(method, path, handler, middleware);
    this._routeCount++;
    return this;
  }

  // =================== WEBSOCKET ===================

  ws<T = unknown>(path: string, behavior: WebSocketBehavior<T> | uWS.WebSocketBehavior<T>): this {
    this._wsBehaviors.set(path, behavior as WebSocketBehavior<unknown>);
    return this;
  }

  // =================== PLUGINS ===================

  async register(plugin: PluginFn, pluginConfig?: unknown): Promise<this> {
    await plugin(this, pluginConfig);
    return this;
  }

  // =================== LIFECYCLE ===================

  onStartup(fn: LifecycleHook): this {
    this._onStartup.push(fn);
    return this;
  }

  onShutdown(fn: LifecycleHook): this {
    this._onShutdown.push(fn);
    return this;
  }

  // =================== SERVER ===================

  async listen(port?: number, host?: string): Promise<this> {
    const listenPort = port ?? this.config.port;
    const listenHost = host ?? this.config.host;

    for (const hook of this._onStartup) {
      await hook(this);
    }

    this._uwsApp = uWS.App();

    // Register WebSocket routes
    for (const [wsPath, behavior] of this._wsBehaviors) {
      this._uwsApp.ws(wsPath, {
        compression: behavior.compression ?? uWS.DISABLED,
        maxPayloadLength: behavior.maxPayloadLength ?? 16 * 1024,
        idleTimeout: behavior.idleTimeout ?? 120,
        maxBackpressure: behavior.maxBackpressure ?? 1024 * 1024,
        open: behavior.open,
        message: behavior.message,
        drain: behavior.drain,
        close: behavior.close,
        upgrade: behavior.upgrade,
      } as uWS.WebSocketBehavior<unknown>);
    }

    // HTTP catch-all handler
    this._uwsApp.any('/*', (res, req) => {
      this._handleRequest(res, req);
    });

    return new Promise<this>((resolve, reject) => {
      this._uwsApp!.listen(listenHost, listenPort, (socket) => {
        if (socket) {
          this._listenSocket = socket;
          this._isRunning = true;
          this.logger.info({
            msg: 'Server started',
            host: listenHost,
            port: listenPort,
            routes: this._routeCount,
            poolSize: this.config.pool.contextSize,
          });
          this._setupGracefulShutdown();
          resolve(this);
        } else {
          reject(new Error(`Failed to listen on ${listenHost}:${listenPort}`));
        }
      });
    });
  }

  /**
   * Handle incoming HTTP request — CRITICAL HOT PATH
   *
   * Flow:
   * 1. Acquire context from pool
   * 2. Capture request data (uWS req only valid synchronously)
   * 3. Run global middleware pipeline
   * 4. Route match (inside final handler)
   * 5. Run route-level middleware + handler
   * 6. Release context back to pool
   */
  private _handleRequest(res: uWS.HttpResponse, req: uWS.HttpRequest): void {
    const ctx = this.pool.acquire();
    ctx.init(res, req);
    ctx.captureHeaders();

    res.onAborted(() => {
      ctx.aborted = true;
    });

    const router = this.router;

    const routeHandler = async (ctx: Context): Promise<void> => {
      if (ctx.responded || ctx.aborted) return;

      const route = router.match(ctx.method, ctx.url);

      if (!route) {
        ctx.json({ error: 'Not Found', statusCode: 404 }, 404);
        return;
      }

      if (route.params) {
        ctx.params = route.params;
      }

      const noop = () => {};
      if (route.middleware && route.middleware.length > 0) {
        await executePipeline(ctx, route.middleware, route.fn);
      } else {
        await route.fn(ctx, noop);
      }
    };

    const maybePromise = executePipeline(ctx, this._globalMiddleware, routeHandler);

    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise
        .then(() => {
          this.pool.release(ctx);
        })
        .catch((err: unknown) => {
          this._handleUncaughtError(ctx, err);
          this.pool.release(ctx);
        });
    } else {
      this.pool.release(ctx);
    }
  }

  private _handleUncaughtError(ctx: Context, err: unknown): void {
    if (ctx.aborted || ctx.responded) return;

    const error = err as Error;
    this.logger.error({
      msg: 'Uncaught error in request handler',
      error: error.message,
      stack: error.stack,
      url: ctx.url,
      method: ctx.method,
    });

    try {
      if (err instanceof AppError) {
        ctx.json(err.toJSON(), err.statusCode);
      } else {
        ctx.json({ error: 'Internal Server Error', statusCode: 500 }, 500);
      }
    } catch {
      // Response already sent or connection aborted
    }
  }

  private _setupGracefulShutdown(): void {
    const shutdown = async (signal: string): Promise<void> => {
      this.logger.info({ msg: 'Shutdown signal received', signal });
      await this.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  async close(): Promise<void> {
    if (!this._isRunning) return;
    this._isRunning = false;

    for (const hook of this._onShutdown) {
      try {
        await hook(this);
      } catch (err: unknown) {
        this.logger.error({ msg: 'Shutdown hook error', error: (err as Error).message });
      }
    }

    if (this._listenSocket) {
      uWS.us_listen_socket_close(this._listenSocket);
      this._listenSocket = null;
    }

    this.logger.info({ msg: 'Server stopped' });
  }

  // =================== DIAGNOSTICS ===================

  stats(): AppStats {
    const mem = process.memoryUsage();
    return {
      isRunning: this._isRunning,
      routes: this._routeCount,
      pool: this.pool.stats,
      memory: {
        rss: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
        heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
        heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      },
      uptime: process.uptime(),
    };
  }
}

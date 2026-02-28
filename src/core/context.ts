/**
 * Ultra-lightweight Request Context with Object Pooling
 *
 * Design decisions:
 * - Context objects are pooled and reused across requests
 * - Body, query, and headers are lazily parsed (only on access)
 * - Direct reference to uWS res/req — no wrapping overhead
 * - reset() clears all state without creating new objects
 * - Params object reused from router match (not cloned)
 * - Backpressure handling for large responses to slow clients
 *
 * Memory per context: ~400 bytes (excluding lazy-parsed data)
 * Pool of 64 contexts: ~25KB total
 */

import type { HttpResponse, HttpRequest } from 'uWebSockets.js';
import type { App } from './app.js';

/**
 * Parse query string into object — only called on demand
 */
function parseQueryString(qs: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!qs) return result;

  let start = 0;
  let eqIdx = -1;

  for (let i = 0; i <= qs.length; i++) {
    const ch = i < qs.length ? qs.charCodeAt(i) : 38;

    if (ch === 61 /* '=' */) {
      eqIdx = i;
    } else if (ch === 38 /* '&' */ || i === qs.length) {
      if (eqIdx > start) {
        const key = qs.substring(start, eqIdx);
        const val = qs.substring(eqIdx + 1, i);
        result[key] = decodeURIComponent(val);
      } else if (i > start) {
        result[qs.substring(start, i)] = '';
      }
      start = i + 1;
      eqIdx = -1;
    }
  }

  return result;
}

// =================== HTTP STATUS TEXT CACHE ===================

const _statusCache = new Map<number, string>();

const STATUS_TEXTS: Record<number, string> = {
  200: '200 OK',
  201: '201 Created',
  204: '204 No Content',
  301: '301 Moved Permanently',
  302: '302 Found',
  304: '304 Not Modified',
  400: '400 Bad Request',
  401: '401 Unauthorized',
  403: '403 Forbidden',
  404: '404 Not Found',
  405: '405 Method Not Allowed',
  409: '409 Conflict',
  422: '422 Unprocessable Entity',
  429: '429 Too Many Requests',
  500: '500 Internal Server Error',
  502: '502 Bad Gateway',
  503: '503 Service Unavailable',
  504: '504 Gateway Timeout',
};

function statusText(code: number): string {
  let text = _statusCache.get(code);
  if (text) return text;
  text = STATUS_TEXTS[code] || `${code}`;
  _statusCache.set(code, text);
  return text;
}

export class Context {
  // -- uWS references --
  res: HttpResponse | null = null;
  req: HttpRequest | null = null;

  // -- Request data --
  method: string = '';
  url: string = '';
  path: string = '';

  // -- Route params --
  params: Record<string, string> | null = null;

  // -- Lazy-parsed fields --
  private _queryRaw: string | null = null;
  private _query: Record<string, string> | null = null;
  private _body: unknown = null;
  private _bodyParsed: boolean = false;
  private _rawBody: Buffer | null = null;
  private _headers: Map<string, string> | null = null;

  // -- Response state --
  statusCode: number = 200;
  responded: boolean = false;
  aborted: boolean = false;

  // -- Buffered response headers --
  private _resHeaderKeys: string[] | null = null;
  private _resHeaderVals: string[] | null = null;

  // -- Arbitrary user data --
  state: Record<string, unknown> = {};

  // -- App reference --
  app: App | null = null;

  /**
   * Reset context for reuse — clears all request-specific state
   */
  reset(): void {
    this.res = null;
    this.req = null;
    this.method = '';
    this.url = '';
    this.path = '';
    this.params = null;
    this._queryRaw = null;
    this._query = null;
    this._body = null;
    this._bodyParsed = false;
    this._rawBody = null;
    this._headers = null;
    this.statusCode = 200;
    this.responded = false;
    this.aborted = false;
    this._resHeaderKeys = null;
    this._resHeaderVals = null;
    this.state = {};
  }

  /**
   * Initialize context from uWS request — minimal work here
   */
  init(res: HttpResponse, req: HttpRequest): void {
    this.res = res;
    this.method = req.getMethod().toUpperCase();
    this.url = req.getUrl();

    const qIdx = this.url.indexOf('?');
    if (qIdx !== -1) {
      this.path = this.url.substring(0, qIdx);
    } else {
      this.path = this.url;
    }

    // Store query from uWS (only available during synchronous callback)
    const q = req.getQuery();
    this._queryRaw = q || null;

    // req is only valid synchronously — capture what we need now
    this.req = req;

    // Register abort handler to prevent dangling pointer exceptions
    res.onAborted(() => {
      this.aborted = true;
      this.res = null; // Clear reference to prevent use-after-free
    });
  }

  /**
   * Capture headers from req before it becomes invalid
   * Must be called during the initial synchronous callback
   */
  captureHeaders(): Map<string, string> {
    if (this._headers) return this._headers;
    this._headers = new Map();
    if (this.req) {
      this.req.forEach((key, value) => {
        this._headers!.set(key, value);
      });
    }
    return this._headers;
  }

  // =================== LAZY GETTERS ===================

  /** Parsed query parameters — lazy */
  get query(): Record<string, string> {
    if (this._query === null) {
      this._query = this._queryRaw ? parseQueryString(this._queryRaw) : {};
    }
    return this._query;
  }

  /** Get request header (lowercase key) */
  getHeader(key: string): string | undefined {
    if (!this._headers) {
      this.captureHeaders();
    }
    return this._headers!.get(key);
  }

  /**
   * Read and parse request body
   * Returns a Promise because uWS body reading is async
   */
  readBody<T = unknown>(): Promise<T | null> {
    if (this._bodyParsed) {
      return Promise.resolve(this._body as T | null);
    }

    return new Promise<T | null>((resolve) => {
      if (this.aborted || !this.res) {
        resolve(null);
        return;
      }

      let chunks: Buffer[] | null = null;

      this.res.onData((chunk: ArrayBuffer, isLast: boolean) => {
        const buf = Buffer.from(chunk);

        if (isLast) {
          let fullBuf: Buffer;
          if (chunks) {
            chunks.push(buf);
            fullBuf = Buffer.concat(chunks);
          } else {
            fullBuf = buf;
          }

          this._rawBody = fullBuf;
          this._bodyParsed = true;

          if (fullBuf.length > 0) {
            try {
              this._body = JSON.parse(fullBuf.toString('utf8'));
            } catch {
              this._body = fullBuf.toString('utf8');
            }
          } else {
            this._body = null;
          }

          resolve(this._body as T | null);
        } else {
          if (!chunks) chunks = [];
          chunks.push(Buffer.from(buf)); // Must copy — uWS reuses buffer
        }
      });
    });
  }

  /**
   * Read raw body as Buffer — no JSON parsing
   * Use for binary protocols (protobuf, msgpack, etc.)
   */
  readRawBody(): Promise<Buffer | null> {
    if (this._rawBody !== null) {
      return Promise.resolve(this._rawBody);
    }

    return new Promise<Buffer | null>((resolve) => {
      if (this.aborted || !this.res) {
        resolve(null);
        return;
      }

      let chunks: Buffer[] | null = null;

      this.res.onData((chunk: ArrayBuffer, isLast: boolean) => {
        const buf = Buffer.from(chunk);

        if (isLast) {
          let fullBuf: Buffer;
          if (chunks) {
            chunks.push(buf);
            fullBuf = Buffer.concat(chunks);
          } else {
            fullBuf = buf;
          }

          this._rawBody = fullBuf;
          this._bodyParsed = true;
          this._body = null; // raw mode — no JSON parse
          resolve(fullBuf);
        } else {
          if (!chunks) chunks = [];
          chunks.push(Buffer.from(buf));
        }
      });
    });
  }

  /** Raw body buffer (must call readBody or readRawBody first) */
  get rawBody(): Buffer | null {
    return this._rawBody;
  }

  /** Parsed body (must call readBody first) */
  get body(): unknown {
    return this._body;
  }

  // =================== RESPONSE METHODS ===================

  /**
   * Buffer a response header — written in correct order when response is sent
   * uWS requires: writeStatus → writeHeader → end
   */
  setHeader(key: string, value: string): this {
    if (this.aborted || this.responded || !this.res) return this;
    if (!this._resHeaderKeys) {
      this._resHeaderKeys = [key];
      this._resHeaderVals = [value];
    } else {
      this._resHeaderKeys.push(key);
      this._resHeaderVals!.push(value);
    }
    return this;
  }

  /** Set status code */
  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  /**
   * Flush status + buffered headers to uWS response
   * MUST be called before res.end()
   */
  private _flush(statusCode: number): void {
    if (!this.res) return; // Safety check
    const res = this.res;

    if (statusCode !== 200) {
      res.writeStatus(statusText(statusCode));
    }

    if (this._resHeaderKeys) {
      for (let i = 0; i < this._resHeaderKeys.length; i++) {
        res.writeHeader(this._resHeaderKeys[i], this._resHeaderVals![i]);
      }
    }
  }

  /** Send JSON response */
  json(data: unknown, status?: number): void {
    if (this.aborted || this.responded || !this.res) {
      console.error('Cannot send JSON response: context is aborted or responded or res is null');
      return;
    };
    this.responded = true;

    const code = status !== undefined ? status : this.statusCode;
    const body = JSON.stringify(data);

    this._flush(code);
    this.res.writeHeader('Content-Type', 'application/json');
    this.res.end(body);
  }

  /** Send plain text response */
  text(text: string, status?: number): void {
    if (this.aborted || this.responded || !this.res) return;
    this.responded = true;

    const code = status !== undefined ? status : this.statusCode;
    this._flush(code);
    this.res.writeHeader('Content-Type', 'text/plain');
    this.res.end(text);
  }

  /** Send raw buffer response */
  send(data: Buffer | ArrayBuffer | string, contentType = 'application/octet-stream', status?: number): void {
    if (this.aborted || this.responded || !this.res) return;
    this.responded = true;

    const code = status !== undefined ? status : this.statusCode;
    this._flush(code);
    this.res.writeHeader('Content-Type', contentType);
    this.res.end(data);
  }

  /** Send HTML response */
  html(html: string, status?: number): void {
    this.send(html, 'text/html; charset=utf-8', status);
  }

  /** Send an empty response with status code */
  empty(code = 204): void {
    if (this.aborted || this.responded || !this.res) return;
    this.responded = true;
    this._flush(code);
    this.res.end();
  }

  /** Redirect to another URL */
  redirect(url: string, code = 302): void {
    if (this.aborted || this.responded || !this.res) return;
    this.responded = true;
    this._flush(code);
    this.res.writeHeader('Location', url);
    this.res.end();
  }

  // =================== BACKPRESSURE HANDLING ===================

  /**
   * Stream large data with automatic backpressure handling
   * 
   * Handles slow clients by pausing when socket buffer is full.
   * Use this for large files, database exports, or any multi-megabyte responses.
   * 
   * @param chunks - Array of Buffer chunks or async generator
   * @param contentType - Content-Type header
   * @param status - HTTP status code
   * @param totalSize - Optional total size for Content-Length header
   * 
   * @example
   * // From array
   * await ctx.stream([chunk1, chunk2, chunk3], 'application/octet-stream');
   * 
   * @example
   * // From async generator
   * async function* generateChunks() {
   *   for (let i = 0; i < 100; i++) {
   *     yield Buffer.from(`Chunk ${i}\n`);
   *   }
   * }
   * await ctx.stream(generateChunks(), 'text/plain');
   */
  async stream(
    chunks: Buffer[] | AsyncIterable<Buffer>,
    contentType = 'application/octet-stream',
    status?: number,
    totalSize?: number
  ): Promise<boolean> {
    if (this.aborted || this.responded || !this.res) return false;
    this.responded = true;

    const code = status !== undefined ? status : this.statusCode;
    this._flush(code);
    this.res.writeHeader('Content-Type', contentType);
    
    if (totalSize !== undefined) {
      this.res.writeHeader('Content-Length', totalSize.toString());
    }

    // Cork for initial headers (batch writes)
    this.res.cork(() => {});

    // Convert to async iterable if needed
    const iterable: AsyncIterable<Buffer> = Symbol.asyncIterator in chunks
      ? (chunks as AsyncIterable<Buffer>)
      : {
          async *[Symbol.asyncIterator]() {
            for (const chunk of chunks as Buffer[]) {
              yield chunk;
            }
          }
        };

    try {
      for await (const chunk of iterable) {
        if (this.aborted || !this.res) return false;

        // Try to write the chunk
        const [ok, done] = this.res.tryEnd(chunk, totalSize || 0);

        if (done) {
          // All data sent successfully
          return true;
        }

        if (!ok) {
          // Backpressure detected - wait for drain
          const drained = await this._waitForDrain(chunk);
          if (!drained) return false; // Aborted or failed
        }
      }

      // Finalize the response
      if (!this.aborted && this.res) {
        this.res.end();
        return true;
      }

      return false;
    } catch (error) {
      if (!this.aborted && this.res) {
        this.res.close();
      }
      return false;
    }
  }

  /**
   * Wait for socket to drain (client to catch up)
   * Called automatically by stream() when backpressure occurs
   */
  private _waitForDrain(remainingData: Buffer): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.aborted || !this.res) {
        resolve(false);
        return;
      }

      // Set up drain handler
      this.res.onWritable((offset: number) => {
        if (this.aborted || !this.res) {
          resolve(false);
          return false;
        }

        // Try to write remaining data from offset
        const chunk = remainingData.subarray(offset);
        const [ok, done] = this.res.tryEnd(chunk, remainingData.length);

        if (done) {
          resolve(true);
          return false; // Remove handler
        }

        if (ok) {
          // Still more to write, but no backpressure now
          resolve(true);
          return false; // Remove handler
        }

        // Still backpressured, keep handler active
        return true;
      });
    });
  }

  /**
   * Send large buffer with automatic chunking and backpressure handling
   * 
   * Use this instead of send() for large responses (> 1MB)
   * 
   * @param data - Large buffer to send
   * @param contentType - Content-Type header
   * @param status - HTTP status code
   * @param chunkSize - Size of each chunk (default 64KB)
   */
  async sendLarge(
    data: Buffer,
    contentType = 'application/octet-stream',
    status?: number,
    chunkSize = 65536
  ): Promise<boolean> {
    const chunks: Buffer[] = [];
    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.subarray(i, Math.min(i + chunkSize, data.length)));
    }
    return this.stream(chunks, contentType, status, data.length);
  }

  /**
   * Check if we can write more data without backpressure
   * Returns current write offset
   */
  getWriteOffset(): number {
    if (!this.res) return 0;
    return this.res.getWriteOffset();
  }
}

// =================== CONTEXT POOL ===================

export class ContextPool {
  private _pool: Context[] = [];
  private _maxSize: number;
  private _app: App | null;
  private _acquired = 0;
  private _created = 0;

  constructor(size = 64, app: App | null = null) {
    this._maxSize = size;
    this._app = app;

    for (let i = 0; i < size; i++) {
      const ctx = new Context();
      ctx.app = app;
      this._pool.push(ctx);
    }
  }

  /** Acquire a context from pool — O(1) */
  acquire(): Context {
    this._acquired++;
    if (this._pool.length > 0) {
      return this._pool.pop()!;
    }
    this._created++;
    const ctx = new Context();
    ctx.app = this._app;
    return ctx;
  }

  /** Release context back to pool — O(1) */
  release(ctx: Context): void {
    ctx.reset();
    if (this._pool.length < this._maxSize) {
      this._pool.push(ctx);
    }
  }

  get stats(): { poolSize: number; maxSize: number; totalAcquired: number; overflowCreated: number } {
    return {
      poolSize: this._pool.length,
      maxSize: this._maxSize,
      totalAcquired: this._acquired,
      overflowCreated: this._created,
    };
  }
}

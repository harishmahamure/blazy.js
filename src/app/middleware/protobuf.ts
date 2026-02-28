/**
 * Protocol Buffers Middleware — Lightweight Protobuf Support
 *
 * Design decisions:
 * - Schemas loaded & compiled once at startup via ProtoRegistry
 * - Zero overhead for non-protobuf requests (content-type check is O(1))
 * - Auto content negotiation: decode protobuf requests, encode protobuf responses
 * - Supports both .proto file loading and programmatic schema definition
 * - Route-level helpers: readProto(), sendProto() for explicit control
 * - Falls back to JSON when Accept header doesn't request protobuf
 *
 * Content types supported:
 *   application/x-protobuf
 *   application/protobuf
 *   application/vnd.google.protobuf
 *
 * Memory: ~200 bytes per registered message type (excluding schema)
 */

import protobuf from 'protobufjs';
import type { Context } from '../../core/context.js';
import type { MiddlewareFn } from '../../core/middleware.js';

// =================== CONSTANTS ===================

const PROTO_CONTENT_TYPES = new Set([
  'application/x-protobuf',
  'application/protobuf',
  'application/vnd.google.protobuf',
]);

const DEFAULT_CONTENT_TYPE = 'application/x-protobuf';

// =================== PROTO REGISTRY ===================

/**
 * Registry for compiled protobuf message types.
 *
 * Load .proto files or register types at startup.
 * Encode/decode operations use precompiled types — zero parsing at request time.
 *
 * Usage:
 *   const registry = new ProtoRegistry();
 *   await registry.loadProto('./protos/user.proto');
 *   registry.encode('mypackage.User', { name: 'Alice', email: 'alice@test.com' });
 */
export class ProtoRegistry {
  private _root: protobuf.Root;
  private _types = new Map<string, protobuf.Type>();

  constructor() {
    this._root = new protobuf.Root();
  }

  /**
   * Load a .proto file and register all message types.
   * Call at startup — async file I/O, not in hot path.
   */
  async loadProto(path: string): Promise<this> {
    const root = await protobuf.load(path);
    this._mergeRoot(root);
    return this;
  }

  /**
   * Load multiple .proto files at once.
   */
  async loadProtos(paths: string[]): Promise<this> {
    for (const p of paths) {
      await this.loadProto(p);
    }
    return this;
  }

  /**
   * Load a .proto schema from a string (inline definition).
   * Useful for tests or embedded schemas.
   */
  loadProtoString(protoContent: string): this {
    const root = protobuf.parse(protoContent).root;
    this._mergeRoot(root);
    return this;
  }

  /**
   * Register a pre-resolved protobuf.Type directly.
   */
  register(name: string, type: protobuf.Type): this {
    this._types.set(name, type);
    return this;
  }

  /**
   * Get a registered message type by fully-qualified name.
   */
  get(name: string): protobuf.Type | undefined {
    // Try direct lookup first
    let type = this._types.get(name);
    if (type) return type;

    // Try resolving from loaded roots
    try {
      type = this._root.lookupType(name);
      if (type) {
        this._types.set(name, type); // Cache for next lookup
        return type;
      }
    } catch {
      // Type not found in root
    }

    return undefined;
  }

  /**
   * Encode a message to binary.
   * Uses precompiled type — no parsing at request time.
   *
   * @param typeName Fully qualified message type name (e.g. 'mypackage.User')
   * @param data     Plain object matching the message schema
   * @returns        Encoded binary as Uint8Array
   * @throws         If type not found or verification fails
   */
  encode(typeName: string, data: Record<string, unknown>): Uint8Array {
    const type = this._resolve(typeName);
    const errMsg = type.verify(data);
    if (errMsg) {
      throw new Error(`Protobuf verification failed for ${typeName}: ${errMsg}`);
    }
    const message = type.create(data);
    return type.encode(message).finish();
  }

  /**
   * Decode binary data into a plain object.
   *
   * @param typeName Fully qualified message type name
   * @param buffer   Binary protobuf data
   * @returns        Decoded plain object
   * @throws         If type not found or decode fails
   */
  decode<T = Record<string, unknown>>(typeName: string, buffer: Uint8Array | Buffer): T {
    const type = this._resolve(typeName);
    const message = type.decode(buffer instanceof Buffer ? new Uint8Array(buffer) : buffer);
    return type.toObject(message, {
      longs: String,
      enums: String,
      bytes: String,
      defaults: true,
    }) as T;
  }

  /**
   * Verify a message against its schema without encoding.
   * Returns null if valid, error string if invalid.
   */
  verify(typeName: string, data: Record<string, unknown>): string | null {
    const type = this._resolve(typeName);
    return type.verify(data);
  }

  /**
   * List all registered type names.
   */
  typeNames(): string[] {
    return [...this._types.keys()];
  }

  /**
   * Check if a type is registered or resolvable.
   */
  has(typeName: string): boolean {
    if (this._types.has(typeName)) return true;
    try {
      this._root.lookupType(typeName);
      return true;
    } catch {
      return false;
    }
  }

  /** Resolve a type or throw */
  private _resolve(typeName: string): protobuf.Type {
    const type = this.get(typeName);
    if (!type) {
      throw new Error(`Protobuf type not found: ${typeName}. Did you load the .proto file?`);
    }
    return type;
  }

  /** Merge another root's types into our registry */
  private _mergeRoot(root: protobuf.Root): void {
    // Walk all nested types and register them
    this._walkNamespace(root, '');
  }

  private _walkNamespace(ns: protobuf.NamespaceBase, prefix: string): void {
    if (ns.nestedArray) {
      for (const nested of ns.nestedArray) {
        const fullName = prefix ? `${prefix}.${nested.name}` : nested.name;

        if (nested instanceof protobuf.Type) {
          this._types.set(fullName, nested);
          // Also register without package prefix for convenience
          if (prefix) {
            this._types.set(nested.name, nested);
          }
        }

        if ('nestedArray' in nested) {
          this._walkNamespace(nested as protobuf.NamespaceBase, fullName);
        }
      }
    }
  }
}

// =================== MIDDLEWARE OPTIONS ===================

export interface ProtobufMiddlewareOptions {
  /** The ProtoRegistry instance with loaded schemas */
  registry: ProtoRegistry;

  /**
   * Map request paths to message type names for auto-decoding.
   * Key: "METHOD /path" (e.g. "POST /api/users")
   * Value: message type name (e.g. "User" or "mypackage.CreateUserRequest")
   */
  requestTypes?: Map<string, string> | Record<string, string>;

  /**
   * Map request paths to response message type names for auto-encoding.
   * Only used when client sends Accept: application/x-protobuf
   */
  responseTypes?: Map<string, string> | Record<string, string>;

  /**
   * Content type to use for protobuf responses.
   * Default: 'application/x-protobuf'
   */
  contentType?: string;
}

// =================== MIDDLEWARE FACTORY ===================

/**
 * Protobuf content negotiation middleware.
 *
 * When a request arrives with Content-Type: application/x-protobuf:
 *   1. Reads the raw body as binary
 *   2. Looks up the message type from requestTypes map
 *   3. Decodes the protobuf into ctx.state.protoBody
 *   4. Sets ctx.state.isProtobuf = true
 *
 * When the client sends Accept: application/x-protobuf:
 *   1. Sets ctx.state.acceptsProtobuf = true
 *   2. Handlers can use sendProto() to respond in protobuf format
 *
 * Zero overhead for JSON requests — just a string check on content-type.
 */
export function protobufMiddleware(opts: ProtobufMiddlewareOptions): MiddlewareFn {
  const { registry } = opts;
  const contentType = opts.contentType || DEFAULT_CONTENT_TYPE;

  // Normalize requestTypes to a Map
  const requestTypes = normalizeTypeMap(opts.requestTypes);
  const responseTypes = normalizeTypeMap(opts.responseTypes);

  return async function protoMw(ctx: Context, next: () => Promise<void> | void): Promise<void> {
    const reqContentType = ctx.getHeader('content-type') || '';
    const acceptHeader = ctx.getHeader('accept') || '';

    // Check if request body is protobuf
    const isProtoRequest = PROTO_CONTENT_TYPES.has(reqContentType);
    // Check if client accepts protobuf responses
    const acceptsProto = PROTO_CONTENT_TYPES.has(acceptHeader) || acceptHeader.includes('x-protobuf');

    ctx.state.isProtobuf = isProtoRequest;
    ctx.state.acceptsProtobuf = acceptsProto;
    ctx.state.protoRegistry = registry;
    ctx.state.protoContentType = contentType;

    // Auto-decode protobuf request body
    if (isProtoRequest && (ctx.method === 'POST' || ctx.method === 'PUT' || ctx.method === 'PATCH')) {
      const routeKey = `${ctx.method} ${ctx.path}`;
      const typeName = requestTypes?.get(routeKey);

      if (typeName) {
        const raw = await ctx.readRawBody();
        if (raw && raw.length > 0) {
          try {
            ctx.state.protoBody = registry.decode(typeName, raw);
          } catch (err) {
            ctx.json(
              { error: 'Invalid protobuf payload', details: (err as Error).message, statusCode: 400 },
              400
            );
            return;
          }
        }
      }
    }

    // Store response type mapping for sendProto auto-lookup
    if (responseTypes) {
      const routeKey = `${ctx.method} ${ctx.path}`;
      const resTypeName = responseTypes.get(routeKey);
      if (resTypeName) {
        ctx.state.protoResponseType = resTypeName;
      }
    }

    await next();
  };
}

// =================== ROUTE-LEVEL HELPERS ===================

/**
 * Read and decode a protobuf request body.
 *
 * Use this in route handlers for explicit protobuf decoding
 * without relying on the global middleware auto-decode.
 *
 * @example
 * ```ts
 * app.post('/api/users', async (ctx) => {
 *   const user = await readProto<UserData>(ctx, registry, 'User');
 *   // user is now a typed object
 * });
 * ```
 */
export async function readProto<T = Record<string, unknown>>(
  ctx: Context,
  registry: ProtoRegistry,
  typeName: string
): Promise<T> {
  // If already decoded by middleware, return cached
  if (ctx.state.protoBody && ctx.state.isProtobuf) {
    return ctx.state.protoBody as T;
  }

  const raw = await ctx.readRawBody();
  if (!raw || raw.length === 0) {
    throw new Error('Empty request body — cannot decode protobuf');
  }

  return registry.decode<T>(typeName, raw);
}

/**
 * Send a protobuf-encoded response.
 *
 * @example
 * ```ts
 * app.get('/api/users/:id', (ctx) => {
 *   const user = { name: 'Alice', email: 'alice@test.com' };
 *   sendProto(ctx, registry, 'User', user);
 * });
 * ```
 */
export function sendProto(
  ctx: Context,
  registry: ProtoRegistry,
  typeName: string,
  data: Record<string, unknown>,
  status?: number
): void {
  const encoded = registry.encode(typeName, data);
  const ct = (ctx.state.protoContentType as string) || DEFAULT_CONTENT_TYPE;
  ctx.send(Buffer.from(encoded), ct, status);
}

/**
 * Send a response that auto-negotiates between protobuf and JSON.
 *
 * If the client sent Accept: application/x-protobuf, responds with protobuf.
 * Otherwise, responds with JSON.
 *
 * @example
 * ```ts
 * app.get('/api/users/:id', (ctx) => {
 *   const user = { name: 'Alice', email: 'alice@test.com' };
 *   sendNegotiated(ctx, registry, 'User', user);
 * });
 * ```
 */
export function sendNegotiated(
  ctx: Context,
  registry: ProtoRegistry,
  typeName: string,
  data: Record<string, unknown>,
  status?: number
): void {
  if (ctx.state.acceptsProtobuf) {
    sendProto(ctx, registry, typeName, data, status);
  } else {
    ctx.json(data, status);
  }
}

/**
 * Create a route-level middleware that decodes a specific protobuf message type.
 *
 * Decoded body is stored in ctx.state.protoBody
 *
 * @example
 * ```ts
 * app.post('/api/users',
 *   decodeProto(registry, 'CreateUserRequest'),
 *   async (ctx) => {
 *     const body = ctx.state.protoBody as CreateUserRequest;
 *   }
 * );
 * ```
 */
export function decodeProto(registry: ProtoRegistry, typeName: string): MiddlewareFn {
  return async function decodeProtoMiddleware(ctx: Context, next: () => Promise<void> | void): Promise<void> {
    const contentType = ctx.getHeader('content-type') || '';

    if (PROTO_CONTENT_TYPES.has(contentType)) {
      const raw = await ctx.readRawBody();
      if (raw && raw.length > 0) {
        try {
          ctx.state.protoBody = registry.decode(typeName, raw);
          ctx.state.isProtobuf = true;
        } catch (err) {
          ctx.json(
            { error: 'Invalid protobuf payload', details: (err as Error).message, statusCode: 400 },
            400
          );
          return;
        }
      }
    } else {
      // Fallback: parse as JSON body
      await ctx.readBody();
    }

    await next();
  };
}

// =================== UTILITIES ===================

/**
 * Check if a request Content-Type is protobuf.
 */
export function isProtobufRequest(ctx: Context): boolean {
  const ct = ctx.getHeader('content-type') || '';
  return PROTO_CONTENT_TYPES.has(ct);
}

/**
 * Check if a client accepts protobuf responses.
 */
export function acceptsProtobuf(ctx: Context): boolean {
  const accept = ctx.getHeader('accept') || '';
  return PROTO_CONTENT_TYPES.has(accept) || accept.includes('x-protobuf');
}

function normalizeTypeMap(
  input: Map<string, string> | Record<string, string> | undefined
): Map<string, string> | null {
  if (!input) return null;
  if (input instanceof Map) return input;
  return new Map(Object.entries(input));
}

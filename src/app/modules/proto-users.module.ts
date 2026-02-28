/**
 * Protobuf Users Module — Example demonstrating protobuf support
 *
 * Demonstrates:
 * - Content negotiation (protobuf ↔ JSON)
 * - readProto() for decoding protobuf request bodies
 * - sendProto() / sendNegotiated() for encoding responses
 * - decodeProto() route-level middleware
 * - Works alongside JSON endpoints seamlessly
 */

import type { App } from '../../core/app.js';
import {
  ProtoRegistry,
  readProto,
  sendProto,
  sendNegotiated,
  decodeProto,
  isProtobufRequest,
} from '../middleware/protobuf.js';

interface User {
  id: string;
  name: string;
  email: string;
  age: number;
}

/**
 * Simple in-memory store (shared with the regular users module or standalone)
 */
class UserStore {
  private _users = new Map<string, User>();
  private _nextId = 1;

  constructor() {
    this._users.set('1', { id: '1', name: 'Alice', email: 'alice@example.com', age: 30 });
    this._users.set('2', { id: '2', name: 'Bob', email: 'bob@example.com', age: 25 });
    this._nextId = 3;
  }

  list(): User[] {
    return [...this._users.values()];
  }

  get(id: string): User | undefined {
    return this._users.get(id);
  }

  create(data: Omit<User, 'id'>): User {
    const id = String(this._nextId++);
    const user: User = { id, ...data };
    this._users.set(id, user);
    return user;
  }

  count(): number {
    return this._users.size;
  }
}

export async function protoUsersModule(app: App, registry: ProtoRegistry): Promise<void> {
  const store = new UserStore();

  // =================== GET /proto/users ===================
  // Responds in protobuf or JSON based on Accept header

  app.get('/proto/users', (ctx) => {
    const users = store.list();
    const response = { data: users, total: store.count() };

    // Auto-negotiate: protobuf if client asks for it, JSON otherwise
    sendNegotiated(ctx, registry, 'app.UserListResponse', response as unknown as Record<string, unknown>);
  });

  // =================== GET /proto/users/:id ===================
  // Responds in protobuf or JSON based on Accept header

  app.get('/proto/users/:id', (ctx) => {
    const user = store.get(ctx.params!.id);
    if (!user) {
      ctx.json({ error: 'User not found', statusCode: 404 }, 404);
      return;
    }

    sendNegotiated(ctx, registry, 'app.UserResponse', { data: user } as unknown as Record<string, unknown>);
  });

  // =================== POST /proto/users ===================
  // Accepts both protobuf and JSON request bodies
  // Uses decodeProto() route-level middleware

  app.post(
    '/proto/users',
    decodeProto(registry, 'app.CreateUserRequest'),
    async (ctx) => {
      let userData: Omit<User, 'id'>;

      if (isProtobufRequest(ctx)) {
        // Decoded by decodeProto middleware
        userData = ctx.state.protoBody as Omit<User, 'id'>;
      } else {
        // Regular JSON body
        userData = ctx.body as Omit<User, 'id'>;
      }

      const user = store.create(userData);

      // Respond in format client prefers
      sendNegotiated(ctx, registry, 'app.UserResponse', { data: user } as unknown as Record<string, unknown>, 201);
    }
  );

  // =================== GET /proto/users/:id/binary ===================
  // Always responds in protobuf (for dedicated protobuf clients)

  app.get('/proto/users/:id/binary', (ctx) => {
    const user = store.get(ctx.params!.id);
    if (!user) {
      ctx.json({ error: 'User not found', statusCode: 404 }, 404);
      return;
    }

    sendProto(ctx, registry, 'app.UserResponse', { data: user } as unknown as Record<string, unknown>);
  });

  // =================== POST /proto/users/explicit ===================
  // Demonstrates explicit readProto() usage (no middleware needed)

  app.post('/proto/users/explicit', async (ctx) => {
    try {
      const body = await readProto<Omit<User, 'id'>>(ctx, registry, 'app.CreateUserRequest');
      const user = store.create(body);
      sendProto(ctx, registry, 'app.UserResponse', { data: user } as unknown as Record<string, unknown>, 201);
    } catch (err) {
      ctx.json({ error: (err as Error).message, statusCode: 400 }, 400);
    }
  });

  app.logger.info({ msg: 'Protobuf users module loaded', types: registry.typeNames() });
}

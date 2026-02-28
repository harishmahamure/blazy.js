/**
 * Users Module — Example CRUD module
 *
 * Demonstrates:
 * - Route registration, body parsing, params, query, validation, DI, route middleware
 * Function-based — explicit, no magic
 */

import type { App } from '../../core/app.js';
import { compileSchema, validateBody } from '../../core/validation.js';
import { notFound } from '../../core/errors.js';

// Pre-compiled validation schemas (done once at module load)
const createUserSchema = compileSchema({
  name: { type: 'string', required: true, minLength: 1, maxLength: 100 },
  email: { type: 'email', required: true },
  age: { type: 'number', min: 0, max: 150 },
});

const updateUserSchema = compileSchema({
  name: { type: 'string', minLength: 1, maxLength: 100 },
  email: { type: 'email' },
  age: { type: 'number', min: 0, max: 150 },
});

interface User {
  id: string;
  name: string;
  email: string;
  age?: number;
}

/**
 * In-memory user store (replace with real DB in production)
 */
class InMemoryUserStore {
  private _users = new Map<string, User>();
  private _nextId = 1;

  constructor() {
    this._users.set('1', { id: '1', name: 'Alice', email: 'alice@example.com', age: 30 });
    this._users.set('2', { id: '2', name: 'Bob', email: 'bob@example.com', age: 25 });
    this._nextId = 3;
  }

  list(limit = 20, offset = 0): User[] {
    const all = [...this._users.values()];
    return all.slice(offset, offset + limit);
  }

  getById(id: string): User | null {
    return this._users.get(id) || null;
  }

  create(data: Omit<User, 'id'>): User {
    const id = String(this._nextId++);
    const user: User = { id, ...data };
    this._users.set(id, user);
    return user;
  }

  update(id: string, data: Partial<Omit<User, 'id'>>): User | null {
    const existing = this._users.get(id);
    if (!existing) return null;
    Object.assign(existing, data);
    return existing;
  }

  delete(id: string): boolean {
    return this._users.delete(id);
  }

  count(): number {
    return this._users.size;
  }
}

export function usersModule(app: App): void {
  const store = new InMemoryUserStore();
  app.container.set('userStore', store);

  // GET /api/users
  app.get('/api/users', (ctx) => {
    const { limit, offset } = ctx.query;
    const users = store.list(
      limit ? parseInt(limit, 10) : 20,
      offset ? parseInt(offset, 10) : 0
    );
    ctx.json({ data: users, total: store.count() });
  });

  // GET /api/users/:id
  app.get('/api/users/:id', (ctx) => {
    const user = store.getById(ctx.params!.id);
    if (!user) throw notFound('User not found');
    ctx.json({ data: user });
  });

  // POST /api/users (with validation)
  app.post('/api/users', validateBody(createUserSchema), async (ctx) => {
    const body = (await ctx.readBody()) as Omit<User, 'id'>;
    const user = store.create(body);
    ctx.json({ data: user }, 201);
  });

  // PUT /api/users/:id
  app.put('/api/users/:id', validateBody(updateUserSchema), async (ctx) => {
    const body = (await ctx.readBody()) as Partial<Omit<User, 'id'>>;
    const user = store.update(ctx.params!.id, body);
    if (!user) throw notFound('User not found');
    ctx.json({ data: user });
  });

  // DELETE /api/users/:id
  app.delete('/api/users/:id', (ctx) => {
    const deleted = store.delete(ctx.params!.id);
    if (!deleted) throw notFound('User not found');
    ctx.empty(204);
  });
}

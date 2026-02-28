/**
 * Memory & Performance Benchmark
 *
 * Run: npx tsx bench/memory.ts
 */

import { Router } from '../src/core/router.js';
import { ContextPool } from '../src/core/context.js';
import { executePipeline } from '../src/core/middleware.js';
import type { MiddlewareFn } from '../src/core/middleware.js';
import { Container } from '../src/core/container.js';
import { compileSchema } from '../src/core/validation.js';

function formatMemory(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function getMemory() {
  const m = process.memoryUsage();
  return { rss: m.rss, heapUsed: m.heapUsed, heapTotal: m.heapTotal, external: m.external };
}

function printMemory(label: string, mem: ReturnType<typeof getMemory>): void {
  console.log(`  ${label}:`);
  console.log(`    RSS:          ${formatMemory(mem.rss)}`);
  console.log(`    Heap Used:    ${formatMemory(mem.heapUsed)}`);
  console.log(`    Heap Total:   ${formatMemory(mem.heapTotal)}`);
  console.log(`    External:     ${formatMemory(mem.external)}`);
}

async function benchRouter(): Promise<void> {
  console.log('\n--- Router Benchmark ---');

  const router = new Router();
  const routeCount = 100;
  const noop = () => {};

  for (let i = 0; i < routeCount; i++) {
    router.add('GET', `/api/resource${i}`, noop);
    router.add('GET', `/api/resource${i}/:id`, noop);
    router.add('POST', `/api/resource${i}`, noop);
    router.add('PUT', `/api/resource${i}/:id`, noop);
    router.add('DELETE', `/api/resource${i}/:id`, noop);
  }

  console.log(`  Routes registered: ${routeCount * 5}`);

  const iterations = 1_000_000;

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    router.match('GET', '/api/resource50');
  }
  let elapsed = performance.now() - start;
  console.log(`  Static match (${iterations.toLocaleString()}x): ${elapsed.toFixed(1)}ms (${(elapsed / iterations * 1000000).toFixed(0)}ns/op)`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    router.match('GET', '/api/resource50/abc123');
  }
  elapsed = performance.now() - start;
  console.log(`  Dynamic match (${iterations.toLocaleString()}x): ${elapsed.toFixed(1)}ms (${(elapsed / iterations * 1000000).toFixed(0)}ns/op)`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    router.match('GET', '/not/found/path');
  }
  elapsed = performance.now() - start;
  console.log(`  Miss (${iterations.toLocaleString()}x): ${elapsed.toFixed(1)}ms (${(elapsed / iterations * 1000000).toFixed(0)}ns/op)`);
}

function benchContextPool(): void {
  console.log('\n--- Context Pool Benchmark ---');

  const pool = new ContextPool(64);
  const iterations = 1_000_000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const ctx = pool.acquire();
    pool.release(ctx);
  }
  const elapsed = performance.now() - start;
  console.log(`  Acquire/release (${iterations.toLocaleString()}x): ${elapsed.toFixed(1)}ms (${(elapsed / iterations * 1000000).toFixed(0)}ns/op)`);
  console.log(`  Pool stats:`, pool.stats);
}

function benchContainer(): void {
  console.log('\n--- DI Container Benchmark ---');

  const container = new Container();
  container.set('config', { port: 3000 });
  container.set('db', { query: () => {} });
  container.set('cache', new Map());

  const iterations = 10_000_000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    container.get('db');
  }
  const elapsed = performance.now() - start;
  console.log(`  Get (${iterations.toLocaleString()}x): ${elapsed.toFixed(1)}ms (${(elapsed / iterations * 1000000).toFixed(0)}ns/op)`);
}

function benchValidation(): void {
  console.log('\n--- Validation Benchmark ---');

  const schema = compileSchema({
    name: { type: 'string', required: true, minLength: 1, maxLength: 100 },
    email: { type: 'email', required: true },
    age: { type: 'number', min: 0, max: 150 },
  });

  const validData = { name: 'Alice', email: 'alice@example.com', age: 30 };
  const invalidData = { name: '', email: 'bad', age: -1 };

  const iterations = 1_000_000;

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    schema(validData);
  }
  let elapsed = performance.now() - start;
  console.log(`  Valid (${iterations.toLocaleString()}x): ${elapsed.toFixed(1)}ms (${(elapsed / iterations * 1000000).toFixed(0)}ns/op)`);

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    schema(invalidData);
  }
  elapsed = performance.now() - start;
  console.log(`  Invalid (${iterations.toLocaleString()}x): ${elapsed.toFixed(1)}ms (${(elapsed / iterations * 1000000).toFixed(0)}ns/op)`);
}

async function benchMiddleware(): Promise<void> {
  console.log('\n--- Middleware Pipeline Benchmark ---');

  const middleware: MiddlewareFn[] = [
    (_ctx, next) => next(),
    (_ctx, next) => next(),
    (_ctx, next) => next(),
    (ctx, next) => { ctx.state.auth = true; return next(); },
  ];

  const pool = new ContextPool(1);
  const iterations = 1_000_000;

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const ctx = pool.acquire();
    ctx.responded = false;
    await executePipeline(ctx, middleware, (c) => { c.responded = true; });
    pool.release(ctx);
  }
  const elapsed = performance.now() - start;
  console.log(`  4-middleware chain (${iterations.toLocaleString()}x): ${elapsed.toFixed(1)}ms (${(elapsed / iterations * 1000000).toFixed(0)}ns/op)`);
}

async function main(): Promise<void> {
  console.log('================================================');
  console.log('  Ultra-light Backend — Performance Benchmark');
  console.log('================================================');

  const startMem = getMemory();
  printMemory('Startup Memory', startMem);

  await benchRouter();
  benchContextPool();
  benchContainer();
  benchValidation();
  await benchMiddleware();

  if (global.gc) {
    global.gc();
    await new Promise((r) => setTimeout(r, 100));
  }

  const endMem = getMemory();
  console.log('\n--- Final Memory ---');
  printMemory('After Benchmarks', endMem);

  console.log(`\n  Memory delta: ${formatMemory(endMem.rss - startMem.rss)} RSS`);
  console.log('================================================\n');
}

main().catch(console.error);

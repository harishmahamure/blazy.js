/**
 * Health Check Module
 *
 * Provides /health, /ready, and /stats endpoints
 * Function-based module — no decorators, no scanning
 */

import type { App } from '../../core/app.js';

export function healthModule(app: App): void {
  // Liveness probe
  app.get('/health', (ctx) => {
    ctx.json({ status: 'ok', timestamp: Date.now() });
  });

  // Readiness probe — checks dependencies
  app.get('/ready', async (ctx) => {
    const checks: Record<string, string> = {};
    let healthy = true;

    const db = app.container.get<{ ping: () => Promise<void> }>('db');
    if (db) {
      try {
        await db.ping();
        checks.database = 'ok';
      } catch {
        checks.database = 'error';
        healthy = false;
      }
    }

    ctx.json(
      { status: healthy ? 'ok' : 'degraded', checks, timestamp: Date.now() },
      healthy ? 200 : 503
    );
  });

  // Stats endpoint
  app.get('/stats', (ctx) => {
    ctx.json(app.stats());
  });
}

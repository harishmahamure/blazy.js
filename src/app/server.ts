/**
 * Server Entry Point — Example Application
 *
 * Demonstrates the complete ultra-lightweight backend template:
 * - App creation with config
 * - Global middleware registration
 * - Module registration (function-based plugins)
 * - Lifecycle hooks
 * - Graceful shutdown
 *
 * Cold start target: <200ms
 * Idle memory target: <30MB
 */

import { App } from '../core/app.js';
import { createErrorHandler } from '../core/errors.js';

// Middleware
import { cors } from './middleware/cors.js';
import { rateLimit } from './middleware/rate-limit.js';
import { requestId } from './middleware/request-id.js';
import { protobufMiddleware, ProtoRegistry } from './middleware/protobuf.js';

// Modules
import { healthModule } from './modules/health.module.js';
import { usersModule } from './modules/users.module.js';
import { websocketModule } from './modules/websocket.module.js';
import { protoUsersModule } from './modules/proto-users.module.js';
import { abortHandlingExamples } from './modules/abort-handling.example.js';
import { backpressureExamples } from './modules/backpressure.example.js';

// =================== STARTUP ===================

const startTime = performance.now();

const app = new App({
  port: 3000,
  host: '0.0.0.0',
  pool: {
    contextSize: 64,
  },
  logging: {
    level: 3,
    enabled: true,
    timestamp: true,
  },
  gracefulShutdownTimeout: 5000,
});

// =================== GLOBAL MIDDLEWARE ===================

app.use(createErrorHandler({ logger: app.logger, expose: process.env.NODE_ENV !== 'production' }));
app.use(requestId());
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  headers: ['Content-Type', 'Authorization'],
  credentials: false,
}));
app.use(rateLimit({ max: 100, windowMs: 60_000 }));

// =================== PROTOBUF SETUP ===================

const protoRegistry = new ProtoRegistry();
await protoRegistry.loadProto('./protos/messages.proto');

abortHandlingExamples(app);
backpressureExamples(app);

app.use(protobufMiddleware({
  registry: protoRegistry,
  requestTypes: {
    'POST /proto/users': 'app.CreateUserRequest',
    'PUT /proto/users': 'app.UpdateUserRequest',
  },
}));

// =================== REGISTER MODULES ===================

healthModule(app);
usersModule(app);
websocketModule(app, { maxPayloadLength: 64 * 1024 });
protoUsersModule(app, protoRegistry);

// =================== LIFECYCLE HOOKS ===================

app.onStartup(async () => {
  const elapsed = (performance.now() - startTime).toFixed(1);
  app.logger.info({
    msg: 'Application initialized',
    startupMs: elapsed,
    nodeVersion: process.version,
    pid: process.pid,
  });
});

app.router.add('GET', '/', (ctx) => {
  ctx.json({ message: 'Hello, world!' });
});

app.onShutdown(async () => {
  app.logger.info({ msg: 'Application shutting down' });
});

// =================== START SERVER ===================

try {
  await app.listen();
  const elapsed = (performance.now() - startTime).toFixed(1);
  console.log(`\n  ⚡ Ultra-light backend ready in ${elapsed}ms`);
  console.log(`  📡 HTTP:      http://localhost:${app.config.port}`);
  console.log(`  🔌 WebSocket: ws://localhost:${app.config.port}/ws`);
  console.log(`  💚 Health:    http://localhost:${app.config.port}/health`);
  console.log(`  📊 Stats:     http://localhost:${app.config.port}/stats`);
  console.log(`  📦 Memory:    ${(process.memoryUsage().rss / 1024 / 1024).toFixed(1)} MB RSS\n`);
} catch (err) {
  console.error('Failed to start server:', (err as Error).message);
  process.exit(1);
}

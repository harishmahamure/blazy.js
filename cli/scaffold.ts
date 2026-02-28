#!/usr/bin/env node

/**
 * Ultra-light Backend — Dev-Only CLI Scaffolding Tool
 *
 * Usage:
 *   npx tsx cli/scaffold.ts module <name>
 *   npx tsx cli/scaffold.ts middleware <name>
 *   npx tsx cli/scaffold.ts plugin <name>
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const TEMPLATES: Record<string, (name: string) => string> = {
  module: (name) => `/**
 * ${capitalize(name)} Module
 *
 * Function-based module — no decorators, no scanning
 */

import type { App } from '../../core/app.js';

export function ${name}Module(app: App): void {
  app.get('/api/${name}', (ctx) => {
    ctx.json({ data: [], total: 0 });
  });

  app.get('/api/${name}/:id', (ctx) => {
    const { id } = ctx.params!;
    ctx.json({ data: { id } });
  });

  app.post('/api/${name}', async (ctx) => {
    const body = await ctx.readBody();
    ctx.json({ data: body }, 201);
  });

  app.put('/api/${name}/:id', async (ctx) => {
    const body = await ctx.readBody();
    ctx.json({ data: { id: ctx.params!.id, ...body as object } });
  });

  app.delete('/api/${name}/:id', (ctx) => {
    ctx.empty(204);
  });
}
`,

  middleware: (name) => `/**
 * ${capitalize(name)} Middleware
 */

import type { Context } from '../../core/context.js';
import type { MiddlewareFn } from '../../core/middleware.js';

export interface ${capitalize(name)}Options {
  // Add configuration options here
}

export function ${name}(opts: ${capitalize(name)}Options = {} as ${capitalize(name)}Options): MiddlewareFn {
  return function ${name}Middleware(ctx: Context, next: () => Promise<void> | void) {
    // Pre-handler logic here
    return next();
  };
}
`,

  plugin: (name) => `/**
 * ${capitalize(name)} Plugin
 *
 * Function-based plugin — explicit registration
 */

import type { App } from '../core/app.js';

export interface ${capitalize(name)}Config {
  // Add configuration here
}

export async function ${name}Plugin(app: App, config: ${capitalize(name)}Config = {} as ${capitalize(name)}Config): Promise<void> {
  // Initialize resources
  // app.container.set('${name}', resource);

  app.onShutdown(async () => {
    // Cleanup resources
  });

  app.logger.info({ msg: '${capitalize(name)} plugin loaded' });
}
`,
};

function main(): void {
  const [, , type, name] = process.argv;

  if (!type || !name) {
    console.log(`
  Ultra-light Backend CLI

  Usage:
    npx tsx cli/scaffold.ts module <name>
    npx tsx cli/scaffold.ts middleware <name>
    npx tsx cli/scaffold.ts plugin <name>

  Examples:
    npx tsx cli/scaffold.ts module products
    npx tsx cli/scaffold.ts middleware cache
    npx tsx cli/scaffold.ts plugin redis
`);
    process.exit(0);
  }

  const template = TEMPLATES[type];
  if (!template) {
    console.error(`Unknown type: ${type}. Use: module, middleware, or plugin`);
    process.exit(1);
  }

  let filePath: string;
  switch (type) {
    case 'module':
      filePath = join(ROOT, 'src/app/modules', `${name}.module.ts`);
      break;
    case 'middleware':
      filePath = join(ROOT, 'src/app/middleware', `${name}.ts`);
      break;
    case 'plugin':
      filePath = join(ROOT, 'src/plugins', `${name}.plugin.ts`);
      break;
    default:
      filePath = '';
  }

  if (existsSync(filePath)) {
    console.error(`File already exists: ${filePath}`);
    process.exit(1);
  }

  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(filePath, template(name));
  console.log(`✅ Created ${type}: ${filePath}`);
}

main();

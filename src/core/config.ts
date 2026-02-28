/**
 * Static Configuration Loader
 *
 * Design decisions:
 * - Loaded once at startup — frozen, immutable
 * - No runtime parsing or watching
 * - Environment variable interpolation
 * - Deep freeze to prevent accidental mutation
 * - No external dependencies
 *
 * Memory: ~1KB for typical config
 */

export interface PoolConfig {
  readonly contextSize: number;
}

export interface LoggingConfig {
  readonly level: number;
  readonly enabled: boolean;
  readonly timestamp: boolean;
}

export interface ValidationConfig {
  readonly enabled: boolean;
}

export interface AppConfig {
  readonly port: number;
  readonly host: string;
  readonly trustProxy: boolean;
  readonly pool: PoolConfig;
  readonly logging: LoggingConfig;
  readonly validation: ValidationConfig;
  readonly gracefulShutdownTimeout: number;
}

export interface ConfigOverrides {
  port?: number;
  host?: string;
  trustProxy?: boolean;
  pool?: Partial<PoolConfig>;
  logging?: Partial<LoggingConfig>;
  validation?: Partial<ValidationConfig>;
  gracefulShutdownTimeout?: number;
}

/** Deep freeze an object */
function deepFreeze<T extends object>(obj: T): Readonly<T> {
  const propNames = Object.getOwnPropertyNames(obj) as (keyof T)[];
  for (const name of propNames) {
    const value = obj[name];
    if (typeof value === 'object' && value !== null) {
      deepFreeze(value as object);
    }
  }
  return Object.freeze(obj);
}

/** Get environment variable with optional default */
export function env(key: string, defaultValue?: string): string | undefined {
  const val = process.env[key];
  if (val !== undefined) return val;
  if (defaultValue !== undefined) return String(defaultValue);
  return undefined;
}

/** Get env as integer */
export function envInt(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (val !== undefined) {
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? defaultValue : parsed;
  }
  return defaultValue;
}

/** Get env as boolean */
export function envBool(key: string, defaultValue: boolean): boolean {
  const val = process.env[key];
  if (val !== undefined) {
    return val === 'true' || val === '1' || val === 'yes';
  }
  return defaultValue;
}

const DEFAULT_CONFIG: AppConfig = {
  port: 3000,
  host: '0.0.0.0',
  trustProxy: false,
  pool: { contextSize: 64 },
  logging: { level: 3, enabled: true, timestamp: true },
  validation: { enabled: false },
  gracefulShutdownTimeout: 5000,
};

/**
 * Load configuration — merges defaults with overrides and env vars
 * Called once at startup, result is frozen
 */
export function loadConfig(overrides: ConfigOverrides = {}): Readonly<AppConfig> {
  const config: AppConfig = {
    port: envInt('PORT', overrides.port ?? DEFAULT_CONFIG.port),
    host: env('HOST', overrides.host ?? DEFAULT_CONFIG.host) ?? DEFAULT_CONFIG.host,
    trustProxy: envBool('TRUST_PROXY', overrides.trustProxy ?? DEFAULT_CONFIG.trustProxy),
    pool: {
      contextSize: overrides.pool?.contextSize ?? DEFAULT_CONFIG.pool.contextSize,
    },
    logging: {
      level: envInt('LOG_LEVEL', overrides.logging?.level ?? DEFAULT_CONFIG.logging.level),
      enabled: envBool('LOG_ENABLED', overrides.logging?.enabled ?? DEFAULT_CONFIG.logging.enabled),
      timestamp: overrides.logging?.timestamp ?? DEFAULT_CONFIG.logging.timestamp,
    },
    validation: {
      enabled: overrides.validation?.enabled ?? DEFAULT_CONFIG.validation.enabled,
    },
    gracefulShutdownTimeout:
      overrides.gracefulShutdownTimeout ?? DEFAULT_CONFIG.gracefulShutdownTimeout,
  };

  return deepFreeze(config);
}

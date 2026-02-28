/**
 * Ultra-lightweight Async Structured Logger
 *
 * Design decisions:
 * - Zero overhead when disabled (level check is a single integer comparison)
 * - Structured JSON output (machine-parseable)
 * - Async write to stdout — never blocks the event loop
 * - No external dependencies
 * - Supports levels: SILENT, ERROR, WARN, INFO, DEBUG
 *
 * Memory: ~200 bytes for logger instance
 */

import type { Writable } from 'node:stream';

export const enum LogLevel {
  SILENT = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
}

const LEVEL_NAMES: readonly string[] = ['SILENT', 'ERROR', 'WARN', 'INFO', 'DEBUG'];

export interface LoggerOptions {
  level?: LogLevel | number;
  name?: string;
  timestamp?: boolean;
  stream?: Writable;
}

export interface ILogger {
  error(msg: string | Record<string, unknown>, data?: Record<string, unknown>): void;
  warn(msg: string | Record<string, unknown>, data?: Record<string, unknown>): void;
  info(msg: string | Record<string, unknown>, data?: Record<string, unknown>): void;
  debug(msg: string | Record<string, unknown>, data?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): ILogger;
  setLevel(level: LogLevel | number): void;
}

export class Logger implements ILogger {
  private _level: number;
  private _name: string;
  private _timestamp: boolean;
  private _stream: Writable;
  private _context?: Record<string, unknown>;

  constructor(opts: LoggerOptions = {}) {
    this._level = opts.level ?? LogLevel.INFO;
    this._name = opts.name || '';
    this._timestamp = opts.timestamp !== false;
    this._stream = opts.stream || process.stdout;
  }

  setLevel(level: LogLevel | number): void {
    this._level = level;
  }

  error(msg: string | Record<string, unknown>, data?: Record<string, unknown>): void {
    if (this._level < LogLevel.ERROR) return;
    this._write(LogLevel.ERROR, msg, data);
  }

  warn(msg: string | Record<string, unknown>, data?: Record<string, unknown>): void {
    if (this._level < LogLevel.WARN) return;
    this._write(LogLevel.WARN, msg, data);
  }

  info(msg: string | Record<string, unknown>, data?: Record<string, unknown>): void {
    if (this._level < LogLevel.INFO) return;
    this._write(LogLevel.INFO, msg, data);
  }

  debug(msg: string | Record<string, unknown>, data?: Record<string, unknown>): void {
    if (this._level < LogLevel.DEBUG) return;
    this._write(LogLevel.DEBUG, msg, data);
  }

  child(context: Record<string, unknown>): Logger {
    const child = new Logger({
      level: this._level,
      name: this._name,
      timestamp: this._timestamp,
      stream: this._stream,
    });
    child._context = context;
    return child;
  }

  private _write(
    level: LogLevel | number,
    msg: string | Record<string, unknown>,
    data?: Record<string, unknown>
  ): void {
    let entry: Record<string, unknown>;

    if (typeof msg === 'object' && msg !== null) {
      entry = { ...msg };
      entry.level = LEVEL_NAMES[level];
    } else {
      entry = { level: LEVEL_NAMES[level], msg };
    }

    if (this._timestamp) {
      entry.time = Date.now();
    }

    if (this._name) {
      entry.name = this._name;
    }

    if (this._context) {
      Object.assign(entry, this._context);
    }

    if (data) {
      Object.assign(entry, data);
    }

    const line = JSON.stringify(entry) + '\n';
    this._stream.write(line);
  }
}

/** Create a logger instance */
export function createLogger(opts?: LoggerOptions): Logger {
  return new Logger(opts);
}

/** No-op logger — zero overhead, all methods are empty */
export const noopLogger: ILogger = {
  error() {},
  warn() {},
  info() {},
  debug() {},
  child() {
    return noopLogger;
  },
  setLevel() {},
};

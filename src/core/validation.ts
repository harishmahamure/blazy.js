/**
 * Optional Lightweight Schema Validation
 *
 * Design decisions:
 * - Precompiled validation functions — zero parsing at request time
 * - Schema defined as plain objects — no DSL overhead
 * - Validates only when explicitly called — not automatic
 * - Returns errors array or null — no error objects created on success
 * - Supports: string, number, boolean, object, array, email, enum
 * - No external dependencies
 *
 * Memory: ~100 bytes per compiled schema
 */

import type { Context } from './context.js';
import type { MiddlewareFn } from './middleware.js';

export interface SchemaField {
  type?: 'string' | 'number' | 'boolean' | 'email' | 'array' | 'object';
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  enum?: readonly (string | number)[];
  pattern?: RegExp;
}

export type Schema = Record<string, SchemaField>;
export type ValidatorFn = (data: Record<string, unknown>) => string[] | null;

type FieldChecker = (val: unknown) => string | null;

/**
 * Compile a schema into a validation function
 * Done once at startup — the returned function is fast
 */
export function compileSchema(schema: Schema): ValidatorFn {
  const fields = Object.entries(schema);
  const validators: ((data: Record<string, unknown>) => string | null)[] = [];

  for (const [name, rules] of fields) {
    validators.push(compileField(name, rules));
  }

  return function validate(data: Record<string, unknown>): string[] | null {
    if (!data || typeof data !== 'object') {
      return ['Expected an object'];
    }

    let errors: string[] | null = null;

    for (let i = 0; i < validators.length; i++) {
      const err = validators[i](data);
      if (err) {
        if (!errors) errors = [];
        errors.push(err);
      }
    }

    return errors;
  };
}

function compileField(name: string, rules: SchemaField): (data: Record<string, unknown>) => string | null {
  const checks: FieldChecker[] = [];

  if (rules.required) {
    checks.push((val) => {
      if (val === undefined || val === null || val === '') {
        return `${name} is required`;
      }
      return null;
    });
  }

  if (rules.type) {
    switch (rules.type) {
      case 'string':
        checks.push((val) =>
          val !== undefined && val !== null && typeof val !== 'string' ? `${name} must be a string` : null
        );
        break;
      case 'number':
        checks.push((val) =>
          val !== undefined && val !== null && typeof val !== 'number' ? `${name} must be a number` : null
        );
        break;
      case 'boolean':
        checks.push((val) =>
          val !== undefined && val !== null && typeof val !== 'boolean' ? `${name} must be a boolean` : null
        );
        break;
      case 'email':
        checks.push((val) => {
          if (val !== undefined && val !== null) {
            if (typeof val !== 'string' || !val.includes('@') || val.length < 3) {
              return `${name} must be a valid email`;
            }
          }
          return null;
        });
        break;
      case 'array':
        checks.push((val) =>
          val !== undefined && val !== null && !Array.isArray(val) ? `${name} must be an array` : null
        );
        break;
      case 'object':
        checks.push((val) =>
          val !== undefined && val !== null && (typeof val !== 'object' || Array.isArray(val))
            ? `${name} must be an object`
            : null
        );
        break;
    }
  }

  if (rules.min !== undefined) {
    const min = rules.min;
    checks.push((val) =>
      typeof val === 'number' && val < min ? `${name} must be >= ${min}` : null
    );
  }
  if (rules.max !== undefined) {
    const max = rules.max;
    checks.push((val) =>
      typeof val === 'number' && val > max ? `${name} must be <= ${max}` : null
    );
  }

  if (rules.minLength !== undefined) {
    const minLen = rules.minLength;
    checks.push((val) => {
      if (val && typeof val === 'string' && val.length < minLen) {
        return `${name} must have at least ${minLen} characters`;
      }
      if (val && Array.isArray(val) && val.length < minLen) {
        return `${name} must have at least ${minLen} items`;
      }
      return null;
    });
  }
  if (rules.maxLength !== undefined) {
    const maxLen = rules.maxLength;
    checks.push((val) => {
      if (val && typeof val === 'string' && val.length > maxLen) {
        return `${name} must have at most ${maxLen} characters`;
      }
      if (val && Array.isArray(val) && val.length > maxLen) {
        return `${name} must have at most ${maxLen} items`;
      }
      return null;
    });
  }

  if (rules.enum) {
    const allowed = new Set(rules.enum);
    checks.push((val) =>
      val !== undefined && val !== null && !allowed.has(val as string | number)
        ? `${name} must be one of: ${[...allowed].join(', ')}`
        : null
    );
  }

  if (rules.pattern) {
    const regex = rules.pattern;
    checks.push((val) =>
      typeof val === 'string' && !regex.test(val) ? `${name} does not match expected pattern` : null
    );
  }

  return function validateField(data: Record<string, unknown>): string | null {
    const val = data[name];
    for (let i = 0; i < checks.length; i++) {
      const err = checks[i](val);
      if (err) return err;
    }
    return null;
  };
}

/**
 * Create a validation middleware from a compiled schema
 */
export function validateBody(validator: ValidatorFn): MiddlewareFn {
  return async function validationMiddleware(ctx: Context, next: () => Promise<void> | void): Promise<void> {
    const body = await ctx.readBody<Record<string, unknown>>();
    const errors = validator(body ?? {});
    if (errors) {
      ctx.json({ error: 'Validation failed', details: errors }, 422);
      return;
    }
    await next();
  };
}

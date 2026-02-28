/**
 * Ultra-lightweight Dependency Injection Container
 *
 * Design decisions:
 * - Map-based storage — no reflection, no decorators, no metadata
 * - Two scopes: singleton (lives forever) and factory (creates per call)
 * - Explicit registration only — no auto-scanning
 * - get() is O(1) hash lookup
 * - No proxy objects, no lazy wrapping
 * - Total overhead: <1KB for typical app
 */

export class Container {
  private _singletons = new Map<string, unknown>();
  private _factories = new Map<string, () => unknown>();
  private _asyncFactories = new Map<string, () => Promise<unknown>>();

  /** Register a singleton value */
  set<T>(key: string, value: T): this {
    this._singletons.set(key, value);
    return this;
  }

  /** Register a factory function (called each time get() is invoked) */
  factory<T>(key: string, factory: () => T): this {
    this._factories.set(key, factory as () => unknown);
    return this;
  }

  /** Register a lazy singleton — factory called once, result cached */
  lazy<T>(key: string, factory: () => T | Promise<T>): this {
    this._asyncFactories.set(key, factory as () => Promise<unknown>);
    return this;
  }

  /** Get a dependency — O(1) */
  get<T>(key: string): T | undefined {
    const singleton = this._singletons.get(key);
    if (singleton !== undefined) return singleton as T;

    const factory = this._factories.get(key);
    if (factory) return factory() as T;

    return undefined;
  }

  /** Resolve a lazy singleton — async, caches result */
  async resolve<T>(key: string): Promise<T | undefined> {
    const existing = this._singletons.get(key);
    if (existing !== undefined) return existing as T;

    const asyncFactory = this._asyncFactories.get(key);
    if (asyncFactory) {
      const instance = await asyncFactory();
      this._singletons.set(key, instance);
      this._asyncFactories.delete(key);
      return instance as T;
    }

    const factory = this._factories.get(key);
    if (factory) return factory() as T;

    return undefined;
  }

  /** Check if a key is registered */
  has(key: string): boolean {
    return (
      this._singletons.has(key) || this._factories.has(key) || this._asyncFactories.has(key)
    );
  }

  /** Remove a dependency */
  delete(key: string): void {
    this._singletons.delete(key);
    this._factories.delete(key);
    this._asyncFactories.delete(key);
  }

  /** Clear all dependencies */
  clear(): void {
    this._singletons.clear();
    this._factories.clear();
    this._asyncFactories.clear();
  }

  /** Get all registered keys (diagnostics only) */
  keys(): string[] {
    const allKeys = new Set<string>();
    for (const k of this._singletons.keys()) allKeys.add(k);
    for (const k of this._factories.keys()) allKeys.add(k);
    for (const k of this._asyncFactories.keys()) allKeys.add(k);
    return [...allKeys];
  }
}

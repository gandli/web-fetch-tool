export interface CacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

/**
 * Short-lived result cache. Collapses concurrent duplicate requests and avoids
 * burning free-tier quota on double submissions; never used as a persistent
 * cache, so history/AI/archive still run for every explicit request.
 */
export class ResultCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly now: () => number = () => Date.now(),
    private readonly maxEntries = 200,
  ) {}

  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  getOrCreate(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing && existing.expiresAt > this.now()) return existing.promise;

    const promise = factory().catch((error) => {
      this.entries.delete(key);
      throw error;
    });

    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { expiresAt: this.now() + this.ttlMs, promise });
    return promise;
  }

  clear(): void {
    this.entries.clear();
  }
}

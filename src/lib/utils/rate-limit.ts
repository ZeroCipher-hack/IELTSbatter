/** Store contract suitable for an external Redis/Valkey implementation. */
export interface RateLimitStore {
  increment(key: string, windowMs: number): Promise<number>;
  get(key: string): Promise<number>;
  expire(key: string, windowMs: number): Promise<void>;
  reset?(): Promise<void>;
}

interface Bucket { count: number; expiresAt: number }
const MAX_BUCKETS = 10_000;

/** Single-process provider used locally and in unit tests. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  async increment(key: string, windowMs: number): Promise<number> {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (bucket && bucket.expiresAt <= now) {
      this.buckets.delete(key);
      bucket = undefined;
    }
    if (!bucket && this.buckets.size >= MAX_BUCKETS) {
      this.prune(now);
      if (this.buckets.size >= MAX_BUCKETS) return Number.POSITIVE_INFINITY;
    }
    const next = bucket ?? { count: 0, expiresAt: now + windowMs };
    next.count += 1;
    this.buckets.set(key, next);
    return next.count;
  }

  async get(key: string): Promise<number> {
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.expiresAt <= Date.now()) {
      if (bucket) this.buckets.delete(key);
      return 0;
    }
    return bucket.count;
  }

  async expire(key: string, windowMs: number): Promise<void> {
    const bucket = this.buckets.get(key);
    if (bucket) bucket.expiresAt = Date.now() + windowMs;
  }

  async reset(): Promise<void> { this.buckets.clear(); }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.expiresAt <= now) this.buckets.delete(key);
    }
  }
}

export interface RateLimitOptions {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

let store: RateLimitStore = new MemoryRateLimitStore();

export async function rateLimit(key: string, options: RateLimitOptions): Promise<boolean> {
  if (!key || options.limit < 1 || options.windowMs < 1) return false;
  return (await store.increment(key, options.windowMs)) <= options.limit;
}

export function setRateLimitStoreForTesting(next: RateLimitStore): void { store = next; }

export async function resetRateLimitsForTesting(): Promise<void> {
  await store.reset?.();
  store = new MemoryRateLimitStore();
}

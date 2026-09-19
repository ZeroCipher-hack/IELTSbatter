/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Good enough for a single-instance deployment; swap the store for Redis
 * when scaling horizontally (the interface stays the same).
 */

interface Bucket {
  timestamps: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

export interface RateLimitOptions {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export function rateLimit(key: string, options: RateLimitOptions): boolean {
  const now = Date.now();
  if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) {
    pruneExpiredBuckets(now, options.windowMs);
    // Never let attacker-controlled IP/header cardinality grow memory without
    // bound. Existing buckets continue to work; new identities are throttled.
    if (buckets.size >= MAX_BUCKETS) return false;
  }
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < options.windowMs);

  if (bucket.timestamps.length >= options.limit) {
    buckets.set(key, bucket);
    return false;
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);

  return true;
}

function pruneExpiredBuckets(now: number, windowMs: number): void {
  buckets.forEach((bucket, bucketKey) => {
    if (bucket.timestamps.every((timestamp) => now - timestamp >= windowMs)) {
      buckets.delete(bucketKey);
    }
  });
}

export function resetRateLimitsForTesting(): void {
  buckets.clear();
}

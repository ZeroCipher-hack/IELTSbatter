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

export interface RateLimitOptions {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export function rateLimit(key: string, options: RateLimitOptions): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < options.windowMs);

  if (bucket.timestamps.length >= options.limit) {
    buckets.set(key, bucket);
    return false;
  }

  bucket.timestamps.push(now);
  buckets.set(key, bucket);

  // Opportunistic cleanup to keep memory bounded.
  if (buckets.size > 10_000) {
    buckets.forEach((b, k) => {
      if (b.timestamps.every((t) => now - t >= options.windowMs)) buckets.delete(k);
    });
  }
  return true;
}

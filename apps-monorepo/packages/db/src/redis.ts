import { Redis } from 'ioredis';

let cached: Redis | null = null;

/**
 * Shared ioredis connection for BullMQ and the rate limiter.
 * REDIS_URL must be a direct RESP connection (e.g. Upstash `rediss://...`).
 * The Upstash REST URL/token will NOT work with BullMQ.
 */
export function getRedis(url?: string): Redis {
  if (cached) return cached;
  const redisUrl = url ?? process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('Missing REDIS_URL — required for BullMQ queues and rate limiting.');
  }
  cached = new Redis(redisUrl, {
    maxRetriesPerRequest: null, // BullMQ requirement
    enableReadyCheck: true,
    lazyConnect: false,
  });
  return cached;
}

/** Duplicate connection for a specific purpose (BullMQ wants blocking + non-blocking on separate conns). */
export function duplicateRedis(): Redis {
  const conn = getRedis();
  return conn.duplicate();
}

export async function closeRedis(): Promise<void> {
  if (cached) {
    await cached.quit().catch(() => cached?.disconnect());
    cached = null;
  }
}

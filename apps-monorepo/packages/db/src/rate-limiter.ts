import { type Redis } from 'ioredis';

/**
 * Simple fixed-window per-source rate limiter backed by Redis.
 * Key: ratelimit:{sourceType}:{boardToken}, window: 60s.
 * Honors source_configs.rate_limit_per_minute (default 30).
 */
export class RedisRateLimiter {
  constructor(private readonly redis: Redis) {}

  async consume(sourceType: string, boardToken: string, limitPerMinute = 30): Promise<boolean> {
    const window = Math.floor(Date.now() / 60_000);
    const key = `ratelimit:${sourceType}:${boardToken}:${window}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.pexpire(key, 61_000);
    }
    return count <= limitPerMinute;
  }

  async remaining(sourceType: string, boardToken: string, limitPerMinute = 30): Promise<number> {
    const window = Math.floor(Date.now() / 60_000);
    const key = `ratelimit:${sourceType}:${boardToken}:${window}`;
    const count = await this.redis.get(key);
    return Math.max(0, limitPerMinute - Number(count ?? 0));
  }
}

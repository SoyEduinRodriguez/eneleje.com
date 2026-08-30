/**
 * eneleje.com · Rate limiting con Redis (ventana fija atómica)
 *
 * Zonas del producto (ver docs/ARQUITECTURA.md §8):
 *   registro:    3/hora/IP   + 5/día/fingerprint
 *   reportes:   10/día/IP
 *   tracking:   60/minuto/IP
 *   login:       5/15min/(cuenta+IP)
 * Nginx añade su propio limit_req como primera muralla.
 */
import type Redis from 'ioredis';

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetSeconds: number;
}

/**
 * Ventana fija: INCR + EXPIRE en MULTI (atómico, O(1), suficiente para anti-spam;
 * no requiere RedisTimeSeries ni lua). Llave por ventana => expira sola.
 */
export async function rateLimit(
  redis: Redis,
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `rl:${scope}:${identifier}:${window}`;

  const [[incrErr, count], [expireErr]] = await redis
    .multi()
    .incr(key)
    .expire(key, windowSeconds)
    .exec() as [[null | Error, number], [null | Error, number]];

  if (incrErr || expireErr) {
    // Fail-open: si Redis cae, no bloqueamos el registro (la emergencia es ahora).
    return { ok: true, remaining: limit - 1, resetSeconds: windowSeconds };
  }

  const ttl = await redis.ttl(key);
  return {
    ok: count <= limit,
    remaining: Math.max(limit - count, 0),
    resetSeconds: ttl > 0 ? ttl : windowSeconds,
  };
}

/** Helper para Server Actions / Route Handlers: lanza 429 cuando excede. */
export async function enforceRateLimit(
  redis: Redis,
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const result = await rateLimit(redis, scope, identifier, limit, windowSeconds);
  if (!result.ok) {
    const err = new Error('Demasiadas solicitudes. Intenta más tarde.') as Error & {
      status?: number; retryAfter?: number;
    };
    err.status = 429;
    err.retryAfter = result.resetSeconds;
    throw err;
  }
}

/**
 * eneleje.com · Rate limiting en memoria (ventana fija).
 *
 * Interino mientras no hay Redis en el homelab: suficiente para desarrollo y
 * para una sola instancia. En despliegue real se reemplaza por
 * src/lib/rate-limit.ts (Redis). Fail-closed deliberado: si esto falla,
 * mejor rechazar el intento en rutas sensibles.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

/** true = permite el intento; false = excedió la cuota de la ventana. */
export function rateLimitMem(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

if (buckets.size > 10_000) buckets.clear(); // cuchara preventiva

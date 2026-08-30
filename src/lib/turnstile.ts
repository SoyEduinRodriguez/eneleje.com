/**
 * eneleje.com · Cloudflare Turnstile (anti-bot en /registro).
 * Si TURNSTILE_SECRET_KEY no está configurada (dev) se omite la verificación.
 */
'use server';

export async function verifyTurnstile(token: string | null, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // dev sin Turnstile configurado
  if (!token) return false;

  const body = new URLSearchParams({ secret, response: token, remoteip: ip });
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false; // si no podemos verificar, no pasamos
  }
}

'use server';

/**
 * eneleje.com · Recuperación de contraseña.
 * Interino sin SMTP: si DEV_RESET_LINK=true el enlace se muestra en pantalla
 * (SOLO desarrollo). En producción se envía por email y este flag se apaga.
 * El token guarda únicamente su sha256 (tabla auth_tokens, vía SECURITY DEFINER).
 */
import { redirect } from 'next/navigation';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '@/db/queries-postgis';
import { clientIp, hashPassword, lookupLogin } from '@/lib/auth';
import { rateLimitMem } from '@/lib/rate-limit-mem';
import { esEmail, normText } from '@/lib/validate';
import type { RecuperarState } from '@/lib/action-state';

function sha256(v: string) {
  return createHash('sha256').update(v).digest('hex');
}

export async function solicitarRecuperacionAction(
  _prev: unknown,
  formData: FormData,
): Promise<RecuperarState> {
  const ip = await clientIp();
  if (!rateLimitMem(`recup:${ip}`, 5, 3_600_000)) {
    return { error: 'Demasiados intentos. Espera una hora.', link: null };
  }

  const email = normText(formData.get('email')).toLowerCase();
  // Respuesta genérica: no revelar si el correo tiene cuenta o no.
  const generic: RecuperarState = {
    error: null,
    ok: 'Si el correo tiene una cuenta activa, el enlace de recuperación ya está disponible. Revisa tu bandeja de entrada.',
    link: null,
  };
  if (!esEmail(email)) return generic;

  const row = await lookupLogin(email);
  if (!row || row.status !== 'active') return generic;

  const token = randomBytes(32).toString('hex');
  await db.execute(sql`SELECT app_create_reset_token(${row.id}::uuid, ${sha256(token)})`);

  if (process.env.DEV_RESET_LINK === 'true') {
    return {
      error: null,
      ok: 'MODO DESARROLLO: enlace directo (en producción se enviaría por email):',
      link: `/recuperar?token=${token}`,
    };
  }
  return generic;
}

export async function restablecerAction(
  _prev: unknown,
  formData: FormData,
): Promise<RecuperarState> {
  const ip = await clientIp();
  if (!rateLimitMem(`reset:${ip}`, 10, 3_600_000)) {
    return { error: 'Demasiados intentos. Espera una hora.' };
  }

  const token = normText(formData.get('token'));
  const password = typeof formData.get('password') === 'string' ? (formData.get('password') as string) : '';
  const confirm = typeof formData.get('confirm') === 'string' ? (formData.get('confirm') as string) : '';

  if (!token) return { error: 'Falta el token del enlace.' };
  if (password.length < 8) return { error: 'La nueva contraseña debe tener al menos 8 caracteres.' };
  if (password !== confirm) return { error: 'Las contraseñas no coinciden.' };

  const result = await db.execute<{ ok: boolean }>(
    sql`SELECT app_consume_reset_token(${sha256(token)}, ${await hashPassword(password)}) AS ok`,
  );
  if (!result.rows[0]?.ok) {
    return { error: 'El enlace no es válido o ya expiró (dura 1 hora). Solicita uno nuevo.' };
  }

  redirect('/entrar?reset=1');
}

'use server';

/**
 * eneleje.com · Server Actions de autenticación.
 * Registro con publicación inmediata: crear cuenta → sesión activa → /panel.
 * Anti-bot: honeypot + trampa de tiempo + rate limit + Turnstile (si está configurado).
 */
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db, withUserContext } from '@/db/queries-postgis';
import { roles, users } from '@/db/schema';
import {
  clientIp, createSession, destroySession, hashPassword,
  lookupLogin, touchLastLogin, verifyPassword,
} from '@/lib/auth';
import { rateLimitMem } from '@/lib/rate-limit-mem';
import { esEmail, normText } from '@/lib/validate';
import { verifyTurnstile } from '@/lib/turnstile';
import type { ActionState } from '@/lib/action-state';

/** Armadura común: honeypot + timing. Silenciosa (trata al bot como error genérico). */
function pasoAntiBot(formData: FormData): boolean {
  if (normText(formData.get('sitio_web')) !== '') return false;
  const ts = Number(normText(formData.get('ts')));
  const delta = Date.now() - ts;
  return Number.isFinite(ts) && delta >= 3000 && delta < 86_400_000;
}

export async function registrarAction(_prev: unknown, formData: FormData): Promise<ActionState> {
  const ip = await clientIp();
  if (!rateLimitMem(`reg:${ip}`, 5, 3_600_000)) {
    return { error: 'Demasiados intentos desde tu conexión. Espera una hora.' };
  }
  if (!pasoAntiBot(formData)) return { error: 'No se pudo validar el formulario. Inténtalo de nuevo.' };

  const email = normText(formData.get('email')).toLowerCase();
  const name = normText(formData.get('nombre'));
  const password = typeof formData.get('password') === 'string' ? (formData.get('password') as string) : '';

  if (name.length < 2 || name.length > 120) return { error: 'Escribe tu nombre (2–120 caracteres).' };
  if (!esEmail(email)) return { error: 'El correo electrónico no es válido.' };
  if (password.length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres.' };

  if (!(await verifyTurnstile(normText(formData.get('cf-turnstile-response')) || null, ip))) {
    return { error: 'Falló la verificación anti-bot. Recarga e inténtalo de nuevo.' };
  }

  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.slug, 'owner')).limit(1);
  if (!role) return { error: 'Error interno: rol de comerciante no encontrado.' };

  try {
    // El UUID se genera aquí y el insert corre con contexto RLS: users_select
    // exige app.user_id para el RETURNING de la fila recién creada.
    const userId = crypto.randomUUID();
    await withUserContext(userId, 'owner', async (tx) =>
      tx.insert(users).values({
        id: userId,
        roleId: role.id,
        email,
        passwordHash: await hashPassword(password),
        displayName: name,
      }),
    );

    await createSession({ userId, name, role: 'owner' });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      return { error: 'Ese correo ya tiene una cuenta. Inicia sesión.' };
    }
    return { error: 'No se pudo crear la cuenta. Inténtalo de nuevo.' };
  }

  redirect('/panel?nuevo=1');
}

export async function entrarAction(_prev: unknown, formData: FormData): Promise<ActionState> {
  const ip = await clientIp();
  const email = normText(formData.get('email')).toLowerCase();
  if (!rateLimitMem(`login:${ip}`, 10, 900_000) || !rateLimitMem(`login:${email}`, 5, 900_000)) {
    return { error: 'Demasiados intentos. Espera unos minutos.' };
  }

  const password = typeof formData.get('password') === 'string' ? (formData.get('password') as string) : '';
  const generic = { error: 'Correo o contraseña incorrectos.' };

  const row = email && password ? await lookupLogin(email) : null;
  if (!row || !row.password_hash || row.status !== 'active') return generic;
  if (!(await verifyPassword(password, row.password_hash))) return generic;

  const role = (['owner', 'moderator', 'superadmin'] as const).includes(
    row.role_slug as 'owner',
  )
    ? (row.role_slug as 'owner' | 'moderator' | 'superadmin')
    : 'owner';

  await touchLastLogin(row.id, role);
  await createSession({ userId: row.id, name: row.display_name, role });
  redirect('/panel');
}

export async function salirAction() {
  await destroySession();
  redirect('/');
}

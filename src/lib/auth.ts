/**
 * eneleje.com · Sesión con JWT en cookie httpOnly (jose) + argon2id.
 *
 * El login consulta app_login_lookup() (SECURITY DEFINER en BD) porque la
 * policy users_select impide — a propósito — leer password_hash bajo RLS.
 */
import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { eq, sql } from 'drizzle-orm';
import { db, withUserContext } from '@/db/queries-postgis';
import { users } from '@/db/schema';

const SESSION_COOKIE = 'eneleje_session';
const SESSION_DAYS = 7;
const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? 'dev-inseguro-cambiar-AUTH_SECRET-en-env',
);

export interface Session {
  userId: string;
  name: string;
  role: 'owner' | 'moderator' | 'superadmin';
}

/* -------------------------------- password -------------------------------- */

export function hashPassword(plain: string) {
  return argon2Hash(plain); // @node-rs/argon2 usa Argon2id por defecto
}

export function verifyPassword(plain: string, hash: string) {
  return argon2Verify(hash, plain);
}

/* --------------------------------- sesión --------------------------------- */

export async function createSession(s: Session) {
  const token = await new SignJWT({ name: s.name, role: s.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(s.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub || typeof payload.name !== 'string') return null;
    return {
      userId: payload.sub,
      name: payload.name,
      role: (payload.role as Session['role']) ?? 'owner',
    };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/entrar');
  return session;
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/* ---------------------------------- login --------------------------------- */

// type (no interface): requisito de índice implícito de db.execute<T>
export type LoginRow = {
  id: string;
  password_hash: string | null;
  display_name: string;
  role_slug: string;
  status: 'active' | 'suspended' | 'deleted';
};

export async function lookupLogin(email: string): Promise<LoginRow | null> {
  const result = await db.execute<LoginRow>(
    sql`SELECT * FROM app_login_lookup(${email}) LIMIT 1`,
  );
  return result.rows[0] ?? null;
}

export async function touchLastLogin(userId: string, role: Session['role']) {
  await withUserContext(userId, role, (tx) =>
    tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId)),
  );
}

/* --------------------------- IP para rate limit --------------------------- */

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

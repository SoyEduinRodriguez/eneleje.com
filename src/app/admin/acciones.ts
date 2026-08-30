'use server';

/**
 * eneleje.com · Acciones de administración (solo moderator/superadmin).
 * Crear categorías usa la policy categories_moderate vía withUserContext;
 * las sugerencias se resuelven con app_resolve_suggestion (SECURITY DEFINER).
 */
import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { db, withUserContext } from '@/db/queries-postgis';
import { categories } from '@/db/schema';
import { requireSession } from '@/lib/auth';
import { normText, slugify } from '@/lib/validate';
import type { ActionState } from '@/lib/action-state';

async function requiereModerador() {
  const session = await requireSession();
  if (session.role !== 'moderator' && session.role !== 'superadmin') return null;
  return session;
}

export async function crearCategoriaAction(
  _prev: unknown,
  formData: FormData,
): Promise<ActionState> {
  const session = await requiereModerador();
  if (!session) return { error: 'No tienes permisos de moderación.' };

  const name = normText(formData.get('nombre'));
  const emoji = normText(formData.get('emoji'));
  const description = normText(formData.get('descripcion'));
  const suggestionId = normText(formData.get('suggestion_id'));

  if (name.length < 3 || name.length > 80) {
    return { error: 'El nombre de la categoría debe tener entre 3 y 80 caracteres.' };
  }
  const slug = slugify(name);
  if (!slug) return { error: 'El nombre no permite generar un identificador válido.' };

  try {
    await withUserContext(session.userId, session.role, (tx) =>
      tx.insert(categories).values({
        slug,
        name,
        emoji: emoji || null,
        description: description || null,
      }),
    );
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      return { error: 'Ya existe una categoría con ese identificador.' };
    }
    if (err && typeof err === 'object' && 'code' in err && err.code === '23514') {
      return { error: 'Ese identificador está reservado (www, admin, api…).' };
    }
    return { error: 'No se pudo crear la categoría.' };
  }

  if (suggestionId) {
    await db.execute(
      sql`SELECT app_resolve_suggestion(${suggestionId}::uuid, 'created')`,
    );
  }

  revalidatePath('/admin');
  revalidatePath('/');
  revalidatePath('/panel/negocio/nuevo');
  return { error: null, ok: true };
}

export async function descartarSugerenciaAction(formData: FormData): Promise<void> {
  const session = await requiereModerador();
  if (!session) return;

  const id = normText(formData.get('suggestion_id'));
  if (!id) return;
  await db.execute(sql`SELECT app_resolve_suggestion(${id}::uuid, 'dismissed')`);
  revalidatePath('/admin');
}

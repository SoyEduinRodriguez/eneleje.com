'use server';

/**
 * eneleje.com · Server Actions del menú/catálogo del negocio.
 * La policy catalog_*_owner_manage re-verifica la propiedad en la BD (RLS).
 */
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getMyBusiness, withUserContext } from '@/db/queries-postgis';
import { catalogCategories, catalogItems } from '@/db/schema';
import { requireSession } from '@/lib/auth';
import { normPrecio, normText, slugify } from '@/lib/validate';
import type { ActionState } from '@/lib/action-state';

const negocioInvalido = { error: 'Ese negocio no existe o no te pertenece.' };

/** Garantiza propiedad; devuelve el negocio o el error listo para devolver. */
async function negocioPropio(businessId: string) {
  const session = await requireSession();
  const own = await getMyBusiness(session.userId, businessId);
  return own ? { session, own } : null;
}

export async function crearCategoriaAction(_prev: unknown, formData: FormData): Promise<ActionState> {
  const negocioId = normText(formData.get('negocio_id'));
  const ctx = await negocioPropio(negocioId);
  if (!ctx) return negocioInvalido;

  const name = normText(formData.get('nombre'));
  if (name.length < 2 || name.length > 80) return { error: 'El nombre de la sección debe tener entre 2 y 80 caracteres.' };
  const slug = slugify(name);
  if (!slug) return { error: 'El nombre no permite generar un identificador válido.' };

  try {
    await withUserContext(ctx.session.userId, 'owner', (tx) =>
      tx.insert(catalogCategories).values({ businessId: negocioId, name, slug }),
    );
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
      return { error: 'Ya tienes una sección con ese nombre.' };
    }
    return { error: 'No se pudo crear la sección.' };
  }
  revalidatePath(`/panel/negocio/${negocioId}/catalogo`);
  revalidatePath(`/c/${ctx.own.categorySlug}/${ctx.own.citySlug}/${ctx.own.slug}`);
  return { error: null, ok: true };
}

export async function crearItemAction(_prev: unknown, formData: FormData): Promise<ActionState> {
  const negocioId = normText(formData.get('negocio_id'));
  const ctx = await negocioPropio(negocioId);
  if (!ctx) return negocioInvalido;

  const catId = normText(formData.get('catalog_category_id'));
  const name = normText(formData.get('nombre'));
  const description = normText(formData.get('descripcion'));
  const priceRaw = normText(formData.get('precio'));
  const promoRaw = normText(formData.get('promo_precio'));
  const promoEndsRaw = normText(formData.get('promo_fin'));
  const photoUrl = normText(formData.get('foto_url'));

  if (name.length < 2 || name.length > 120) return { error: 'El nombre del producto debe tener entre 2 y 120 caracteres.' };
  const price = normPrecio(priceRaw);
  if (!price) return { error: 'El precio no es válido. Ej: 12500 o 12500.00' };

  let promoPrice: string | null = null;
  if (promoRaw) {
    promoPrice = normPrecio(promoRaw);
    if (!promoPrice) return { error: 'El precio de promoción no es válido.' };
  }
  let promoEndsAt: Date | null = null;
  if (promoEndsRaw) {
    const d = new Date(promoEndsRaw);
    if (Number.isNaN(d.getTime())) return { error: 'La fecha de fin de la promoción no es válida.' };
    promoEndsAt = d;
  }

  await withUserContext(ctx.session.userId, 'owner', (tx) =>
    tx.insert(catalogItems).values({
      businessId: negocioId,
      catalogCategoryId: catId,
      name,
      description: description || null,
      price,
      promoPrice,
      promoEndsAt,
      photoUrl: photoUrl || null,
    }),
  );

  revalidatePath(`/panel/negocio/${negocioId}/catalogo`);
  revalidatePath(`/c/${ctx.own.categorySlug}/${ctx.own.citySlug}/${ctx.own.slug}`);
  return { error: null, ok: true };
}

export async function alternarItemAction(formData: FormData): Promise<void> {
  const negocioId = normText(formData.get('negocio_id'));
  const itemId = normText(formData.get('item_id'));
  const ctx = await negocioPropio(negocioId);
  if (!ctx || !itemId) return;

  const disponible = normText(formData.get('disponible')) === '1';
  await withUserContext(ctx.session.userId, 'owner', (tx) =>
    tx
      .update(catalogItems)
      .set({ isAvailable: disponible, updatedAt: new Date() })
      .where(and(eq(catalogItems.id, itemId), eq(catalogItems.businessId, negocioId))),
  );
  revalidatePath(`/panel/negocio/${negocioId}/catalogo`);
  revalidatePath(`/c/${ctx.own.categorySlug}/${ctx.own.citySlug}/${ctx.own.slug}`);
}

export async function eliminarItemAction(formData: FormData): Promise<void> {
  const negocioId = normText(formData.get('negocio_id'));
  const itemId = normText(formData.get('item_id'));
  const ctx = await negocioPropio(negocioId);
  if (!ctx || !itemId) return;

  await withUserContext(ctx.session.userId, 'owner', (tx) =>
    tx
      .delete(catalogItems)
      .where(and(eq(catalogItems.id, itemId), eq(catalogItems.businessId, negocioId))),
  );
  revalidatePath(`/panel/negocio/${negocioId}/catalogo`);
  revalidatePath(`/c/${ctx.own.categorySlug}/${ctx.own.citySlug}/${ctx.own.slug}`);
}

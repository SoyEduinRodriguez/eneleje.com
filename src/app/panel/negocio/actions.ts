'use server';

/**
 * eneleje.com · Server Actions del panel: crear y editar negocios.
 * Toda escritura pasa por withUserContext (RLS: businesses_owner_manage).
 */
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import {
  createBusinessAsOwner, db, geogPoint, getCityCentroid, getMyBusiness,
  withUserContext,
} from '@/db/queries-postgis';
import { businesses, categories } from '@/db/schema';
import { clientIp, requireSession } from '@/lib/auth';
import { rateLimitMem } from '@/lib/rate-limit-mem';
import {
  esLat, esLon, normCoord, normPhoneE164, normText,
} from '@/lib/validate';
import type { ActionState } from '@/lib/action-state';

const CONTINGENCY = ['normal', 'delivery_only', 'closed_damage', 'collection_center', 'unknown'] as const;
type Contingency = (typeof CONTINGENCY)[number];

function readCoord(formData: FormData, key: string): number | null {
  const v = normCoord(normText(formData.get(key)));
  return v;
}

export async function crearNegocioAction(_prev: unknown, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const ip = await clientIp();
  if (!rateLimitMem(`biz:${session.userId}:${ip}`, 10, 3_600_000)) {
    return { error: 'Demasiados registros seguidos. Espera un poco.' };
  }

  const name = normText(formData.get('name'));
  const categoryId = Number(normText(formData.get('category_id')));
  const cityId = Number(normText(formData.get('city_id')));
  const whatsapp = normText(formData.get('whatsapp_phone'));
  const phone = normText(formData.get('phone'));
  const address = normText(formData.get('address'));
  const neighborhood = normText(formData.get('neighborhood'));
  const shortDescription = normText(formData.get('short_description'));
  const description = normText(formData.get('description'));

  if (name.length < 3 || name.length > 120) return { error: 'El nombre debe tener entre 3 y 120 caracteres.' };
  if (!Number.isInteger(categoryId) || categoryId <= 0) return { error: 'Elige la categoría que mejor le quede a tu negocio.' };
  if (!Number.isInteger(cityId) || cityId <= 0) return { error: 'Elige la ciudad de tu local.' };
  const whatsappE164 = normPhoneE164(whatsapp);
  if (!whatsappE164) return { error: 'El número de WhatsApp no es válido. Incluye indicativo, ej: +573001112233.' };

  let lat = readCoord(formData, 'lat');
  let lon = readCoord(formData, 'lon');
  if (lat == null || lon == null) {
    const centroid = await getCityCentroid(cityId);
    lat = centroid?.lat ?? 4.8143;
    lon = centroid?.lon ?? -75.6907;
  }
  if (!esLat(lat) || !esLon(lon)) return { error: 'Las coordenadas no son válidas.' };

  // Sugerencia de categoría (si eligió «Otros servicios»)
  const sugerencia = normText(formData.get('sugerencia_categoria'));
  const [catElegida] = await db
    .select({ slug: categories.slug })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  if (!catElegida) return { error: 'La categoría seleccionada no existe.' };
  if (catElegida.slug === 'otros' && !sugerencia) {
    return {
      error:
        'Cuéntanos qué categoría necesita tu negocio para que la moderación la cree (o elige una existente).',
    };
  }

  try {
    const rows = await createBusinessAsOwner(session.userId, {
      categoryId,
      cityId,
      name,
      whatsappPhone: whatsappE164,
      phone: phone ? normPhoneE164(phone) : null,
      address: address || null,
      neighborhood: neighborhood || null,
      shortDescription: shortDescription ? shortDescription.slice(0, 200) : null,
      description: description || null,
      contingencyStatus: 'normal',
      geom: geogPoint(lon, lat), // ⚠ orden (LONGITUD, latitud)
    });
    if (catElegida.slug === 'otros' && sugerencia) {
      await db.execute(
        sql`SELECT app_suggest_category(${rows[0].id}::uuid, ${sugerencia})`,
      );
    }
    revalidatePath('/panel');
    redirect(`/panel/negocio/${rows[0].id}?creado=1`);
  } catch (err) {
    if (err && typeof err === 'object' && 'digest' in err) throw err; // NEXT_REDIRECT
    return { error: 'No se pudo registrar el negocio. Revisa los datos e inténtalo de nuevo.' };
  }
}

export async function guardarNegocioAction(_prev: unknown, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const businessId = normText(formData.get('business_id'));
  if (!businessId) return { error: 'Falta el identificador del negocio.' };

  // Verificación de propiedad + respuesta (RLS vuelve a aplicar en el UPDATE).
  const own = await getMyBusiness(session.userId, businessId);
  if (!own) return { error: 'Ese negocio no existe o no te pertenece.' };

  const name = normText(formData.get('name'));
  const whatsapp = normText(formData.get('whatsapp_phone'));
  if (name.length < 3 || name.length > 120) return { error: 'El nombre debe tener entre 3 y 120 caracteres.' };
  const whatsappE164 = normPhoneE164(whatsapp);
  if (!whatsappE164) return { error: 'El número de WhatsApp no es válido.' };

  const contingencyRaw = normText(formData.get('contingency_status')) as Contingency;
  const contingency = CONTINGENCY.includes(contingencyRaw) ? contingencyRaw : 'unknown';
  const phone = normText(formData.get('phone'));

  const lat = readCoord(formData, 'lat');
  const lon = readCoord(formData, 'lon');
  if (lat != null && !esLat(lat)) return { error: 'La latitud no es válida.' };
  if (lon != null && !esLon(lon)) return { error: 'La longitud no es válida.' };

  const set: Partial<typeof businesses.$inferInsert> = {
    name,
    whatsappPhone: whatsappE164,
    phone: phone ? normPhoneE164(phone) : null,
    address: normText(formData.get('address')) || null,
    neighborhood: normText(formData.get('neighborhood')) || null,
    shortDescription: normText(formData.get('short_description')).slice(0, 200) || null,
    description: normText(formData.get('description')) || null,
    contingencyStatus: contingency,
    contingencyNote: normText(formData.get('contingency_note')).slice(0, 280) || null,
    websiteUrl: normText(formData.get('website_url')).slice(0, 300) || null,
    instagramUrl: normText(formData.get('instagram_url')).slice(0, 300) || null,
    facebookUrl: normText(formData.get('facebook_url')).slice(0, 300) || null,
    tiktokUrl: normText(formData.get('tiktok_url')).slice(0, 300) || null,
    updatedAt: new Date(),
  };

  // Re-categorización (p. ej. cuando se aprueba la categoría que sugirió)
  const newCategoryId = Number(normText(formData.get('category_id')));
  if (Number.isInteger(newCategoryId) && newCategoryId > 0 && newCategoryId !== own.categoryId) {
    const [cat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, newCategoryId))
      .limit(1);
    if (!cat) return { error: 'La categoría seleccionada no existe.' };
    set.categoryId = newCategoryId;
  }

  if (lat != null && lon != null) set.geom = geogPoint(lon, lat);

  await withUserContext(session.userId, 'owner', (tx) =>
    tx.update(businesses).set(set).where(eq(businesses.id, businessId)),
  );

  revalidatePath('/panel');
  revalidatePath(`/c/${own.categorySlug}/${own.citySlug}/${own.slug}`);
  redirect(`/panel/negocio/${businessId}?ok=1`);
}

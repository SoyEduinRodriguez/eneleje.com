/**
 * eneleje.com · Validación ligera de entrada (sin dependencias).
 * Mensajes de error listos para mostrar al comerciante.
 */

export function normText(v: FormDataEntryValue | null): string {
  return typeof v === 'string' ? v.trim() : '';
}

const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function esEmail(v: string): boolean {
  return RE_EMAIL.test(v) && v.length <= 254;
}

/** Acepta +57..., 57..., o 10 dígitos locales colombianos; devuelve E.164 o null. */
export function normPhoneE164(v: string): string | null {
  const digits = v.replace(/[^\d+]/g, '');
  let e164: string;
  if (digits.startsWith('+')) e164 = digits;
  else if (digits.startsWith('57') && digits.length > 10) e164 = `+${digits}`;
  else e164 = `+57${digits}`; // país por defecto (proyecto: Eje Cafetero)
  if (!/^\+\d{8,15}$/.test(e164)) return null;
  return e164;
}

export function normCoord(v: string): number | null {
  if (!v) return null;
  const n = Number(v.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return n;
}
export function esLat(v: number): boolean { return v >= -90 && v <= 90; }
export function esLon(v: number): boolean { return v >= -180 && v <= 180; }

const RE_PRECIO = /^\d{1,10}(\.\d{1,2})?$/;
export function normPrecio(v: string): string | null {
  if (!v) return null;
  const n = v.replace(/[.\s]/g, '').replace(',', '.'); // acepta "12.500,00" → "12500.00"
  return RE_PRECIO.test(n) ? n : null;
}

/** slug simple para catalog_categories (los negocios usan el trigger de BD). */
export function slugify(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

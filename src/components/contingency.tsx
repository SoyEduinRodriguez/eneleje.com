import type { BusinessSearchRow } from '@/db/queries-postgis';

const CONTINGENCY_META: Record<
  BusinessSearchRow['contingency_status'],
  { label: string; className: string }
> = {
  normal: {
    label: 'Operando normal',
    className: 'border-green-200 bg-green-50 text-green-800',
  },
  delivery_only: {
    label: 'Solo a domicilio',
    className: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  closed_damage: {
    label: 'Cerrado por daños',
    className: 'border-red-200 bg-red-50 text-red-800',
  },
  collection_center: {
    label: 'Centro de acopio',
    className: 'border-sky-200 bg-sky-50 text-sky-800',
  },
  unknown: {
    label: 'Estado por confirmar',
    className: 'border-slate-200 bg-slate-50 text-slate-600',
  },
};

export function ContingencyBadge({
  status,
  note,
}: {
  status: BusinessSearchRow['contingency_status'];
  note?: string | null;
}) {
  const meta = CONTINGENCY_META[status] ?? CONTINGENCY_META.unknown;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.className}`}
      title={note ?? undefined}
    >
      {meta.label}
    </span>
  );
}

/** 850 → "850 m" · 2894 → "2.9 km" */
export function formatDistance(meters: number | null): string | null {
  if (meters == null || Number.isNaN(meters)) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** "+573001112233" → link wa.me con mensaje prellenado. */
export function whatsappLink(phone: string, businessName: string) {
  const digits = phone.replace(/\D/g, '');
  const text = encodeURIComponent(`Hola ${businessName}, los vi en eneleje.com. ¿Están operando?`);
  return `https://wa.me/${digits}?text=${text}`;
}

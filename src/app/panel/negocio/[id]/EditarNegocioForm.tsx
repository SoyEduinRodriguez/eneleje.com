'use client';

import { useActionState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { guardarNegocioAction } from '../actions';
import { Field, SelectField, TextArea, Honeypot, FormError, FormOk } from '@/components/ui';
import { GeoButton, SubmitButton } from '@/components/client-bits';
import type { MyBusiness } from '@/db/queries-postgis';

const CONTINGENCIA = [
  { value: 'normal', label: '🟢 Operando normal' },
  { value: 'delivery_only', label: '🟡 Solo a domicilio' },
  { value: 'closed_damage', label: '🔴 Cerrado por daños' },
  { value: 'collection_center', label: '🔵 Centro de acopio' },
  { value: 'unknown', label: '⚪ Estado por confirmar' },
];

export function EditarNegocioForm({
  biz,
  categorias,
}: {
  biz: MyBusiness;
  categorias: { id: number; name: string; emoji: string | null }[];
}) {
  const [state, action] = useActionState(guardarNegocioAction, { error: null });
  const tsRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (tsRef.current) tsRef.current.value = String(Date.now());
  }, []);

  return (
    <form action={action} className="relative space-y-6">
      <Honeypot />
      <input type="hidden" name="ts" ref={tsRef} />
      <input type="hidden" name="business_id" value={biz.id} />

      <fieldset className="space-y-4 rounded-xl border border-amber-300 bg-amber-50/50 p-4">
        <legend className="px-1 text-sm font-semibold text-amber-900">
          Estado de contingencia (lo que más verán tus clientes)
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="¿Cómo opera hoy?"
            name="contingency_status"
            options={CONTINGENCIA}
            defaultValue={biz.contingencyStatus}
            hint="Actualízalo tras una emergencia: es la información que la comunidad más necesita."
          />
          <Field
            label="Nota breve de contingencia"
            name="contingency_note"
            defaultValue={biz.contingencyNote ?? ''}
            maxLength={280}
            placeholder="Ej: Abrimos con horario normal desde el 10 de junio."
          />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-slate-800">Datos del anuncio</legend>
        <Field label="Nombre del negocio" name="name" required defaultValue={biz.name} />
        <SelectField
          label="Categoría"
          name="category_id"
          options={categorias.map((c) => ({ value: String(c.id), label: `${c.emoji ?? '🏪'} ${c.name}` }))}
          defaultValue={String(biz.categoryId)}
          hint={`Hoy tu anuncio vive en ${biz.categoryName}. Cambiarla actualiza tu enlace público y tu subdominio.`}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="WhatsApp"
            name="whatsapp_phone"
            required
            inputMode="tel"
            defaultValue={biz.whatsappPhone}
            autoComplete="tel"
          />
          <Field label="Teléfono fijo (opcional)" name="phone" inputMode="tel" defaultValue={biz.phone ?? ''} />
        </div>
        <Field label="Descripción corta" name="short_description" maxLength={200} defaultValue={biz.shortDescription ?? ''} />
        <TextArea label="Descripción completa" name="description" rows={4} defaultValue={biz.description ?? ''} />
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-slate-800">Ubicación</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dirección" name="address" defaultValue={biz.address ?? ''} />
          <Field label="Barrio / sector" name="neighborhood" defaultValue={biz.neighborhood ?? ''} />
        </div>
        <GeoButton latId="lat-edit" lonId="lon-edit" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Latitud"
            name="lat"
            inputId="lat-edit"
            inputMode="decimal"
            defaultValue={biz.lat ? String(biz.lat) : ''}
          />
          <Field
            label="Longitud"
            name="lon"
            inputId="lon-edit"
            inputMode="decimal"
            defaultValue={biz.lon ? String(biz.lon) : ''}
          />
        </div>
        <p className="text-xs text-slate-500">
          Si dejas los campos vacíos, se conserva la ubicación actual
          ({biz.lat.toFixed(5)}, {biz.lon.toFixed(5)}).
        </p>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-slate-800">Enlaces del negocio</legend>
        <Field label="Sitio web" name="website_url" inputMode="url" defaultValue={biz.websiteUrl ?? ''} placeholder="https://…" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Instagram" name="instagram_url" defaultValue={biz.instagramUrl ?? ''} placeholder="https://instagram.com/…" />
          <Field label="Facebook" name="facebook_url" defaultValue={biz.facebookUrl ?? ''} placeholder="https://facebook.com/…" />
          <Field label="TikTok" name="tiktok_url" defaultValue={biz.tiktokUrl ?? ''} placeholder="https://tiktok.com/@…" />
        </div>
      </fieldset>

      <FormError message={state.error} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Guardar cambios</SubmitButton>
        <Link
          href={`/c/${biz.categorySlug}/${biz.citySlug}/${biz.slug}`}
          className="text-sm font-medium text-slate-500 hover:text-emerald-700 hover:underline"
        >
          Ver mi anuncio público ↗
        </Link>
      </div>
    </form>
  );
}

export function OkBanner({ show, text }: { show: boolean; text: string }) {
  return <FormOk message={show ? text : null} />;
}

'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { crearNegocioAction } from '../actions';
import { Field, SelectField, TextArea, Honeypot, FormError } from '@/components/ui';
import { GeoButton, SubmitButton } from '@/components/client-bits';

interface Opcion { id: number; name: string; slug: string; emoji?: string | null }

export function NuevoNegocioForm({
  categorias,
  ciudades,
}: {
  categorias: Opcion[];
  ciudades: { id: number; nombre: string }[];
}) {
  const [state, action] = useActionState(crearNegocioAction, { error: null });
  const tsRef = useRef<HTMLInputElement>(null);
  const [categoriaElegida, setCategoriaElegida] = useState<string>('');
  useEffect(() => {
    if (tsRef.current) tsRef.current.value = String(Date.now());
  }, []);

  const esOtros = categorias.find((c) => String(c.id) === categoriaElegida)?.slug === 'otros';

  return (
    <form action={action} className="relative space-y-4">
      <Honeypot />
      <input type="hidden" name="ts" ref={tsRef} />

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-slate-800">Lo esencial</legend>
        <Field label="Nombre del negocio" name="name" required placeholder="Panadería La Espiga Dorada" />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Categoría (será tu subdominio) <span className="text-rose-600">*</span>
            </span>
            <select
              name="category_id"
              required
              value={categoriaElegida}
              onChange={(e) => setCategoriaElegida(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            >
              {categorias.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.emoji ?? '🏪'} {c.name}
                </option>
              ))}
            </select>
          </label>
          <SelectField
            label="Ciudad del local"
            name="city_id"
            required
            options={ciudades.map((c) => ({ value: String(c.id), label: c.nombre }))}
          />
        </div>
        {esOtros && (
          <Field
            label="¿Qué categoría necesita tu negocio?"
            name="sugerencia_categoria"
            required
            maxLength={120}
            placeholder="Ej: Consulta médica, Spa, Centro recreacional…"
            hint="Un moderador la revisará y creará la categoría. Mientras tanto aparecerás en «Otros servicios» y podrás cambiar de categoría desde tu panel."
          />
        )}
        <Field
          label="WhatsApp del negocio"
          name="whatsapp_phone"
          required
          inputMode="tel"
          placeholder="+573001112233"
          hint="Con indicativo. Por aquí te escribirán los clientes."
          autoComplete="tel"
        />
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-slate-800">Cómo encontrarte</legend>
        <Field label="Dirección" name="address" placeholder="Calle 14 #23-45" hint="Opcional, pero ayuda muchísimo." />
        <Field label="Barrio / sector" name="neighborhood" placeholder="El Óso" />
        <Field label="Teléfono fijo (opcional)" name="phone" inputMode="tel" placeholder="606 1234567" />
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">
            Ubicación exacta (opcional): si no la das, usamos el centro de la ciudad.
            Puedes capturarla con el GPS del celular desde tu local.
          </p>
          <GeoButton latId="lat" lonId="lon" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Latitud" name="lat" inputId="lat" inputMode="decimal" placeholder="4.814300" />
            <Field label="Longitud" name="lon" inputId="lon" inputMode="decimal" placeholder="-75.690700" />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-slate-800">Tu anuncio</legend>
        <Field
          label="Descripción corta"
          name="short_description"
          maxLength={200}
          placeholder="Pan artesanal, pandebono y café desde las 6 a.m."
        />
        <TextArea
          label="Descripción completa"
          name="description"
          rows={4}
          placeholder="Cuenta qué ofreces, formas de pago, si hacen domicilios…"
        />
      </fieldset>

      <FormError message={state.error} />
      <SubmitButton className="w-full" pendingLabel="Publicando…">
        Publicar mi negocio ahora
      </SubmitButton>
    </form>
  );
}

'use client';

import { useActionState, useEffect, useRef } from 'react';
import { crearCategoriaAction, crearItemAction } from './actions';
import { Field, SelectField, TextArea, Honeypot, FormError, FormOk } from '@/components/ui';
import { SubmitButton } from '@/components/client-bits';

function useTimestamp() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.value = String(Date.now());
  }, []);
  return ref;
}

export function NuevaSeccionForm({ negocioId }: { negocioId: string }) {
  const [state, action] = useActionState(crearCategoriaAction, { error: null });
  const tsRef = useTimestamp();

  return (
    <form action={action} className="relative flex flex-wrap items-end gap-2">
      <Honeypot />
      <input type="hidden" name="ts" ref={tsRef} />
      <input type="hidden" name="negocio_id" value={negocioId} />
      <div className="min-w-48 flex-1">
        <Field label="Nueva sección del menú" name="nombre" placeholder="Bebidas, Combos, Postres…" required />
      </div>
      <SubmitButton pendingLabel="Creando…">+ Crear sección</SubmitButton>
      <FormError message={state.error} />
      <FormOk message={state.ok ? 'Sección creada.' : null} />
    </form>
  );
}

export function NuevoProductoForm({
  negocioId,
  secciones,
}: {
  negocioId: string;
  secciones: { value: string; label: string }[];
}) {
  const [state, action] = useActionState(crearItemAction, { error: null });
  const tsRef = useTimestamp();

  return (
    <form action={action} className="relative space-y-4">
      <Honeypot />
      <input type="hidden" name="ts" ref={tsRef} />
      <input type="hidden" name="negocio_id" value={negocioId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Sección" name="catalog_category_id" required options={secciones} />
        <Field label="Producto" name="nombre" required placeholder="Pandebono de queso" />
      </div>
      <TextArea label="Descripción (opcional)" name="descripcion" rows={2} placeholder="Unidad, ingredientes, tamaño…" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Precio (COP)" name="precio" required inputMode="decimal" placeholder="2500" />
        <Field label="Precio promo (opcional)" name="promo_precio" inputMode="decimal" placeholder="2000" />
        <Field label="Promo vigente hasta (opcional)" name="promo_fin" type="date" />
      </div>
      <Field label="Foto (URL, opcional)" name="foto_url" inputMode="url" placeholder="https://… — la subida directa llega con R2" />

      <FormError message={state.error} />
      <SubmitButton>+ Añadir al menú</SubmitButton>
    </form>
  );
}

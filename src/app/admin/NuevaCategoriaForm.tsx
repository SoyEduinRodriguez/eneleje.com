'use client';

import { useActionState } from 'react';
import { crearCategoriaAction } from './acciones';
import { Field, TextArea, FormError, FormOk } from '@/components/ui';
import { SubmitButton } from '@/components/client-bits';

export function NuevaCategoriaForm({ suggestion }: { suggestion?: { id: string; name: string } }) {
  const [state, action] = useActionState(crearCategoriaAction, { error: null });

  return (
    <form action={action} className="space-y-3">
      {suggestion && <input type="hidden" name="suggestion_id" value={suggestion.id} />}
      <div className="grid gap-3 sm:grid-cols-[1fr_5rem]">
        <Field
          label="Nombre de la categoría"
          name="nombre"
          required
          defaultValue={suggestion?.name ?? ''}
          placeholder="Spas y bienestar"
        />
        <Field label="Emoji" name="emoji" placeholder="💆" maxLength={8} />
      </div>
      <TextArea
        label="Descripción corta (opcional)"
        name="descripcion"
        rows={2}
        placeholder="Masajes, spa y servicios de relajación."
      />
      <FormError message={state.error} />
      <FormOk message={state.ok ? '✓ Categoría creada. Ya está disponible en el registro y en el home.' : null} />
      <SubmitButton>{suggestion ? 'Aprobar y crear categoría' : 'Crear categoría'}</SubmitButton>
    </form>
  );
}

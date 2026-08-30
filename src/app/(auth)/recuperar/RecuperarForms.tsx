'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { solicitarRecuperacionAction, restablecerAction } from './acciones';
import { Field, FormError, FormOk } from '@/components/ui';
import { SubmitButton } from '@/components/client-bits';

export function SolicitarForm() {
  const [state, action] = useActionState(solicitarRecuperacionAction, { error: null });

  return (
    <form action={action} className="space-y-4">
      <Field label="Correo de tu cuenta" name="email" type="email" required inputMode="email" autoComplete="email" />
      <FormError message={state.error} />
      <FormOk message={state.ok} />
      {state.link && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 break-all">
          <a href={state.link} className="font-semibold underline">
            {state.link}
          </a>
        </p>
      )}
      <SubmitButton className="w-full" pendingLabel="Generando…">
        Generar enlace de recuperación
      </SubmitButton>
      <p className="text-center text-sm text-slate-500">
        <Link href="/entrar" className="hover:underline">
          Volver a iniciar sesión
        </Link>
      </p>
    </form>
  );
}

export function RestablecerForm({ token }: { token: string }) {
  const [state, action] = useActionState(restablecerAction, { error: null });

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field label="Nueva contraseña" name="password" type="password" required hint="Mínimo 8 caracteres." autoComplete="new-password" />
      <Field label="Repite la nueva contraseña" name="confirm" type="password" required autoComplete="new-password" />
      <FormError message={state.error} />
      <SubmitButton className="w-full" pendingLabel="Guardando…">
        Guardar contraseña
      </SubmitButton>
    </form>
  );
}

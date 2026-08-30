'use client';

import { useActionState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { entrarAction } from '../acciones';
import { Field, Honeypot, FormError } from '@/components/ui';
import { SubmitButton, TurnstileWidget } from '@/components/client-bits';

export function EntrarForm() {
  const [state, action] = useActionState(entrarAction, { error: null });
  const tsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (tsRef.current) tsRef.current.value = String(Date.now());
  }, []);

  return (
    <form action={action} className="relative space-y-4">
      <Honeypot />
      <input type="hidden" name="ts" ref={tsRef} />

      <Field label="Correo electrónico" name="email" type="email" required autoComplete="email" inputMode="email" />
      <Field label="Contraseña" name="password" type="password" required autoComplete="current-password" />

      <TurnstileWidget />
      <FormError message={state.error} />

      <SubmitButton className="w-full" pendingLabel="Entrando…">
        Entrar
      </SubmitButton>

      <p className="text-center text-sm text-slate-500">
        ¿Olvidaste tu contraseña?{' '}
        <Link href="/recuperar" className="font-medium text-emerald-700 hover:underline">
          Recupérala
        </Link>
        {' · '}
        ¿Aún no tienes cuenta?{' '}
        <Link href="/registro" className="font-medium text-emerald-700 hover:underline">
          Registra tu negocio
        </Link>
      </p>
    </form>
  );
}

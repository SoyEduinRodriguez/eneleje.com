'use client';

import { useActionState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { registrarAction } from '../acciones';
import { Field, Honeypot, FormError } from '@/components/ui';
import { SubmitButton, TurnstileWidget } from '@/components/client-bits';

export function RegistroForm() {
  const [state, action] = useActionState(registrarAction, { error: null });
  const tsRef = useRef<HTMLInputElement>(null);

  // Marca de tiempo real del render del cliente (trampa anti-bot de 3 s).
  useEffect(() => {
    if (tsRef.current) tsRef.current.value = String(Date.now());
  }, []);

  return (
    <form action={action} className="relative space-y-4">
      <Honeypot />
      <input type="hidden" name="ts" ref={tsRef} />

      <Field label="Tu nombre" name="nombre" required placeholder="Ana Restrepo" autoComplete="name" />
      <Field label="Correo electrónico" name="email" type="email" required placeholder="tu@correo.com" autoComplete="email" inputMode="email" />
      <Field
        label="Contraseña"
        name="password"
        type="password"
        required
        hint="Mínimo 8 caracteres. La usas para entrar a tu panel."
        autoComplete="new-password"
      />

      <TurnstileWidget />
      <FormError message={state.error} />

      <SubmitButton className="w-full" pendingLabel="Creando cuenta…">
        Crear mi cuenta
      </SubmitButton>

      <p className="text-center text-sm text-slate-500">
        ¿Ya tienes cuenta?{' '}
        <Link href="/entrar" className="font-medium text-emerald-700 hover:underline">
          Inicia sesión
        </Link>
      </p>
    </form>
  );
}

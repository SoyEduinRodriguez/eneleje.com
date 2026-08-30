import type { Metadata } from 'next';
import { SolicitarForm, RestablecerForm } from './RecuperarForms';
import { Card } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Recuperar contraseña',
  robots: { index: false, follow: true },
};

export default async function RecuperarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const token = typeof sp.token === 'string' ? sp.token : '';

  return (
    <div className="mx-auto max-w-md space-y-6 py-4">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Recuperar contraseña</h1>
        <p className="text-sm text-slate-600">
          {token
            ? 'Escribe tu nueva contraseña. El enlace dura 1 hora y se usa una sola vez.'
            : 'Te generamos un enlace para restablecer tu contraseña. Dura 1 hora.'}
        </p>
      </header>

      <Card>{token ? <RestablecerForm token={token} /> : <SolicitarForm />}</Card>
    </div>
  );
}

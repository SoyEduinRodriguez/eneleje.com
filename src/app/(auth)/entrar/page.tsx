import type { Metadata } from 'next';
import { EntrarForm } from './EntrarForm';
import { Card, FormOk } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Inicia sesión',
  robots: { index: false, follow: true },
};

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  return (
    <div className="mx-auto max-w-md space-y-6 py-4">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Panel del comerciante</h1>
        <p className="text-sm text-slate-600">
          Actualiza tu contingencia, tu menú y mantén tu anuncio al día.
        </p>
      </header>

      {sp.reset === '1' && (
        <FormOk message="✓ Contraseña actualizada. Entra con la nueva." />
      )}

      <Card>
        <EntrarForm />
      </Card>
    </div>
  );
}

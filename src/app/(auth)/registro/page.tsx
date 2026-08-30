import Link from 'next/link';
import type { Metadata } from 'next';
import { RegistroForm } from './RegistroForm';
import { Card } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Registra tu negocio — gratis e inmediato',
  description:
    'Crea la cuenta de tu negocio, publica tu anuncio en minutos y mantente visible para tu comunidad. Gratis.',
  robots: { index: false, follow: true },
};

export default function RegistroPage() {
  return (
    <div className="mx-auto max-w-md space-y-6 py-4">
      <header className="space-y-2 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Registra tu negocio</h1>
        <p className="text-sm text-slate-600">
          Gratis, sin aprobaciones: publicas al instante y la comunidad ayuda a
          mantener la información al día.
        </p>
      </header>

      <Card>
        <RegistroForm />
      </Card>

      <p className="text-center text-xs text-slate-400">
        <Link href="/" className="hover:underline">
          Volver al inicio
        </Link>
      </p>
    </div>
  );
}

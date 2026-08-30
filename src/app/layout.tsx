import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://eneleje.com';

export const metadata: Metadata = {
  metadataBase: new URL(BASE),
  title: {
    default: 'eneleje.com — Qué está abierto en el Eje Cafetero | Directorio de negocios',
    template: '%s · eneleje.com',
  },
  description:
    'Directorio de negocios del Eje Cafetero con estado de contingencia en tiempo real: qué panaderías, ferreterías y restaurantes están abiertos, solo a domicilio o cerrados. Publica el tuyo gratis.',
  keywords: [
    'negocios abiertos Pereira',
    'directorio Eje Cafetero',
    'qué está abierto después del sismo',
    'negocios Eje Cafetero',
    'domicilios Pereira',
    'centros de acopio',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'es_CO',
    siteName: 'eneleje.com',
    url: BASE,
    title: 'eneleje.com — Qué está abierto en el Eje Cafetero',
    description:
      'Negocios abiertos, a domicilio o cerrados por emergencia, en tiempo real y cerca de ti. Publica el tuyo gratis.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'eneleje.com — Qué está abierto en el Eje Cafetero',
    description:
      'Negocios abiertos, a domicilio o cerrados por emergencia, en tiempo real y cerca de ti.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO">
      <body className="min-h-dvh flex flex-col">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight text-slate-900">
              en<span className="text-emerald-600">eleje</span>.com
            </Link>
            <div className="flex items-center gap-3">
              <Link
                href="/entrar"
                className="hidden text-sm font-medium text-slate-600 hover:text-emerald-700 sm:block"
              >
                Iniciar sesión
              </Link>
              <Link
                href="/registro"
                className="rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                Publicar mi negocio
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>

        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 py-4 text-xs text-slate-500">
            eneleje.com — directorio auto-mantenido por la comunidad. Los negocios se
            publican al instante y se moderan con reportes de los usuarios.
          </div>
        </footer>
      </body>
    </html>
  );
}

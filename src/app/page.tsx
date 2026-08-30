import Link from 'next/link';
import { listCategoriesWithCounts } from '@/db/queries-postgis';

export const dynamic = 'force-dynamic'; // las cifras de categorías viven en BD

const FAQ = [
  {
    q: '¿Para qué sirve eneleje.com?',
    a: 'Es un directorio de negocios del Eje Cafetero pensado para emergencias y para el día a día: te dice qué panaderías, ferreterías, farmacias o restaurantes están operando cerca de ti, con su estado real (abierto, solo domicilios, cerrado por daños o centro de acopio).',
  },
  {
    q: '¿Cómo funciona?',
    a: 'Cada negocio se registra gratis, elige su categoría y su anuncio se publica de inmediato. El propio dueño actualiza su estado de contingencia y su menú, y la comunidad puede reportar datos falsos: cuando los reportes superan un umbral, el anuncio se suspende automáticamente hasta revisión.',
  },
  {
    q: '¿Cuánto cuesta publicar mi negocio?',
    a: 'Hoy todo es gratis: perfil, menú, enlaces de WhatsApp y estadísticas básicas. Más adelante habrá un plan premium con extras, pero el anuncio básico seguirá siendo gratuito.',
  },
  {
    q: '¿Qué es el "estado de contingencia"?',
    a: 'Después de un sismo o emergencia, lo más valioso es saber quién sí puede atenderte. Cada negocio marca si opera normal, si solo hace domicilios, si está cerrado por daños o si funciona como centro de acopio de ayuda.',
  },
  {
    q: '¿Puedo confiar en la información?',
    a: 'Los anuncios son administrados por sus dueños, que son los más interesados en que los encuentren. Los reportes de la comunidad y las verificaciones del equipo mantienen el directorio limpio: el abuso se detecta y se sanciona automáticamente.',
  },
  {
    q: '¿Qué ciudades cubre?',
    a: 'Arrancamos con Pereira y el Eje Cafetero (Dosquebradas, Santa Rosa, Marsella, y las principales ciudades de Quindío y Caldas). Si tu ciudad no aparece, escríbenos y la agregamos.',
  },
];

export default async function HomePage() {
  const categories = await listCategoriesWithCounts();
  const conNegocios = categories.filter((c) => c.negocios > 0);

  // Datos estructurados: identidad del sitio + preguntas frecuentes (rich results).
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: 'eneleje.com',
        url: 'https://eneleje.com',
        inLanguage: 'es-CO',
        description:
          'Directorio de negocios abiertos del Eje Cafetero con estado de contingencia en tiempo real.',
      },
      {
        '@type': 'Organization',
        name: 'eneleje.com',
        url: 'https://eneleje.com',
        areaServed: 'Eje Cafetero, Colombia',
      },
      {
        '@type': 'FAQPage',
        mainEntity: FAQ.map((f) => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };

  return (
    <div className="space-y-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="space-y-5 pt-4 text-center sm:pt-10">
        <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">
          Eje Cafetero · directorio local
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          ¿Qué está <span className="text-emerald-600">abierto ahora mismo</span> cerca de ti?
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-slate-600">
          Tras una emergencia (y todos los días), lo urgente es saber qué negocios sí
          están operando: panaderías, ferreterías, farmacias y más, con su estado real
          y su WhatsApp directo.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {conNegocios.length > 0 ? (
            <Link
              href="#categorias"
              className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white transition hover:bg-emerald-700"
            >
              Explorar negocios abiertos
            </Link>
          ) : null}
          <Link
            href="/registro"
            className="rounded-xl border-2 border-emerald-600 px-6 py-3 font-semibold text-emerald-700 transition hover:bg-emerald-50"
          >
            Publicar mi negocio (gratis)
          </Link>
        </div>
      </section>

      {/* ── Cómo funciona ────────────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-center text-2xl font-bold tracking-tight">
          ¿Cómo funciona eneleje.com?
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Paso
            emoji="🏪"
            titulo="1. El negocio se registra"
            texto="Gratis y sin aprobaciones: nombre, categoría, ciudad y WhatsApp. El anuncio aparece publicado al instante."
          />
          <Paso
            emoji="🟡"
            titulo="2. Marca su estado real"
            texto="El dueño mantiene su contingencia al día: operando normal, solo domicilios, cerrado por daños o centro de acopio."
          />
          <Paso
            emoji="🛡️"
            titulo="3. La comunidad lo mantiene"
            texto="¿Datos falsos? Se reporta y, al pasar el umbral de denuncias, el anuncio se suspende solo hasta revisión."
          />
        </div>
      </section>

      {/* ── Categorías ───────────────────────────────────────────────────── */}
      <section id="categorias" className="space-y-5 scroll-mt-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold tracking-tight">Explora por categoría</h2>
          <p className="mt-1 text-slate-600">
            Cada categoría tiene su propio subdominio:{' '}
            <span className="font-mono text-sm text-slate-500">panaderias.eneleje.com</span>
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/c/${cat.slug}`}
              className="group rounded-xl border border-slate-200 bg-white p-5 transition hover:border-emerald-400 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="text-3xl">{cat.emoji ?? '🏪'}</span>
                {cat.negocios > 0 ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                    {cat.negocios} operando
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">
                    sé el primero
                  </span>
                )}
              </div>
              <h3 className="mt-3 font-semibold text-slate-900 group-hover:text-emerald-700">
                {cat.name}
              </h3>
              {cat.description && (
                <p className="mt-1 line-clamp-2 text-sm text-slate-500">{cat.description}</p>
              )}
            </Link>
          ))}
        </div>
      </section>

      {/* ── Para negocios ────────────────────────────────────────────────── */}
      <section className="rounded-2xl bg-slate-900 px-6 py-10 text-center text-white sm:px-10">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          ¿Tienes un negocio en el Eje Cafetero?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-slate-300">
          Publica tu anuncio en 2 minutos, comparte tu enlace de WhatsApp, monta tu
          menú con promociones y avísale a tu comunidad cuando cambie tu estado de
          apertura. Gratis, siempre, mientras arranque la economía.
        </p>
        <Link
          href="/registro"
          className="mt-6 inline-block rounded-xl bg-emerald-500 px-8 py-3.5 font-semibold text-white transition hover:bg-emerald-400"
        >
          Registrar mi negocio ahora
        </Link>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl space-y-4">
        <h2 className="text-center text-2xl font-bold tracking-tight">
          Preguntas frecuentes
        </h2>
        {FAQ.map((f) => (
          <details
            key={f.q}
            className="group rounded-xl border border-slate-200 bg-white p-4 open:shadow-sm"
          >
            <summary className="cursor-pointer list-none font-medium text-slate-900 marker:hidden">
              <span className="mr-2 text-emerald-600 group-open:hidden">＋</span>
              <span className="mr-2 hidden text-emerald-600 group-open:inline">－</span>
              {f.q}
            </summary>
            <p className="mt-2 pl-6 text-sm leading-relaxed text-slate-600">{f.a}</p>
          </details>
        ))}
      </section>
    </div>
  );
}

function Paso({ emoji, titulo, texto }: { emoji: string; titulo: string; texto: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 text-left">
      <span className="text-3xl">{emoji}</span>
      <h3 className="mt-2 font-semibold text-slate-900">{titulo}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{texto}</p>
    </div>
  );
}

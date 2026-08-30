import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getMyBusiness } from '@/db/queries-postgis';
import { requireSession } from '@/lib/auth';
import { Card, PageHeader } from '@/components/ui';
import { CopyButton } from '@/components/client-bits';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Compartir negocio', robots: { index: false } };

export default async function CompartirPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const biz = await getMyBusiness(session.userId, id);
  if (!biz) notFound();

  const h = await headers();
  const host = h.get('host') ?? 'eneleje.com';
  const proto = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  const publicUrl = `${proto}://${host}/c/${biz.categorySlug}/${biz.citySlug}/${biz.slug}`;

  const waText = encodeURIComponent(
    `Mirá ${biz.name} en eneleje.com: ${publicUrl}`,
  );
  const links = [
    {
      titulo: 'Enlace de tu anuncio',
      desc: 'Compártelo en estados, grupos y carteles con QR.',
      url: publicUrl,
    },
    {
      titulo: 'Invitar por WhatsApp',
      desc: 'Abre WhatsApp con el mensaje listo para reenviar.',
      url: `https://wa.me/?text=${waText}`,
      cta: 'Abrir WhatsApp',
    },
    {
      titulo: 'Cómo llegar (Google Maps)',
      desc: 'Ubicación exacta de tu local según las coordenadas guardadas.',
      url: `https://www.google.com/maps?q=${biz.lat},${biz.lon}`,
      cta: 'Abrir mapa',
    },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title={`Compartir ${biz.name}`}
        subtitle="Cuanto más lo compartas, más rápido se entera tu comunidad de que estás operando."
        back={{ href: `/panel/negocio/${id}`, label: 'Editar negocio' }}
      />

      {links.map((l) => (
        <Card key={l.titulo} className="space-y-2">
          <h2 className="font-semibold text-slate-900">{l.titulo}</h2>
          <p className="text-sm text-slate-500">{l.desc}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {l.url}
            </code>
            <CopyButton text={l.url} />
            {l.cta && (
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                {l.cta} ↗
              </a>
            )}
          </div>
        </Card>
      ))}

      <Card className="space-y-2">
        <h2 className="font-semibold text-slate-900">🔲 QR de tu local (muy pronto)</h2>
        <p className="text-sm text-slate-500">
          Cada negocio tendrá un QR único para pegar en la puerta: al escanearlo, el
          cliente llega directo a tu anuncio y sabremos cuántas visitas trae el QR.
          Llega con la Fase 5 (analítica).
        </p>
      </Card>
    </div>
  );
}

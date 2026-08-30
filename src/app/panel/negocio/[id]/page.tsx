import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getMyBusiness, listAllCategories } from '@/db/queries-postgis';
import { requireSession } from '@/lib/auth';
import { Card, PageHeader } from '@/components/ui';
import { ContingencyBadge } from '@/components/contingency';
import { EditarNegocioForm, OkBanner } from './EditarNegocioForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Editar negocio', robots: { index: false } };

export default async function EditarNegocioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const sp = await searchParams;

  const [biz, categorias] = await Promise.all([getMyBusiness(session.userId, id), listAllCategories()]);
  if (!biz) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title={biz.name}
        subtitle={`${biz.categoryName} · ${biz.cityName}`}
        back={{ href: '/panel', label: 'Mis negocios' }}
      />

      <OkBanner show={sp.ok === '1'} text="✓ Cambios guardados y publicados." />
      <OkBanner show={sp.creado === '1'} text="🎉 Negocio publicado. Súmale tu menú y comparte tu enlace." />

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ContingencyBadge status={biz.contingencyStatus} note={biz.contingencyNote} />
          {biz.isVerified && <span className="text-xs font-medium text-sky-600">✔ Verificado</span>}
        </div>
        <nav className="flex gap-2">
          <ChipLink href={`/panel/negocio/${biz.id}/catalogo`}>📋 Menú</ChipLink>
          <ChipLink href={`/panel/negocio/${biz.id}/compartir`}>🔗 Compartir</ChipLink>
        </nav>
      </Card>

      <Card>
        <EditarNegocioForm biz={biz} categorias={categorias} />
      </Card>
    </div>
  );
}

function ChipLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-emerald-400 hover:text-emerald-700"
    >
      {children}
    </Link>
  );
}

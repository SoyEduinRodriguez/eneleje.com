import Link from 'next/link';
import { listMyBusinesses } from '@/db/queries-postgis';
import { requireSession } from '@/lib/auth';
import { ContingencyBadge } from '@/components/contingency';
import { Card, PageHeader } from '@/components/ui';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Mis negocios', robots: { index: false } };

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  published: { label: 'Publicado', className: 'bg-emerald-100 text-emerald-700' },
  suspended: { label: 'Suspendido', className: 'bg-amber-100 text-amber-700' },
  blocked: { label: 'Bloqueado', className: 'bg-rose-100 text-rose-700' },
  closed_by_owner: { label: 'Cerrado por ti', className: 'bg-slate-100 text-slate-600' },
};

export default async function PanelPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const businesses = await listMyBusinesses(session.userId);
  const recienRegistrado = sp.nuevo === '1';

  return (
    <div className="space-y-5">
      <PageHeader
        title="Mis negocios"
        subtitle="Cada negocio publica al instante en su categoría. Mantén tu contingencia y tu menú al día."
      />

      {recienRegistrado && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          🎉 Cuenta creada. Ahora registra tu primer negocio: toma menos de 2 minutos.
        </p>
      )}

      {businesses.length === 0 ? (
        <Card className="text-center">
          <p className="mb-4 text-slate-600">
            Aún no tienes negocios. Registra el primero y aparecerá publicado de inmediato
            en la categoría que elijas.
          </p>
          <Link
            href="/panel/negocio/nuevo"
            className="inline-block rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            + Registrar mi negocio
          </Link>
        </Card>
      ) : (
        <>
          <ul className="space-y-3">
            {businesses.map((b) => {
              const status = STATUS_LABEL[b.status] ?? STATUS_LABEL.published;
              return (
                <li key={b.id}>
                  <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold text-slate-900">{b.name}</h2>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
                          {status.label}
                        </span>
                        {b.is_verified && (
                          <span className="text-xs font-medium text-sky-600">✔ Verificado</span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500">
                        {b.category_name} · {b.city_name}
                      </p>
                      <ContingencyBadge status={b.contingency_status} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <PanelLink href={`/panel/negocio/${b.id}`}>Editar perfil</PanelLink>
                      <PanelLink href={`/panel/negocio/${b.id}/catalogo`}>Menú</PanelLink>
                      <PanelLink href={`/panel/negocio/${b.id}/compartir`}>Compartir</PanelLink>
                      <a
                        href={`/c/${b.category_slug}/${b.city_slug}/${b.slug}`}
                        className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 underline-offset-2 hover:underline"
                      >
                        Ver público ↗
                      </a>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
          <Link
            href="/panel/negocio/nuevo"
            className="inline-block rounded-lg border border-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50"
          >
            + Registrar otro negocio
          </Link>
        </>
      )}
    </div>
  );
}

function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-emerald-400 hover:text-emerald-700"
    >
      {children}
    </Link>
  );
}

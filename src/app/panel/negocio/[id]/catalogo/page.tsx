import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getBusinessCatalog, getMyBusiness, type CatalogRow,
} from '@/db/queries-postgis';
import { requireSession } from '@/lib/auth';
import { alternarItemAction, eliminarItemAction } from './actions';
import { NuevaSeccionForm, NuevoProductoForm } from './CatalogoForms';
import { Card, PageHeader } from '@/components/ui';
import { SecondarySubmit } from '@/components/client-bits';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Menú del negocio', robots: { index: false } };

function formatCOP(v: string | null): string {
  if (!v) return '';
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString('es-CO')}` : v;
}

export default async function CatalogoPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;

  const biz = await getMyBusiness(session.userId, id);
  if (!biz) notFound();

  const rows = await getBusinessCatalog(id, false);
  const secciones = agrupar(rows);
  const opcionesSecciones = secciones.map((s) => ({ value: s.cat_id, label: s.cat_name }));

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title={`Menú de ${biz.name}`}
        subtitle="Lo que agregues aquí aparece en tu anuncio público. Marca agotado sin borrar."
        back={{ href: `/panel/negocio/${id}`, label: 'Editar negocio' }}
      />

      {secciones.length === 0 ? (
        <Card className="space-y-4">
          <p className="text-sm text-slate-600">
            Tu menú está vacío. Crea la primera sección (por ejemplo «Panadería» o
            «Combos») y luego añade productos con precio y promociones.
          </p>
          <NuevaSeccionForm negocioId={id} />
        </Card>
      ) : (
        <>
          <Card>
            <NuevaSeccionForm negocioId={id} />
          </Card>
          <Card>
            <NuevoProductoForm negocioId={id} secciones={opcionesSecciones} />
          </Card>
        </>
      )}

      <div className="space-y-4">
        {secciones.map((s) => (
          <Card key={s.cat_id}>
            <h2 className="mb-3 font-semibold text-slate-900">📋 {s.cat_name}</h2>
            {s.items.length === 0 ? (
              <p className="text-sm text-slate-500">Sin productos todavía.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {s.items.map((it) => (
                  <li key={it.item_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-48 flex-1">
                      <p className="font-medium text-slate-900">
                        {it.item_name}
                        {!it.is_available && (
                          <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                            agotado / oculto
                          </span>
                        )}
                      </p>
                      {it.item_description && (
                        <p className="text-sm text-slate-500">{it.item_description}</p>
                      )}
                      <p className="text-sm">
                        {it.promo_price ? (
                          <>
                            <span className="font-semibold text-emerald-700">{formatCOP(it.promo_price)}</span>{' '}
                            <s className="text-xs text-slate-400">{formatCOP(it.price)}</s>
                          </>
                        ) : (
                          <span className="font-semibold text-slate-700">{formatCOP(it.price)}</span>
                        )}
                        {it.promo_ends_at && (
                          <span className="ml-2 text-xs text-amber-700">
                            promo hasta {new Date(it.promo_ends_at).toLocaleDateString('es-CO')}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <form action={alternarItemAction}>
                        <input type="hidden" name="negocio_id" value={id} />
                        <input type="hidden" name="item_id" value={it.item_id ?? ''} />
                        <input type="hidden" name="disponible" value={it.is_available ? '0' : '1'} />
                        <SecondarySubmit>
                          {it.is_available ? 'Marcar agotado' : 'Volver a mostrar'}
                        </SecondarySubmit>
                      </form>
                      <form action={eliminarItemAction}>
                        <input type="hidden" name="negocio_id" value={id} />
                        <input type="hidden" name="item_id" value={it.item_id ?? ''} />
                        <SecondarySubmit className="hover:border-rose-300 hover:text-rose-700">
                          Eliminar
                        </SecondarySubmit>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      <p className="text-center text-sm">
        <Link
          href={`/c/${biz.categorySlug}/${biz.citySlug}/${biz.slug}`}
          className="font-medium text-emerald-700 hover:underline"
        >
          Ver cómo queda en tu anuncio público ↗
        </Link>
      </p>
    </div>
  );
}

interface Seccion {
  cat_id: string;
  cat_name: string;
  items: CatalogRow[];
}

function agrupar(rows: CatalogRow[]): Seccion[] {
  const out = new Map<string, Seccion>();
  for (const r of rows) {
    let s = out.get(r.cat_id);
    if (!s) {
      s = { cat_id: r.cat_id, cat_name: r.cat_name, items: [] };
      out.set(r.cat_id, s);
    }
    if (r.item_id) s.items.push(r);
  }
  return [...out.values()];
}

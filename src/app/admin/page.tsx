import { notFound } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { db, listAllCategories } from '@/db/queries-postgis';
import { requireSession } from '@/lib/auth';
import { Card, PageHeader } from '@/components/ui';
import { SecondarySubmit } from '@/components/client-bits';
import { NuevaCategoriaForm } from './NuevaCategoriaForm';
import { descartarSugerenciaAction } from './acciones';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Administración', robots: { index: false } };

// type (no interface): requisito de índice implícito de db.execute<T>
type Sugerencia = {
  id: string;
  suggested_name: string;
  business_id: string | null;
  business_name: string | null;
  created_at: string;
};

export default async function AdminPage() {
  const session = await requireSession();
  if (session.role !== 'moderator' && session.role !== 'superadmin') notFound();

  const [sugerencias, categorias] = await Promise.all([
    db.execute<Sugerencia>(sql`SELECT * FROM app_list_pending_suggestions()`),
    listAllCategories(),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="Administración"
        subtitle={`Sesión de ${session.role}. Las categorías nuevas quedan disponibles de inmediato para el registro.`}
        back={{ href: '/panel', label: 'Mi panel' }}
      />

      <Card>
        <h2 className="mb-1 font-semibold text-slate-900">
          Sugerencias pendientes{' '}
          <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            {sugerencias.rows.length}
          </span>
        </h2>
        <p className="mb-4 text-sm text-slate-500">
          Categorías que los comerciantes pidieron al registrar su negocio bajo
          «Otros servicios».
        </p>
        {sugerencias.rows.length === 0 ? (
          <p className="text-sm text-slate-500">No hay sugerencias pendientes.</p>
        ) : (
          <ul className="space-y-3">
            {sugerencias.rows.map((s) => (
              <li key={s.id} className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                <p className="font-semibold text-slate-900">“{s.suggested_name}”</p>
                <p className="mb-3 text-xs text-slate-500">
                  Sugerida por {s.business_name ?? 'un comerciante'} ·{' '}
                  {new Date(s.created_at).toLocaleDateString('es-CO')}
                </p>
                <NuevaCategoriaForm suggestion={{ id: s.id, name: s.suggested_name }} />
                <form action={descartarSugerenciaAction} className="mt-2">
                  <input type="hidden" name="suggestion_id" value={s.id} />
                  <SecondarySubmit>Descartar sugerencia</SecondarySubmit>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-slate-900">Crear categoría manualmente</h2>
        <NuevaCategoriaForm />
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-slate-900">
          Categorías actuales <span className="text-slate-400">({categorias.length})</span>
        </h2>
        <div className="flex flex-wrap gap-2">
          {categorias.map((c) => (
            <span
              key={c.id}
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700"
            >
              {c.emoji ?? '🏪'} {c.name}{' '}
              <span className="font-mono text-xs text-slate-400">{c.slug}</span>
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}

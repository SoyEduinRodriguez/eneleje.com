import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { salirAction } from '@/app/(auth)/acciones';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Panel del comerciante</p>
          <p className="font-semibold text-slate-800">Hola, {session.name}</p>
        </div>
        <div className="flex items-center gap-3">
          {(session.role === 'moderator' || session.role === 'superadmin') && (
            <Link
              href="/admin"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-amber-400 hover:text-amber-700"
            >
              Administración
            </Link>
          )}
          <form action={salirAction}>
            <button
              type="submit"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-rose-300 hover:text-rose-700"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>
      {children}
    </div>
  );
}

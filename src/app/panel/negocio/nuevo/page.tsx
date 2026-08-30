import { listActiveCities, listAllCategories } from '@/db/queries-postgis';
import { Card, PageHeader } from '@/components/ui';
import { NuevoNegocioForm } from './NuevoNegocioForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Registrar negocio', robots: { index: false } };

export default async function NuevoNegocioPage() {
  const [categorias, ciudades] = await Promise.all([listAllCategories(), listActiveCities()]);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title="Registrar un negocio"
        subtitle="Se publica inmediatamente en la categoría que elijas. Podrás editarlo todo desde el panel."
        back={{ href: '/panel', label: 'Mis negocios' }}
      />
      <Card>
        <NuevoNegocioForm
          categorias={categorias}
          ciudades={ciudades.map((c) => ({ id: c.id, nombre: c.name }))}
        />
      </Card>
    </div>
  );
}

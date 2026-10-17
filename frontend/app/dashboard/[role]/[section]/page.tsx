import DashboardView from '../../DashboardView';

export default async function DashboardSection({ params }: { params: Promise<{ role: string; section: string }> }) {
  const { role, section } = await params;
  return <DashboardView role={role} section={section} />;
}

import DashboardView from '../DashboardView';

export default async function Dashboard({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  return <DashboardView role={role} />;
}

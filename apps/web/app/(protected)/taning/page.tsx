import { redirect } from 'next/navigation';

export default function TaningPage({ searchParams }: { searchParams: { tenantId?: string; clientId?: string } }) {
  const query = new URLSearchParams();
  if (searchParams.tenantId) query.set('tenantId', searchParams.tenantId);
  if (searchParams.clientId) query.set('clientId', searchParams.clientId);
  redirect(`/training${query.size ? `?${query}` : ''}`);
}

'use client';
import { useState } from 'react';

export function CoachTermsForm({ tenantId, engagementId, rate, lifespan }: { tenantId: string; engagementId: string; rate: string; lifespan: number }) {
  const [message, setMessage] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(''); const data = new FormData(event.currentTarget);
    const response = await fetch('/api/coaches', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId, engagementId, commissionRate: data.get('rate'), commissionLifespanMonths: Number(data.get('lifespan')) }) });
    const result = await response.json() as { error?: string }; setMessage(response.ok ? 'Saved' : (result.error ?? 'Could not save'));
  }
  return <form className="terms-form" onSubmit={submit}><label>Rate (%)<input name="rate" defaultValue={rate} inputMode="decimal" required /></label><label>Lifespan<select name="lifespan" defaultValue={lifespan}>{[1, 3, 6, 8, 12].map((value) => <option key={value} value={value}>{value} months</option>)}</select></label><button className="secondary-button" type="submit">Save</button>{message ? <span role="status">{message}</span> : null}</form>;
}

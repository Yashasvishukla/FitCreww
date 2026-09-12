'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function OrganizationCoachAssignmentForm({ tenantId, organizationId, coaches }: { tenantId: string; organizationId: string; coaches: readonly { partyId: string; displayName: string }[] }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'submitting' | 'complete' | 'failed'>('idle');
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('submitting');
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch('/api/organizations', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId, organizationId, coachPartyId: data.get('coachPartyId') }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setError(result.error ?? 'Assignment failed.');
        setState('failed');
        return;
      }
      form.reset();
      setState('complete');
      window.setTimeout(() => {
        setState('idle');
        router.refresh();
      }, 800);
    } catch {
      setError('Assignment failed.');
      setState('failed');
    }
  }
  const isUnavailable = coaches.length === 0;
  return <form className="organization-assignment-form" onSubmit={submit}>
    <label><span>Assign coach</span><select name="coachPartyId" required defaultValue="" disabled={isUnavailable}><option value="" disabled>{isUnavailable ? 'All coaches assigned' : 'Select coach'}</option>{coaches.map((coach) => <option key={coach.partyId} value={coach.partyId}>{coach.displayName}</option>)}</select></label>
    <button className="secondary-button" type="submit" disabled={state === 'submitting' || isUnavailable} data-state={state} aria-busy={state === 'submitting'}>{state === 'submitting' ? 'Assigning' : 'Assign'}</button>
    {state === 'failed' ? <span className="organization-assignment-status" role="status">{error}</span> : null}
  </form>;
}

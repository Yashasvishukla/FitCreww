'use client';
import { useState } from 'react';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function CoachTermsForm({ tenantId, engagementId, rate, lifespan }: { tenantId: string; engagementId: string; rate: string; lifespan: number }) {
  const [state, setState] = useState<SaveState>('idle');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('saving');
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/coaches', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, engagementId, commissionRate: data.get('rate'), commissionLifespanMonths: Number(data.get('lifespan')) }),
      });
      if (response.ok) {
        setState('saved');
        window.setTimeout(() => setState('idle'), 760);
      } else {
        setState('failed');
      }
    } catch {
      setState('failed');
    }
  }
  return (
    <form className="terms-form coach-terms-form" onSubmit={submit}>
      <label>
        <span>Rate</span>
        <input name="rate" defaultValue={rate} inputMode="decimal" required aria-label="Commission rate percentage" />
      </label>
      <label>
        <span>Lifespan</span>
        <select name="lifespan" defaultValue={lifespan} aria-label="Commission lifespan">
          {[1, 3, 6, 8, 12].map((value) => <option key={value} value={value}>{value} months</option>)}
        </select>
      </label>
      <button className="secondary-button" type="submit" disabled={state === 'saving'} data-state={state} aria-busy={state === 'saving'}>{state === 'saving' ? 'Saving' : 'Save'}</button>
      {state === 'failed' ? <span className="coach-terms-status" data-state="failed" role="status">Failed</span> : null}
    </form>
  );
}

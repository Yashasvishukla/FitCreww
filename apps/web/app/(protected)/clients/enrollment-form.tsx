'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
type Option = { id: string; label: string };
export function EnrollmentForm({ tenantId, coaches, organizations }: { tenantId: string; coaches: readonly Option[]; organizations: readonly Option[] }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'submitting' | 'complete' | 'failed'>('idle');
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('submitting');
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const days = data.getAll('scheduleDay').map(String);
    if (!days.length) {
      setError('Select at least one training day.');
      setState('failed');
      return;
    }
    try {
      const response = await fetch('/api/clients', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId, name: data.get('name'), email: data.get('email') || undefined, password: data.get('password') || undefined, price: data.get('price'), coachPartyId: data.get('coachPartyId'), organizationId: data.get('organizationId') || null, schedule: { days }, photoConsent: data.get('consent') === 'on', subscriptionDurationMonths: Number(data.get('duration')) }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setError(result.error ?? 'Enrollment failed.');
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
      setError('Enrollment failed.');
      setState('failed');
    }
  }
  return <form className="client-enrollment-form" onSubmit={submit}>
    <div className="client-enrollment-basics"><label><span>Client name</span><input name="name" placeholder="Client name" required maxLength={200} autoFocus /></label><label><span>Coach</span><select name="coachPartyId" required defaultValue=""><option value="" disabled>Select a coach</option>{coaches.map((coach) => <option key={coach.id} value={coach.id}>{coach.label}</option>)}</select></label><label><span>Organization <small>Optional</small></span><select name="organizationId" defaultValue=""><option value="">Direct client</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.label}</option>)}</select></label></div>
    <details open><summary>Service setup</summary><div className="client-service-setup"><div className="client-service-financials"><label><span>Price</span><div className="client-price-input"><span>INR</span><input name="price" type="number" min="0" step="0.01" inputMode="decimal" placeholder="0" required /></div></label><label><span>Subscription</span><select name="duration" defaultValue="1">{[1, 3, 6, 12].map((value) => <option key={value} value={value}>{value} month{value === 1 ? '' : 's'}</option>)}</select></label></div><fieldset className="training-days-fieldset"><legend>Training days</legend><div className="training-day-options">{[['Mon', 'Monday'], ['Tue', 'Tuesday'], ['Wed', 'Wednesday'], ['Thu', 'Thursday'], ['Fri', 'Friday'], ['Sat', 'Saturday'], ['Sun', 'Sunday']].map(([value, label]) => <label key={value} className="training-day-option"><input name="scheduleDay" value={value} type="checkbox" defaultChecked={['Mon', 'Wed', 'Fri'].includes(value as string)} /><span>{label}</span></label>)}</div></fieldset></div></details>
    <details><summary>Client access and consent <small>(optional)</small></summary><div className="form-grid"><label><span>Login email</span><input name="email" type="email" autoComplete="email" /></label><label><span>Temporary password</span><input name="password" type="password" minLength={12} autoComplete="new-password" /></label></div><label className="checkbox-row"><input name="consent" type="checkbox" /> Photo consent granted</label></details>
    <button className="primary-button" type="submit" disabled={state === 'submitting' || coaches.length === 0} data-state={state} aria-busy={state === 'submitting'}>{state === 'submitting' ? 'Enrolling' : coaches.length === 0 ? 'No coach available' : 'Enroll client'}</button>{state === 'failed' ? <p role="status" className="client-enrollment-status">{error}</p> : null}
  </form>;
}

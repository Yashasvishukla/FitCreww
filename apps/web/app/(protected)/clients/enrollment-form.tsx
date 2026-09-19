'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
type Option = { id: string; label: string };
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export function EnrollmentForm({ tenantId, coaches, organizations, organizationRequired = false }: { tenantId: string; coaches: readonly Option[]; organizations: readonly Option[]; organizationRequired?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'submitting' | 'complete' | 'failed'>('idle');
  const [error, setError] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState(6);
  const [billingCadence, setBillingCadence] = useState<'monthly' | 'upfront'>('monthly');
  const total = Number(price) || 0;
  const monthly = duration > 0 ? total / duration : 0;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('submitting');
    setError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const days = data.getAll('scheduleDay').map(String);
    const email = data.get('email')?.toString().trim() ?? '';
    const password = data.get('password')?.toString() ?? '';
    if (!days.length) {
      setError('Select at least one training day.');
      setState('failed');
      return;
    }
    if ((email || password) && (!email || !password)) {
      setError('Add both client login email and temporary password, or leave both blank.');
      setState('failed');
      return;
    }
    if (password && password.length < 12) {
      setError('Temporary password must be at least 12 characters.');
      setState('failed');
      return;
    }
    try {
      const response = await fetch('/api/clients', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId, name: data.get('name'), email: email || undefined, password: password || undefined, price: data.get('price'), billingCadence: data.get('billingCadence'), coachPartyId: data.get('coachPartyId'), organizationId: data.get('organizationId') || null, schedule: { days }, photoConsent: data.get('consent') === 'on', subscriptionDurationMonths: Number(data.get('duration')) }) });
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
    <div className="client-enrollment-basics"><label><span>Client name</span><input name="name" placeholder="Client name" required maxLength={200} autoFocus /></label><label><span>Coach</span><select name="coachPartyId" required defaultValue=""><option value="" disabled>Select a coach</option>{coaches.map((coach) => <option key={coach.id} value={coach.id}>{coach.label}</option>)}</select></label><label><span>Organization <small>{organizationRequired ? 'Required' : 'Optional'}</small></span>{organizationRequired && organizations.length === 1 ? <><input value={organizations[0]?.label ?? ''} readOnly /><input type="hidden" name="organizationId" value={organizations[0]?.id ?? ''} /></> : <select name="organizationId" defaultValue="" required={organizationRequired}><option value="">{organizationRequired ? 'Select an organization' : 'Direct client'}</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.label}</option>)}</select>}</label></div>
    <details open><summary>Service setup</summary><div className="client-service-setup"><div className="client-service-financials"><label><span>Total package value</span><div className="client-price-input"><span>INR</span><input name="price" type="number" min="0" step="0.01" inputMode="decimal" placeholder="6000" required value={price} onChange={(event) => setPrice(event.currentTarget.value)} /></div></label><label><span>Subscription period</span><select name="duration" value={duration} onChange={(event) => setDuration(Number(event.currentTarget.value))}>{[1, 3, 6, 12].map((value) => <option key={value} value={value}>{value} month{value === 1 ? '' : 's'}</option>)}</select></label></div><fieldset className="billing-cadence-fieldset"><legend>Client payment plan</legend><div className="billing-cadence-options"><label className="billing-cadence-option"><input name="billingCadence" value="monthly" type="radio" checked={billingCadence === 'monthly'} onChange={() => setBillingCadence('monthly')} /><span><strong>Monthly collection</strong><small>{total > 0 ? `${inr.format(monthly)} every month for ${duration} month${duration === 1 ? '' : 's'}` : 'Collect one installment each month'}</small></span></label><label className="billing-cadence-option"><input name="billingCadence" value="upfront" type="radio" checked={billingCadence === 'upfront'} onChange={() => setBillingCadence('upfront')} /><span><strong>One-time collection</strong><small>{total > 0 ? `${inr.format(total)} at enrollment` : 'Collect the full package value once'}</small></span></label></div><div className="billing-preview"><span>Collection preview</span><strong>{billingCadence === 'monthly' ? `${inr.format(monthly)} monthly` : `${inr.format(total)} once`}</strong><small>Coach payouts follow confirmed client collections, so monthly client payments create monthly coach payable entries.</small></div></fieldset><fieldset className="training-days-fieldset"><legend>Training days</legend><div className="training-day-options">{[['Mon', 'Monday'], ['Tue', 'Tuesday'], ['Wed', 'Wednesday'], ['Thu', 'Thursday'], ['Fri', 'Friday'], ['Sat', 'Saturday'], ['Sun', 'Sunday']].map(([value, label]) => <label key={value} className="training-day-option"><input name="scheduleDay" value={value} type="checkbox" defaultChecked={['Mon', 'Wed', 'Fri'].includes(value as string)} /><span>{label}</span></label>)}</div></fieldset></div></details>
    <details><summary>Client access and consent <small>(optional)</small></summary><p className="muted">Leave login fields blank unless the client should sign in now.</p><div className="form-grid"><label><span>Login email</span><input name="email" type="email" autoComplete="email" /></label><label><span>Temporary password</span><input name="password" type="password" minLength={12} autoComplete="new-password" /></label></div><label className="checkbox-row"><input name="consent" type="checkbox" /> Photo consent granted</label></details>
    <button className="primary-button" type="submit" disabled={state === 'submitting' || coaches.length === 0} data-state={state} aria-busy={state === 'submitting'}>{state === 'submitting' ? 'Enrolling' : coaches.length === 0 ? 'No coach available' : 'Enroll client'}</button>{state === 'failed' ? <p role="status" className="client-enrollment-status">{error}</p> : null}{state === 'complete' ? <p role="status" className="client-enrollment-status client-enrollment-status-success">Client enrolled. Refreshing roster...</p> : null}
  </form>;
}

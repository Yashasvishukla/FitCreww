'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

type Accrual = { kind: 'earning' | 'correction'; commissionAmount: string; coachPayableAmount: string; rateApplied: string; withinLifespan: boolean; windowEndAt: string };
type Data = {
  ownerAccess: boolean;
  principalPartyId: string;
  ownerPartyId: string;
  refundCoachClawbackRate: string;
  handles: { id: string; partyName: string; type: string; value: string; label: string | null; isDefault: boolean }[];
  payments: { id: string; purpose: string; reversesPaymentId: string | null; clientName: string; amount: string; method: string; status: string; utr: string | null; createdAt: string; accrual: Accrual | null }[];
  subscriptions: { id: string; clientName: string; price: string }[];
  organizations: { id: string; name: string }[];
};

export function MoneyWorkspace({ tenantId, initial }: { tenantId: string; initial: Data }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(url: string, method: string, body: unknown) {
    setBusy(true); setError('');
    const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setError(data.error ?? 'Operation failed.'); return false; }
    router.refresh(); return true;
  }

  async function addHandle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (await submit('/api/money/handles', 'POST', { tenantId, partyId: initial.principalPartyId, type: form.get('type'), value: form.get('value'), label: form.get('label'), isDefault: form.get('isDefault') === 'on' })) event.currentTarget.reset();
  }

  async function record(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    if (await submit('/api/money', 'POST', { kind: 'client', tenantId, subscriptionId: form.get('subscriptionId'), amount: form.get('amount'), method: form.get('method') })) event.currentTarget.reset();
  }

  async function recordOrganization(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); if (await submit('/api/money', 'POST', { kind: 'organization', tenantId, organizationId: form.get('organizationId'), amount: form.get('amount'), method: form.get('method') })) event.currentTarget.reset(); }
  async function saveClawback(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); await submit('/api/money', 'PATCH', { action: 'config', tenantId, refundCoachClawbackRate: form.get('rate') }); }
  async function reverse(event: FormEvent<HTMLFormElement>, paymentId: string) { event.preventDefault(); const form = new FormData(event.currentTarget); await submit('/api/money', 'PATCH', { action: 'reverse', tenantId, paymentId, method: form.get('method'), utr: form.get('utr') || undefined }); }

  async function confirm(event: FormEvent<HTMLFormElement>, paymentId: string) {
    event.preventDefault(); const form = new FormData(event.currentTarget); let proofMediaAssetId: string | undefined; const proof = form.get('proof');
    if (proof instanceof File && proof.size) {
      setBusy(true); const upload = new FormData(); upload.set('tenantId', tenantId); upload.set('paymentId', paymentId); upload.set('proof', proof);
      const response = await fetch('/api/money/proof', { method: 'POST', body: upload }); const result = await response.json();
      if (!response.ok) { setBusy(false); setError(result.error); return; } proofMediaAssetId = result.mediaAssetId;
    }
    await submit('/api/money', 'PATCH', { tenantId, paymentId, utr: form.get('utr') || undefined, proofMediaAssetId });
  }

  return <>
    <div className="page-grid">
      <section className="surface">
        <div className="section-heading"><div><p className="eyebrow">Collect to</p><h2>Payout handles</h2></div></div>
        <div className="data-list">{initial.handles.length ? initial.handles.map((handle) => <article className="data-row" key={handle.id}><div><h3>{handle.label || handle.type.toUpperCase()}</h3><p className="muted">{handle.value} · {handle.partyName}{handle.isDefault ? ' · default' : ''}</p></div></article>) : <p className="muted">Add the UPI ID or QR reference shown to clients.</p>}</div>
        <form className="stack-form" onSubmit={addHandle}><label>Type<select name="type"><option value="upi">UPI</option><option value="phone">Phone</option><option value="qr">QR reference</option></select></label><label>Handle<input name="value" required /></label><label>Label<input name="label" /></label><label><input name="isDefault" type="checkbox" /> Default</label><button disabled={busy}>Save handle</button></form>
      </section>
      {initial.ownerAccess ? <section className="surface">
        <div className="section-heading"><div><p className="eyebrow">One-time agreement</p><h2>Organization payment</h2></div></div>
        <form className="stack-form" onSubmit={recordOrganization}><label>Organization<select name="organizationId" required>{initial.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label><label>Amount<input name="amount" inputMode="decimal" required /></label><label>Method<select name="method"><option value="upi">UPI</option><option value="qr">QR</option><option value="phone">Phone</option><option value="other">Other</option></select></label><button disabled={busy || !initial.organizations.length}>Record agreement payment</button></form>
      </section> : null}
      {initial.ownerAccess ? <section className="surface">
        <div className="section-heading"><div><p className="eyebrow">Refund policy</p><h2>Coach claw-back</h2></div></div>
        <form className="stack-form" onSubmit={saveClawback}><label>Coach share reclaimed (%)<input name="rate" type="number" min="0" max="100" step="0.01" defaultValue={initial.refundCoachClawbackRate} required /></label><p className="muted">The remaining refunded coach share is absorbed by the organization and separately posted.</p><button disabled={busy}>Save policy</button></form>
      </section> : null}
      <section className="surface">
        <div className="section-heading"><div><p className="eyebrow">Receivable</p><h2>Record client payment</h2></div></div>
        <form className="stack-form" onSubmit={record}><label>Client<select name="subscriptionId" required>{initial.subscriptions.map((subscription) => <option key={subscription.id} value={subscription.id}>{subscription.clientName} · ₹{subscription.price}</option>)}</select></label><label>Amount<input name="amount" inputMode="decimal" required /></label><label>Method<select name="method"><option value="upi">UPI</option><option value="qr">QR</option><option value="phone">Phone</option><option value="other">Other</option></select></label><button disabled={busy || !initial.subscriptions.length}>Record pending payment</button></form>
      </section>
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <section className="surface">
      <div className="section-heading"><div><p className="eyebrow">Audit queue</p><h2>Payment records</h2></div><span className="count-label">{initial.payments.length}</span></div>
      <div className="data-list">{initial.payments.map((payment) => <article className="data-row" key={payment.id}>
        <div><h3>{payment.clientName} · ₹{payment.amount}</h3><p className="muted">{payment.purpose.replaceAll('_', ' ')} · {payment.status} · {payment.method} · {new Date(payment.createdAt).toLocaleString('en-IN')}</p>{payment.accrual ? <p className="muted">{payment.accrual.kind === 'correction' ? 'Correction' : 'Owner commission'} ₹{payment.accrual.commissionAmount} at {payment.accrual.rateApplied}% · Coach payable ₹{payment.accrual.coachPayableAmount} · {payment.accrual.withinLifespan ? `window ends ${new Date(payment.accrual.windowEndAt).toLocaleDateString('en-IN')}` : 'commission window expired'}</p> : null}</div>
        {payment.status === 'pending' ? <form className="inline-form" onSubmit={(event) => confirm(event, payment.id)}><input aria-label="UTR" name="utr" placeholder="UTR" /><input aria-label="Screenshot proof" name="proof" type="file" accept="image/jpeg,image/png,image/webp" /><button disabled={busy}>Confirm</button></form> : <span className="status-label">UTR {payment.utr ?? 'proof attached'}</span>}
        {initial.ownerAccess && payment.purpose === 'client_subscription' && payment.status === 'confirmed' ? <form className="inline-form" onSubmit={(event) => reverse(event, payment.id)}><select aria-label="Refund method" name="method"><option value="upi">UPI refund</option><option value="other">Other</option></select><input aria-label="Refund UTR" name="utr" placeholder="Refund UTR" required /><button disabled={busy}>Post refund</button></form> : null}
      </article>)}</div>
    </section>
  </>;
}

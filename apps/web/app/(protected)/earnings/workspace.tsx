'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

type Payable = { coachPartyId: string; coachName: string; amount: string; accrualCount: number; settleable: boolean };
type Accrual = { id: string; kind: 'earning' | 'correction'; clientName: string; coachName: string; gross: string; commission: string; net: string; settled: boolean; createdAt: string };
type Settlement = { id: string; coachName: string; periodStart: string; periodEnd: string; grossRevenue: string; commissionAmount: string; totalAmount: string; status: string; payslipMediaAssetId: string | null };
type Data = { owner: boolean; payables: Payable[]; accruals: Accrual[]; settlements: Settlement[] };
type ActionState = 'idle' | 'submitting' | 'complete' | 'failed';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const amountOf = (value: string) => Number(value) || 0;
const valueOf = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

export function EarningsWorkspace({ tenantId, initial }: { tenantId: string; initial: Data }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [busy, setBusy] = useState(false);
  const totalPayable = initial.payables.reduce((sum, payable) => sum + amountOf(payable.amount), 0);
  const readyPayables = initial.payables.filter((payable) => payable.settleable);
  const openAccruals = initial.accruals.filter((row) => !row.settled);
  const issued = initial.settlements.filter((settlement) => settlement.status !== 'draft');

  function clearField(name: string) {
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function invalidProps(name: string) {
    return {
      'aria-describedby': fieldErrors[name] ? `${name}-error` : undefined,
      'aria-invalid': fieldErrors[name] ? true : undefined,
      className: fieldErrors[name] ? 'invalid-input' : undefined,
      onChange: () => clearField(name),
    };
  }

  function showErrors(errors: Record<string, string>) { setFieldErrors(errors); return Object.keys(errors).length === 0; }
  function stateOf(action: string) { return actionStates[action] ?? 'idle'; }
  function setActionState(action: string, state: ActionState) { setActionStates((current) => ({ ...current, [action]: state })); }
  function settleAction(action: string, state: 'complete' | 'failed') {
    setActionState(action, state);
    window.setTimeout(() => {
      setActionStates((current) => ({ ...current, [action]: 'idle' }));
      if (state === 'complete') router.refresh();
    }, state === 'complete' ? 800 : 900);
  }

  async function send(method: 'POST' | 'PATCH', body: object, action: string) {
    setBusy(true); setError(''); setActionState(action, 'submitting');
    try {
      const response = await fetch('/api/settlements', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId, ...body }) });
      const result = await response.json(); setBusy(false);
      if (!response.ok) { setError(result.error ?? 'Settlement could not be updated.'); settleAction(action, 'failed'); return false; }
      settleAction(action, 'complete'); return true;
    } catch { setBusy(false); setError('Settlement could not be updated.'); settleAction(action, 'failed'); return false; }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget); const periodStart = valueOf(form, 'periodStart'); const periodEnd = valueOf(form, 'periodEnd');
    const errors: Record<string, string> = {};
    if (!valueOf(form, 'coachPartyId')) errors.coachPartyId = 'Choose a coach.';
    if (!periodStart) errors.periodStart = 'Choose a start date.';
    if (!periodEnd) errors.periodEnd = 'Choose an end date.';
    if (periodStart && periodEnd && periodEnd < periodStart) errors.periodEnd = 'End date must follow start date.';
    if (!showErrors(errors)) return;
    if (await send('POST', { coachPartyId: form.get('coachPartyId'), periodStart, periodEnd, method: form.get('method') }, 'create-settlement')) event.currentTarget.reset();
  }

  async function confirm(event: FormEvent<HTMLFormElement>, settlementId: string) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const utrKey = `utr-${settlementId}`;
    if (!showErrors(valueOf(form, utrKey) ? {} : { [utrKey]: 'Enter the payout reference.' })) return;
    await send('PATCH', { settlementId, utr: form.get(utrKey) }, `confirm-${settlementId}`);
  }

  return <div className="finance-workspace earnings-workspace">
    <section className="finance-summary" aria-label="Earnings overview">
      <FinanceMetric label={initial.owner ? 'Outstanding payables' : 'My payable earnings'} value={inr.format(totalPayable)} detail={initial.owner ? 'Across your coach network' : 'Awaiting settlement'} tone="orange" />
      <FinanceMetric label={initial.owner ? 'Ready to settle' : 'Open accruals'} value={String(initial.owner ? readyPayables.length : openAccruals.length)} detail={initial.owner ? 'Coaches available now' : 'Current earning records'} tone="blue" />
      <FinanceMetric label="Settlements issued" value={String(issued.length)} detail="Payslips ready to view" tone="green" />
      <FinanceMetric label="Traceable accruals" value={String(initial.accruals.length)} detail="Every client payment accounted for" tone="purple" />
    </section>

    <div className={initial.owner ? 'finance-command-grid' : 'finance-single-command'}>
      <section className="finance-command">
        <div><p className="eyebrow">{initial.owner ? 'Payout workspace' : 'Your earnings'}</p><h2>{initial.owner ? 'Settle coach earnings.' : 'Every earning, explained.'}</h2><p>{initial.owner ? 'Create a settlement from confirmed, unsettled accruals. Confirm the payout reference to issue an immutable payslip.' : 'Approved accruals and issued payslips remain available here.'}</p></div>
        {initial.owner ? <form className="finance-form" onSubmit={create} noValidate>
          <label><span>Coach</span><select name="coachPartyId" required {...invalidProps('coachPartyId')}>{readyPayables.length ? readyPayables.map((row) => <option key={row.coachPartyId} value={row.coachPartyId}>{row.coachName} · {inr.format(amountOf(row.amount))}</option>) : <option value="">No coach is ready to settle</option>}</select><FieldError id="coachPartyId-error" message={fieldErrors.coachPartyId} /></label>
          <label><span>Payout method</span><select name="method" {...invalidProps('method')}><option value="upi">UPI</option><option value="qr">QR</option><option value="phone">Phone</option><option value="other">Other</option></select><FieldError id="method-error" message={fieldErrors.method} /></label>
          <label><span>Period start</span><input name="periodStart" type="date" required {...invalidProps('periodStart')} /><FieldError id="periodStart-error" message={fieldErrors.periodStart} /></label>
          <label><span>Period end</span><input name="periodEnd" type="date" required {...invalidProps('periodEnd')} /><FieldError id="periodEnd-error" message={fieldErrors.periodEnd} /></label>
          <button className="primary-button" disabled={busy || !readyPayables.length} data-state={stateOf('create-settlement')} aria-busy={stateOf('create-settlement') === 'submitting'}>{stateOf('create-settlement') === 'submitting' ? 'Creating settlement' : 'Create settlement'}</button>
        </form> : <div className="finance-proof-callout"><span className="finance-icon">✓</span><p>Your payslip becomes available as soon as the payout is confirmed.</p></div>}
      </section>
      {initial.owner ? <section className="surface finance-side-card"><div className="section-heading"><div><p className="eyebrow">Ready now</p><h2>Coach payables</h2></div><span className="count-label">{readyPayables.length}</span></div><div className="finance-handle-list">{initial.payables.length ? initial.payables.map((row) => <article className="finance-handle" key={row.coachPartyId}><span className="finance-icon">{row.coachName.slice(0, 1).toUpperCase()}</span><div><strong>{row.coachName}</strong><p>{row.accrualCount} accruals · {row.settleable ? 'Ready to settle' : 'Carried forward'}</p></div><strong>{inr.format(amountOf(row.amount))}</strong></article>) : <p className="muted">No unsettled earnings.</p>}</div></section> : null}
    </div>

    {error ? <p className="form-error finance-error" role="alert">{error}</p> : null}

    <section className="surface finance-records"><div className="section-heading"><div><p className="eyebrow">Payout history</p><h2>Settlements and payslips</h2><p className="muted">A permanent record of every completed coach payout.</p></div><span className="count-label">{initial.settlements.length}</span></div><div className="finance-record-list">{initial.settlements.length ? initial.settlements.map((row) => <article className="finance-record" key={row.id}><div className="finance-record-main"><span className={`finance-status ${row.status}`}>{row.status}</span><div><h3>{row.coachName}</h3><p>{row.periodStart} to {row.periodEnd} · Gross {inr.format(amountOf(row.grossRevenue))} · Commission {inr.format(amountOf(row.commissionAmount))}</p></div></div><strong className="finance-amount">{inr.format(amountOf(row.totalAmount))}</strong>{row.status === 'draft' && initial.owner ? <form className="finance-inline-form earnings-confirm-form" onSubmit={(event) => confirm(event, row.id)} noValidate><label className="finance-compact-field"><span className="sr-only">Payout reference</span><input name={`utr-${row.id}`} aria-label="Payout reference" placeholder="Payout UTR or reference" {...invalidProps(`utr-${row.id}`)} /><FieldError id={`utr-${row.id}-error`} message={fieldErrors[`utr-${row.id}`]} /></label><button className="primary-button" disabled={busy} data-state={stateOf(`confirm-${row.id}`)} aria-busy={stateOf(`confirm-${row.id}`) === 'submitting'}>{stateOf(`confirm-${row.id}`) === 'submitting' ? 'Confirming' : 'Confirm payout'}</button></form> : row.payslipMediaAssetId ? <a className="secondary-button" href={`/api/payslips/${row.payslipMediaAssetId}?tenantId=${tenantId}`} target="_blank">Open payslip</a> : <span className="finance-proof">Payout pending</span>}</article>) : <p className="muted">No settlement batches have been created yet.</p>}</div></section>

    <section className="surface finance-records"><div className="section-heading"><div><p className="eyebrow">Traceability</p><h2>Accrual detail</h2><p className="muted">Every number can be traced back to a confirmed client payment.</p></div><span className="count-label">{initial.accruals.length}</span></div><div className="finance-record-list">{initial.accruals.length ? initial.accruals.map((row) => <article className="finance-record finance-accrual" key={row.id}><div className="finance-record-main"><span className={`finance-status ${row.settled ? 'confirmed' : 'pending'}`}>{row.settled ? 'settled' : 'payable'}</span><div><h3>{row.clientName}</h3><p>{row.coachName} · {row.kind === 'correction' ? 'Correction' : 'Earning'} · {new Date(row.createdAt).toLocaleDateString('en-IN')}</p></div></div><div className="finance-breakdown"><span>Gross <strong>{inr.format(amountOf(row.gross))}</strong></span><span>Commission <strong>{inr.format(amountOf(row.commission))}</strong></span><span>Net <strong>{inr.format(amountOf(row.net))}</strong></span></div></article>) : <p className="muted">No accruals have been recorded yet.</p>}</div></section>
  </div>;
}

function FinanceMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) { return <article className={`finance-metric finance-metric-${tone}`}><span className="metric-mark" aria-hidden="true" /><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function FieldError({ id, message }: { id: string; message?: string }) { return message ? <small className="field-error" id={id}>{message}</small> : null; }

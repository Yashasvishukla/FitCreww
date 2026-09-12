'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

type Payable = { coachPartyId: string; coachName: string; amount: string; accrualCount: number; settleable: boolean };
type Accrual = { id: string; settlementId: string | null; kind: 'earning' | 'correction'; clientName: string; coachName: string; gross: string; commission: string; net: string; settled: boolean; createdAt: string };
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
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null);
  const [selectedCoachPartyId, setSelectedCoachPartyId] = useState(initial.payables.find((payable) => payable.settleable)?.coachPartyId ?? '');
  const totalPayable = initial.payables.reduce((sum, payable) => sum + amountOf(payable.amount), 0);
  const readyPayables = initial.payables.filter((payable) => payable.settleable);
  const openAccruals = initial.accruals.filter((row) => !row.settled);
  const issued = initial.settlements.filter((settlement) => settlement.status !== 'draft');
  const draftSettlements = initial.settlements.filter((settlement) => settlement.status === 'draft');
  const selectedSettlement = initial.settlements.find((settlement) => settlement.id === selectedSettlementId);
  const traceableAccruals = selectedSettlementId ? initial.accruals.filter((accrual) => accrual.settlementId === selectedSettlementId) : initial.accruals;
  const selectedPayable = readyPayables.find((payable) => payable.coachPartyId === selectedCoachPartyId) ?? readyPayables[0];
  const coachGrossEarnings = initial.accruals.reduce((sum, accrual) => sum + amountOf(accrual.gross), 0);
  const coachCommission = initial.accruals.reduce((sum, accrual) => sum + amountOf(accrual.commission), 0);
  const coachNetEarnings = initial.accruals.reduce((sum, accrual) => sum + amountOf(accrual.net), 0);
  const coachPaidOut = issued.reduce((sum, settlement) => sum + amountOf(settlement.totalAmount), 0);
  const coachAwaitingPayout = openAccruals.reduce((sum, accrual) => sum + amountOf(accrual.net), 0) + draftSettlements.reduce((sum, settlement) => sum + amountOf(settlement.totalAmount), 0);

  function showSettlementTrace(settlementId: string) {
    setSelectedSettlementId(settlementId);
    window.setTimeout(() => document.getElementById('accrual-traceability')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

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
    {initial.owner ? <>
      <section className="owner-payout-summary" aria-label="Coach payout overview">
        <div><p className="eyebrow">To pay coaches</p><strong>{inr.format(totalPayable)}</strong><span>{readyPayables.length === 1 ? '1 coach is ready for payout' : `${readyPayables.length} coaches are ready for payout`}</span></div>
        <dl><div><dt>Awaiting transfer</dt><dd>{draftSettlements.length}</dd></div><div><dt>Payslips issued</dt><dd>{issued.length}</dd></div><div><dt>Open earnings</dt><dd>{openAccruals.length}</dd></div></dl>
      </section>

      <div className="owner-payout-flow">
        <section className="surface owner-payout-card">
          <div className="owner-payout-card-heading"><div><p className="eyebrow">Step 1</p><h2>Prepare a coach payout</h2><p className="muted">Choose who you are paying and the earnings period. FitCrew calculates the payable amount automatically.</p></div>{selectedPayable ? <div className="owner-payout-amount"><span>Available now</span><strong>{inr.format(amountOf(selectedPayable.amount))}</strong></div> : null}</div>
          <form className="finance-form owner-payout-form" onSubmit={create} noValidate>
            <label><span>Coach and payable amount</span><select name="coachPartyId" required value={selectedCoachPartyId} {...invalidProps('coachPartyId')} onChange={(event) => { setSelectedCoachPartyId(event.currentTarget.value); clearField('coachPartyId'); }}>{readyPayables.length ? readyPayables.map((row) => <option key={row.coachPartyId} value={row.coachPartyId}>{row.coachName} — {inr.format(amountOf(row.amount))} available</option>) : <option value="">No coach is ready to settle</option>}</select><FieldError id="coachPartyId-error" message={fieldErrors.coachPartyId} /></label>
            <label><span>Payment method</span><select name="method" {...invalidProps('method')}><option value="upi">UPI</option><option value="qr">QR</option><option value="phone">Phone</option><option value="other">Other</option></select><FieldError id="method-error" message={fieldErrors.method} /></label>
            <label><span>Earnings from</span><input name="periodStart" type="date" required {...invalidProps('periodStart')} /><FieldError id="periodStart-error" message={fieldErrors.periodStart} /></label>
            <label><span>Earnings to</span><input name="periodEnd" type="date" required {...invalidProps('periodEnd')} /><FieldError id="periodEnd-error" message={fieldErrors.periodEnd} /></label>
            <button className="primary-button" disabled={busy || !readyPayables.length} data-state={stateOf('create-settlement')} aria-busy={stateOf('create-settlement') === 'submitting'}>{stateOf('create-settlement') === 'submitting' ? 'Preparing payout' : 'Prepare payout'}</button>
          </form>
        </section>

        <aside className="surface owner-confirmation-card">
          {draftSettlements.length ? <><p className="eyebrow">Step 2 · action needed</p><h2>Confirm the transfer</h2><p className="muted">Enter the UTR/reference after you have paid the coach. This issues their payslip.</p>{draftSettlements.map((row) => <form className="owner-confirmation-form" key={row.id} onSubmit={(event) => confirm(event, row.id)} noValidate><div><strong>{row.coachName}</strong><span>{inr.format(amountOf(row.totalAmount))} · {row.periodStart}–{row.periodEnd}</span></div><label><span className="sr-only">Payout reference</span><input name={`utr-${row.id}`} aria-label={`Payout reference for ${row.coachName}`} placeholder="Enter UTR or payment reference" {...invalidProps(`utr-${row.id}`)} /><FieldError id={`utr-${row.id}-error`} message={fieldErrors[`utr-${row.id}`]} /></label><button className="primary-button" disabled={busy} data-state={stateOf(`confirm-${row.id}`)} aria-busy={stateOf(`confirm-${row.id}`) === 'submitting'}>{stateOf(`confirm-${row.id}`) === 'submitting' ? 'Confirming' : 'Confirm payout'}</button></form>)}</> : <><p className="eyebrow">Next step</p><h2>No transfer waiting</h2><p className="muted">Prepare a payout on the left. Once you send the money, return here to confirm its reference and issue the payslip.</p><div className="owner-confirmation-check">✓ <span>All prepared payouts are up to date</span></div></>}
        </aside>
      </div>
    </> : <><section className="finance-summary coach-earnings-summary" aria-label="Your earnings overview">
      <FinanceMetric label="Total net earnings" value={inr.format(coachNetEarnings)} detail="After owner commission" tone="green" />
      <FinanceMetric label="Paid to you" value={inr.format(coachPaidOut)} detail={`${issued.length} confirmed payout${issued.length === 1 ? '' : 's'}`} tone="blue" />
      <FinanceMetric label="Awaiting payout" value={inr.format(coachAwaitingPayout)} detail={draftSettlements.length ? 'Transfer is being confirmed' : 'Ready for the next settlement'} tone="orange" />
      <FinanceMetric label="Owner commission" value={inr.format(coachCommission)} detail={`From ${inr.format(coachGrossEarnings)} client payments`} tone="purple" />
    </section><section className="finance-command finance-single-command coach-earnings-card"><div><p className="eyebrow">Your earnings breakdown</p><h2>{inr.format(coachNetEarnings)} earned in total</h2><p>Each confirmed client payment is split using your agreed commission rate. Refunds and corrections are included automatically.</p></div><dl className="coach-earnings-breakdown"><div><dt>Client payments</dt><dd>{inr.format(coachGrossEarnings)}</dd></div><div><dt>Owner commission</dt><dd>−{inr.format(coachCommission)}</dd></div><div><dt>Net earnings</dt><dd>{inr.format(coachNetEarnings)}</dd></div></dl></section></>}

    {error ? <p className="form-error finance-error" role="alert">{error}</p> : null}

    <section className="surface finance-records"><div className="section-heading"><div><p className="eyebrow">Payout history</p><h2>Settlements and payslips</h2><p className="muted">Select a payout to view the client-payment accruals included in it.</p></div><span className="count-label">{initial.settlements.length}</span></div><div className="finance-record-list">{initial.settlements.length ? initial.settlements.map((row) => { const accrualCount = initial.accruals.filter((accrual) => accrual.settlementId === row.id).length; return <article className="finance-record" key={row.id} data-selected={selectedSettlementId === row.id || undefined}><div className="finance-record-main"><span className={`finance-status ${row.status}`}>{row.status}</span><div><h3>{row.coachName}</h3><p>{row.periodStart} to {row.periodEnd} · Gross {inr.format(amountOf(row.grossRevenue))} · Commission {inr.format(amountOf(row.commissionAmount))}</p></div></div><strong className="finance-amount">{inr.format(amountOf(row.totalAmount))}</strong><div className="earnings-settlement-actions"><button className="secondary-button" type="button" onClick={() => showSettlementTrace(row.id)}>View {accrualCount} accrual{accrualCount === 1 ? '' : 's'}</button>{row.status === 'draft' && initial.owner ? <span className="finance-proof">Confirm this payout above</span> : row.payslipMediaAssetId ? <a className="secondary-button" href={`/api/payslips/${row.payslipMediaAssetId}?tenantId=${tenantId}`} target="_blank">Open payslip</a> : <span className="finance-proof">Payout pending</span>}</div></article>; }) : <p className="muted">No settlement batches have been created yet.</p>}</div></section>

    <section className="surface finance-records" id="accrual-traceability"><div className="section-heading"><div><p className="eyebrow">Traceability</p><h2>Accrual detail</h2><p className="muted">{selectedSettlement ? `Showing the ${traceableAccruals.length} accruals included in ${selectedSettlement.coachName}'s payout.` : 'Every number can be traced back to a confirmed client payment.'}</p>{selectedSettlement ? <button className="secondary-button" type="button" onClick={() => setSelectedSettlementId(null)}>Show all accruals</button> : null}</div><span className="count-label">{traceableAccruals.length}</span></div><div className="finance-record-list">{traceableAccruals.length ? traceableAccruals.map((row) => <article className="finance-record finance-accrual" key={row.id}><div className="finance-record-main"><span className={`finance-status ${row.settled ? 'confirmed' : 'pending'}`}>{row.settled ? 'settled' : 'payable'}</span><div><h3>{row.clientName}</h3><p>{row.coachName} · {row.kind === 'correction' ? 'Correction' : 'Earning'} · {new Date(row.createdAt).toLocaleDateString('en-IN')}</p></div></div><div className="finance-breakdown"><span>Gross <strong>{inr.format(amountOf(row.gross))}</strong></span><span>Commission <strong>{inr.format(amountOf(row.commission))}</strong></span><span>Net <strong>{inr.format(amountOf(row.net))}</strong></span></div></article>) : <p className="muted">No accruals are linked to this payout.</p>}</div></section>
  </div>;
}

function FinanceMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) { return <article className={`finance-metric finance-metric-${tone}`}><span className="metric-mark" aria-hidden="true" /><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function FieldError({ id, message }: { id: string; message?: string }) { return message ? <small className="field-error" id={id}>{message}</small> : null; }

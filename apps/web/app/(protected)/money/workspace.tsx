'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

type RazorpayCheckoutResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayOrder = {
  keyId: string;
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: 'INR';
  name: string;
  description: string;
};

declare global {
  interface Window {
    Razorpay?: new (options: {
      key: string;
      amount: number;
      currency: string;
      name: string;
      description: string;
      order_id: string;
      handler: (response: RazorpayCheckoutResponse) => void;
      theme?: { color: string };
      modal?: { ondismiss?: () => void };
      retry?: { enabled: boolean; max_count: number };
    }) => { open: () => void };
  }
}

type Accrual = {
  kind: 'earning' | 'correction';
  commissionAmount: string;
  coachPayableAmount: string;
  rateApplied: string;
  withinLifespan: boolean;
  windowEndAt: string;
};

type Data = {
  ownerAccess: boolean;
  principalPartyId: string;
  ownerPartyId: string;
  refundCoachClawbackRate: string;
  handles: { id: string; partyName: string; type: string; value: string; label: string | null; isDefault: boolean }[];
  payments: {
    id: string;
    purpose: string;
    reversesPaymentId: string | null;
    clientName: string;
    amount: string;
    method: string;
    status: string;
    utr: string | null;
    gatewayProvider: string | null;
    gatewayOrderId: string | null;
    createdAt: string;
    accrual: Accrual | null;
  }[];
  subscriptions: { id: string; clientName: string; price: string }[];
  organizations: { id: string; name: string }[];
};

type ActionState = 'idle' | 'submitting' | 'complete' | 'failed';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const amountOf = (value: string) => Number(value) || 0;
const valueOf = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const amountPattern = /^\d+(\.\d{1,2})?$/;

export function MoneyWorkspace({ tenantId, initial }: { tenantId: string; initial: Data }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [proofNames, setProofNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const confirmedTotal = initial.payments.filter((payment) => payment.status === 'confirmed').reduce((total, payment) => total + amountOf(payment.amount), 0);
  const pending = initial.payments.filter((payment) => payment.status === 'pending');

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

  function amountProps(name: string) {
    const props = invalidProps(name);
    return {
      ...props,
      inputMode: 'decimal' as const,
      onInput: (event: FormEvent<HTMLInputElement>) => {
        const input = event.currentTarget;
        const [whole, ...rest] = input.value.replace(/[^\d.]/g, '').split('.');
        input.value = rest.length ? `${whole ?? ''}.${rest.join('').slice(0, 2)}` : whole ?? '';
        clearField(name);
      },
    };
  }

  function showErrors(errors: Record<string, string>) {
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function stateOf(action: string) {
    return actionStates[action] ?? 'idle';
  }

  function setActionState(action: string, state: ActionState) {
    setActionStates((current) => ({ ...current, [action]: state }));
  }

  function settleAction(action: string, state: 'complete' | 'failed') {
    setActionState(action, state);
    window.setTimeout(() => {
      setActionStates((current) => ({ ...current, [action]: 'idle' }));
      if (state === 'complete') router.refresh();
    }, state === 'complete' ? 800 : 900);
  }

  function requireAmount(form: FormData, key: string) {
    const raw = valueOf(form, key);
    if (!raw) return 'Enter amount.';
    if (!amountPattern.test(raw)) return 'Use numbers only.';
    return Number(raw) > 0 ? '' : 'Use a valid amount.';
  }

  function validateHandle(form: FormData) {
    const type = valueOf(form, 'type');
    const value = valueOf(form, 'value');
    const errors: Record<string, string> = {};
    if (!value) errors.value = 'Enter handle.';
    else if (type === 'upi' && !/^[\w.-]+@[\w.-]+$/.test(value)) errors.value = 'Use name@bank.';
    else if (type === 'phone' && !/^[0-9+\-\s()]{7,20}$/.test(value)) errors.value = 'Check phone.';
    return errors;
  }

  async function submit(url: string, method: string, body: unknown, action: string) {
    setBusy(true);
    setError('');
    setActionState(action, 'submitting');
    try {
      const response = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      setBusy(false);
      if (!response.ok) {
        setError(data.error ?? 'Operation failed.');
        settleAction(action, 'failed');
        return false;
      }
      settleAction(action, 'complete');
      return true;
    } catch {
      setBusy(false);
      setError('Operation failed.');
      settleAction(action, 'failed');
      return false;
    }
  }

  async function addHandle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const errors = validateHandle(form);
    if (!showErrors(errors)) return;
    if (await submit('/api/money/handles', 'POST', {
      tenantId,
      partyId: initial.principalPartyId,
      type: form.get('type'),
      value: form.get('value'),
      label: form.get('label'),
      isDefault: form.get('isDefault') === 'on',
    }, 'handle')) event.currentTarget.reset();
  }

  async function acceptClientPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const errors: Record<string, string> = {};
    if (!valueOf(form, 'subscriptionId')) errors.subscriptionId = 'Pick client.';
    const amountError = requireAmount(form, 'amount');
    if (amountError) errors.amount = amountError;
    if (!showErrors(errors)) return;
    if (await openRazorpay({
      kind: 'client',
      tenantId,
      subscriptionId: form.get('subscriptionId'),
      amount: form.get('amount'),
    }, 'client-payment')) event.currentTarget.reset();
  }

  async function acceptOrganizationPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const errors: Record<string, string> = {};
    if (!valueOf(form, 'organizationId')) errors.organizationId = 'Pick organization.';
    const amountError = requireAmount(form, 'organizationAmount');
    if (amountError) errors.organizationAmount = amountError;
    if (!showErrors(errors)) return;
    if (await openRazorpay({
      kind: 'organization',
      tenantId,
      organizationId: form.get('organizationId'),
      amount: form.get('organizationAmount'),
    }, 'organization-payment')) event.currentTarget.reset();
  }

  async function openRazorpay(body: Record<string, unknown>, action: string) {
    setBusy(true);
    setError('');
    setActionState(action, 'submitting');
    try {
      await loadRazorpayCheckout();
      const response = await fetch('/api/money/razorpay/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const order = await response.json() as RazorpayOrder | { error?: string };
      if (!response.ok || !('orderId' in order)) throw new Error('error' in order ? order.error : 'Razorpay order failed.');
      await new Promise<void>((resolve, reject) => {
        const checkout = new window.Razorpay!({
          key: order.keyId,
          amount: order.amountMinor,
          currency: order.currency,
          name: order.name,
          description: order.description,
          order_id: order.orderId,
          retry: { enabled: true, max_count: 2 },
          theme: { color: '#0d6b65' },
          modal: { ondismiss: () => reject(new Error('Payment was cancelled.')) },
          handler: async (result) => {
            const confirmation = await fetch('/api/money/razorpay/confirm', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ tenantId, paymentId: order.paymentId, razorpayOrderId: result.razorpay_order_id, razorpayPaymentId: result.razorpay_payment_id, razorpaySignature: result.razorpay_signature }),
            });
            const confirmationBody = await confirmation.json();
            if (!confirmation.ok) reject(new Error(confirmationBody.error ?? 'Payment confirmation failed.'));
            else resolve();
          },
        });
        checkout.open();
      });
      setBusy(false);
      settleAction(action, 'complete');
      return true;
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof Error ? caught.message : 'Razorpay payment failed.');
      settleAction(action, 'failed');
      return false;
    }
  }

  async function saveClawback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rate = Number(valueOf(form, 'rate'));
    if (!showErrors(Number.isFinite(rate) && rate >= 0 && rate <= 100 ? {} : { rate: 'Use 0-100.' })) return;
    await submit('/api/money', 'PATCH', { action: 'config', tenantId, refundCoachClawbackRate: form.get('rate') }, 'clawback');
  }

  async function reverse(event: FormEvent<HTMLFormElement>, paymentId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const key = `refundUtr-${paymentId}`;
    if (!showErrors(valueOf(form, key) ? {} : { [key]: 'Enter UTR.' })) return;
    await submit('/api/money', 'PATCH', { action: 'reverse', tenantId, paymentId, method: form.get('method'), utr: form.get(key) || undefined }, `refund-${paymentId}`);
  }

  async function confirm(event: FormEvent<HTMLFormElement>, paymentId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let proofMediaAssetId: string | undefined;
    const proof = form.get('proof');
    const utrKey = `utr-${paymentId}`;
    const proofKey = `proof-${paymentId}`;
    const actionKey = `confirm-${paymentId}`;
    const hasProof = proof instanceof File && proof.size > 0;
    if (!valueOf(form, utrKey) && !hasProof) {
      if (!showErrors({ [utrKey]: 'Add UTR or proof.', [proofKey]: 'Add UTR or proof.' })) return;
    } else if (hasProof && proof instanceof File && !['image/jpeg', 'image/png', 'image/webp'].includes(proof.type)) {
      if (!showErrors({ [proofKey]: 'Use image file.' })) return;
    }
    setActionState(actionKey, 'submitting');
    if (proof instanceof File && proof.size) {
      setBusy(true);
      const upload = new FormData();
      upload.set('tenantId', tenantId);
      upload.set('paymentId', paymentId);
      upload.set('proof', proof);
      const response = await fetch('/api/money/proof', { method: 'POST', body: upload });
      const result = await response.json();
      if (!response.ok) {
        setBusy(false);
        setError(result.error);
        settleAction(actionKey, 'failed');
        return;
      }
      proofMediaAssetId = result.mediaAssetId;
    }
    await submit('/api/money', 'PATCH', { tenantId, paymentId, utr: form.get(utrKey) || undefined, proofMediaAssetId }, actionKey);
  }

  return (
    <div className="finance-workspace">
      <section className="finance-summary" aria-label="Collections overview">
        <FinanceMetric label="Confirmed" value={inr.format(confirmedTotal)} detail="Cleared inflow" tone="blue" />
        <FinanceMetric label="Pending" value={String(pending.length)} detail="Need UTR or proof" tone="orange" />
        <FinanceMetric label="Handles" value={String(initial.handles.length)} detail="Ways to collect" tone="green" />
        <FinanceMetric label="Subscriptions" value={String(initial.subscriptions.length)} detail="Ready to bill" tone="purple" />
      </section>

      <div className="finance-command-grid">
        <section className="finance-command">
          <div>
            <p className="eyebrow">Primary action</p>
            <h2>Accept payment.</h2>
            <p>Create a Razorpay order and confirm it with server-side signature verification.</p>
          </div>
          <form className="finance-form" onSubmit={acceptClientPayment} noValidate>
            <label>
              <span>Client subscription</span>
              <select name="subscriptionId" required {...invalidProps('subscriptionId')}>
                {initial.subscriptions.length ? initial.subscriptions.map((subscription) => (
                  <option key={subscription.id} value={subscription.id}>
                    {subscription.clientName} · {inr.format(amountOf(subscription.price))}
                  </option>
                )) : <option value="">No subscriptions available</option>}
              </select>
              <FieldError id="subscriptionId-error" message={fieldErrors.subscriptionId} />
            </label>
            <label>
              <span>Amount</span>
              <input name="amount" placeholder="0.00" required {...amountProps('amount')} />
              <FieldError id="amount-error" message={fieldErrors.amount} />
            </label>
            <button className="primary-button" disabled={busy || !initial.subscriptions.length} data-state={stateOf('client-payment')} aria-busy={stateOf('client-payment') === 'submitting'}>
              {stateOf('client-payment') === 'submitting' ? 'Opening Razorpay' : 'Accept with Razorpay'}
            </button>
          </form>
        </section>

        <section className="surface finance-side-card">
          <div className="section-heading">
            <div><p className="eyebrow">Collection setup</p><h2>Pay-in handles</h2></div>
            <span className="count-label">{initial.handles.length}</span>
          </div>
          <div className="finance-handle-list">
            {initial.handles.length ? initial.handles.map((handle) => (
              <div className="finance-handle" key={handle.id}>
                <span className="finance-icon">{handle.type.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{handle.label || handle.type.toUpperCase()}</strong>
                  <p>{handle.value}{handle.isDefault ? ' · Default' : ''}</p>
                </div>
              </div>
            )) : <p className="muted">Add a UPI ID, phone number, or QR reference before collecting.</p>}
          </div>
          <details className="finance-disclosure">
            <summary>Add collection handle</summary>
            <form className="stack-form" onSubmit={addHandle} noValidate>
              <label>
                <span>Type</span>
                <select name="type" {...invalidProps('type')}><option value="upi">UPI</option><option value="phone">Phone</option><option value="qr">QR reference</option></select>
                <FieldError id="type-error" message={fieldErrors.type} />
              </label>
              <label>
                <span>Handle</span>
                <input name="value" required {...invalidProps('value')} />
                <FieldError id="value-error" message={fieldErrors.value} />
              </label>
              <label><span>Label</span><input name="label" /></label>
              <label className="checkbox-row"><input name="isDefault" type="checkbox" /> Make this default</label>
              <button className="secondary-button" disabled={busy} data-state={stateOf('handle')} aria-busy={stateOf('handle') === 'submitting'}>
                {stateOf('handle') === 'submitting' ? 'Saving' : 'Save handle'}
              </button>
            </form>
          </details>
        </section>
      </div>

      {error ? <p className="form-error finance-error" role="alert">{error}</p> : null}

      <section className="surface finance-records">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Verification queue</p>
            <h2>Payment records</h2>
            <p className="muted">Confirmations create the ledger event and commission snapshot.</p>
          </div>
          <span className="count-label">{initial.payments.length}</span>
        </div>
        <div className="finance-record-list">
          {initial.payments.length ? initial.payments.map((payment) => (
            <article className="finance-record" key={payment.id}>
              <div className="finance-record-main">
                <span className={`finance-status ${payment.status}`}>{payment.status}</span>
                <div>
                  <h3>{payment.clientName}</h3>
                  <p>{payment.purpose.replaceAll('_', ' ')} · {payment.gatewayProvider === 'razorpay' ? 'RAZORPAY' : payment.method.toUpperCase()} · {new Date(payment.createdAt).toLocaleString('en-IN')}</p>
                  {payment.accrual ? (
                    <small>
                      {payment.accrual.kind === 'correction' ? 'Correction' : `Owner commission ${payment.accrual.rateApplied}%`}
                      {' · '}Coach payable {inr.format(amountOf(payment.accrual.coachPayableAmount))}
                      {' · '}
                      {payment.accrual.withinLifespan ? `window ends ${new Date(payment.accrual.windowEndAt).toLocaleDateString('en-IN')}` : 'commission window expired'}
                    </small>
                  ) : null}
                </div>
              </div>
              <strong className="finance-amount">{inr.format(amountOf(payment.amount))}</strong>
              {payment.status === 'pending' && payment.gatewayProvider !== 'razorpay' ? (
                <form className="finance-inline-form" onSubmit={(event) => confirm(event, payment.id)} noValidate>
                  <label className="finance-compact-field">
                    <span className="sr-only">UTR</span>
                    <input aria-label="UTR" name={`utr-${payment.id}`} placeholder="UTR reference" {...invalidProps(`utr-${payment.id}`)} />
                    <FieldError id={`utr-${payment.id}-error`} message={fieldErrors[`utr-${payment.id}`]} />
                  </label>
                  <label className="finance-compact-field">
                    <span className="sr-only">Screenshot proof</span>
                    <span className={`finance-upload-control ${fieldErrors[`proof-${payment.id}`] ? 'invalid-input' : ''}`} data-selected={proofNames[payment.id] ? 'true' : undefined}>
                      <input aria-label="Screenshot proof" name="proof" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby={fieldErrors[`proof-${payment.id}`] ? `proof-${payment.id}-error` : undefined} aria-invalid={fieldErrors[`proof-${payment.id}`] ? true : undefined} onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        setProofNames((current) => ({ ...current, [payment.id]: file?.name ?? '' }));
                        clearField(`proof-${payment.id}`);
                      }} />
                      <span className="finance-upload-action">Choose proof</span>
                      <span className="finance-upload-name" title={proofNames[payment.id]}>{proofNames[payment.id] || 'PNG, JPG or WEBP'}</span>
                    </span>
                    <FieldError id={`proof-${payment.id}-error`} message={fieldErrors[`proof-${payment.id}`]} />
                  </label>
                  <button className="primary-button" disabled={busy} data-state={stateOf(`confirm-${payment.id}`)} aria-busy={stateOf(`confirm-${payment.id}`) === 'submitting'}>
                    {stateOf(`confirm-${payment.id}`) === 'submitting' ? 'Confirming' : 'Confirm'}
                  </button>
                </form>
              ) : payment.status === 'pending' ? <span className="finance-proof">Razorpay order pending</span> : <span className="finance-proof">{payment.gatewayProvider === 'razorpay' ? 'Razorpay payment' : 'UTR'} {payment.utr ?? 'Proof attached'}</span>}
              {initial.ownerAccess && payment.purpose === 'client_subscription' && payment.status === 'confirmed' ? (
                <details className="finance-disclosure finance-refund">
                  <summary>Post a refund</summary>
                  <form className="finance-inline-form" onSubmit={(event) => reverse(event, payment.id)} noValidate>
                    <select aria-label="Refund method" name="method"><option value="upi">UPI refund</option><option value="other">Other</option></select>
                    <label className="finance-compact-field">
                      <span className="sr-only">Refund UTR</span>
                      <input aria-label="Refund UTR" name={`refundUtr-${payment.id}`} placeholder="Refund UTR" required {...invalidProps(`refundUtr-${payment.id}`)} />
                      <FieldError id={`refundUtr-${payment.id}-error`} message={fieldErrors[`refundUtr-${payment.id}`]} />
                    </label>
                    <button className="secondary-button" disabled={busy} data-state={stateOf(`refund-${payment.id}`)} aria-busy={stateOf(`refund-${payment.id}`) === 'submitting'}>
                      {stateOf(`refund-${payment.id}`) === 'submitting' ? 'Posting' : 'Post refund'}
                    </button>
                  </form>
                </details>
              ) : null}
            </article>
          )) : <p className="muted">No payment records yet. Record a client payment to begin the audit trail.</p>}
        </div>
      </section>

      {initial.ownerAccess ? (
        <div className="finance-secondary-grid">
          <section className="surface finance-side-card">
            <div className="section-heading"><div><p className="eyebrow">Organizations</p><h2>One-time payment</h2></div></div>
            <form className="stack-form" onSubmit={acceptOrganizationPayment} noValidate>
              <label>
                <span>Organization</span>
                <select name="organizationId" required {...invalidProps('organizationId')}>
                  {initial.organizations.length ? initial.organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>{organization.name}</option>
                  )) : <option value="">No organizations available</option>}
                </select>
                <FieldError id="organizationId-error" message={fieldErrors.organizationId} />
              </label>
              <label>
                <span>Amount</span>
                <input name="organizationAmount" placeholder="0.00" required {...amountProps('organizationAmount')} />
                <FieldError id="organizationAmount-error" message={fieldErrors.organizationAmount} />
              </label>
              <button className="secondary-button" disabled={busy || !initial.organizations.length} data-state={stateOf('organization-payment')} aria-busy={stateOf('organization-payment') === 'submitting'}>
                {stateOf('organization-payment') === 'submitting' ? 'Opening Razorpay' : 'Accept with Razorpay'}
              </button>
            </form>
          </section>
          <section className="surface finance-side-card">
            <div className="section-heading"><div><p className="eyebrow">Refund policy</p><h2>Coach claw-back</h2></div></div>
            <form className="stack-form" onSubmit={saveClawback} noValidate>
              <label>
                <span>Coach share reclaimed (%)</span>
                <input name="rate" type="number" min="0" max="100" step="0.01" defaultValue={initial.refundCoachClawbackRate} required {...invalidProps('rate')} />
                <FieldError id="rate-error" message={fieldErrors.rate} />
              </label>
              <p className="muted">The remaining refunded coach share is absorbed by the organization and posted separately.</p>
              <button className="secondary-button" disabled={busy} data-state={stateOf('clawback')} aria-busy={stateOf('clawback') === 'submitting'}>
                {stateOf('clawback') === 'submitting' ? 'Saving' : 'Save policy'}
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function FinanceMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return (
    <article className={`finance-metric finance-metric-${tone}`}>
      <span className="metric-mark" aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <small className="field-error" id={id}>{message}</small> : null;
}

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.getElementById('razorpay-checkout-js') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Razorpay Checkout could not be loaded.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = 'razorpay-checkout-js';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Razorpay Checkout could not be loaded.'));
    document.head.appendChild(script);
  });
}

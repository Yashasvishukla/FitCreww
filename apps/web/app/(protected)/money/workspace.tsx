'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

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
  checkoutMode: 'test' | 'live' | 'mock';
  mockConfirmation?: {
    razorpayPaymentId: string;
    razorpaySignature: string;
  };
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
  reportingPeriod: { key: string; label: string; start: string; end: string };
  principalPartyId: string;
  ownerPartyId: string;
  refundCoachClawbackRate: string;
  handles: { id: string; partyName: string; type: string; value: string; label: string | null; isDefault: boolean }[];
  payments: {
    id: string;
    subscriptionId: string | null;
    purpose: string;
    reversesPaymentId: string | null;
    clientName: string;
    coachName: string | null;
    amount: string;
    method: string;
    status: string;
    utr: string | null;
    gatewayProvider: string | null;
    gatewayOrderId: string | null;
    installmentNumber: number | null;
    billingPeriodStart: string | null;
    billingPeriodEnd: string | null;
    createdAt: string;
    confirmedAt: string | null;
    accrual: Accrual | null;
  }[];
  subscriptions: { id: string; clientName: string; coachName: string | null; billingCadence: 'upfront' | 'monthly'; totalContractValue: string; installmentAmount: string; durationMonths: number; confirmedInstallmentCount: number; installmentCount: number; remainingInstallmentCount: number; remainingBalance: string }[];
  collectionsDue: { id: string; clientName: string; coachName: string | null; price: string; billingCadence: 'upfront' | 'monthly'; totalContractValue: string; installmentAmount: string; durationMonths: number; confirmedInstallmentCount: number; installmentNumber: number; installmentCount: number; remainingInstallmentCount: number; remainingBalance: string; billingPeriodStart: string; billingPeriodEnd: string; paymentStatus: 'unpaid' | 'pending' | 'confirmed'; canCollect: boolean }[];
  organizations: { id: string; name: string }[];
};

type ActionState = 'idle' | 'submitting' | 'complete' | 'failed';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const amountOf = (value: string) => Number(value) || 0;
const valueOf = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
const amountPattern = /^\d+(\.\d{1,2})?$/;

export function MoneyWorkspace({ tenantId, initial, checkoutMode }: { tenantId: string; initial: Data; checkoutMode: 'test' | 'live' | 'mock' | 'unavailable' }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [proofNames, setProofNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [selectedSubscriptionIdState, setSelectedSubscriptionId] = useState(initial.collectionsDue[0]?.id ?? '');
  const [collectedSubscriptionIds, setCollectedSubscriptionIds] = useState<Set<string>>(new Set());
  const scheduledSubscriptions = initial.collectionsDue;
  // Once a payment is created, its installment leaves this selector. The record
  // remains visible in the monthly activity list below.
  const availableSubscriptions = scheduledSubscriptions.filter((subscription) => subscription.paymentStatus === 'unpaid' && !collectedSubscriptionIds.has(subscription.id));
  const collectableSubscriptions = availableSubscriptions.filter((subscription) => subscription.canCollect);
  const isInReportingPeriod = (value: string | null) => value !== null && value >= initial.reportingPeriod.start && value < initial.reportingPeriod.end;
  const collectionPayments = initial.payments.filter((payment) => payment.purpose !== 'coach_payout');
  const confirmedTotal = collectionPayments.filter((payment) => payment.status === 'confirmed' && isInReportingPeriod(payment.confirmedAt)).reduce((total, payment) => total + amountOf(payment.amount), 0);
  const pending = collectionPayments.filter((payment) => payment.status === 'pending');
  const gatewayPending = pending.filter((payment) => payment.gatewayProvider === 'razorpay');
  const checkoutDetail = gatewayPending.length
    ? `${gatewayPending.length} pending gateway payment${gatewayPending.length === 1 ? '' : 's'}`
    : checkoutMode === 'unavailable'
      ? 'Razorpay credentials required'
      : collectableSubscriptions.length
        ? 'Scheduled installment ready'
      : scheduledSubscriptions.length
          ? 'This month is already in progress'
          : 'No installment scheduled';
  // Refreshing after a collection removes that subscription from the picker.
  // Fall back to the next available option so the controlled select never keeps
  // a stale, invisible value.
  const selectedSubscriptionId = availableSubscriptions.some((subscription) => subscription.id === selectedSubscriptionIdState)
    ? selectedSubscriptionIdState
    : (availableSubscriptions[0]?.id ?? '');
  const selectedSubscription = availableSubscriptions.find((subscription) => subscription.id === selectedSubscriptionId);
  const selectedCanCollect = Boolean(selectedSubscription?.canCollect && !collectedSubscriptionIds.has(selectedSubscription.id));
  const today = new Date();
  const currentMonthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const isCurrentMonth = initial.reportingPeriod.key === currentMonthKey;
  const periodStart = new Date(`${initial.reportingPeriod.key}-01T00:00:00`);
  const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0);
  const periodRange = `${periodStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${periodEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const coachClientPayments = initial.payments.filter((payment) => payment.purpose === 'client_subscription');
  const awaitingVerification = coachClientPayments.filter((payment) => payment.status === 'pending');
  const verifiedPayments = coachClientPayments.filter((payment) => payment.status === 'confirmed');
  const awaitingVerificationAmount = awaitingVerification.reduce((total, payment) => total + amountOf(payment.amount), 0);
  const verifiedCoachShare = verifiedPayments.reduce((total, payment) => total + amountOf(payment.accrual?.coachPayableAmount ?? '0'), 0);
  const plansById = new Map(initial.subscriptions.map((subscription) => [subscription.id, subscription]));

  function changeMonth(offset: number) {
    const [year, month] = initial.reportingPeriod.key.split('-').map(Number);
    const next = new Date(Date.UTC(year!, month! - 1 + offset, 1));
    const params = new URLSearchParams(searchParams.toString());
    params.set('month', `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`);
    router.push(`${pathname}?${params.toString()}`);
  }

  function goToCurrentMonth() {
    const now = new Date();
    const params = new URLSearchParams(searchParams.toString());
    params.set('month', `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`);
    router.push(`${pathname}?${params.toString()}`);
  }

  // The refreshed server data is authoritative after checkout completes.
  useEffect(() => {
    setCollectedSubscriptionIds(new Set());
  }, [initial.collectionsDue]);

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

  function refreshPaymentStatus() {
    setError('');
    router.refresh();
  }

  function requireAmount(form: FormData, key: string) {
    const raw = valueOf(form, key);
    if (!raw) return 'Enter amount.';
    if (!amountPattern.test(raw)) return 'Use numbers only.';
    return Number(raw) > 0 ? '' : 'Use a valid amount.';
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

  async function acceptClientPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const subscriptionId = valueOf(form, 'subscriptionId');
    const subscription = availableSubscriptions.find((row) => row.id === subscriptionId);
    if (!subscription || !subscription.canCollect || collectedSubscriptionIds.has(subscription.id)) {
      showErrors({ subscriptionId: 'Pick client.' });
      return;
    }
    if (await openRazorpay({ kind: 'client', tenantId, subscriptionId }, 'client-payment')) {
      setCollectedSubscriptionIds((current) => new Set(current).add(subscriptionId));
      event.currentTarget.reset();
    }
  }

  async function openRazorpay(body: Record<string, unknown>, action: string) {
    setBusy(true);
    setError('');
    setActionState(action, 'submitting');
    try {
      const response = await fetch('/api/money/razorpay/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const order = await response.json() as RazorpayOrder | { error?: string };
      if (!response.ok || !('orderId' in order)) throw new Error('error' in order ? order.error : 'Razorpay order failed.');
      let checkoutResponse: RazorpayCheckoutResponse;
      if (order.checkoutMode === 'mock') {
        if (!order.mockConfirmation) throw new Error('Mock checkout confirmation is unavailable.');
        checkoutResponse = {
          razorpay_order_id: order.orderId,
          razorpay_payment_id: order.mockConfirmation.razorpayPaymentId,
          razorpay_signature: order.mockConfirmation.razorpaySignature,
        };
      } else {
        await loadRazorpayCheckout();
        checkoutResponse = await new Promise<RazorpayCheckoutResponse>((resolve, reject) => {
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
            handler: (checkoutResult) => resolve(checkoutResult),
          });
          checkout.open();
        });
      }
      const confirmResponse = await fetch('/api/money/razorpay/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          paymentId: order.paymentId,
          razorpayOrderId: checkoutResponse.razorpay_order_id,
          razorpayPaymentId: checkoutResponse.razorpay_payment_id,
          razorpaySignature: checkoutResponse.razorpay_signature,
        }),
      });
      const confirmResult = await confirmResponse.json().catch(() => null) as { error?: string } | null;
      if (!confirmResponse.ok) throw new Error(confirmResult?.error ?? 'FitCrew could not confirm this checkout.');
      setBusy(false);
      settleAction(action, 'complete');
      return true;
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof Error ? caught.message.replaceAll('Razorpay', 'checkout') : 'Checkout payment failed.');
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
      <section className="money-period-bar" aria-label="Monthly reporting period">
        <div className="money-period-copy">
          <div className="money-period-kicker">
            <span className="money-period-icon" aria-hidden="true">▦</span>
            <p className="eyebrow">Monthly report</p>
            {isCurrentMonth ? <span className="money-period-live">Current month</span> : <span className="money-period-archive">Past month</span>}
          </div>
          <h2>Viewing {initial.reportingPeriod.label}</h2>
          <p>{periodRange} · All collections and activity are grouped by calendar month.</p>
        </div>
        <div className="money-period-controls" role="group" aria-label="Change reporting month">
          <div className="month-switcher">
            <button type="button" className="month-switcher-button" onClick={() => changeMonth(-1)} aria-label="View previous month">
              <span aria-hidden="true">‹</span>
            </button>
            <span className="month-switcher-label" aria-live="polite">{initial.reportingPeriod.label}</span>
            <button type="button" className="month-switcher-button" onClick={() => changeMonth(1)} aria-label="View next month">
              <span aria-hidden="true">›</span>
            </button>
          </div>
          {!isCurrentMonth ? <button type="button" className="month-current-button" onClick={goToCurrentMonth} aria-label="View current month">Today</button> : null}
        </div>
      </section>
      <section className="finance-summary" aria-label="Collections overview">
        <FinanceMetric label={`Collected in ${initial.reportingPeriod.label}`} value={inr.format(confirmedTotal)} detail="Confirmed inflow" tone="blue" />
        <FinanceMetric label={`To verify in ${initial.reportingPeriod.label}`} value={inr.format(pending.reduce((total, payment) => total + amountOf(payment.amount), 0))} detail={`${pending.length} payment${pending.length === 1 ? '' : 's'} awaiting review`} tone="orange" />
        <FinanceMetric label={`${initial.reportingPeriod.label} activity`} value={String(initial.payments.length)} detail={initial.payments.length ? 'Created or confirmed in this period' : 'No activity yet'} tone="purple" />
        <FinanceMetric label="Ready to collect now" value={String(collectableSubscriptions.length)} detail={checkoutDetail} tone={gatewayPending.length ? 'orange' : 'green'} />
      </section>

      <div className="finance-command-grid">
        <section className={`finance-command${selectedSubscription ? '' : ' finance-command-empty'}`}>
          <div>
            <p className="eyebrow">Subscription schedule</p>
            <h2>Review this month’s installment.</h2>
            <p>The client and installment below always match the month you are viewing. Confirmed collections flow into coach earnings automatically.</p>
          </div>
          <form className="finance-form" onSubmit={acceptClientPayment} noValidate>
            <label className="finance-subscription-field">
              {availableSubscriptions.length ? <><span>Client subscription</span><select name="subscriptionId" aria-label="Client subscription" value={selectedSubscriptionId} {...invalidProps('subscriptionId')} onChange={(event) => {
                setSelectedSubscriptionId(event.currentTarget.value);
                clearField('subscriptionId');
              }}>
                {availableSubscriptions.map((subscription) => (
                  <option key={subscription.id} value={subscription.id}>
                    {subscription.clientName} · {subscription.coachName ? `Coach: ${subscription.coachName} · ` : ''}{subscription.billingCadence === 'monthly' ? `Month ${subscription.installmentNumber}/${subscription.installmentCount} · ` : ''}{inr.format(amountOf(subscription.price))}
                  </option>
                ))}
              </select><FieldError id="subscriptionId-error" message={fieldErrors.subscriptionId} /></> : null}
              {selectedSubscription ? <div className="collection-plan" aria-label="Selected payment plan"><div className="collection-plan-title"><strong>{selectedSubscription.billingCadence === 'monthly' ? `Installment ${selectedSubscription.installmentNumber} of ${selectedSubscription.installmentCount}` : 'Full package'}</strong><b>{inr.format(amountOf(selectedSubscription.price))}</b></div><dl><div><dt>Coach</dt><dd>{selectedSubscription.coachName ?? 'Not assigned'}</dd></div><div><dt>Scheduled for</dt><dd>{new Date(selectedSubscription.billingPeriodStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – {new Date(selectedSubscription.billingPeriodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</dd></div><div><dt>Payment status</dt><dd className={`collection-status ${selectedSubscription.paymentStatus}`}>{selectedSubscription.paymentStatus}</dd></div><div><dt>Balance after this</dt><dd>{inr.format(Math.max(0, amountOf(selectedSubscription.remainingBalance) - amountOf(selectedSubscription.price)))}</dd></div></dl></div> : <div className="collection-empty"><strong>{scheduledSubscriptions.length ? 'All installments are already recorded.' : 'No installment is scheduled for this month.'}</strong><span>{scheduledSubscriptions.length ? 'Paid and pending installments appear in the payment activity below.' : 'Choose another month to review its subscription schedule.'}</span></div>}
            </label>
            <button className="primary-button checkout-button" disabled={busy || !selectedCanCollect || checkoutMode === 'unavailable'} data-state={stateOf('client-payment')} aria-busy={stateOf('client-payment') === 'submitting'}>
              {stateOf('client-payment') === 'submitting' ? 'Recording test payment…' : checkoutMode === 'mock' && selectedCanCollect ? `Record ${inr.format(amountOf(selectedSubscription?.price ?? '0'))} test payment →` : checkoutMode === 'unavailable' ? 'Checkout needs setup' : !selectedSubscription ? 'No payment to collect' : selectedCanCollect ? 'Continue to checkout →' : 'Not available to collect'}
            </button>
          </form>
        </section>
      </div>

      {error ? <p className="form-error finance-error" role="alert">{error}</p> : null}

      {initial.ownerAccess ? <section className="surface finance-records">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Verification queue</p>
            <h2>Payment records</h2>
            <p className="muted">Payment activity in {initial.reportingPeriod.label}. Confirmations create the ledger event and commission snapshot.</p>
          </div>
          <span className="count-label">{initial.payments.length}</span>
        </div>
        <div className="finance-record-list">
          {initial.payments.length ? initial.payments.map((payment) => {
            const plan = payment.subscriptionId ? plansById.get(payment.subscriptionId) : undefined;
            return <article className="finance-record" key={payment.id}>
              <div className="finance-record-main">
                <span className={`finance-status ${payment.status}`}>{payment.status}</span>
                <div>
                  <h3>{payment.clientName}</h3>
                  <p>{payment.purpose.replaceAll('_', ' ')} · {payment.gatewayProvider ? 'ONLINE PAYMENT' : payment.method.toUpperCase()} · {new Date(payment.createdAt).toLocaleString('en-IN')}</p>
                  {payment.installmentNumber ? <small>Installment {payment.installmentNumber} of {plan?.installmentCount ?? '—'}{payment.billingPeriodStart && payment.billingPeriodEnd ? ` · ${new Date(payment.billingPeriodStart).toLocaleDateString('en-IN')} to ${new Date(payment.billingPeriodEnd).toLocaleDateString('en-IN')}` : ''}</small> : null}
                  {plan ? <small>Plan balance remaining: {inr.format(amountOf(plan.remainingBalance))} · {plan.remainingInstallmentCount} installment{plan.remainingInstallmentCount === 1 ? '' : 's'} remaining</small> : null}
                  {payment.coachName ? <small>Assigned coach: {payment.coachName}</small> : null}
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
              {payment.status === 'pending' && payment.purpose !== 'coach_payout' && payment.method !== 'razorpay' && payment.gatewayProvider !== 'razorpay' ? (
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
              ) : payment.status === 'pending' ? <span className="finance-proof">{payment.purpose === 'coach_payout' ? 'Confirm in Earnings' : 'Online payment pending verification'}</span> : <span className="finance-proof">{payment.gatewayProvider ? 'Online payment' : 'UTR'} {payment.utr ?? 'Proof attached'}</span>}
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
            </article>;
          }) : <p className="muted">No payment records yet. Record a client payment to begin the audit trail.</p>}
        </div>
      </section> : <section className="surface finance-records coach-payment-status">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Payment status</p>
            <h2>{awaitingVerification.length ? 'Awaiting administrator verification' : verifiedPayments.length ? 'Payments verified' : 'No client payments yet'}</h2>
            <p className="muted">{awaitingVerification.length ? 'The owner needs to verify these client payments before they create coach earnings.' : verifiedPayments.length ? 'Verified client payments have created earning records. View your Earnings page for payout and payslip status.' : 'When you collect a client payment, its verification status will appear here.'}</p>
          </div>
          <button className="secondary-button finance-status-refresh" type="button" onClick={refreshPaymentStatus}>Refresh status</button>
        </div>
        <div className="coach-payment-status-grid">
          <div><span>Awaiting verification</span><strong>{awaitingVerification.length}</strong><small>{inr.format(awaitingVerificationAmount)} from clients</small></div>
          <div><span>Verified payments</span><strong>{verifiedPayments.length}</strong><small>{inr.format(verifiedPayments.reduce((total, payment) => total + amountOf(payment.amount), 0))} confirmed</small></div>
          <div><span>Coach share recorded</span><strong>{inr.format(verifiedCoachShare)}</strong><small>From verified payments</small></div>
        </div>
      </section>}

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
              <button className="secondary-button" disabled={busy || !initial.organizations.length || checkoutMode === 'unavailable'} data-state={stateOf('organization-payment')} aria-busy={stateOf('organization-payment') === 'submitting'}>
                {stateOf('organization-payment') === 'submitting' ? 'Opening checkout' : checkoutMode === 'unavailable' ? 'Checkout unavailable' : 'Accept payment'}
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

import { describe, expect, it } from 'vitest';
import { ManualConfirmationSource, ManualMeasurementSource, type IPaymentConfirmationSource, type IMeasurementSource } from '../src/index.js';

function paymentConfirmationContract(createSource: () => IPaymentConfirmationSource) {
  it('returns a payment confirmation with source and timestamp', async () => {
    const result = await createSource().awaitConfirmation('payment-1');
    expect(result.source).toMatch(/^(manual|gateway)$/);
    expect(result.confirmedAt).toBeInstanceOf(Date);
    expect(result.utr !== null || result.proofMediaAssetId !== null).toBe(true);
  });
}

function measurementContract(createSource: () => IMeasurementSource) {
  it('returns a validated measurement snapshot', async () => {
    const result = await createSource().capture('client-1');
    expect(result.source).toMatch(/^(manual|gateway)$/);
    expect(result.capturedAt).toBeInstanceOf(Date);
    expect(Object.keys(result.values).length).toBeGreaterThan(0);
    expect(Object.values(result.values).every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
  });
}

describe('IPaymentConfirmationSource contract', () => {
  paymentConfirmationContract(() => new ManualConfirmationSource({ utr: 'UTR123456' }, () => new Date('2026-09-06T10:00:00.000Z')));
  paymentConfirmationContract(() => ({ awaitConfirmation: async () => ({ source: 'gateway', confirmedAt: new Date('2026-09-06T10:00:00.000Z'), utr: 'GW123456', proofMediaAssetId: null }) }));
});

describe('IMeasurementSource contract', () => {
  measurementContract(() => new ManualMeasurementSource({ weightKg: 80, bodyFatPct: 18 }, () => new Date('2026-09-06T10:00:00.000Z')));
  measurementContract(() => ({ capture: async () => ({ source: 'gateway', capturedAt: new Date('2026-09-06T10:00:00.000Z'), values: { weightKg: 80, bmi: 24 } }) }));
});

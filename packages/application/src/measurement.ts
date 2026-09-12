export type MeasurementValues = Readonly<Record<string, number>>;

export type MeasurementSnapshot = {
  readonly source: 'manual' | 'gateway';
  readonly capturedAt: Date;
  readonly values: MeasurementValues;
};

export interface IMeasurementSource {
  capture(clientId: string): Promise<MeasurementSnapshot>;
}

export class ManualMeasurementSource implements IMeasurementSource {
  constructor(private readonly values: MeasurementValues, private readonly clock: () => Date = () => new Date()) {}

  async capture(_clientId: string): Promise<MeasurementSnapshot> {
    const entries = Object.entries(this.values);
    if (!entries.length || entries.some(([key, value]) => !key.trim() || !Number.isFinite(value) || value < 0)) {
      throw new Error('Measurements must be non-negative finite numbers.');
    }
    return { source: 'manual', capturedAt: this.clock(), values: Object.freeze(Object.fromEntries(entries)) };
  }
}

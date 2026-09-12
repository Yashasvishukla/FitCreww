type TelemetryProperties = Readonly<Record<string, string>>;
type TelemetryMeasurements = Readonly<Record<string, number>>;

/** App Insights ingestion is intentionally best-effort: telemetry must never break a business request. */
export async function trackServerEvent(name: string, properties: TelemetryProperties = {}, measurements: TelemetryMeasurements = {}): Promise<void> {
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) return;
  const instrumentationKey = connectionString.match(/(?:^|;)InstrumentationKey=([^;]+)/i)?.[1];
  if (!instrumentationKey) return;
  const ingestionEndpoint = connectionString.match(/(?:^|;)IngestionEndpoint=([^;]+)/i)?.[1]?.replace(/\/$/, '') ?? 'https://dc.services.visualstudio.com';
  try {
    await fetch(`${ingestionEndpoint}/v2/track`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Microsoft.ApplicationInsights.Event', time: new Date().toISOString(), iKey: instrumentationKey, data: { baseType: 'EventData', baseData: { ver: 2, name, properties, measurements } } }), signal: AbortSignal.timeout(1_000) });
  } catch {
    // Observability is non-blocking by design.
  }
}

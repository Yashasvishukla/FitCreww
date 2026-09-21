-- Persist gateway delivery identifiers separately from payments. This gives
-- webhook handling a durable idempotency boundary and an audit trail without
-- retaining sensitive raw gateway payloads.
CREATE TABLE public.payment_gateway_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payment_record_id uuid REFERENCES public.payment_record(id),
  payload_sha256 text NOT NULL,
  outcome text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE UNIQUE INDEX payment_gateway_event_provider_event_key
  ON public.payment_gateway_event(tenant_id, provider, event_id);
CREATE INDEX payment_gateway_event_lookup_idx
  ON public.payment_gateway_event(tenant_id, provider, event_type, received_at);
CREATE INDEX payment_gateway_event_payment_idx
  ON public.payment_gateway_event(tenant_id, payment_record_id);

ALTER TABLE public.payment_gateway_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_gateway_event FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_gateway_event_tenant_isolation ON public.payment_gateway_event
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON public.payment_gateway_event TO fitcrew_app;

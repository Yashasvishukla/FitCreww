CREATE TYPE public."PaymentWebhookEventStatus" AS ENUM ('received', 'processed', 'failed');

CREATE TABLE public.payment_webhook_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  signature_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status public."PaymentWebhookEventStatus" NOT NULL DEFAULT 'received',
  payload_sha256 text NOT NULL,
  error text,
  CONSTRAINT payment_webhook_event_provider_check CHECK (provider = 'razorpay'),
  CONSTRAINT payment_webhook_event_hash_shape_check CHECK (
    signature_hash ~ '^[a-f0-9]{64}$' AND payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT payment_webhook_event_processed_shape_check CHECK (
    (status = 'processed' AND processed_at IS NOT NULL AND error IS NULL)
    OR (status <> 'processed')
  )
);

CREATE UNIQUE INDEX payment_webhook_event_provider_event_key
  ON public.payment_webhook_event(provider, provider_event_id);

CREATE INDEX payment_webhook_event_tenant_status_idx
  ON public.payment_webhook_event(tenant_id, provider, status, received_at);

ALTER TABLE public.payment_webhook_event ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_webhook_event_tenant_isolation
  ON public.payment_webhook_event
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

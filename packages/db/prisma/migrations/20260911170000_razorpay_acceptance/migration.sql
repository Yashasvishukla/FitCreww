ALTER TYPE public."PaymentMethod" ADD VALUE IF NOT EXISTS 'razorpay';

ALTER TABLE public.payment_record
  ADD COLUMN gateway_provider text,
  ADD COLUMN gateway_order_id text,
  ADD COLUMN gateway_payment_id text,
  ADD COLUMN gateway_signature text,
  ADD CONSTRAINT payment_record_gateway_provider_check CHECK (
    gateway_provider IS NULL OR gateway_provider = 'razorpay'
  ),
  ADD CONSTRAINT payment_record_gateway_shape_check CHECK (
    confirmation_source <> 'gateway'
    OR (gateway_provider IS NOT NULL AND gateway_order_id IS NOT NULL AND gateway_payment_id IS NOT NULL)
  );

CREATE UNIQUE INDEX payment_record_gateway_order_key
  ON public.payment_record(tenant_id, gateway_order_id)
  WHERE gateway_order_id IS NOT NULL;

CREATE UNIQUE INDEX payment_record_gateway_payment_key
  ON public.payment_record(tenant_id, gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_payment_record_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'confirmed payment records are immutable; post a reversal instead' USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'pending'
     AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
     AND NEW.payer_party_id IS NOT DISTINCT FROM OLD.payer_party_id
     AND NEW.payee_party_id IS NOT DISTINCT FROM OLD.payee_party_id
     AND NEW.subscription_id IS NOT DISTINCT FROM OLD.subscription_id
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND NEW.reverses_payment_id IS NOT DISTINCT FROM OLD.reverses_payment_id
     AND NEW.purpose IS NOT DISTINCT FROM OLD.purpose
     AND NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.method IS NOT DISTINCT FROM OLD.method
     AND NEW.utr IS NOT DISTINCT FROM OLD.utr
     AND NEW.proof_media_asset_id IS NOT DISTINCT FROM OLD.proof_media_asset_id
     AND NEW.confirmation_source IS NOT DISTINCT FROM OLD.confirmation_source
     AND NEW.confirmed_by_party_id IS NOT DISTINCT FROM OLD.confirmed_by_party_id
     AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'confirmed' AND NEW.status = 'reversed' THEN
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'confirmed payment records are immutable; post a reversal instead' USING ERRCODE = '55000';
  END IF;

  IF NEW.tenant_id <> OLD.tenant_id OR NEW.payer_party_id <> OLD.payer_party_id
     OR NEW.payee_party_id <> OLD.payee_party_id OR NEW.amount <> OLD.amount
     OR NEW.purpose <> OLD.purpose OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.reverses_payment_id IS DISTINCT FROM OLD.reverses_payment_id THEN
    RAISE EXCEPTION 'payment financial identity cannot be changed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TYPE public."PayoutHandleType" AS ENUM ('upi', 'phone', 'qr');
CREATE TYPE public."PaymentPurpose" AS ENUM ('client_subscription', 'coach_payout', 'org_agreement', 'correction');
CREATE TYPE public."PaymentMethod" AS ENUM ('upi', 'qr', 'phone', 'other');
CREATE TYPE public."PaymentStatus" AS ENUM ('pending', 'confirmed', 'reversed');
CREATE TYPE public."PaymentConfirmationSource" AS ENUM ('manual', 'gateway');

CREATE TABLE public.payout_handle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  party_id uuid NOT NULL REFERENCES public.party(id) ON DELETE RESTRICT,
  type public."PayoutHandleType" NOT NULL,
  value text NOT NULL,
  label text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL,
  CONSTRAINT payout_handle_value_check CHECK (length(btrim(value)) > 0),
  CONSTRAINT payout_handle_natural_key UNIQUE (tenant_id, party_id, type, value)
);
CREATE INDEX payout_handle_tenant_party_default_idx ON public.payout_handle(tenant_id, party_id, is_default);
CREATE UNIQUE INDEX payout_handle_one_default_idx ON public.payout_handle(tenant_id, party_id)
  WHERE is_default;

CREATE TABLE public.payment_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  payer_party_id uuid NOT NULL REFERENCES public.party(id) ON DELETE RESTRICT,
  payee_party_id uuid NOT NULL REFERENCES public.party(id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES public.subscription(id) ON DELETE RESTRICT,
  purpose public."PaymentPurpose" NOT NULL,
  amount numeric(18,2) NOT NULL,
  method public."PaymentMethod" NOT NULL,
  status public."PaymentStatus" NOT NULL DEFAULT 'pending',
  utr text,
  proof_media_asset_id uuid REFERENCES public.media_asset(id) ON DELETE RESTRICT,
  confirmation_source public."PaymentConfirmationSource",
  confirmed_by_party_id uuid REFERENCES public.party(id) ON DELETE RESTRICT,
  confirmed_at timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payment_record_amount_check CHECK (amount > 0),
  CONSTRAINT payment_record_parties_check CHECK (payer_party_id <> payee_party_id),
  CONSTRAINT payment_record_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT payment_record_confirmation_state_check CHECK (
    (status = 'pending' AND confirmation_source IS NULL AND confirmed_by_party_id IS NULL AND confirmed_at IS NULL)
    OR (status IN ('confirmed', 'reversed') AND confirmation_source IS NOT NULL AND confirmed_by_party_id IS NOT NULL AND confirmed_at IS NOT NULL)
  ),
  CONSTRAINT payment_record_manual_proof_check CHECK (
    confirmation_source <> 'manual' OR utr IS NOT NULL OR proof_media_asset_id IS NOT NULL
  )
);
CREATE INDEX payment_record_tenant_status_created_idx ON public.payment_record(tenant_id, status, created_at DESC);
CREATE INDEX payment_record_tenant_payer_created_idx ON public.payment_record(tenant_id, payer_party_id, created_at DESC);

CREATE FUNCTION public.guard_payment_record_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'confirmed payment records are immutable; post a reversal instead' USING ERRCODE = '55000';
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.payer_party_id <> OLD.payer_party_id
     OR NEW.payee_party_id <> OLD.payee_party_id OR NEW.amount <> OLD.amount
     OR NEW.purpose <> OLD.purpose OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id THEN
    RAISE EXCEPTION 'payment financial identity cannot be changed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_record_guard BEFORE UPDATE ON public.payment_record
FOR EACH ROW EXECUTE FUNCTION public.guard_payment_record_mutation();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['payout_handle', 'payment_record'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', table_name || '_tenant_isolation', table_name);
  END LOOP;
END $$;

GRANT USAGE ON TYPE public."PayoutHandleType", public."PaymentPurpose", public."PaymentMethod", public."PaymentStatus", public."PaymentConfirmationSource" TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payout_handle TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE ON public.payment_record TO fitcrew_app;

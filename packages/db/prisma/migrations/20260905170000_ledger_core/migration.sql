CREATE TYPE public."LedgerAccountPurpose" AS ENUM (
  'client_receivable', 'owner_cash', 'coach_payable',
  'commission_income', 'org_agreement_receivable'
);
CREATE TYPE public."LedgerReferenceType" AS ENUM ('payment', 'settlement', 'correction');
CREATE TYPE public."LedgerDirection" AS ENUM ('debit', 'credit');

CREATE TABLE public.ledger_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  party_id uuid NOT NULL REFERENCES public.party(id) ON DELETE RESTRICT,
  purpose public."LedgerAccountPurpose" NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ledger_account_currency_check CHECK (currency = 'INR'),
  CONSTRAINT ledger_account_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT ledger_account_natural_key UNIQUE (tenant_id, party_id, purpose, currency)
);
CREATE INDEX ledger_account_tenant_purpose_idx ON public.ledger_account(tenant_id, purpose);

CREATE TABLE public.ledger_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  description text NOT NULL,
  reference_type public."LedgerReferenceType" NOT NULL,
  reference_id uuid NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ledger_entry_description_check CHECK (length(btrim(description)) > 0),
  CONSTRAINT ledger_entry_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT ledger_entry_reference_key UNIQUE (tenant_id, reference_type, reference_id)
);
CREATE INDEX ledger_entry_tenant_created_idx ON public.ledger_entry(tenant_id, created_at DESC);

CREATE TABLE public.ledger_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  entry_id uuid NOT NULL,
  account_id uuid NOT NULL,
  direction public."LedgerDirection" NOT NULL,
  amount numeric(18, 2) NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ledger_line_amount_check CHECK (amount > 0),
  CONSTRAINT ledger_line_entry_tenant_fkey FOREIGN KEY (entry_id, tenant_id)
    REFERENCES public.ledger_entry(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT ledger_line_account_tenant_fkey FOREIGN KEY (account_id, tenant_id)
    REFERENCES public.ledger_account(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX ledger_line_tenant_entry_idx ON public.ledger_line(tenant_id, entry_id);
CREATE INDEX ledger_line_tenant_account_created_idx ON public.ledger_line(tenant_id, account_id, created_at DESC);

CREATE FUNCTION public.assert_ledger_entry_balanced() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE target_entry_id uuid := COALESCE(NEW.entry_id, OLD.entry_id);
DECLARE line_count bigint;
DECLARE signed_total numeric(18, 2);
BEGIN
  SELECT count(*), COALESCE(sum(CASE WHEN direction = 'debit' THEN amount ELSE -amount END), 0)
    INTO line_count, signed_total
    FROM public.ledger_line
   WHERE entry_id = target_entry_id;
  IF line_count < 2 OR signed_total <> 0 THEN
    RAISE EXCEPTION 'ledger entry % must have at least two lines and balance to zero (lines %, balance %)',
      target_entry_id, line_count, signed_total USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_line_balance_check
AFTER INSERT ON public.ledger_line
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.assert_ledger_entry_balanced();

CREATE FUNCTION public.reject_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; post a reversing entry instead', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER ledger_account_append_only BEFORE UPDATE OR DELETE ON public.ledger_account
FOR EACH ROW EXECUTE FUNCTION public.reject_ledger_mutation();
CREATE TRIGGER ledger_entry_append_only BEFORE UPDATE OR DELETE ON public.ledger_entry
FOR EACH ROW EXECUTE FUNCTION public.reject_ledger_mutation();
CREATE TRIGGER ledger_line_append_only BEFORE UPDATE OR DELETE ON public.ledger_line
FOR EACH ROW EXECUTE FUNCTION public.reject_ledger_mutation();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['ledger_account', 'ledger_entry', 'ledger_line'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', table_name || '_tenant_isolation', table_name);
  END LOOP;
END $$;

GRANT USAGE ON TYPE public."LedgerAccountPurpose", public."LedgerReferenceType", public."LedgerDirection" TO fitcrew_app;
GRANT SELECT, INSERT ON public.ledger_account, public.ledger_entry, public.ledger_line TO fitcrew_app;

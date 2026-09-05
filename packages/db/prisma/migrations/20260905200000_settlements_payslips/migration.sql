CREATE TYPE public."SettlementStatus" AS ENUM ('draft', 'paid');

CREATE TABLE public.settlement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  coach_party_id uuid NOT NULL REFERENCES public.party(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  gross_revenue numeric(18,2) NOT NULL,
  commission_amount numeric(18,2) NOT NULL,
  total_amount numeric(18,2) NOT NULL,
  status public."SettlementStatus" NOT NULL DEFAULT 'draft',
  payout_payment_id uuid UNIQUE REFERENCES public.payment_record(id) ON DELETE RESTRICT,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at timestamp(3),
  CONSTRAINT settlement_id_tenant_key UNIQUE (id, tenant_id),
  CONSTRAINT settlement_period_check CHECK (period_end >= period_start),
  CONSTRAINT settlement_amounts_check CHECK (gross_revenue > 0 AND commission_amount >= 0 AND total_amount > 0 AND commission_amount + total_amount = gross_revenue),
  CONSTRAINT settlement_state_check CHECK ((status = 'draft' AND paid_at IS NULL) OR (status = 'paid' AND paid_at IS NOT NULL AND payout_payment_id IS NOT NULL))
);
CREATE INDEX settlement_tenant_coach_status_idx ON public.settlement(tenant_id, coach_party_id, status);

ALTER TABLE public.commission_accrual ADD CONSTRAINT commission_accrual_settlement_fkey
  FOREIGN KEY (settlement_id, tenant_id) REFERENCES public.settlement(id, tenant_id) ON DELETE RESTRICT;

CREATE TABLE public.payslip (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  settlement_id uuid NOT NULL UNIQUE,
  gross_revenue numeric(18,2) NOT NULL,
  commission_deducted numeric(18,2) NOT NULL,
  net_paid numeric(18,2) NOT NULL,
  detail jsonb NOT NULL,
  document_media_asset_id uuid NOT NULL UNIQUE REFERENCES public.media_asset(id) ON DELETE RESTRICT,
  issued_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (settlement_id, tenant_id) REFERENCES public.settlement(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT payslip_amounts_check CHECK (gross_revenue > 0 AND commission_deducted >= 0 AND net_paid > 0 AND commission_deducted + net_paid = gross_revenue)
);
CREATE INDEX payslip_tenant_issued_idx ON public.payslip(tenant_id, issued_at DESC);

CREATE FUNCTION public.guard_settlement_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status = 'paid' THEN RAISE EXCEPTION 'paid settlements are immutable' USING ERRCODE = '55000'; END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.coach_party_id <> OLD.coach_party_id OR NEW.period_start <> OLD.period_start
    OR NEW.period_end <> OLD.period_end OR NEW.gross_revenue <> OLD.gross_revenue
    OR NEW.commission_amount <> OLD.commission_amount OR NEW.total_amount <> OLD.total_amount THEN
    RAISE EXCEPTION 'settlement financial snapshot is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER settlement_guard BEFORE UPDATE ON public.settlement FOR EACH ROW EXECUTE FUNCTION public.guard_settlement_mutation();
CREATE TRIGGER settlement_no_delete BEFORE DELETE ON public.settlement FOR EACH ROW EXECUTE FUNCTION public.reject_ledger_mutation();
CREATE TRIGGER payslip_append_only BEFORE UPDATE OR DELETE ON public.payslip FOR EACH ROW EXECUTE FUNCTION public.reject_ledger_mutation();

CREATE FUNCTION public.guard_payslip_media() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payslip WHERE document_media_asset_id = OLD.id) THEN
    RAISE EXCEPTION 'payslip documents are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payslip_media_guard BEFORE UPDATE OR DELETE ON public.media_asset FOR EACH ROW EXECUTE FUNCTION public.guard_payslip_media();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['settlement', 'payslip'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', table_name || '_tenant_isolation', table_name);
  END LOOP;
END $$;

GRANT USAGE ON TYPE public."SettlementStatus" TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE ON public.settlement, public.payslip TO fitcrew_app;

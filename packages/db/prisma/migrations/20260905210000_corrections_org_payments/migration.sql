CREATE TYPE public."CommissionAccrualKind" AS ENUM ('earning', 'correction');
ALTER TYPE public."LedgerAccountPurpose" ADD VALUE 'refund_absorption_expense';

ALTER TABLE public.tenant_config
  ADD COLUMN refund_coach_clawback_rate numeric(5,2) NOT NULL DEFAULT 100,
  ADD CONSTRAINT tenant_config_refund_clawback_check CHECK (refund_coach_clawback_rate BETWEEN 0 AND 100);

ALTER TABLE public.organization ADD CONSTRAINT organization_id_tenant_key UNIQUE (id, tenant_id);

ALTER TABLE public.ledger_entry
  ADD COLUMN reverses_entry_id uuid,
  ADD CONSTRAINT ledger_entry_reverses_key UNIQUE (reverses_entry_id),
  ADD CONSTRAINT ledger_entry_reverses_fkey FOREIGN KEY (reverses_entry_id, tenant_id)
    REFERENCES public.ledger_entry(id, tenant_id) ON DELETE RESTRICT;

ALTER TABLE public.payment_record
  ADD COLUMN organization_id uuid,
  ADD COLUMN reverses_payment_id uuid,
  ADD CONSTRAINT payment_record_organization_fkey FOREIGN KEY (organization_id, tenant_id)
    REFERENCES public.organization(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT payment_record_reverses_fkey FOREIGN KEY (reverses_payment_id, tenant_id)
    REFERENCES public.payment_record(id, tenant_id) ON DELETE RESTRICT,
  ADD CONSTRAINT payment_record_reverses_key UNIQUE (reverses_payment_id),
  ADD CONSTRAINT payment_record_shape_check CHECK (
    (purpose = 'client_subscription' AND subscription_id IS NOT NULL AND organization_id IS NULL AND reverses_payment_id IS NULL)
    OR (purpose = 'org_agreement' AND organization_id IS NOT NULL AND subscription_id IS NULL AND reverses_payment_id IS NULL)
    OR (purpose = 'correction' AND reverses_payment_id IS NOT NULL AND subscription_id IS NULL AND organization_id IS NULL)
    OR (purpose = 'coach_payout' AND subscription_id IS NULL AND organization_id IS NULL AND reverses_payment_id IS NULL)
  );
CREATE UNIQUE INDEX payment_record_one_org_agreement_idx
  ON public.payment_record(tenant_id, organization_id)
  WHERE purpose = 'org_agreement';

ALTER TABLE public.commission_accrual
  ADD COLUMN kind public."CommissionAccrualKind" NOT NULL DEFAULT 'earning',
  ADD COLUMN reverses_accrual_id uuid,
  ADD CONSTRAINT commission_accrual_reverses_key UNIQUE (reverses_accrual_id),
  ADD CONSTRAINT commission_accrual_reverses_fkey FOREIGN KEY (reverses_accrual_id)
    REFERENCES public.commission_accrual(id) ON DELETE RESTRICT;
ALTER TABLE public.commission_accrual DROP CONSTRAINT commission_accrual_amounts_check;
ALTER TABLE public.commission_accrual ADD CONSTRAINT commission_accrual_amounts_check CHECK (
  commission_amount + coach_payable_amount = gross_amount
  AND ((kind = 'earning' AND gross_amount > 0 AND commission_amount >= 0 AND coach_payable_amount >= 0 AND reverses_accrual_id IS NULL)
    OR (kind = 'correction' AND gross_amount < 0 AND commission_amount <= 0 AND coach_payable_amount <= 0 AND reverses_accrual_id IS NOT NULL))
);

ALTER TABLE public.settlement DROP CONSTRAINT settlement_amounts_check;
ALTER TABLE public.settlement ADD CONSTRAINT settlement_amounts_check CHECK (
  total_amount > 0 AND commission_amount + total_amount = gross_revenue
);
ALTER TABLE public.payslip DROP CONSTRAINT payslip_amounts_check;
ALTER TABLE public.payslip ADD CONSTRAINT payslip_amounts_check CHECK (
  net_paid > 0 AND commission_deducted + net_paid = gross_revenue
);

CREATE OR REPLACE FUNCTION public.guard_commission_accrual_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.payment_id <> OLD.payment_id OR NEW.kind <> OLD.kind
    OR NEW.reverses_accrual_id IS DISTINCT FROM OLD.reverses_accrual_id
    OR NEW.engagement_id <> OLD.engagement_id OR NEW.client_id <> OLD.client_id
    OR NEW.coach_assignment_id <> OLD.coach_assignment_id OR NEW.gross_amount <> OLD.gross_amount
    OR NEW.rate_applied <> OLD.rate_applied OR NEW.lifespan_months_applied <> OLD.lifespan_months_applied
    OR NEW.window_anchor_at <> OLD.window_anchor_at OR NEW.window_end_at <> OLD.window_end_at
    OR NEW.commission_amount <> OLD.commission_amount OR NEW.coach_payable_amount <> OLD.coach_payable_amount
    OR NEW.within_lifespan <> OLD.within_lifespan OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'commission accrual snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.settlement_id IS NOT NULL AND NEW.settlement_id IS DISTINCT FROM OLD.settlement_id THEN
    RAISE EXCEPTION 'settled commission accrual cannot be reassigned' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_payment_record_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.status = 'confirmed' AND NEW.status = 'reversed'
     AND NEW.tenant_id = OLD.tenant_id AND NEW.payer_party_id = OLD.payer_party_id
     AND NEW.payee_party_id = OLD.payee_party_id AND NEW.amount = OLD.amount
     AND NEW.method = OLD.method AND NEW.purpose = OLD.purpose
     AND NEW.subscription_id IS NOT DISTINCT FROM OLD.subscription_id
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND NEW.reverses_payment_id IS NOT DISTINCT FROM OLD.reverses_payment_id
     AND NEW.utr IS NOT DISTINCT FROM OLD.utr
     AND NEW.proof_media_asset_id IS NOT DISTINCT FROM OLD.proof_media_asset_id
     AND NEW.confirmation_source IS NOT DISTINCT FROM OLD.confirmation_source
     AND NEW.confirmed_by_party_id IS NOT DISTINCT FROM OLD.confirmed_by_party_id
     AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at
     AND NEW.created_at = OLD.created_at THEN RETURN NEW;
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

CREATE OR REPLACE FUNCTION public.guard_commission_accrual_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.payment_id <> OLD.payment_id OR NEW.kind <> OLD.kind
    OR NEW.reverses_accrual_id IS DISTINCT FROM OLD.reverses_accrual_id OR NEW.engagement_id <> OLD.engagement_id
    OR NEW.client_id <> OLD.client_id OR NEW.coach_assignment_id <> OLD.coach_assignment_id
    OR NEW.gross_amount <> OLD.gross_amount OR NEW.rate_applied <> OLD.rate_applied
    OR NEW.lifespan_months_applied <> OLD.lifespan_months_applied
    OR NEW.window_anchor_at <> OLD.window_anchor_at OR NEW.window_end_at <> OLD.window_end_at
    OR NEW.commission_amount <> OLD.commission_amount OR NEW.coach_payable_amount <> OLD.coach_payable_amount
    OR NEW.within_lifespan <> OLD.within_lifespan OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'commission accrual snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.settlement_id IS NOT NULL AND NEW.settlement_id IS DISTINCT FROM OLD.settlement_id THEN
    RAISE EXCEPTION 'settled commission accrual cannot be reassigned' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

GRANT USAGE ON TYPE public."CommissionAccrualKind" TO fitcrew_app;

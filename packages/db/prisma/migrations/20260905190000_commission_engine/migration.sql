ALTER TABLE public.engagement ADD CONSTRAINT engagement_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE public.client ADD CONSTRAINT client_id_tenant_key UNIQUE (id, tenant_id);
ALTER TABLE public.client_coach_assignment ADD CONSTRAINT client_coach_assignment_id_tenant_key UNIQUE (id, tenant_id);

CREATE TABLE public.client_engagement_clock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  coach_assignment_id uuid NOT NULL,
  anchor_at timestamp(3) NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT client_engagement_clock_identity_key UNIQUE (tenant_id, client_id, engagement_id, coach_assignment_id),
  FOREIGN KEY (client_id, tenant_id) REFERENCES public.client(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (engagement_id, tenant_id) REFERENCES public.engagement(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (coach_assignment_id, tenant_id) REFERENCES public.client_coach_assignment(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX client_engagement_clock_tenant_engagement_idx ON public.client_engagement_clock(tenant_id, engagement_id);

CREATE TABLE public.commission_accrual (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  client_id uuid NOT NULL,
  coach_assignment_id uuid NOT NULL,
  gross_amount numeric(18,2) NOT NULL,
  rate_applied numeric(5,2) NOT NULL,
  lifespan_months_applied integer NOT NULL,
  window_anchor_at timestamp(3) NOT NULL,
  window_end_at timestamp(3) NOT NULL,
  commission_amount numeric(18,2) NOT NULL,
  coach_payable_amount numeric(18,2) NOT NULL,
  within_lifespan boolean NOT NULL,
  settlement_id uuid,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT commission_accrual_identity_key UNIQUE (tenant_id, payment_id, engagement_id),
  CONSTRAINT commission_accrual_amounts_check CHECK (
    gross_amount > 0 AND commission_amount >= 0 AND coach_payable_amount >= 0
    AND commission_amount + coach_payable_amount = gross_amount
  ),
  CONSTRAINT commission_accrual_rate_check CHECK (rate_applied BETWEEN 0 AND 100),
  CONSTRAINT commission_accrual_lifespan_check CHECK (lifespan_months_applied > 0),
  CONSTRAINT commission_accrual_window_check CHECK (window_end_at > window_anchor_at),
  FOREIGN KEY (payment_id, tenant_id) REFERENCES public.payment_record(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (engagement_id, tenant_id) REFERENCES public.engagement(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id, tenant_id) REFERENCES public.client(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (coach_assignment_id, tenant_id) REFERENCES public.client_coach_assignment(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX commission_accrual_tenant_assignment_settlement_idx ON public.commission_accrual(tenant_id, coach_assignment_id, settlement_id);

CREATE TRIGGER client_engagement_clock_append_only BEFORE UPDATE OR DELETE ON public.client_engagement_clock
FOR EACH ROW EXECUTE FUNCTION public.reject_ledger_mutation();

CREATE FUNCTION public.guard_commission_accrual_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.payment_id <> OLD.payment_id OR NEW.engagement_id <> OLD.engagement_id
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
CREATE TRIGGER commission_accrual_snapshot_guard BEFORE UPDATE ON public.commission_accrual
FOR EACH ROW EXECUTE FUNCTION public.guard_commission_accrual_mutation();
CREATE TRIGGER commission_accrual_no_delete BEFORE DELETE ON public.commission_accrual
FOR EACH ROW EXECUTE FUNCTION public.reject_ledger_mutation();

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['client_engagement_clock', 'commission_accrual'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', table_name || '_tenant_isolation', table_name);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON public.client_engagement_clock TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE ON public.commission_accrual TO fitcrew_app;

ALTER TABLE public.invite
  ADD COLUMN coach_commission_rate numeric(5,2),
  ADD COLUMN coach_commission_lifespan_months integer,
  ADD COLUMN billing_plan_id uuid REFERENCES public.billing_plan(id);

CREATE INDEX invite_tenant_billing_plan_idx ON public.invite(tenant_id, billing_plan_id);

ALTER TABLE public.invite
  ADD CONSTRAINT invite_coach_onboarding_shape_check CHECK (
    (coach_commission_rate IS NULL AND coach_commission_lifespan_months IS NULL AND billing_plan_id IS NULL)
    OR (coach_commission_rate IS NOT NULL AND coach_commission_lifespan_months IS NOT NULL AND billing_plan_id IS NOT NULL)
  );

GRANT SELECT, INSERT, UPDATE ON public.invite TO fitcrew_app;

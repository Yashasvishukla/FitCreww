CREATE TYPE public."BillingInterval" AS ENUM ('daily', 'weekly', 'monthly', 'quarterly', 'yearly');
CREATE TYPE public."BillingPlanStatus" AS ENUM ('active', 'archived');
CREATE TYPE public."BillingProvider" AS ENUM ('razorpay');
CREATE TYPE public."BillingSubscriptionStatus" AS ENUM ('draft', 'awaiting_authorization', 'active', 'paused', 'completed', 'cancelled', 'failed');
CREATE TYPE public."BillingInvoiceStatus" AS ENUM ('draft', 'issued', 'paid', 'failed', 'cancelled');
CREATE TYPE public."OrganizationBillingModel" AS ENUM ('fixed_retainer', 'per_member', 'package', 'hybrid');
CREATE TYPE public."BillingFrequency" AS ENUM ('monthly', 'quarterly', 'yearly', 'one_time');
CREATE TYPE public."OrganizationAllocationModel" AS ENUM ('assigned_member_split', 'session_based', 'fixed_coach_share', 'manual_reviewed_split');
CREATE TYPE public."OrganizationAgreementStatus" AS ENUM ('active', 'paused', 'ended');
CREATE TYPE public."OrganizationInvoiceStatus" AS ENUM ('draft', 'sent', 'pending_payment', 'paid', 'overdue', 'disputed', 'allocated', 'closed', 'cancelled');
CREATE TYPE public."OrganizationInvoiceLineBasis" AS ENUM ('retainer', 'member', 'session', 'package', 'adjustment');
CREATE TYPE public."OrganizationAllocationStatus" AS ENUM ('draft', 'approved', 'settled', 'cancelled');

CREATE TABLE public.billing_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  name text NOT NULL,
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  interval public."BillingInterval" NOT NULL,
  interval_count integer NOT NULL DEFAULT 1,
  total_cycles integer NOT NULL,
  razorpay_plan_id text,
  status public."BillingPlanStatus" NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_plan_amount_check CHECK (amount > 0),
  CONSTRAINT billing_plan_interval_count_check CHECK (interval_count > 0),
  CONSTRAINT billing_plan_total_cycles_check CHECK (total_cycles > 0),
  CONSTRAINT billing_plan_currency_check CHECK (currency = 'INR')
);

CREATE UNIQUE INDEX billing_plan_tenant_name_key ON public.billing_plan(tenant_id, name);
CREATE UNIQUE INDEX billing_plan_tenant_razorpay_plan_key ON public.billing_plan(tenant_id, razorpay_plan_id) WHERE razorpay_plan_id IS NOT NULL;
CREATE INDEX billing_plan_tenant_status_idx ON public.billing_plan(tenant_id, status);

CREATE TABLE public.client_billing_subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  client_id uuid NOT NULL REFERENCES public.client(id),
  subscription_id uuid NOT NULL REFERENCES public.subscription(id),
  billing_plan_id uuid NOT NULL REFERENCES public.billing_plan(id),
  provider public."BillingProvider" NOT NULL DEFAULT 'razorpay',
  provider_subscription_id text,
  provider_customer_id text,
  status public."BillingSubscriptionStatus" NOT NULL DEFAULT 'draft',
  current_cycle integer NOT NULL DEFAULT 0,
  total_cycles integer NOT NULL,
  next_charge_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_billing_subscription_cycles_check CHECK (current_cycle >= 0 AND total_cycles > 0 AND current_cycle <= total_cycles)
);

CREATE UNIQUE INDEX client_billing_subscription_subscription_key ON public.client_billing_subscription(tenant_id, subscription_id);
CREATE UNIQUE INDEX client_billing_subscription_provider_key ON public.client_billing_subscription(tenant_id, provider_subscription_id) WHERE provider_subscription_id IS NOT NULL;
CREATE INDEX client_billing_subscription_client_status_idx ON public.client_billing_subscription(tenant_id, client_id, status);
CREATE INDEX client_billing_subscription_plan_idx ON public.client_billing_subscription(tenant_id, billing_plan_id);

CREATE TABLE public.billing_invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  client_billing_subscription_id uuid NOT NULL REFERENCES public.client_billing_subscription(id),
  subscription_id uuid NOT NULL REFERENCES public.subscription(id),
  cycle_number integer NOT NULL,
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  provider_invoice_id text,
  provider_payment_id text,
  payment_record_id uuid UNIQUE REFERENCES public.payment_record(id),
  status public."BillingInvoiceStatus" NOT NULL DEFAULT 'draft',
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_invoice_cycle_check CHECK (cycle_number > 0),
  CONSTRAINT billing_invoice_amount_check CHECK (amount > 0),
  CONSTRAINT billing_invoice_currency_check CHECK (currency = 'INR'),
  CONSTRAINT billing_invoice_paid_shape_check CHECK ((status = 'paid' AND paid_at IS NOT NULL) OR status <> 'paid')
);

CREATE UNIQUE INDEX billing_invoice_subscription_cycle_key ON public.billing_invoice(tenant_id, subscription_id, cycle_number);
CREATE UNIQUE INDEX billing_invoice_provider_invoice_key ON public.billing_invoice(tenant_id, provider_invoice_id) WHERE provider_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX billing_invoice_provider_payment_key ON public.billing_invoice(tenant_id, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX billing_invoice_status_due_idx ON public.billing_invoice(tenant_id, status, due_at);
CREATE INDEX billing_invoice_client_billing_subscription_idx ON public.billing_invoice(tenant_id, client_billing_subscription_id);

CREATE TABLE public.organization_agreement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  organization_id uuid NOT NULL REFERENCES public.organization(id),
  billing_model public."OrganizationBillingModel" NOT NULL,
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  billing_frequency public."BillingFrequency" NOT NULL,
  billing_day integer,
  start_date date NOT NULL,
  end_date date,
  payment_terms_days integer NOT NULL DEFAULT 15,
  allocation_model public."OrganizationAllocationModel" NOT NULL,
  status public."OrganizationAgreementStatus" NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_agreement_amount_check CHECK (amount > 0),
  CONSTRAINT organization_agreement_currency_check CHECK (currency = 'INR'),
  CONSTRAINT organization_agreement_billing_day_check CHECK (billing_day IS NULL OR (billing_day >= 1 AND billing_day <= 31)),
  CONSTRAINT organization_agreement_terms_check CHECK (payment_terms_days >= 0),
  CONSTRAINT organization_agreement_dates_check CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX organization_agreement_org_status_idx ON public.organization_agreement(tenant_id, organization_id, status);

CREATE TABLE public.organization_invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  organization_id uuid NOT NULL REFERENCES public.organization(id),
  organization_agreement_id uuid NOT NULL REFERENCES public.organization_agreement(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  member_count integer NOT NULL DEFAULT 0,
  status public."OrganizationInvoiceStatus" NOT NULL DEFAULT 'draft',
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  provider_invoice_id text,
  provider_order_id text,
  payment_record_id uuid UNIQUE REFERENCES public.payment_record(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_invoice_period_check CHECK (period_end >= period_start),
  CONSTRAINT organization_invoice_amount_check CHECK (amount > 0),
  CONSTRAINT organization_invoice_currency_check CHECK (currency = 'INR'),
  CONSTRAINT organization_invoice_member_count_check CHECK (member_count >= 0),
  CONSTRAINT organization_invoice_paid_shape_check CHECK ((status IN ('paid', 'allocated', 'closed') AND paid_at IS NOT NULL) OR status NOT IN ('paid', 'allocated', 'closed'))
);

CREATE UNIQUE INDEX organization_invoice_period_key ON public.organization_invoice(tenant_id, organization_id, period_start, period_end);
CREATE UNIQUE INDEX organization_invoice_provider_invoice_key ON public.organization_invoice(tenant_id, provider_invoice_id) WHERE provider_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX organization_invoice_provider_order_key ON public.organization_invoice(tenant_id, provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE INDEX organization_invoice_status_due_idx ON public.organization_invoice(tenant_id, status, due_at);
CREATE INDEX organization_invoice_agreement_idx ON public.organization_invoice(tenant_id, organization_agreement_id);

CREATE TABLE public.organization_invoice_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  organization_invoice_id uuid NOT NULL REFERENCES public.organization_invoice(id),
  client_id uuid REFERENCES public.client(id),
  coach_party_id uuid REFERENCES public.party(id),
  basis public."OrganizationInvoiceLineBasis" NOT NULL,
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  unit_amount numeric(18,2) NOT NULL,
  line_amount numeric(18,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_invoice_line_quantity_check CHECK (quantity > 0),
  CONSTRAINT organization_invoice_line_amount_check CHECK (unit_amount >= 0 AND line_amount >= 0)
);

CREATE INDEX organization_invoice_line_invoice_idx ON public.organization_invoice_line(tenant_id, organization_invoice_id);
CREATE INDEX organization_invoice_line_coach_idx ON public.organization_invoice_line(tenant_id, coach_party_id);

CREATE TABLE public.organization_coach_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenant(id),
  organization_invoice_id uuid NOT NULL REFERENCES public.organization_invoice(id),
  coach_party_id uuid NOT NULL REFERENCES public.party(id),
  allocation_model public."OrganizationAllocationModel" NOT NULL,
  gross_amount numeric(18,2) NOT NULL,
  commission_amount numeric(18,2) NOT NULL,
  coach_payable_amount numeric(18,2) NOT NULL,
  status public."OrganizationAllocationStatus" NOT NULL DEFAULT 'draft',
  approved_by_party_id uuid REFERENCES public.party(id),
  approved_at timestamptz,
  settlement_id uuid REFERENCES public.settlement(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_coach_allocation_amount_check CHECK (gross_amount >= 0 AND commission_amount >= 0 AND coach_payable_amount >= 0),
  CONSTRAINT organization_coach_allocation_total_check CHECK (gross_amount = commission_amount + coach_payable_amount),
  CONSTRAINT organization_coach_allocation_approval_shape_check CHECK ((status IN ('approved', 'settled') AND approved_by_party_id IS NOT NULL AND approved_at IS NOT NULL) OR status NOT IN ('approved', 'settled'))
);

CREATE UNIQUE INDEX organization_coach_allocation_coach_key ON public.organization_coach_allocation(tenant_id, organization_invoice_id, coach_party_id);
CREATE INDEX organization_coach_allocation_coach_status_idx ON public.organization_coach_allocation(tenant_id, coach_party_id, status);
CREATE INDEX organization_coach_allocation_settlement_idx ON public.organization_coach_allocation(tenant_id, settlement_id);

ALTER TABLE public.billing_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_billing_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_agreement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invoice_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_coach_allocation ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'billing_plan',
    'client_billing_subscription',
    'billing_invoice',
    'organization_agreement',
    'organization_invoice',
    'organization_invoice_line',
    'organization_coach_allocation'
  ]
  LOOP
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', table_name || '_tenant_isolation', table_name);
  END LOOP;
END $$;

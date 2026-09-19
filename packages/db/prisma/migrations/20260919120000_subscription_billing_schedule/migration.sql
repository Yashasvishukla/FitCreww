CREATE TYPE public."BillingCadence" AS ENUM ('upfront', 'monthly');

ALTER TABLE public.subscription
  ADD COLUMN billing_cadence public."BillingCadence" NOT NULL DEFAULT 'upfront',
  ADD COLUMN total_contract_value numeric(12,2),
  ADD COLUMN installment_amount numeric(12,2);

UPDATE public.subscription
SET total_contract_value = price,
    installment_amount = price
WHERE total_contract_value IS NULL OR installment_amount IS NULL;

ALTER TABLE public.subscription
  ALTER COLUMN total_contract_value SET NOT NULL,
  ALTER COLUMN installment_amount SET NOT NULL,
  ADD CONSTRAINT subscription_billing_schedule_check CHECK (
    duration_months > 0
    AND total_contract_value > 0
    AND installment_amount > 0
    AND (
      (billing_cadence = 'upfront' AND installment_amount = total_contract_value)
      OR billing_cadence = 'monthly'
    )
  );

ALTER TABLE public.payment_record
  ADD COLUMN billing_period_start date,
  ADD COLUMN billing_period_end date,
  ADD COLUMN installment_number integer;

WITH numbered AS (
  SELECT pr.id,
         pr.tenant_id,
         row_number() OVER (PARTITION BY pr.tenant_id, pr.subscription_id ORDER BY pr.created_at, pr.id)::integer AS installment_number,
         s.start_date,
         s.end_date
  FROM public.payment_record pr
  JOIN public.subscription s ON s.id = pr.subscription_id AND s.tenant_id = pr.tenant_id
  WHERE pr.purpose = 'client_subscription'
)
UPDATE public.payment_record pr
SET installment_number = numbered.installment_number,
    billing_period_start = numbered.start_date,
    billing_period_end = numbered.end_date
FROM numbered
WHERE pr.id = numbered.id AND pr.tenant_id = numbered.tenant_id;

ALTER TABLE public.payment_record
  ADD CONSTRAINT payment_record_installment_check CHECK (
    (purpose = 'client_subscription' AND subscription_id IS NOT NULL AND installment_number IS NOT NULL AND installment_number > 0 AND billing_period_start IS NOT NULL AND billing_period_end IS NOT NULL AND billing_period_end >= billing_period_start)
    OR (purpose <> 'client_subscription' AND installment_number IS NULL AND billing_period_start IS NULL AND billing_period_end IS NULL)
  );

CREATE UNIQUE INDEX payment_record_subscription_installment_idx
  ON public.payment_record(tenant_id, subscription_id, installment_number)
  WHERE subscription_id IS NOT NULL AND installment_number IS NOT NULL AND status <> 'reversed';

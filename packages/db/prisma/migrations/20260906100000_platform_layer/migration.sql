CREATE TYPE platform."PlatformSubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'cancelled');

CREATE TABLE platform.platform_plan (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    price numeric(12, 2) NOT NULL CHECK (price >= 0),
    billing_period text NOT NULL CHECK (billing_period IN ('monthly', 'annual')),
    limits jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE platform.platform_subscription (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES platform.tenant(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    plan_id uuid NOT NULL REFERENCES platform.platform_plan(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    status platform."PlatformSubscriptionStatus" NOT NULL DEFAULT 'trialing',
    current_period_start timestamp(3) without time zone NOT NULL,
    current_period_end timestamp(3) without time zone NOT NULL,
    created_at timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT platform_subscription_period_check CHECK (current_period_end > current_period_start)
);

CREATE INDEX platform_subscription_tenant_status_idx ON platform.platform_subscription (tenant_id, status);
CREATE INDEX platform_subscription_plan_id_idx ON platform.platform_subscription (plan_id);
CREATE UNIQUE INDEX platform_subscription_one_active_per_tenant_idx
    ON platform.platform_subscription (tenant_id)
    WHERE status IN ('trialing', 'active');

ALTER TABLE platform.tenant ADD COLUMN plan_id uuid;
ALTER TABLE platform.tenant
    ADD CONSTRAINT tenant_plan_id_fkey FOREIGN KEY (plan_id)
    REFERENCES platform.platform_plan(id) ON UPDATE CASCADE ON DELETE RESTRICT;
CREATE INDEX tenant_plan_id_idx ON platform.tenant (plan_id);

GRANT USAGE ON SCHEMA platform TO fitcrew_app;
GRANT USAGE ON TYPE platform."PlatformSubscriptionStatus" TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE ON platform.tenant, platform.platform_plan, platform.platform_subscription TO fitcrew_app;

ALTER TABLE public.invite ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.invite DROP CONSTRAINT IF EXISTS invite_role_check;
ALTER TABLE public.invite ADD CONSTRAINT invite_role_check CHECK (role IN ('OwnerAdmin', 'Coach', 'OrgAdmin'));

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS platform;

CREATE TYPE platform."TenantStatus" AS ENUM ('active', 'suspended', 'trial');
CREATE TYPE public."EvaluationCadence" AS ENUM ('weekly', 'biweekly', 'monthly');
CREATE TYPE public."FeeBearer" AS ENUM ('tenant', 'client');
CREATE TYPE public."SatisfactionMode" AS ENUM ('per_session', 'periodic');

CREATE TABLE platform.tenant (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    status platform."TenantStatus" NOT NULL DEFAULT 'trial',
    created_at timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.tenant_config (
    tenant_id uuid PRIMARY KEY,
    default_commission_rate numeric(5, 2) NOT NULL,
    default_commission_lifespan_months integer NOT NULL,
    default_evaluation_cadence public."EvaluationCadence" NOT NULL,
    fee_bearer public."FeeBearer" NOT NULL DEFAULT 'tenant',
    satisfaction_mode public."SatisfactionMode" NOT NULL DEFAULT 'per_session',
    currency text NOT NULL DEFAULT 'INR',
    CONSTRAINT tenant_config_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX tenant_config_tenant_id_idx ON public.tenant_config (tenant_id);

ALTER TABLE public.tenant_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_config FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_config_tenant_isolation
    ON public.tenant_config
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fitcrew_app') THEN
        CREATE ROLE fitcrew_app LOGIN PASSWORD 'fitcrew_app' NOBYPASSRLS;
    END IF;
END
$$;

ALTER ROLE fitcrew_app NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO fitcrew_app;
GRANT USAGE ON TYPE public."EvaluationCadence" TO fitcrew_app;
GRANT USAGE ON TYPE public."FeeBearer" TO fitcrew_app;
GRANT USAGE ON TYPE public."SatisfactionMode" TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_config TO fitcrew_app;

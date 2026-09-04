CREATE TYPE public."OrganizationStatus" AS ENUM ('active', 'inactive');

CREATE TABLE public.organization (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    party_id uuid NOT NULL UNIQUE,
    agreement_terms jsonb NOT NULL,
    status public."OrganizationStatus" NOT NULL DEFAULT 'active',
    created_at timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp(3) without time zone NOT NULL,
    CONSTRAINT organization_party_institution
        FOREIGN KEY (party_id) REFERENCES public.party(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT organization_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX organization_tenant_id_status_idx ON public.organization (tenant_id, status);

ALTER TABLE public.organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization FORCE ROW LEVEL SECURITY;

CREATE POLICY organization_tenant_isolation
    ON public.organization
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT USAGE ON TYPE public."OrganizationStatus" TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization TO fitcrew_app;

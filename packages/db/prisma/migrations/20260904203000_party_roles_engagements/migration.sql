CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE public."PartyKind" AS ENUM ('person', 'institution');
CREATE TYPE public."PartyStatus" AS ENUM ('active', 'inactive');
CREATE TYPE public."Role" AS ENUM ('OwnerAdmin', 'Coach', 'OrgAdmin', 'Client');
CREATE TYPE public."ScopeType" AS ENUM ('tenant', 'organization');

CREATE TABLE public.party (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    user_id uuid,
    kind public."PartyKind" NOT NULL,
    display_name text NOT NULL,
    contact jsonb,
    status public."PartyStatus" NOT NULL DEFAULT 'active',
    created_at timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp(3) without time zone NOT NULL,
    CONSTRAINT party_display_name_not_blank CHECK (length(trim(display_name)) > 0),
    CONSTRAINT party_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT party_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES platform.user_account(id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT party_tenant_user_id_key UNIQUE (tenant_id, user_id)
);

CREATE TABLE public.role_assignment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    party_id uuid NOT NULL,
    role public."Role" NOT NULL,
    scope_type public."ScopeType" NOT NULL,
    scope_id uuid,
    valid_from date NOT NULL,
    valid_to date,
    created_at timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp(3) without time zone NOT NULL,
    CONSTRAINT role_assignment_valid_range CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CONSTRAINT role_assignment_owner_scope CHECK (role <> 'OwnerAdmin' OR (scope_type = 'tenant' AND scope_id IS NULL)),
    CONSTRAINT role_assignment_org_admin_scope CHECK (role <> 'OrgAdmin' OR (scope_type = 'organization' AND scope_id IS NOT NULL)),
    CONSTRAINT role_assignment_party_id_fkey
        FOREIGN KEY (party_id) REFERENCES public.party(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT role_assignment_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE public.engagement (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    upstream_party_id uuid NOT NULL,
    downstream_party_id uuid NOT NULL,
    commission_rate numeric(5, 2) NOT NULL,
    commission_lifespan_months integer NOT NULL,
    valid_from date NOT NULL,
    valid_to date,
    terms jsonb NOT NULL DEFAULT '{}',
    created_at timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp(3) without time zone NOT NULL,
    CONSTRAINT engagement_no_self_loop CHECK (upstream_party_id <> downstream_party_id),
    CONSTRAINT engagement_commission_rate_range CHECK (commission_rate >= 0 AND commission_rate <= 100),
    CONSTRAINT engagement_commission_lifespan_positive CHECK (commission_lifespan_months > 0),
    CONSTRAINT engagement_valid_range CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CONSTRAINT engagement_upstream_party_id_fkey
        FOREIGN KEY (upstream_party_id) REFERENCES public.party(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT engagement_downstream_party_id_fkey
        FOREIGN KEY (downstream_party_id) REFERENCES public.party(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT engagement_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX party_tenant_id_kind_status_idx ON public.party (tenant_id, kind, status);
CREATE INDEX role_assignment_tenant_id_party_id_role_idx ON public.role_assignment (tenant_id, party_id, role);
CREATE INDEX role_assignment_tenant_id_scope_type_scope_id_role_idx ON public.role_assignment (tenant_id, scope_type, scope_id, role);
CREATE INDEX engagement_tenant_id_upstream_party_id_idx ON public.engagement (tenant_id, upstream_party_id);
CREATE INDEX engagement_tenant_id_downstream_party_id_idx ON public.engagement (tenant_id, downstream_party_id);

ALTER TABLE public.role_assignment
    ADD CONSTRAINT role_assignment_no_overlapping_duplicate
    EXCLUDE USING gist (
        tenant_id WITH =,
        party_id WITH =,
        role WITH =,
        scope_type WITH =,
        COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid) WITH =,
        daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]') WITH &&
    );

ALTER TABLE public.engagement
    ADD CONSTRAINT engagement_no_overlapping_duplicate_edges
    EXCLUDE USING gist (
        tenant_id WITH =,
        upstream_party_id WITH =,
        downstream_party_id WITH =,
        daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]') WITH &&
    );

ALTER TABLE public.party ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party FORCE ROW LEVEL SECURITY;
ALTER TABLE public.role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE public.engagement ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement FORCE ROW LEVEL SECURITY;

CREATE POLICY party_tenant_isolation
    ON public.party
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY role_assignment_tenant_isolation
    ON public.role_assignment
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY engagement_tenant_isolation
    ON public.engagement
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT USAGE ON TYPE public."PartyKind" TO fitcrew_app;
GRANT USAGE ON TYPE public."PartyStatus" TO fitcrew_app;
GRANT USAGE ON TYPE public."Role" TO fitcrew_app;
GRANT USAGE ON TYPE public."ScopeType" TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.party TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_assignment TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.engagement TO fitcrew_app;

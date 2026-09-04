CREATE TABLE public.invite (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    token_hash text NOT NULL UNIQUE,
    role public."Role" NOT NULL,
    scope_type public."ScopeType" NOT NULL,
    scope_id uuid,
    email text NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    consumed_at timestamp(3) without time zone,
    created_by uuid NOT NULL,
    created_at timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT invite_email_not_blank CHECK (length(trim(email)) > 3),
    CONSTRAINT invite_role_check CHECK (role IN ('Coach', 'OrgAdmin')),
    CONSTRAINT invite_org_admin_scope CHECK (role <> 'OrgAdmin' OR (scope_type = 'organization' AND scope_id IS NOT NULL)),
    CONSTRAINT invite_coach_scope CHECK (role <> 'Coach' OR scope_type IN ('tenant', 'organization')),
    CONSTRAINT invite_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT invite_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES public.party(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX invite_tenant_id_email_idx ON public.invite (tenant_id, email);
CREATE INDEX invite_tenant_id_expires_at_idx ON public.invite (tenant_id, expires_at);

ALTER TABLE public.invite ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite FORCE ROW LEVEL SECURITY;

CREATE POLICY invite_tenant_isolation
    ON public.invite
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON public.invite TO fitcrew_app;

CREATE TABLE public.audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    actor_party_id uuid NOT NULL,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid,
    before jsonb,
    after jsonb,
    created_at timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT audit_log_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT audit_log_actor_party_id_fkey
        FOREIGN KEY (actor_party_id) REFERENCES public.party(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX audit_log_tenant_id_created_at_idx ON public.audit_log (tenant_id, created_at);
CREATE INDEX audit_log_tenant_id_actor_party_id_created_at_idx
    ON public.audit_log (tenant_id, actor_party_id, created_at);

CREATE OR REPLACE FUNCTION public.reject_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

CREATE TRIGGER audit_log_append_only
    BEFORE UPDATE OR DELETE ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION public.reject_audit_log_mutation();

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_log_tenant_isolation
    ON public.audit_log
    FOR ALL
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT ON public.audit_log TO fitcrew_app;

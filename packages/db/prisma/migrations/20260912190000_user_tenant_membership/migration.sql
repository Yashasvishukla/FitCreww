CREATE TABLE platform.user_tenant_membership (
    user_id uuid NOT NULL REFERENCES platform.user_account(id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL REFERENCES platform.tenant(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, tenant_id)
);

CREATE INDEX user_tenant_membership_tenant_id_idx ON platform.user_tenant_membership(tenant_id);

INSERT INTO platform.user_tenant_membership (user_id, tenant_id)
SELECT user_id, tenant_id
FROM public.party
WHERE user_id IS NOT NULL
ON CONFLICT (user_id, tenant_id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.user_tenant_membership TO fitcrew_app;

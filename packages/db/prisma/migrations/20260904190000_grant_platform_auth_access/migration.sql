DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fitcrew_app') THEN
        CREATE ROLE fitcrew_app LOGIN PASSWORD 'fitcrew_app' NOBYPASSRLS;
    END IF;
END
$$;

ALTER ROLE fitcrew_app NOBYPASSRLS;

GRANT USAGE ON SCHEMA platform TO fitcrew_app;
GRANT USAGE ON TYPE platform."TenantStatus" TO fitcrew_app;

GRANT SELECT ON TABLE platform.tenant TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE platform.user_account TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE platform.auth_account TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE platform.auth_session TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE platform.auth_verification_token TO fitcrew_app;

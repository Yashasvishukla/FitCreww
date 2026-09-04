CREATE TABLE platform.user_account (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text,
    email text NOT NULL UNIQUE,
    email_verified timestamp(3) without time zone,
    image text,
    password_hash text,
    failed_sign_in_attempts integer NOT NULL DEFAULT 0,
    locked_until timestamp(3) without time zone,
    created_at timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp(3) without time zone NOT NULL
);

CREATE TABLE platform.auth_account (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    type text NOT NULL,
    provider text NOT NULL,
    provider_account_id text NOT NULL,
    refresh_token text,
    access_token text,
    expires_at integer,
    token_type text,
    scope text,
    id_token text,
    session_state text,
    CONSTRAINT auth_account_user_id_fkey FOREIGN KEY (user_id) REFERENCES platform.user_account(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT auth_account_provider_provider_account_id_key UNIQUE (provider, provider_account_id)
);

CREATE TABLE platform.auth_session (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token text NOT NULL UNIQUE,
    user_id uuid NOT NULL,
    expires timestamp(3) without time zone NOT NULL,
    CONSTRAINT auth_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES platform.user_account(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX auth_session_user_id_idx ON platform.auth_session(user_id);

CREATE TABLE platform.auth_verification_token (
    identifier text NOT NULL,
    token text NOT NULL UNIQUE,
    expires timestamp(3) without time zone NOT NULL,
    CONSTRAINT auth_verification_token_identifier_token_key UNIQUE (identifier, token)
);

GRANT USAGE ON SCHEMA platform TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE platform.user_account TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE platform.auth_account TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE platform.auth_session TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE platform.auth_verification_token TO fitcrew_app;

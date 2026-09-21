-- Defense in depth for tenant isolation.
--
-- A table owner normally bypasses row-level security.  The application can be
-- deployed with a role that owns an older table, so every tenant-bearing table
-- must explicitly FORCE RLS as well as ENABLE it.  Discovering the tables from
-- the catalog makes this migration cover the billing and webhook tables added
-- after the original tenancy migration, and prevents an accidental omission
-- when migrations are applied out of order to an existing environment.
DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOR table_name IN
    SELECT c.relname
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    JOIN pg_attribute AS a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND a.attname = 'tenant_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);

    policy_name := table_name || '_tenant_isolation';
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
        AND policyname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
        policy_name,
        table_name
      );
    END IF;
  END LOOP;
END
$$;

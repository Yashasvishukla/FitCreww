-- The production connection may use the table-owning database role. FORCE is
-- required so that role cannot bypass this tenant isolation policy.
ALTER TABLE public.satisfaction_record FORCE ROW LEVEL SECURITY;

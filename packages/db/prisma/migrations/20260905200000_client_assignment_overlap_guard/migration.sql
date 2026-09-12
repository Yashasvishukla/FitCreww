-- Prevent concurrent or historical overlapping coach assignments for one client.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.client_coach_assignment
  ADD CONSTRAINT client_coach_assignment_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    client_id WITH =,
    daterange(valid_from, COALESCE(valid_to, 'infinity'::date), '[]') WITH &&
  );

CREATE TABLE public.workout_draft (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES platform.tenant(id),
  client_id UUID NOT NULL UNIQUE REFERENCES public.client(id),
  exercises JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_exercise_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workout_draft_tenant_updated_idx ON public.workout_draft(tenant_id, updated_at);

ALTER TABLE public.workout_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_draft FORCE ROW LEVEL SECURITY;
CREATE POLICY workout_draft_tenant_isolation ON public.workout_draft FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workout_draft TO fitcrew_app;

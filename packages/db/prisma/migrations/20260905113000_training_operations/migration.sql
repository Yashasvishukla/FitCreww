CREATE TYPE public."EvaluationDueStatus" AS ENUM ('pending', 'reminded', 'completed', 'dismissed');

CREATE TABLE public.exercise_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  name text NOT NULL,
  muscle_group text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX exercise_catalog_tenant_name_key ON public.exercise_catalog(tenant_id, name);
CREATE UNIQUE INDEX exercise_catalog_global_name_key ON public.exercise_catalog(name) WHERE tenant_id IS NULL;
CREATE INDEX exercise_catalog_tenant_muscle_idx ON public.exercise_catalog(tenant_id, muscle_group);

CREATE TABLE public.workout_plan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  version integer NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  created_by_party_id uuid NOT NULL,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id) REFERENCES public.client(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_party_id) REFERENCES public.party(id) ON DELETE RESTRICT,
  CHECK (version > 0)
);
CREATE UNIQUE INDEX workout_plan_tenant_client_version_key ON public.workout_plan(tenant_id, client_id, version);
CREATE INDEX workout_plan_tenant_client_current_idx ON public.workout_plan(tenant_id, client_id, is_current);

CREATE TABLE public.plan_day (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  day_number integer NOT NULL,
  exercises jsonb NOT NULL,
  notes text,
  FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  FOREIGN KEY (plan_id) REFERENCES public.workout_plan(id) ON DELETE RESTRICT,
  CHECK (day_number BETWEEN 1 AND 7)
);
CREATE UNIQUE INDEX plan_day_tenant_plan_day_key ON public.plan_day(tenant_id, plan_id, day_number);
CREATE INDEX plan_day_tenant_plan_idx ON public.plan_day(tenant_id, plan_id);

CREATE TABLE public.training_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  coach_assignment_id uuid NOT NULL,
  coach_party_id uuid NOT NULL,
  session_date date NOT NULL,
  start_time text NOT NULL,
  end_time text,
  exercises_performed jsonb NOT NULL,
  notes text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id) REFERENCES public.client(id) ON DELETE RESTRICT,
  FOREIGN KEY (coach_assignment_id) REFERENCES public.client_coach_assignment(id) ON DELETE RESTRICT,
  FOREIGN KEY (coach_party_id) REFERENCES public.party(id) ON DELETE RESTRICT,
  CHECK (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  CHECK (end_time IS NULL OR end_time ~ '^[0-2][0-9]:[0-5][0-9]$')
);
CREATE INDEX training_session_tenant_coach_date_idx ON public.training_session(tenant_id, coach_party_id, session_date DESC);
CREATE INDEX training_session_tenant_client_date_idx ON public.training_session(tenant_id, client_id, session_date DESC);

CREATE TABLE public.evaluation_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL UNIQUE,
  cadence public."EvaluationCadence" NOT NULL,
  next_due_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id) REFERENCES public.client(id) ON DELETE RESTRICT
);
CREATE INDEX evaluation_schedule_tenant_active_due_idx ON public.evaluation_schedule(tenant_id, is_active, next_due_date);

CREATE TABLE public.evaluation_due_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  evaluation_schedule_id uuid NOT NULL,
  client_id uuid NOT NULL,
  next_due_date date NOT NULL,
  status public."EvaluationDueStatus" NOT NULL DEFAULT 'pending',
  reminder_sent_at timestamp(3),
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  FOREIGN KEY (evaluation_schedule_id) REFERENCES public.evaluation_schedule(id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id) REFERENCES public.client(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX evaluation_due_tenant_schedule_date_key ON public.evaluation_due_event(tenant_id, evaluation_schedule_id, next_due_date);
CREATE INDEX evaluation_due_tenant_status_date_idx ON public.evaluation_due_event(tenant_id, status, next_due_date);

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['exercise_catalog','workout_plan','plan_day','training_session','evaluation_schedule','evaluation_due_event'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (tenant_id IS NULL OR tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting(''app.tenant_id'', true)::uuid)', table_name || '_tenant_isolation', table_name);
  END LOOP;
END $$;

GRANT USAGE ON TYPE public."EvaluationDueStatus" TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exercise_catalog, public.workout_plan, public.plan_day, public.training_session, public.evaluation_schedule, public.evaluation_due_event TO fitcrew_app;

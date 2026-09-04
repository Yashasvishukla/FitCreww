CREATE TYPE public."ClientStatus" AS ENUM ('active', 'paused', 'left');
CREATE TYPE public."ConsentState" AS ENUM ('granted', 'withdrawn');
CREATE TYPE public."MediaStatus" AS ENUM ('active', 'removed');
CREATE TYPE public."EvaluationType" AS ENUM ('baseline', 'periodic');
CREATE TYPE public."WorkflowStatus" AS ENUM ('draft', 'active', 'retired');
CREATE TYPE public."SubscriptionStatus" AS ENUM ('active', 'lapsed', 'renewed', 'cancelled');

CREATE TABLE public.client (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, party_id uuid NOT NULL,
  current_coach_assignment_id uuid UNIQUE, organization_id uuid, enrolled_by_party_id uuid NOT NULL,
  custom_price numeric(12,2) NOT NULL, schedule jsonb NOT NULL DEFAULT '{}', photo_consent boolean NOT NULL DEFAULT false,
  photo_consent_at timestamp(3), status public."ClientStatus" NOT NULL DEFAULT 'active', workflow_state text,
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp(3) NOT NULL,
  CONSTRAINT client_party_fkey FOREIGN KEY (party_id) REFERENCES public.party(id) ON DELETE RESTRICT,
  CONSTRAINT client_org_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE RESTRICT,
  CONSTRAINT client_enrolled_by_fkey FOREIGN KEY (enrolled_by_party_id) REFERENCES public.party(id) ON DELETE RESTRICT,
  CONSTRAINT client_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  CONSTRAINT client_price_nonnegative CHECK (custom_price >= 0),
  CONSTRAINT client_party_person CHECK (party_id IS NOT NULL)
);
CREATE UNIQUE INDEX client_tenant_party_key ON public.client(tenant_id, party_id);
CREATE INDEX client_tenant_org_status_idx ON public.client(tenant_id, organization_id, status);

CREATE TABLE public.client_coach_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, client_id uuid NOT NULL,
  coach_party_id uuid NOT NULL, assigned_by_party_id uuid NOT NULL, valid_from date NOT NULL, valid_to date, reason text,
  CONSTRAINT cca_client_fkey FOREIGN KEY (client_id) REFERENCES public.client(id) ON DELETE RESTRICT,
  CONSTRAINT cca_coach_fkey FOREIGN KEY (coach_party_id) REFERENCES public.party(id) ON DELETE RESTRICT,
  CONSTRAINT cca_assigned_by_fkey FOREIGN KEY (assigned_by_party_id) REFERENCES public.party(id) ON DELETE RESTRICT,
  CONSTRAINT cca_tenant_fkey FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  CONSTRAINT cca_valid_range CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX cca_tenant_coach_valid_idx ON public.client_coach_assignment(tenant_id, coach_party_id, valid_to);
ALTER TABLE public.client ADD CONSTRAINT client_current_coach_fkey FOREIGN KEY (current_coach_assignment_id) REFERENCES public.client_coach_assignment(id) ON DELETE RESTRICT;

CREATE TABLE public.consent_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, client_id uuid NOT NULL, purpose text NOT NULL,
  policy_version text NOT NULL, state public."ConsentState" NOT NULL, captured_by_party_id uuid NOT NULL,
  capture_source text NOT NULL, captured_at timestamp(3) NOT NULL, withdrawn_at timestamp(3), notes text,
  FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id) REFERENCES public.client(id) ON DELETE RESTRICT,
  FOREIGN KEY (captured_by_party_id) REFERENCES public.party(id) ON DELETE RESTRICT
);
CREATE INDEX consent_tenant_client_captured_idx ON public.consent_record(tenant_id, client_id, captured_at);

CREATE TABLE public.media_asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, client_id uuid, blob_key text NOT NULL UNIQUE,
  content_type text NOT NULL, byte_size integer NOT NULL, sha256 text NOT NULL, status public."MediaStatus" NOT NULL DEFAULT 'active',
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, removed_at timestamp(3),
  FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id) REFERENCES public.client(id) ON DELETE RESTRICT,
  CONSTRAINT media_size_positive CHECK (byte_size > 0)
);
CREATE INDEX media_tenant_client_status_idx ON public.media_asset(tenant_id, client_id, status);

CREATE TABLE public.workflow_definition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, name text NOT NULL, version integer NOT NULL,
  status public."WorkflowStatus" NOT NULL, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, activated_at timestamp(3),
  FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT, UNIQUE (tenant_id, version)
);
CREATE INDEX workflow_tenant_status_idx ON public.workflow_definition(tenant_id, status);
CREATE TABLE public.workflow_stage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, workflow_definition_id uuid NOT NULL,
  sequence integer NOT NULL, step_type text NOT NULL, config jsonb NOT NULL DEFAULT '{}', is_required boolean NOT NULL DEFAULT true,
  FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  FOREIGN KEY (workflow_definition_id) REFERENCES public.workflow_definition(id) ON DELETE RESTRICT,
  UNIQUE (tenant_id, workflow_definition_id, sequence)
);

CREATE TABLE public.evaluation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, client_id uuid NOT NULL, coach_assignment_id uuid,
  evaluated_by_party_id uuid NOT NULL, evaluated_at timestamp(3) NOT NULL, type public."EvaluationType" NOT NULL,
  measurements jsonb NOT NULL, posture_notes text, deltas jsonb NOT NULL DEFAULT '{}', cadence_context jsonb NOT NULL DEFAULT '{}',
  FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id) REFERENCES public.client(id) ON DELETE RESTRICT,
  FOREIGN KEY (coach_assignment_id) REFERENCES public.client_coach_assignment(id) ON DELETE RESTRICT,
  FOREIGN KEY (evaluated_by_party_id) REFERENCES public.party(id) ON DELETE RESTRICT
);
CREATE INDEX evaluation_tenant_client_at_idx ON public.evaluation(tenant_id, client_id, evaluated_at);
CREATE TABLE public.evaluation_photo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, evaluation_id uuid NOT NULL, media_asset_id uuid NOT NULL,
  view_type text NOT NULL, FOREIGN KEY (evaluation_id) REFERENCES public.evaluation(id) ON DELETE RESTRICT,
  FOREIGN KEY (media_asset_id) REFERENCES public.media_asset(id) ON DELETE RESTRICT, UNIQUE (evaluation_id, media_asset_id)
);

CREATE TABLE public.subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, client_id uuid NOT NULL, price numeric(12,2) NOT NULL,
  start_date date NOT NULL, duration_months integer NOT NULL, end_date date NOT NULL, status public."SubscriptionStatus" NOT NULL DEFAULT 'active',
  previous_subscription_id uuid, FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id) REFERENCES public.client(id) ON DELETE RESTRICT,
  FOREIGN KEY (previous_subscription_id) REFERENCES public.subscription(id) ON DELETE RESTRICT,
  CHECK (price >= 0), CHECK (duration_months > 0), CHECK (end_date >= start_date)
);
CREATE INDEX subscription_tenant_client_status_idx ON public.subscription(tenant_id, client_id, status);

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['client','client_coach_assignment','consent_record','media_asset','workflow_definition','workflow_stage','evaluation','evaluation_photo','subscription'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', table_name || '_tenant_isolation', table_name);
  END LOOP;
END $$;
GRANT USAGE ON TYPE public."ClientStatus", public."ConsentState", public."MediaStatus", public."EvaluationType", public."WorkflowStatus", public."SubscriptionStatus" TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client, public.client_coach_assignment, public.consent_record, public.media_asset, public.workflow_definition, public.workflow_stage, public.evaluation, public.evaluation_photo, public.subscription TO fitcrew_app;

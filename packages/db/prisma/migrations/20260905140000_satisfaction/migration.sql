CREATE TABLE public.satisfaction_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  captured_by_party_id uuid NOT NULL,
  mode public."SatisfactionMode" NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment text,
  captured_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id) REFERENCES public.client(id) ON DELETE RESTRICT,
  FOREIGN KEY (captured_by_party_id) REFERENCES public.party(id) ON DELETE RESTRICT
);
CREATE INDEX satisfaction_record_tenant_client_date_idx ON public.satisfaction_record(tenant_id, client_id, captured_at DESC);
ALTER TABLE public.satisfaction_record ENABLE ROW LEVEL SECURITY;
CREATE POLICY satisfaction_record_tenant_isolation ON public.satisfaction_record USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.satisfaction_record TO fitcrew_app;

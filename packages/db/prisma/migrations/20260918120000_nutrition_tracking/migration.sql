CREATE TYPE public."MealType" AS ENUM ('breakfast', 'lunch', 'dinner', 'snack');
CREATE TYPE public."FoodInputSource" AS ENUM ('text', 'camera', 'barcode', 'manual');

CREATE TABLE public.nutrition_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  captured_by_party_id uuid NOT NULL,
  photo_asset_id uuid,
  meal_type public."MealType" NOT NULL,
  input_source public."FoodInputSource" NOT NULL DEFAULT 'text',
  food_name text NOT NULL,
  quantity_text text,
  serving_grams integer,
  calories integer NOT NULL,
  protein_grams numeric(8,2),
  carb_grams numeric(8,2),
  fat_grams numeric(8,2),
  fiber_grams numeric(8,2),
  confidence numeric(4,2) NOT NULL DEFAULT 0.70,
  logged_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES platform.tenant(id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id) REFERENCES public.client(id) ON DELETE RESTRICT,
  FOREIGN KEY (captured_by_party_id) REFERENCES public.party(id) ON DELETE RESTRICT,
  FOREIGN KEY (photo_asset_id) REFERENCES public.media_asset(id) ON DELETE RESTRICT,
  CHECK (length(trim(food_name)) > 0),
  CHECK (serving_grams IS NULL OR serving_grams > 0),
  CHECK (calories >= 0),
  CHECK (protein_grams IS NULL OR protein_grams >= 0),
  CHECK (carb_grams IS NULL OR carb_grams >= 0),
  CHECK (fat_grams IS NULL OR fat_grams >= 0),
  CHECK (fiber_grams IS NULL OR fiber_grams >= 0),
  CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX nutrition_log_tenant_client_at_idx ON public.nutrition_log(tenant_id, client_id, logged_at);
CREATE INDEX nutrition_log_tenant_client_meal_idx ON public.nutrition_log(tenant_id, client_id, meal_type);

ALTER TABLE public.nutrition_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_log FORCE ROW LEVEL SECURITY;
CREATE POLICY nutrition_log_tenant_isolation ON public.nutrition_log
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT USAGE ON TYPE public."MealType", public."FoodInputSource" TO fitcrew_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nutrition_log TO fitcrew_app;

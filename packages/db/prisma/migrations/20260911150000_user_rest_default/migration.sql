ALTER TABLE platform.user_account
  ADD COLUMN IF NOT EXISTS default_rest_seconds INTEGER NOT NULL DEFAULT 90;

-- Reassert the payment immutability contract for databases that were migrated
-- before the reversal exception was added to the trigger.
CREATE OR REPLACE FUNCTION public.guard_payment_record_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  -- A reversal may change status only. All financial and audit identity fields
  -- must remain byte-for-byte equivalent to the confirmed payment.
  IF OLD.status = 'confirmed' AND NEW.status = 'reversed'
     AND NEW.tenant_id = OLD.tenant_id
     AND NEW.payer_party_id = OLD.payer_party_id
     AND NEW.payee_party_id = OLD.payee_party_id
     AND NEW.amount = OLD.amount
     AND NEW.method = OLD.method
     AND NEW.purpose = OLD.purpose
     AND NEW.subscription_id IS NOT DISTINCT FROM OLD.subscription_id
     AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
     AND NEW.reverses_payment_id IS NOT DISTINCT FROM OLD.reverses_payment_id
     AND NEW.utr IS NOT DISTINCT FROM OLD.utr
     AND NEW.proof_media_asset_id IS NOT DISTINCT FROM OLD.proof_media_asset_id
     AND NEW.confirmation_source IS NOT DISTINCT FROM OLD.confirmation_source
     AND NEW.confirmed_by_party_id IS NOT DISTINCT FROM OLD.confirmed_by_party_id
     AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'confirmed payment records are immutable; post a reversal instead' USING ERRCODE = '55000';
  END IF;

  IF NEW.tenant_id <> OLD.tenant_id
     OR NEW.payer_party_id <> OLD.payer_party_id
     OR NEW.payee_party_id <> OLD.payee_party_id
     OR NEW.amount <> OLD.amount
     OR NEW.purpose <> OLD.purpose
     OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.reverses_payment_id IS DISTINCT FROM OLD.reverses_payment_id THEN
    RAISE EXCEPTION 'payment financial identity cannot be changed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

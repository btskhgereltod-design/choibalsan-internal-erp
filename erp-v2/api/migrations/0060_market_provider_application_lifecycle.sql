-- Enforce the reviewed Provider application lifecycle at the database boundary.
-- Membership activation remains a separate capacity transition after approval.

CREATE OR REPLACE FUNCTION overva_validate_market_provider_application_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'submitted' AND NEW.status = 'under_review' THEN
    IF NEW.reviewed_at IS NULL OR NEW.decided_at IS NOT NULL
       OR NEW.decided_by_identity_id IS NOT NULL OR NEW.decision_reason IS NOT NULL THEN
      RAISE EXCEPTION 'invalid provider application review transition';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'under_review' AND NEW.status IN ('approved','rejected') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid provider application status transition: % -> %', OLD.status, NEW.status;
END;
$$;

CREATE TRIGGER market_provider_application_transition_guard
BEFORE UPDATE OF status ON market_provider_applications
FOR EACH ROW EXECUTE FUNCTION overva_validate_market_provider_application_transition();

COMMENT ON FUNCTION overva_validate_market_provider_application_transition() IS
  'Allows only submitted -> under_review -> approved/rejected. Active and suspended remain membership states.';

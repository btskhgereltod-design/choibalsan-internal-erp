-- Reconcile the known pre-release 0079 variant without rewriting migration
-- history or synthesizing assignment events. Existing rows are untouched.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='work_order_events'::regclass
       AND conname='work_order_events_assignment_identity_check'
  ) THEN
    ALTER TABLE work_order_events
      ADD CONSTRAINT work_order_events_assignment_identity_check CHECK(
        (from_assignee_user_id IS NOT NULL OR from_assignee_employee_id IS NULL)
        AND (to_assignee_user_id IS NOT NULL OR to_assignee_employee_id IS NULL)
      ) NOT VALID;
    ALTER TABLE work_order_events
      VALIDATE CONSTRAINT work_order_events_assignment_identity_check;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION overva_validate_work_order_assignment_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.from_assignee_employee_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM users u
     WHERE u.organization_id=NEW.organization_id
       AND u.id=NEW.from_assignee_user_id
       AND u.employee_id=NEW.from_assignee_employee_id
  ) THEN
    RAISE EXCEPTION 'WORK_ORDER_ASSIGNMENT_FROM_IDENTITY_MISMATCH' USING ERRCODE='P0001';
  END IF;
  IF NEW.to_assignee_employee_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM users u
     WHERE u.organization_id=NEW.organization_id
       AND u.id=NEW.to_assignee_user_id
       AND u.employee_id=NEW.to_assignee_employee_id
  ) THEN
    RAISE EXCEPTION 'WORK_ORDER_ASSIGNMENT_TO_IDENTITY_MISMATCH' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid='work_order_events'::regclass
       AND tgname='work_order_events_assignment_identity_guard'
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER work_order_events_assignment_identity_guard
      BEFORE INSERT ON work_order_events
      FOR EACH ROW EXECUTE FUNCTION overva_validate_work_order_assignment_identity();
  END IF;
END $$;

DO $$
DECLARE
  delete_action "char";
BEGIN
  SELECT confdeltype INTO delete_action
    FROM pg_constraint
   WHERE conrelid='work_order_events'::regclass
     AND conname='work_order_events_order_tenant_fk';
  IF delete_action IS DISTINCT FROM 'r' THEN
    ALTER TABLE work_order_events DROP CONSTRAINT IF EXISTS work_order_events_order_tenant_fk;
    ALTER TABLE work_order_events
      ADD CONSTRAINT work_order_events_order_tenant_fk
      FOREIGN KEY(organization_id,work_order_id)
      REFERENCES work_orders(organization_id,id) ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON TABLE work_order_events IS
  'Append-only Work Order event journal. Version-1 assignment events are canonical. Unversioned assigned events are accepted only for phased old-writer compatibility and remain non-canonical.';

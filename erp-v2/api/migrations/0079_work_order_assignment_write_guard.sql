-- Backward-compatible assignment-history hardening, phase 1 of 2.
--
-- Existing/rollback API images may still insert unversioned `assigned` events,
-- so this migration deliberately does not reject them. They remain explicit
-- legacy/transition evidence and are never projected backward by reports.
-- A later, separately released activation migration may require version 1 only
-- after every old writer has been retired and the new application has soaked.

ALTER TABLE work_order_events
  ADD CONSTRAINT work_order_events_assignment_identity_check CHECK(
    (from_assignee_user_id IS NOT NULL OR from_assignee_employee_id IS NULL)
    AND (to_assignee_user_id IS NOT NULL OR to_assignee_employee_id IS NULL)
  );

CREATE FUNCTION overva_validate_work_order_assignment_identity()
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

CREATE TRIGGER work_order_events_assignment_identity_guard
  BEFORE INSERT ON work_order_events
  FOR EACH ROW EXECUTE FUNCTION overva_validate_work_order_assignment_identity();

ALTER TABLE work_order_events
  DROP CONSTRAINT work_order_events_order_tenant_fk,
  ADD CONSTRAINT work_order_events_order_tenant_fk
    FOREIGN KEY(organization_id,work_order_id)
    REFERENCES work_orders(organization_id,id) ON DELETE RESTRICT;

COMMENT ON TABLE work_order_events IS
  'Append-only Work Order event journal. Version-1 assignment events are canonical. Unversioned assigned events are accepted only for phased old-writer compatibility and remain non-canonical.';

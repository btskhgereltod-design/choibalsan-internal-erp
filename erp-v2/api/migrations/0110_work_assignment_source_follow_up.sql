-- A governed scope disposition may create a follow-up Work Order. Preserve
-- that origin in the canonical assignment timeline instead of weakening it to
-- the generic API source.

ALTER TABLE work_order_events
  DROP CONSTRAINT work_order_events_assignment_source_check;

ALTER TABLE work_order_events
  ADD CONSTRAINT work_order_events_assignment_source_check CHECK(
    assignment_source IS NULL OR assignment_source IN(
      'api','import','system','self_claim','scope_follow_up'
    )
  );

COMMENT ON COLUMN work_order_events.assignment_source IS
  'Typed origin of assignment evidence, including a follow-up created from an approved measured-scope disposition.';

-- Preserve the intended calendar day across short months. Without an anchor,
-- a monthly January 31 obligation would clamp to February 28 and then drift to
-- the 28th forever.

ALTER TABLE report_schedules
  ADD COLUMN recurrence_anchor_day SMALLINT CHECK(recurrence_anchor_day BETWEEN 1 AND 31);

UPDATE report_schedules
SET recurrence_anchor_day=extract(day FROM next_due)::smallint
WHERE recurrence_anchor_day IS NULL;

ALTER TABLE report_schedules ALTER COLUMN recurrence_anchor_day SET NOT NULL;

COMMENT ON COLUMN report_schedules.recurrence_anchor_day IS
  'Intended day-of-month retained while monthly recurrences clamp to the last valid day of shorter months.';

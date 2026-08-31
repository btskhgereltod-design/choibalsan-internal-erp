-- Canonical Work Order assignment history.
-- Existing work_orders.assigned_to remains the compatible current snapshot.
-- Historical rows are not backfilled: legacy assignment state stays unknown.

ALTER TABLE work_order_events
  ADD COLUMN assignment_history_version SMALLINT,
  ADD COLUMN assignment_operation TEXT,
  ADD COLUMN assignment_source TEXT,
  ADD COLUMN from_assignee_user_id UUID,
  ADD COLUMN to_assignee_user_id UUID,
  ADD COLUMN from_assignee_employee_id UUID,
  ADD COLUMN to_assignee_employee_id UUID,
  ADD COLUMN assignment_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN idempotency_key UUID,
  ADD CONSTRAINT work_order_events_assignment_operation_check CHECK(
    assignment_operation IS NULL OR assignment_operation IN ('initial','assigned','reassigned','unassigned')
  ),
  ADD CONSTRAINT work_order_events_assignment_source_check CHECK(
    assignment_source IS NULL OR assignment_source IN ('api','import','system')
  ),
  ADD CONSTRAINT work_order_events_assignment_v1_check CHECK(
    assignment_history_version IS NULL OR (
      event_type='assigned'
      AND assignment_history_version=1
      AND assignment_operation IS NOT NULL
      AND assignment_source IS NOT NULL
      AND (
        (assignment_operation='initial' AND from_assignee_user_id IS NULL)
        OR (assignment_operation='assigned' AND from_assignee_user_id IS NULL
            AND to_assignee_user_id IS NOT NULL)
        OR (assignment_operation='reassigned' AND from_assignee_user_id IS NOT NULL
            AND to_assignee_user_id IS NOT NULL AND from_assignee_user_id<>to_assignee_user_id)
        OR (assignment_operation='unassigned' AND from_assignee_user_id IS NOT NULL
            AND to_assignee_user_id IS NULL)
      )
    )
  ),
  ADD CONSTRAINT work_order_events_from_assignee_user_tenant_fk
    FOREIGN KEY(organization_id,from_assignee_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT work_order_events_to_assignee_user_tenant_fk
    FOREIGN KEY(organization_id,to_assignee_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT work_order_events_from_assignee_employee_tenant_fk
    FOREIGN KEY(organization_id,from_assignee_employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT work_order_events_to_assignee_employee_tenant_fk
    FOREIGN KEY(organization_id,to_assignee_employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX work_order_events_assignment_idempotency_uidx
  ON work_order_events(organization_id,work_order_id,idempotency_key)
  WHERE event_type='assigned' AND assignment_history_version=1 AND idempotency_key IS NOT NULL;
CREATE INDEX work_order_events_assignment_timeline_idx
  ON work_order_events(organization_id,work_order_id,created_at,id)
  WHERE event_type='assigned' AND assignment_history_version=1;
CREATE INDEX work_order_events_assignment_employee_time_idx
  ON work_order_events(organization_id,to_assignee_employee_id,created_at,work_order_id)
  WHERE event_type='assigned' AND assignment_history_version=1;

CREATE TRIGGER work_order_events_append_only
  BEFORE UPDATE OR DELETE ON work_order_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

INSERT INTO data_catalog_assets(
  code,name,domain,object_type,source_object,description,classification_code,owner_role_code,
  contains_personal_data,data_kind
) VALUES (
  'work-order-assignment-history','Work Order assignment history','operations','event','work_order_events',
  'Tenant-scoped append-only initial assignment, reassignment and unassignment evidence.',
  'confidential','work-order-manager',true,'transaction'
)
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,domain=EXCLUDED.domain,object_type=EXCLUDED.object_type,
  source_object=EXCLUDED.source_object,description=EXCLUDED.description,
  classification_code=EXCLUDED.classification_code,owner_role_code=EXCLUDED.owner_role_code,
  contains_personal_data=EXCLUDED.contains_personal_data,data_kind=EXCLUDED.data_kind,
  active=true,updated_at=now();

INSERT INTO data_dictionary_elements(
  asset_code,field_code,business_name,definition,data_type,source_field,owner_domain,
  classification_code,critical_data_element,nullable,quality_expectation
) VALUES
  ('work-order-assignment-history','work_order_id','Work Order ID',
   'Tenant Work Order whose assignment state changed.','uuid','work_order_events.work_order_id',
   'operations','confidential',true,false,'Composite tenant reference is valid'),
  ('work-order-assignment-history','assignment_operation','Assignment operation',
   'Initial assignment state, reassignment, or unassignment.','text','work_order_events.assignment_operation',
   'operations','internal',true,false,'Valid version-1 assignment operation'),
  ('work-order-assignment-history','from_assignee_user_id','Previous assignee',
   'Previous tenant login identity when known.','uuid','work_order_events.from_assignee_user_id',
   'operations','confidential',true,true,'Same-tenant identity or null'),
  ('work-order-assignment-history','to_assignee_user_id','New assignee',
   'New tenant login identity, or null after unassignment.','uuid','work_order_events.to_assignee_user_id',
   'operations','confidential',true,true,'Same-tenant identity or null'),
  ('work-order-assignment-history','created_at','Recorded time',
   'Immutable time at which OVERVA recorded the assignment change.','timestamptz','work_order_events.created_at',
   'operations','internal',true,false,'Server generated and immutable')
ON CONFLICT(asset_code,field_code) DO NOTHING;

COMMENT ON COLUMN work_order_events.assignment_history_version IS
  'NULL means legacy/non-canonical assignment evidence. Version 1 is typed and reportable.';
COMMENT ON TABLE work_order_events IS
  'Append-only Work Order event journal. Versioned assignment events are the canonical assignment timeline; work_orders.assigned_to is the current compatibility snapshot.';

-- Configurable work-order approval workflows.
-- The core remains industry-neutral; tenant policies decide who authorizes
-- work start, inspects completion and performs final closure.

CREATE TABLE organization_workflow_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT 'work_order' CHECK(domain IN ('work_order')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,code),
  CHECK(jsonb_typeof(config)='object')
);

CREATE TABLE organization_work_type_routes (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  work_type_id UUID NOT NULL,
  organization_unit_id UUID,
  workflow_policy_id UUID,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,work_type_id),
  FOREIGN KEY(organization_id,work_type_id)
    REFERENCES organization_work_types(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY(organization_id,organization_unit_id)
    REFERENCES departments(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,workflow_policy_id)
    REFERENCES organization_workflow_policies(organization_id,id) ON DELETE RESTRICT
);

ALTER TABLE work_orders
  ADD COLUMN work_type_id UUID,
  ADD COLUMN department_id UUID,
  ADD COLUMN workflow_policy_id UUID,
  ADD COLUMN workflow_stage TEXT,
  ADD CONSTRAINT work_orders_work_type_tenant_fk
    FOREIGN KEY(organization_id,work_type_id)
    REFERENCES organization_work_types(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT work_orders_department_tenant_fk
    FOREIGN KEY(organization_id,department_id)
    REFERENCES departments(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT work_orders_workflow_policy_tenant_fk
    FOREIGN KEY(organization_id,workflow_policy_id)
    REFERENCES organization_workflow_policies(organization_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT work_orders_workflow_stage_check CHECK(
    workflow_stage IS NULL OR workflow_stage IN (
      'awaiting_safety_start','awaiting_management_start','execution',
      'awaiting_safety_completion','awaiting_management_completion',
      'completed','cancelled'
    )
  );

CREATE INDEX work_orders_tenant_department_status_idx
  ON work_orders(organization_id,department_id,status,created_at DESC);

CREATE TABLE work_order_approvals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  work_order_id UUID NOT NULL,
  workflow_stage TEXT NOT NULL,
  action_code TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approved','rejected','returned')),
  actor_user_id UUID NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,work_order_id)
    REFERENCES work_orders(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(jsonb_typeof(detail)='object')
);
CREATE INDEX work_order_approvals_order_time_idx
  ON work_order_approvals(organization_id,work_order_id,created_at,id);
CREATE TRIGGER work_order_approvals_append_only
  BEFORE UPDATE OR DELETE ON work_order_approvals
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

ALTER TABLE work_order_events DROP CONSTRAINT IF EXISTS work_order_events_event_type_check;
ALTER TABLE work_order_events ADD CONSTRAINT work_order_events_event_type_check
  CHECK(event_type IN ('created','assigned','status_changed','note','workflow_action'));

INSERT INTO organization_workflow_policies(organization_id,code,name,config)
SELECT id,'safety-managed-field-work','ХАБЭА хяналттай талбайн ажлын урсгал',
       '{"startSafetyRole":"safety","startApprovalRole":"chief_engineer","completionSafetyRole":"safety","completionApprovalRole":"chief_engineer"}'::jsonb
  FROM organizations WHERE slug='choibalsan-hugjil'
ON CONFLICT(organization_id,code) DO UPDATE
SET name=EXCLUDED.name,config=EXCLUDED.config,active=true,updated_at=now();

INSERT INTO organization_work_type_routes(
  organization_id,work_type_id,organization_unit_id,workflow_policy_id
)
SELECT wt.organization_id,wt.id,d.id,p.id
  FROM organization_work_types wt
  JOIN organizations o ON o.id=wt.organization_id AND o.slug='choibalsan-hugjil'
  JOIN organization_workflow_policies p
    ON p.organization_id=wt.organization_id AND p.code='safety-managed-field-work'
  LEFT JOIN LATERAL (
    SELECT id FROM departments d
     WHERE d.organization_id=wt.organization_id
       AND (
         (wt.code IN ('lighting-inspection','lighting-repair','traffic-signal-repair') AND lower(d.name) LIKE '%цахилгаан%')
         OR (wt.code='camera-repair' AND lower(d.name) LIKE '%камер%')
       )
     ORDER BY d.active DESC,d.created_at LIMIT 1
  ) d ON true
 WHERE wt.code IN ('lighting-inspection','lighting-repair','camera-repair','traffic-signal-repair')
ON CONFLICT(organization_id,work_type_id) DO UPDATE
SET organization_unit_id=EXCLUDED.organization_unit_id,
    workflow_policy_id=EXCLUDED.workflow_policy_id,
    active=true,updated_at=now();

INSERT INTO data_catalog_assets(
  code,name,domain,source_object,description,classification_code,owner_role_code
) VALUES
('work-order-workflow-policy','Ажлын батлах урсгал','operations','organization_workflow_policies','Байгууллага бүрийн ажил эхлүүлэх, хянах, хаах үүргийн тохиргоо','internal','owner'),
('work-order-approval','Ажлын зөвшөөрөл, баталгаажуулалт','operations','work_order_approvals','ХАБЭА болон удирдлагын өөрчлөх боломжгүй баталгаажуулалтын мөр','restricted','chief_engineer')
ON CONFLICT(code) DO NOTHING;

CREATE TABLE attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL,
  attendance_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('worked','absent','leave','sick','vacation','late','remote','holiday')),
  work_hours NUMERIC(4,2) NOT NULL DEFAULT 0 CHECK (work_hours BETWEEN 0 AND 8),
  leave_hours NUMERIC(4,2) NOT NULL DEFAULT 0 CHECK (leave_hours BETWEEN 0 AND 8),
  overtime_hours NUMERIC(4,2) NOT NULL DEFAULT 0 CHECK (overtime_hours BETWEEN 0 AND 16),
  check_in TIME,
  check_out TIME,
  late_minutes INTEGER NOT NULL DEFAULT 0 CHECK (late_minutes BETWEEN 0 AND 1440),
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','device','import')),
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, attendance_date),
  CHECK (work_hours + leave_hours <= 8),
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id) ON DELETE SET NULL
);

CREATE INDEX attendance_records_org_date_idx ON attendance_records (organization_id, attendance_date DESC);
CREATE INDEX attendance_records_org_user_date_idx ON attendance_records (organization_id, user_id, attendance_date DESC);

INSERT INTO module_catalog(code,name,description,category,monthly_price,core)
VALUES ('attendance','Ирц ба цагийн бүртгэл','Сарын матриц, цагийн задаргаа, илүү цаг болон CSV тайлан','Хүний нөөц',0,true)
ON CONFLICT(code) DO NOTHING;
INSERT INTO organization_modules(organization_id,module_code)
SELECT id,'attendance' FROM organizations ON CONFLICT DO NOTHING;

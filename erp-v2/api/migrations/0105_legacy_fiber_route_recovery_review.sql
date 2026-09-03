-- Review-only recovery staging for malformed legacy fiber route geometry.
-- Nothing in this migration promotes a candidate into canonical network_routes.

CREATE TABLE network_route_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source_system TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  source_fingerprint CHAR(64) NOT NULL CHECK(source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_record_count INTEGER NOT NULL CHECK(source_record_count > 0),
  source_vertex_count INTEGER NOT NULL CHECK(source_vertex_count > 0),
  transform JSONB NOT NULL CHECK(jsonb_typeof(transform)='object'),
  status TEXT NOT NULL DEFAULT 'staged' CHECK(status='staged'),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,source_fingerprint),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE network_route_import_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL,
  source_key TEXT NOT NULL,
  proposed_code TEXT NOT NULL,
  proposed_name TEXT NOT NULL,
  proposed_core_count INTEGER NOT NULL CHECK(proposed_core_count IN(4,6,8,12,24,48,96)),
  proposed_color TEXT NOT NULL CHECK(proposed_color ~ '^#[0-9A-Fa-f]{6}$'),
  source_geometry JSONB NOT NULL,
  normalized_geometry JSONB NOT NULL,
  source_length_m NUMERIC(14,2) NOT NULL CHECK(source_length_m >= 0),
  recomputed_length_m NUMERIC(14,2) NOT NULL CHECK(recomputed_length_m >= 0),
  validation JSONB NOT NULL CHECK(jsonb_typeof(validation)='object'),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,batch_id,source_key),
  FOREIGN KEY(organization_id,batch_id) REFERENCES network_route_import_batches(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(source_geometry->>'type'='LineString'),
  CHECK(normalized_geometry->>'type'='LineString'),
  CHECK(jsonb_typeof(source_geometry->'coordinates')='array'),
  CHECK(jsonb_typeof(normalized_geometry->'coordinates')='array'),
  CHECK(jsonb_array_length(source_geometry->'coordinates') >= 2),
  CHECK(jsonb_array_length(normalized_geometry->'coordinates') >= 2)
);

CREATE TABLE network_route_import_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  candidate_id UUID NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN('confirmed','needs_correction','rejected')),
  note TEXT NOT NULL,
  reviewed_by UUID NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,candidate_id) REFERENCES network_route_import_candidates(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,reviewed_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX network_route_import_batches_created_idx
  ON network_route_import_batches(organization_id,created_at DESC);
CREATE INDEX network_route_import_candidates_batch_idx
  ON network_route_import_candidates(organization_id,batch_id,proposed_name);
CREATE INDEX network_route_import_reviews_candidate_idx
  ON network_route_import_reviews(organization_id,candidate_id,reviewed_at DESC);

CREATE TRIGGER network_route_import_batches_append_only BEFORE UPDATE OR DELETE ON network_route_import_batches
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER network_route_import_candidates_append_only BEFORE UPDATE OR DELETE ON network_route_import_candidates
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER network_route_import_reviews_append_only BEFORE UPDATE OR DELETE ON network_route_import_reviews
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE POLICY network_route_import_batches_tenant_policy ON network_route_import_batches
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY network_route_import_candidates_tenant_policy ON network_route_import_candidates
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY network_route_import_reviews_tenant_policy ON network_route_import_reviews
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());

ALTER TABLE network_route_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_route_import_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_route_import_reviews ENABLE ROW LEVEL SECURITY;

INSERT INTO data_catalog_assets(code,name,domain,source_object,description,classification_code,owner_role_code)
VALUES('network-route-import-candidate','Шилэн кабелийн сэргээх нэр дэвшигч','operations','network_route_import_candidates','Legacy эхээс сэргээсэн боловч canonical master бүртгэлд дэвшүүлээгүй, инженерийн хяналт хүлээж буй трассын хувилбар','internal','chief_engineer')
ON CONFLICT(code) DO NOTHING;

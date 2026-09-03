-- Canonical fiber network workspace for the camera operations demo.
-- A fiber route is a network object with immutable geometry revisions. It is
-- deliberately not a camera device, lighting component, or fixed-asset row.

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('network-routes.read','Шилэн кабелийн сүлжээ харах','camera-operations','Тенантын шилэн кабелийн трасс, зангилаа болон камерын GPS давхаргыг харах'),
('network-routes.manage','Шилэн кабелийн сүлжээ удирдах','camera-operations','Трасс, зангилаа, холбоосын хувилбар үүсгэх болон lifecycle төлөв өөрчлөх')
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,module_code=EXCLUDED.module_code,description=EXCLUDED.description;

CREATE TABLE network_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  network_kind TEXT NOT NULL DEFAULT 'fiber' CHECK(network_kind IN('fiber')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','inactive')),
  current_revision_id UUID,
  version BIGINT NOT NULL DEFAULT 1 CHECK(version > 0),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,code),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE network_route_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  network_route_id UUID NOT NULL,
  version_no BIGINT NOT NULL CHECK(version_no > 0),
  core_count INTEGER NOT NULL CHECK(core_count IN(4,6,8,12,24,48,96)),
  color TEXT NOT NULL CHECK(color ~ '^#[0-9A-Fa-f]{6}$'),
  geometry JSONB NOT NULL,
  length_m NUMERIC(14,2) NOT NULL CHECK(length_m >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,network_route_id,version_no),
  UNIQUE(organization_id,network_route_id,id),
  FOREIGN KEY(organization_id,network_route_id) REFERENCES network_routes(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(jsonb_typeof(geometry)='object'),
  CHECK(geometry->>'type'='LineString'),
  CHECK(jsonb_typeof(geometry->'coordinates')='array'),
  CHECK(jsonb_array_length(geometry->'coordinates') >= 2)
);

ALTER TABLE network_routes
  ADD CONSTRAINT network_routes_current_revision_fk
  FOREIGN KEY(organization_id,id,current_revision_id)
  REFERENCES network_route_revisions(organization_id,network_route_id,id) ON DELETE RESTRICT;

CREATE TABLE network_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK(node_type IN('splice','closure','odf','cross','splitter','other')),
  latitude NUMERIC(9,6) NOT NULL CHECK(latitude BETWEEN -90 AND 90),
  longitude NUMERIC(10,6) NOT NULL CHECK(longitude BETWEEN -180 AND 180),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','inactive')),
  version BIGINT NOT NULL DEFAULT 1 CHECK(version > 0),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,code),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE network_node_route_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  network_node_id UUID NOT NULL,
  network_route_id UUID NOT NULL,
  link_order INTEGER NOT NULL CHECK(link_order BETWEEN 1 AND 16),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,network_node_id,network_route_id),
  UNIQUE(organization_id,network_node_id,link_order),
  FOREIGN KEY(organization_id,network_node_id) REFERENCES network_nodes(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,network_route_id) REFERENCES network_routes(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE network_route_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  network_route_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  route_version BIGINT NOT NULL CHECK(route_version > 0),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,network_route_id) REFERENCES network_routes(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE network_node_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  network_node_id UUID NOT NULL,
  actor_user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  node_version BIGINT NOT NULL CHECK(node_version > 0),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(detail)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,network_node_id) REFERENCES network_nodes(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE INDEX network_routes_status_idx ON network_routes(organization_id,status,name);
CREATE INDEX network_route_revisions_route_idx ON network_route_revisions(organization_id,network_route_id,version_no DESC);
CREATE INDEX network_nodes_status_idx ON network_nodes(organization_id,status,node_type);
CREATE INDEX network_node_route_links_route_idx ON network_node_route_links(organization_id,network_route_id);
CREATE INDEX network_route_events_route_idx ON network_route_events(organization_id,network_route_id,created_at DESC);
CREATE INDEX network_node_events_node_idx ON network_node_events(organization_id,network_node_id,created_at DESC);

CREATE TRIGGER network_route_revisions_append_only BEFORE UPDATE OR DELETE ON network_route_revisions
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER network_node_route_links_append_only BEFORE UPDATE OR DELETE ON network_node_route_links
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER network_route_events_append_only BEFORE UPDATE OR DELETE ON network_route_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER network_node_events_append_only BEFORE UPDATE OR DELETE ON network_node_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE POLICY network_routes_tenant_policy ON network_routes
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY network_route_revisions_tenant_policy ON network_route_revisions
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY network_nodes_tenant_policy ON network_nodes
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY network_node_route_links_tenant_policy ON network_node_route_links
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY network_route_events_tenant_policy ON network_route_events
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY network_node_events_tenant_policy ON network_node_events
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());

ALTER TABLE network_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_route_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_node_route_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_route_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_node_events ENABLE ROW LEVEL SECURITY;

INSERT INTO organization_roles(organization_id,code,name,system)
SELECT om.organization_id,role.code,role.name,true
FROM organization_modules om
CROSS JOIN (VALUES
  ('camera-network-viewer','Шилэн кабелийн сүлжээ харагч'),
  ('camera-network-editor','Шилэн кабелийн сүлжээ хариуцагч')
) role(code,name)
WHERE om.module_code='camera-operations' AND om.enabled=true
ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,active=true;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT role.organization_id,role.id,grant_row.permission_code
FROM organization_roles role
JOIN LATERAL (VALUES
  ('camera-network-viewer','network-routes.read'),
  ('camera-network-editor','network-routes.read'),
  ('camera-network-editor','network-routes.manage')
) grant_row(role_code,permission_code) ON grant_row.role_code=role.code
ON CONFLICT DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT role.organization_id,role.id,permission.code
FROM organization_roles role
CROSS JOIN (VALUES('network-routes.read'),('network-routes.manage')) permission(code)
WHERE role.code IN('owner','administrator')
ON CONFLICT DO NOTHING;

INSERT INTO user_roles(organization_id,user_id,role_id)
SELECT user_row.organization_id,user_row.id,role.id
FROM users user_row
JOIN organization_modules om ON om.organization_id=user_row.organization_id
  AND om.module_code='camera-operations' AND om.enabled=true
JOIN organization_roles role ON role.organization_id=user_row.organization_id
  AND role.code='camera-network-editor'
WHERE user_row.active=true AND user_row.role IN('director','chief_engineer','camera_engineer')
ON CONFLICT DO NOTHING;

INSERT INTO data_catalog_assets(code,name,domain,source_object,description,classification_code,owner_role_code)
VALUES
('network-route','Шилэн кабелийн трасс','operations','network_routes','Хувилбартай GeoJSON шугаман геометр, core болон lifecycle бүхий сүлжээний master объект','internal','chief_engineer'),
('network-node','Шилэн кабелийн зангилаа','operations','network_nodes','Муфт, ODF, кросс, splitter болон трассын холбоосын GPS master','internal','chief_engineer')
ON CONFLICT(code) DO NOTHING;

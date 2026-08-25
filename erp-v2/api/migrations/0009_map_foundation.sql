-- COP Map foundation. PostGIS can be introduced later for advanced spatial
-- queries; the first release deliberately keeps portable point coordinates.

ALTER TABLE assets ADD COLUMN latitude NUMERIC(9,6) CHECK (latitude BETWEEN -90 AND 90);
ALTER TABLE assets ADD COLUMN longitude NUMERIC(9,6) CHECK (longitude BETWEEN -180 AND 180);
ALTER TABLE work_orders ADD COLUMN latitude NUMERIC(9,6) CHECK (latitude BETWEEN -90 AND 90);
ALTER TABLE work_orders ADD COLUMN longitude NUMERIC(9,6) CHECK (longitude BETWEEN -180 AND 180);

ALTER TABLE organization_settings ADD COLUMN map_center_lat NUMERIC(9,6) NOT NULL DEFAULT 48.072600 CHECK (map_center_lat BETWEEN -90 AND 90);
ALTER TABLE organization_settings ADD COLUMN map_center_lng NUMERIC(9,6) NOT NULL DEFAULT 114.535600 CHECK (map_center_lng BETWEEN -180 AND 180);
ALTER TABLE organization_settings ADD COLUMN map_default_zoom INTEGER NOT NULL DEFAULT 13 CHECK (map_default_zoom BETWEEN 3 AND 19);

CREATE TABLE map_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#7c3aed' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon TEXT NOT NULL DEFAULT 'point',
  visible_default BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code),
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE map_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  layer_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  latitude NUMERIC(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','warning','fault')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, layer_id) REFERENCES map_layers(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX assets_tenant_coordinates_idx ON assets(organization_id, latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX work_orders_tenant_coordinates_idx ON work_orders(organization_id, latitude, longitude) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX map_features_tenant_layer_idx ON map_features(organization_id, layer_id, status);

INSERT INTO map_layers(organization_id,code,name,color,icon,created_by)
SELECT o.id,'general','Ерөнхий тэмдэглэгээ','#7c3aed','point',NULL FROM organizations o
ON CONFLICT (organization_id,code) DO NOTHING;

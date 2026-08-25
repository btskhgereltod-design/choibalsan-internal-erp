-- GPS/Fleet foundation. Provider-neutral device ingest and tenant-scoped history.

CREATE TABLE fleet_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  asset_id UUID NOT NULL,
  plate_number TEXT NOT NULL,
  make TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  driver_user_id UUID,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive')),
  odometer_km NUMERIC(14,1) NOT NULL DEFAULT 0 CHECK (odometer_km >= 0),
  fuel_capacity_l NUMERIC(10,2) CHECK (fuel_capacity_l IS NULL OR fuel_capacity_l > 0),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,asset_id),
  UNIQUE (organization_id,plate_number),
  FOREIGN KEY (organization_id,asset_id) REFERENCES assets(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,driver_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE gps_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  vehicle_id UUID NOT NULL,
  device_uid TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'generic',
  api_key_hash CHAR(64) NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,device_uid),
  UNIQUE (organization_id,vehicle_id),
  FOREIGN KEY (organization_id,vehicle_id) REFERENCES fleet_vehicles(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE gps_positions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  vehicle_id UUID NOT NULL,
  device_id UUID NOT NULL,
  latitude NUMERIC(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  speed_kph NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (speed_kph >= 0),
  heading NUMERIC(6,2) CHECK (heading IS NULL OR (heading >= 0 AND heading < 360)),
  altitude_m NUMERIC(10,2),
  ignition BOOLEAN,
  fuel_level_pct NUMERIC(5,2) CHECK (fuel_level_pct IS NULL OR (fuel_level_pct BETWEEN 0 AND 100)),
  odometer_km NUMERIC(14,1) CHECK (odometer_km IS NULL OR odometer_km >= 0),
  accuracy_m NUMERIC(8,2) CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  recorded_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (organization_id,vehicle_id) REFERENCES fleet_vehicles(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,device_id) REFERENCES gps_devices(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX gps_positions_vehicle_time_idx ON gps_positions(organization_id,vehicle_id,recorded_at DESC);
CREATE INDEX gps_positions_received_idx ON gps_positions(received_at DESC);

CREATE TABLE geofences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  center_lat NUMERIC(9,6) NOT NULL CHECK (center_lat BETWEEN -90 AND 90),
  center_lng NUMERIC(9,6) NOT NULL CHECK (center_lng BETWEEN -180 AND 180),
  radius_m INTEGER NOT NULL CHECK (radius_m BETWEEN 10 AND 100000),
  color TEXT NOT NULL DEFAULT '#f59e0b' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,name),
  FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE vehicle_geofence_states (
  organization_id UUID NOT NULL,
  vehicle_id UUID NOT NULL,
  geofence_id UUID NOT NULL,
  is_inside BOOLEAN NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,vehicle_id,geofence_id),
  FOREIGN KEY (organization_id,vehicle_id) REFERENCES fleet_vehicles(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,geofence_id) REFERENCES geofences(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE geofence_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  vehicle_id UUID NOT NULL,
  geofence_id UUID NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('entered','exited')),
  latitude NUMERIC(9,6) NOT NULL,
  longitude NUMERIC(9,6) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,vehicle_id) REFERENCES fleet_vehicles(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,geofence_id) REFERENCES geofences(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX geofence_events_tenant_time_idx ON geofence_events(organization_id,occurred_at DESC);

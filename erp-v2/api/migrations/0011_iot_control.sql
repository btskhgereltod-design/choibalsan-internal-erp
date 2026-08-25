-- Provider-neutral IoT telemetry and priority-aware command queue.

CREATE TABLE iot_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  asset_id UUID,
  map_feature_id UUID,
  device_uid TEXT NOT NULL,
  name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'http',
  api_key_hash CHAR(64) NOT NULL UNIQUE,
  latitude NUMERIC(9,6) CHECK (latitude BETWEEN -90 AND 90),
  longitude NUMERIC(9,6) CHECK (longitude BETWEEN -180 AND 180),
  active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  firmware_version TEXT NOT NULL DEFAULT '',
  local_policy_version TEXT NOT NULL DEFAULT '',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,device_uid),
  FOREIGN KEY (organization_id,asset_id) REFERENCES assets(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id,map_feature_id) REFERENCES map_features(organization_id,id) ON DELETE SET NULL,
  FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

CREATE TABLE iot_telemetry (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  device_id UUID NOT NULL,
  state TEXT NOT NULL DEFAULT 'unknown',
  health TEXT NOT NULL DEFAULT 'normal' CHECK (health IN ('normal','warning','fault','critical')),
  voltage NUMERIC(12,3),
  current_amp NUMERIC(12,3),
  power_watt NUMERIC(14,3),
  energy_kwh NUMERIC(16,3),
  temperature_c NUMERIC(8,3),
  signal_strength INTEGER,
  sensors JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,device_id) REFERENCES iot_devices(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX iot_telemetry_device_time_idx ON iot_telemetry(organization_id,device_id,recorded_at DESC);

CREATE TABLE iot_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  device_id UUID NOT NULL,
  action TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority TEXT NOT NULL CHECK (priority IN ('emergency','manual','weather','schedule','default')),
  priority_level INTEGER NOT NULL CHECK (priority_level IN (100,80,60,40,20)),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','delivered','acknowledged','failed','expired','superseded')),
  requested_by UUID,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now()+interval '15 minutes'),
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT,
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,device_id,idempotency_key),
  FOREIGN KEY (organization_id,device_id) REFERENCES iot_devices(organization_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id,requested_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX iot_commands_device_queue_idx ON iot_commands(organization_id,device_id,status,priority_level DESC,requested_at);

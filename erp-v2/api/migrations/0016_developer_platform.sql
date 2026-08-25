CREATE TABLE api_clients (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 name TEXT NOT NULL,key_prefix TEXT NOT NULL,api_key_hash CHAR(64) NOT NULL UNIQUE,scopes TEXT[] NOT NULL DEFAULT '{}',
 active BOOLEAN NOT NULL DEFAULT true,last_used_at TIMESTAMPTZ,expires_at TIMESTAMPTZ,created_by UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE webhook_subscriptions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 name TEXT NOT NULL,url TEXT NOT NULL,event_types TEXT[] NOT NULL,active BOOLEAN NOT NULL DEFAULT true,created_by UUID NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE TABLE webhook_deliveries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 subscription_id UUID NOT NULL,event_type TEXT NOT NULL,payload JSONB NOT NULL,status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','delivered','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,response_status INTEGER,response_body TEXT NOT NULL DEFAULT '',last_error TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),delivered_at TIMESTAMPTZ,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,subscription_id) REFERENCES webhook_subscriptions(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX webhook_delivery_queue_idx ON webhook_deliveries(status,next_attempt_at);

CREATE TABLE module_catalog(code TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,monthly_price NUMERIC(14,2) NOT NULL DEFAULT 0,core BOOLEAN NOT NULL DEFAULT false,active BOOLEAN NOT NULL DEFAULT true);
INSERT INTO module_catalog(code,name,description,category,monthly_price,core) VALUES
('core-work','Ажил ба хөрөнгө','Хөрөнгө, ажлын захиалга, аудит','Үндсэн',0,true),('finance','Finance Hub','CSV/XLSX болон санхүүгийн интеграц','Санхүү',150000,false),
('connected-ops','Connected Operations','COP Map, GPS/Fleet, IoT Control','Үйл ажиллагаа',250000,false),('automation','Automation','Event-driven дүрэм ба үйлдэл','Удирдлага',100000,false),
('ai-director','AI Director','Нотолгоонд суурилсан удирдлагын brief','Удирдлага',150000,false),('developer','Developer Platform','Open API ба webhooks','Интеграц',100000,false)
ON CONFLICT(code) DO NOTHING;
CREATE TABLE organization_modules(organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,module_code TEXT NOT NULL REFERENCES module_catalog(code) ON DELETE RESTRICT,enabled BOOLEAN NOT NULL DEFAULT true,enabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),enabled_by UUID,PRIMARY KEY(organization_id,module_code),FOREIGN KEY(organization_id,enabled_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT);
INSERT INTO organization_modules(organization_id,module_code) SELECT o.id,m.code FROM organizations o CROSS JOIN module_catalog m ON CONFLICT DO NOTHING;

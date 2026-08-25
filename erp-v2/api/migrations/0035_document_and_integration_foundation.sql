-- Canonical document/content lifecycle and integration-contract foundation.
-- Existing attachments, records, archives and webhook endpoints remain API-compatible.

INSERT INTO data_catalog_assets(code,name,domain,object_type,source_object,description,classification_code,owner_role_code) VALUES
('document','Баримт бичиг','content','file','documents','Хувилбар, баталгаажуулалт, хадгалалттай canonical баримт','confidential','records-officer'),
('integration-contract','Интеграцийн гэрээ','integration','api','integration_contracts','Source, target, trigger, mapping болон гүйцэтгэлийн дүрэм','restricted','owner')
ON CONFLICT(code) DO NOTHING;

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  document_no TEXT NOT NULL,
  title TEXT NOT NULL,
  document_type TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN('draft','in_review','approved','signed','active','archived','disposed')),
  classification_set_code TEXT NOT NULL DEFAULT 'data_classification'
    CHECK(classification_set_code='data_classification'),
  classification_code TEXT NOT NULL DEFAULT 'internal',
  retention_class TEXT NOT NULL DEFAULT 'standard',
  linked_entity_type TEXT,
  linked_entity_id TEXT,
  current_version_id UUID,
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,document_no),
  FOREIGN KEY(classification_set_code,classification_code)
    REFERENCES reference_values(set_code,code) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK((linked_entity_type IS NULL)=(linked_entity_id IS NULL))
);
CREATE INDEX documents_tenant_status_idx ON documents(organization_id,status,updated_at DESC);
CREATE INDEX documents_tenant_entity_idx ON documents(organization_id,linked_entity_type,linked_entity_id);

CREATE TABLE document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL,
  version_no INTEGER NOT NULL CHECK(version_no > 0),
  original_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 52428800),
  content_sha256 CHAR(64) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,document_id,version_no),
  FOREIGN KEY(organization_id,document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX document_versions_tenant_document_idx
  ON document_versions(organization_id,document_id,version_no DESC);
ALTER TABLE documents ADD CONSTRAINT documents_current_version_tenant_fk
  FOREIGN KEY(organization_id,current_version_id)
  REFERENCES document_versions(organization_id,id) ON DELETE RESTRICT;

CREATE TABLE document_lifecycle_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL,
  version_id UUID,
  action TEXT NOT NULL CHECK(action IN('created','version_added','submitted','approved','rejected','signed','activated','archived','disposed')),
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,document_id) REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,version_id) REFERENCES document_versions(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX document_lifecycle_events_tenant_idx
  ON document_lifecycle_events(organization_id,document_id,created_at DESC,id DESC);
CREATE TRIGGER document_versions_append_only BEFORE UPDATE OR DELETE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER document_lifecycle_events_append_only BEFORE UPDATE OR DELETE ON document_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE TABLE integration_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  source_system TEXT NOT NULL,
  target_system TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN('event','webhook','schedule','manual')),
  trigger_rule TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK(direction IN('inbound','outbound','bidirectional')),
  update_policy TEXT NOT NULL DEFAULT 'source_wins'
    CHECK(update_policy IN('source_wins','target_wins','reject_conflict','manual_review')),
  idempotency_strategy TEXT NOT NULL DEFAULT 'required'
    CHECK(idempotency_strategy IN('required','source_key','content_hash')),
  expected_latency_seconds INTEGER NOT NULL DEFAULT 300 CHECK(expected_latency_seconds BETWEEN 1 AND 86400),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 20),
  retry_backoff_seconds INTEGER NOT NULL DEFAULT 60 CHECK(retry_backoff_seconds BETWEEN 1 AND 86400),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','active','suspended','retired')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,code,version),
  FOREIGN KEY(organization_id,approved_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK(source_system <> target_system),
  CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL)
     OR (status<>'draft' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX integration_contracts_tenant_status_idx ON integration_contracts(organization_id,status,name);

CREATE TABLE integration_field_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  contract_id UUID NOT NULL,
  source_field TEXT NOT NULL,
  target_field TEXT NOT NULL,
  transformation TEXT NOT NULL DEFAULT 'copy',
  transformation_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  required BOOLEAN NOT NULL DEFAULT false,
  default_value JSONB,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,contract_id,target_field),
  FOREIGN KEY(organization_id,contract_id) REFERENCES integration_contracts(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE integration_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  contract_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_sha256 CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN('queued','running','succeeded','retry_scheduled','dead_letter','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error_code TEXT NOT NULL DEFAULT '',
  last_error_message TEXT NOT NULL DEFAULT '',
  result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,contract_id,idempotency_key),
  FOREIGN KEY(organization_id,contract_id) REFERENCES integration_contracts(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX integration_executions_queue_idx
  ON integration_executions(status,next_attempt_at) WHERE status IN('queued','retry_scheduled');

CREATE TABLE integration_execution_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  execution_id UUID NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK(attempt >= 0),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,execution_id) REFERENCES integration_executions(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX integration_execution_events_tenant_idx
  ON integration_execution_events(organization_id,execution_id,created_at DESC,id DESC);
CREATE TRIGGER integration_execution_events_append_only BEFORE UPDATE OR DELETE ON integration_execution_events
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

-- Upgrade the existing, working webhook queue without changing its public API.
ALTER TABLE webhook_deliveries DROP CONSTRAINT webhook_deliveries_status_check;
ALTER TABLE webhook_deliveries ADD CONSTRAINT webhook_deliveries_status_check
  CHECK(status IN('queued','delivered','failed','dead_letter'));
ALTER TABLE webhook_deliveries ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 20);
ALTER TABLE webhook_deliveries ADD COLUMN retry_backoff_seconds INTEGER NOT NULL DEFAULT 60 CHECK(retry_backoff_seconds BETWEEN 1 AND 86400);
ALTER TABLE webhook_deliveries ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX webhook_deliveries_idempotency_uidx
  ON webhook_deliveries(organization_id,subscription_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('documents.manage','Баримт удирдах','records','Баримт үүсгэх, хувилбар нэмэх, lifecycle төлөв удирдах'),
('integrations.manage','Интеграц удирдах','developer','Source-target contract, mapping болон гүйцэтгэл удирдах')
ON CONFLICT(code) DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code FROM organization_roles r CROSS JOIN permission_catalog p
WHERE (r.code IN('owner','administrator') AND p.code IN('documents.manage','integrations.manage'))
   OR (r.code IN('records-officer','archivist') AND p.code='documents.manage')
ON CONFLICT DO NOTHING;

CREATE POLICY documents_tenant_policy ON documents USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY document_versions_tenant_policy ON document_versions USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY integration_contracts_tenant_policy ON integration_contracts USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY integration_field_mappings_tenant_policy ON integration_field_mappings USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY integration_executions_tenant_policy ON integration_executions USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());

COMMENT ON TABLE documents IS 'Canonical tenant document metadata; binary content is append-only in document_versions.';
COMMENT ON TABLE integration_contracts IS 'Versioned source-target-trigger contract; secrets and payload bodies are deliberately excluded.';

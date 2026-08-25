-- OVERVA governance catalog: master/reference classification, field metadata,
-- KPI definitions, lineage and measurable data-quality evidence.

ALTER TABLE data_catalog_assets
  ADD COLUMN data_kind TEXT NOT NULL DEFAULT 'transaction'
    CHECK(data_kind IN ('master','reference','transaction'));

UPDATE data_catalog_assets SET data_kind='master'
 WHERE code IN ('organization','organization-unit','job','position','employee','employee-profile');
UPDATE data_catalog_assets SET data_kind='reference'
 WHERE code IN ('integration-contract');

CREATE TABLE data_dictionary_elements (
  asset_code TEXT NOT NULL REFERENCES data_catalog_assets(code) ON DELETE RESTRICT,
  field_code TEXT NOT NULL,
  business_name TEXT NOT NULL,
  definition TEXT NOT NULL,
  data_type TEXT NOT NULL,
  source_field TEXT NOT NULL,
  source_system TEXT NOT NULL DEFAULT 'OVERVA',
  owner_domain TEXT NOT NULL,
  classification_set_code TEXT NOT NULL DEFAULT 'data_classification'
    CHECK(classification_set_code='data_classification'),
  classification_code TEXT NOT NULL DEFAULT 'internal',
  critical_data_element BOOLEAN NOT NULL DEFAULT false,
  nullable BOOLEAN NOT NULL DEFAULT true,
  quality_expectation TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(asset_code,field_code),
  FOREIGN KEY(classification_set_code,classification_code)
    REFERENCES reference_values(set_code,code) ON DELETE RESTRICT,
  CHECK(field_code ~ '^[a-z][a-z0-9_]{0,99}$')
);

INSERT INTO data_dictionary_elements
  (asset_code,field_code,business_name,definition,data_type,source_field,owner_domain,classification_code,critical_data_element,nullable,quality_expectation)
VALUES
  ('organization','id','Organization ID','OVERVA tenant байгууллагын өөрчлөгдөхгүй дотоод таних дугаар.','uuid','organizations.id','organization','restricted',true,false,'Unique and immutable'),
  ('organization','slug','Organization code','Нэвтрэх болон tenant routing-д ашиглагдах давтагдашгүй байгууллагын код.','text','organizations.slug','organization','internal',true,false,'Unique, lowercase slug'),
  ('employee','employee_no','Employee number','Нэг байгууллагын хүрээнд ажилтныг таних давтагдашгүй дугаар.','text','employees.employee_no','people','confidential',true,false,'Unique within organization'),
  ('document','document_no','Document number','Байгууллагын хүрээнд баримтыг таних давтагдашгүй дугаар.','text','documents.document_no','records','confidential',true,false,'Unique within organization'),
  ('integration-contract','code','Integration contract code','Source-target өгөгдлийн гэрээг таних хувилбартай код.','text','integration_contracts.code','integration','internal',true,false,'Unique by organization and version')
ON CONFLICT(asset_code,field_code) DO NOTHING;

CREATE TABLE data_lineage_edges (
  code TEXT PRIMARY KEY,
  source_asset_code TEXT NOT NULL REFERENCES data_catalog_assets(code) ON DELETE RESTRICT,
  source_field_code TEXT,
  target_asset_code TEXT NOT NULL REFERENCES data_catalog_assets(code) ON DELETE RESTRICT,
  target_field_code TEXT,
  movement_type TEXT NOT NULL DEFAULT 'api'
    CHECK(movement_type IN ('api','event','file','database','manual','derived')),
  transformation_rule TEXT NOT NULL DEFAULT 'same_value',
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(source_asset_code<>target_asset_code OR source_field_code IS DISTINCT FROM target_field_code)
);

CREATE TABLE kpi_catalog (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  formula_definition TEXT NOT NULL,
  source_asset_codes TEXT[] NOT NULL DEFAULT '{}',
  owner_domain TEXT NOT NULL,
  refresh_frequency TEXT NOT NULL DEFAULT 'daily'
    CHECK(refresh_frequency IN ('realtime','hourly','daily','weekly','monthly','manual')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO kpi_catalog(code,name,purpose,formula_definition,source_asset_codes,owner_domain,refresh_frequency) VALUES
  ('authoritative-source-coverage','Authoritative source coverage','Өгөгдлийн объект бүр албан ёсны эх сурвалжтай эсэхийг хянах.','configured authoritative assets / active catalog assets * 100',ARRAY['organization'],'governance','daily'),
  ('lifecycle-policy-coverage','Lifecycle policy coverage','Өгөгдлийн объект бүр хадгалалт, архивын бодлоготой эсэхийг хянах.','active lifecycle policies / active catalog assets * 100',ARRAY['organization'],'governance','daily'),
  ('document-version-completeness','Document version completeness','Идэвхтэй баримт бүр дор хаяж нэг immutable хувилбартай эсэхийг хянах.','versioned active documents / active documents * 100',ARRAY['document'],'records','daily'),
  ('integration-delivery-health','Integration delivery health','Интеграцийн амжилтгүй болон dead-letter гүйцэтгэлийг хянах.','successful executions / completed executions * 100',ARRAY['integration-contract'],'integration','hourly')
ON CONFLICT(code) DO NOTHING;

CREATE TABLE organization_kpis (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  kpi_code TEXT NOT NULL REFERENCES kpi_catalog(code) ON DELETE RESTRICT,
  owner_employee_id UUID,
  enabled BOOLEAN NOT NULL DEFAULT true,
  target_value NUMERIC,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,kpi_code),
  FOREIGN KEY(organization_id,owner_employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,updated_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);

ALTER TABLE data_quality_rules
  ADD COLUMN field_code TEXT,
  ADD COLUMN rule_type TEXT NOT NULL DEFAULT 'constraint'
    CHECK(rule_type IN ('required','unique','reference','range','pattern','freshness','constraint')),
  ADD COLUMN target_percent NUMERIC(5,2) NOT NULL DEFAULT 100
    CHECK(target_percent>=0 AND target_percent<=100),
  ADD COLUMN owner_domain TEXT NOT NULL DEFAULT 'governance',
  ADD COLUMN parameters JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE data_quality_measurements (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  rule_code TEXT NOT NULL REFERENCES data_quality_rules(code) ON DELETE RESTRICT,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  records_checked BIGINT NOT NULL CHECK(records_checked>=0),
  records_passed BIGINT NOT NULL CHECK(records_passed>=0),
  pass_percent NUMERIC(5,2) NOT NULL CHECK(pass_percent>=0 AND pass_percent<=100),
  target_percent NUMERIC(5,2) NOT NULL CHECK(target_percent>=0 AND target_percent<=100),
  outcome TEXT NOT NULL CHECK(outcome IN ('pass','warning','fail')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(records_passed<=records_checked)
);
CREATE INDEX data_quality_measurements_tenant_idx
  ON data_quality_measurements(organization_id,measured_at DESC,rule_code);
CREATE TRIGGER data_quality_measurements_append_only
BEFORE UPDATE OR DELETE ON data_quality_measurements
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

COMMENT ON TABLE data_dictionary_elements IS 'Platform-managed field-level business metadata; contains definitions, not tenant row values.';
COMMENT ON TABLE data_lineage_edges IS 'Platform-standard source-to-target lineage definitions without business payloads.';
COMMENT ON TABLE kpi_catalog IS 'Reusable KPI templates. Tenant-specific enablement and targets live in organization_kpis.';
COMMENT ON TABLE data_quality_measurements IS 'Append-only tenant quality measurement evidence; evidence must not contain raw sensitive records.';

CREATE POLICY organization_kpis_tenant_policy ON organization_kpis
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY data_quality_measurements_tenant_policy ON data_quality_measurements
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());

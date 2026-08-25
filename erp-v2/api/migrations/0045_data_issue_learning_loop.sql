-- OVERVA Data Issue Learning Loop
-- Source/staging discrepancies are preserved as review cases. They never mutate
-- canonical business data until an authorized person makes an explicit decision.

CREATE TABLE data_quality_patterns (
  code TEXT PRIMARY KEY,
  finding_type TEXT NOT NULL CHECK(finding_type IN(
    'semantic_mismatch','duplicate','missing_reference','invalid_value',
    'ambiguous_definition','relationship_gap','measurement_gap',
    'ownership_gap','lineage_gap','other'
  )),
  name TEXT NOT NULL,
  detection_definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution_guidance TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO data_quality_patterns(code,finding_type,name,detection_definition,resolution_guidance) VALUES
('operational-object-vs-fixed-asset','semantic_mismatch','Ашиглалтын объект ба үндсэн хөрөнгийн ангилал холилдсон',
 '{"signals":["composite operational network stored as one accounting asset","component inventory used as operational object"],"humanApprovalRequired":true}'::jsonb,
 'Эх өгөгдлийг хэвээр хадгалж, нягтлангийн хөрөнгө, ашиглалтын объект, бүрэлдэхүүн хэсгийг хүнээр батлуулан тусад нь ангилна.'),
('percentage-without-measurement-basis','measurement_gap','Гүйцэтгэлийн хувь хэмжилтийн суурьгүй',
 '{"signals":["progress percent without planned quantity","progress percent without completed quantity or accepted exception"],"humanApprovalRequired":true}'::jsonb,
 'Төлөвлөсөн ба гүйцэтгэсэн хэмжигдэхүүн, боломжгүй үлдэгдэл, хүлээн зөвшөөрсөн тайлбарыг тусад нь бүртгэнэ.'),
('missing-authoritative-source','ownership_gap','Албан ёсны эх сурвалж тодорхойгүй',
 '{"signals":["same business entity maintained by multiple systems","no authoritative source configured"],"humanApprovalRequired":true}'::jsonb,
 'System of record болон өгөгдөл хариуцагчийг тогтоож байж canonical бүртгэлийг шинэчилнэ.'),
('orphan-reference','missing_reference','Хамаарах үндсэн бүртгэл олдоогүй',
 '{"signals":["foreign business key cannot be mapped","parent or reference record is absent"],"humanApprovalRequired":true}'::jsonb,
 'Эх мөрийг staging-д хадгалж, зөв master/reference бүртгэлтэй хүнээр холбуулна.'),
('duplicate-business-key','duplicate','Бизнесийн түлхүүр давхардсан',
 '{"signals":["same tenant and business key occurs more than once"],"humanApprovalRequired":true}'::jsonb,
 'Автоматаар нэгтгэхгүй. Давхардлын шалтгаан, authoritative хувилбар, merge шийдвэрийг хүн батална.')
ON CONFLICT(code) DO NOTHING;

CREATE TABLE data_quality_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  fingerprint TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN('import','migration','runtime','user_report','audit','analysis')),
  source_system TEXT NOT NULL DEFAULT 'OVERVA',
  import_job_id UUID,
  asset_code TEXT REFERENCES data_catalog_assets(code) ON DELETE RESTRICT,
  entity_type TEXT NOT NULL,
  record_key_hash TEXT,
  source_reference JSONB NOT NULL DEFAULT '{}'::jsonb,
  pattern_code TEXT REFERENCES data_quality_patterns(code) ON DELETE RESTRICT,
  finding_type TEXT NOT NULL CHECK(finding_type IN(
    'semantic_mismatch','duplicate','missing_reference','invalid_value',
    'ambiguous_definition','relationship_gap','measurement_gap',
    'ownership_gap','lineage_gap','other'
  )),
  severity TEXT NOT NULL CHECK(severity IN('info','low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN(
    'open','triaged','awaiting_owner','accepted_for_correction',
    'resolved','accepted_exception','rejected'
  )),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  business_impact TEXT NOT NULL DEFAULT '',
  recommendation TEXT NOT NULL DEFAULT '',
  detected_by TEXT NOT NULL DEFAULT 'system' CHECK(detected_by IN('system','ai','user','import_rule')),
  confidence NUMERIC(4,3) CHECK(confidence IS NULL OR (confidence>=0 AND confidence<=1)),
  proposed_classification JSONB NOT NULL DEFAULT '{}'::jsonb,
  assigned_employee_id UUID,
  resolution_note TEXT NOT NULL DEFAULT '',
  learning_status TEXT NOT NULL DEFAULT 'not_applicable'
    CHECK(learning_status IN('not_applicable','candidate','approved','rejected')),
  created_by UUID,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,fingerprint),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,import_job_id) REFERENCES smart_import_jobs(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,assigned_employee_id) REFERENCES employees(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE SET NULL,
  FOREIGN KEY(organization_id,resolved_by) REFERENCES users(organization_id,id) ON DELETE SET NULL,
  CHECK(length(fingerprint) BETWEEN 8 AND 160),
  CHECK(jsonb_typeof(source_reference)='object'),
  CHECK(jsonb_typeof(proposed_classification)='object')
);
CREATE INDEX data_quality_findings_tenant_queue_idx
  ON data_quality_findings(organization_id,status,severity,created_at DESC);
CREATE INDEX data_quality_findings_pattern_idx
  ON data_quality_findings(pattern_code,learning_status,created_at DESC);

CREATE TABLE data_quality_finding_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL,
  finding_id UUID NOT NULL,
  actor_user_id UUID,
  event_type TEXT NOT NULL CHECK(event_type IN(
    'detected','triaged','assigned','status_changed','correction_approved',
    'resolved','exception_accepted','rule_proposed','rule_approved','note'
  )),
  from_status TEXT,
  to_status TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,finding_id) REFERENCES data_quality_findings(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE SET NULL,
  CHECK(jsonb_typeof(detail)='object')
);
CREATE INDEX data_quality_finding_events_tenant_time_idx
  ON data_quality_finding_events(organization_id,finding_id,created_at,id);
CREATE TRIGGER data_quality_finding_events_immutable
BEFORE UPDATE OR DELETE ON data_quality_finding_events
FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

CREATE POLICY data_quality_findings_tenant_policy ON data_quality_findings
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY data_quality_finding_events_tenant_policy ON data_quality_finding_events
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());

COMMENT ON TABLE data_quality_findings IS 'Tenant discrepancy cases. Source references are metadata only; raw sensitive rows remain in their governed source/staging store.';
COMMENT ON TABLE data_quality_finding_events IS 'Append-only human review and decision history. Finding decisions never mutate canonical records automatically.';
COMMENT ON TABLE data_quality_patterns IS 'Platform-standard reusable detection guidance; definitions contain no tenant business payload.';

-- First real lessons from the legacy Choibalsan lighting migration. These are
-- visible as governed cases, not silently hidden corrections.
WITH tenant AS (SELECT id FROM organizations WHERE slug='choibalsan-hugjil'), inserted AS (
  INSERT INTO data_quality_findings(
    organization_id,fingerprint,source_type,source_system,asset_code,entity_type,
    source_reference,pattern_code,finding_type,severity,status,title,description,
    business_impact,recommendation,detected_by,confidence,resolution_note,learning_status,resolved_at
  )
  SELECT id,'legacy-lighting-asset-classification','migration','Choibalsan legacy ERP',
    'operational-object','lighting_operational_object','{"migration":"0044","rawValuesStored":false}'::jsonb,
    'operational-object-vs-fixed-asset','semantic_mismatch','high','resolved',
    'Гэрэлтүүлгийн ашиглалтын объект үндсэн хөрөнгөтэй холилдсон',
    'Гэрлийн шугам, толгой, шон, тоолуур, утас зэрэг нийлмэл ашиглалтын ойлголт нягтлангийн үндсэн хөрөнгийн бүртгэлтэй нэг түвшинд хадгалагдсан байсан.',
    'Хөрөнгийн тайлан болон ашиглалтын ажлын тоо хоёул буруу тайлбарлагдах эрсдэлтэй.',
    'Нягтлангийн хөрөнгө, ашиглалтын объект, бүрэлдэхүүн хэсгийг тусдаа canonical төрлөөр удирдана.',
    'system',1,'0044 migration-аар 451 legacy мөрийг operational object болгон ангилж, fixed asset master-аас тусгаарласан.',
    'approved',now()
  FROM tenant ON CONFLICT(organization_id,fingerprint) DO NOTHING RETURNING organization_id,id,status
)
INSERT INTO data_quality_finding_events(organization_id,finding_id,event_type,to_status,detail)
SELECT organization_id,id,'resolved',status,'{"migration":"0044","humanReviewRequiredForFutureImports":true}'::jsonb FROM inserted;

WITH tenant AS (SELECT id FROM organizations WHERE slug='choibalsan-hugjil'), inserted AS (
  INSERT INTO data_quality_findings(
    organization_id,fingerprint,source_type,source_system,asset_code,entity_type,
    source_reference,pattern_code,finding_type,severity,status,title,description,
    business_impact,recommendation,detected_by,confidence,resolution_note,learning_status
  )
  SELECT id,'legacy-work-progress-without-measurement','analysis','Choibalsan legacy ERP',
    'measured-work-outcome','work_order','{"migration":"0044","rawValuesStored":false}'::jsonb,
    'percentage-without-measurement-basis','measurement_gap','high','accepted_for_correction',
    'Ажлын гүйцэтгэл хэмжилтийн суурьгүй нэг хувиар хадгалагдсан',
    'Нэг ажлын дотор олон гэрэл, боломжгүй үлдэгдэл болон хэсэгчилсэн үр дүн байхад зөвхөн нийт хувь хадгалсан байна.',
    'Гүйцэтгэл бодитоос өндөр эсвэл бага харагдаж, удирдлагын шийдвэр буруу гарах эрсдэлтэй.',
    'Төлөвлөсөн, гүйцэтгэсэн, боломжгүй үлдсэн хэмжигдэхүүн болон баталсан exception-ийг тусад нь бүртгэнэ.',
    'system',1,'Measured outcome суурь үүссэн; legacy мөрүүдийг хүнээр батлуулан нөхөх шаардлагатай.',
    'candidate'
  FROM tenant ON CONFLICT(organization_id,fingerprint) DO NOTHING RETURNING organization_id,id,status
)
INSERT INTO data_quality_finding_events(organization_id,finding_id,event_type,to_status,detail)
SELECT organization_id,id,'correction_approved',status,'{"canonicalMutationPerformed":false,"requiresHumanCompletion":true}'::jsonb FROM inserted;

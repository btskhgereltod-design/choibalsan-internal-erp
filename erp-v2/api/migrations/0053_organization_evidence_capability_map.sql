-- Evidence-backed organization discovery and human-reviewed capability map.
-- Source material, extracted AS-IS findings, machine proposals and human
-- decisions remain separate and append-only. No proposal mutates master data.

CREATE TABLE organization_evidence_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK(source_type IN('pasted_text','interview_note','document_excerpt','system_inventory')),
  title TEXT NOT NULL CHECK(char_length(title) BETWEEN 2 AND 240),
  content TEXT NOT NULL CHECK(char_length(content) BETWEEN 20 AND 50000),
  content_sha256 CHAR(64) NOT NULL,
  analysis_mode TEXT NOT NULL DEFAULT 'deterministic' CHECK(analysis_mode IN('deterministic','ai_assisted')),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX organization_evidence_sources_tenant_time_idx
  ON organization_evidence_sources(organization_id,created_at DESC);

CREATE TABLE organization_evidence_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  source_id UUID NOT NULL,
  finding_kind TEXT NOT NULL CHECK(finding_kind IN('activity','current_system','pain_point','control','role')),
  statement TEXT NOT NULL,
  evidence_excerpt TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  FOREIGN KEY(organization_id,source_id) REFERENCES organization_evidence_sources(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX organization_evidence_findings_source_idx
  ON organization_evidence_findings(organization_id,source_id,created_at,id);

CREATE TABLE organization_capability_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  finding_id UUID NOT NULL,
  capability_code TEXT NOT NULL REFERENCES organization_blueprint_catalog(code) ON DELETE RESTRICT,
  capability_name TEXT NOT NULL,
  proposed_disposition TEXT NOT NULL CHECK(proposed_disposition IN('native','integrate','later')),
  rationale TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,finding_id,capability_code),
  FOREIGN KEY(organization_id,finding_id) REFERENCES organization_evidence_findings(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX organization_capability_proposals_review_queue_idx
  ON organization_capability_proposals(organization_id,created_at DESC,id);

CREATE TABLE organization_capability_reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id UUID NOT NULL,
  proposal_id UUID NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN('accepted','corrected','rejected')),
  selected_disposition TEXT CHECK(selected_disposition IN('native','integrate','later')),
  note TEXT NOT NULL DEFAULT '',
  actor_user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(organization_id,proposal_id) REFERENCES organization_capability_proposals(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,actor_user_id) REFERENCES users(organization_id,id) ON DELETE RESTRICT,
  CHECK((decision='rejected' AND selected_disposition IS NULL) OR
        (decision<>'rejected' AND selected_disposition IS NOT NULL))
);
CREATE INDEX organization_capability_reviews_latest_idx
  ON organization_capability_reviews(organization_id,proposal_id,created_at DESC,id DESC);

CREATE TRIGGER organization_evidence_sources_append_only BEFORE UPDATE OR DELETE ON organization_evidence_sources
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER organization_evidence_findings_append_only BEFORE UPDATE OR DELETE ON organization_evidence_findings
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER organization_capability_proposals_append_only BEFORE UPDATE OR DELETE ON organization_capability_proposals
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE TRIGGER organization_capability_reviews_append_only BEFORE UPDATE OR DELETE ON organization_capability_reviews
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();

ALTER TABLE organization_evidence_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_evidence_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_capability_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_capability_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_evidence_sources_tenant_policy ON organization_evidence_sources
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY organization_evidence_findings_tenant_policy ON organization_evidence_findings
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY organization_capability_proposals_tenant_policy ON organization_capability_proposals
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());
CREATE POLICY organization_capability_reviews_tenant_policy ON organization_capability_reviews
  USING(organization_id=overva_current_organization_id()) WITH CHECK(organization_id=overva_current_organization_id());

COMMENT ON TABLE organization_evidence_sources IS 'Tenant-private immutable source material used for organization discovery.';
COMMENT ON TABLE organization_evidence_findings IS 'Evidence-linked AS-IS observations; extracted text is never canonical master data.';
COMMENT ON TABLE organization_capability_proposals IS 'Machine proposals classified as Native, Integrate or Later; human review is required.';
COMMENT ON TABLE organization_capability_reviews IS 'Append-only human decisions; proposals do not directly apply configuration.';

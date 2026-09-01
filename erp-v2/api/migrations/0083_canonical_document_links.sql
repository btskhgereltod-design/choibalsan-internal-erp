-- Canonical document relationship foundation.
-- Legacy linked_entity_* fields and domain references stay in place. Only
-- relationships directly evidenced by existing document rows are projected.

CREATE TABLE document_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  document_id UUID NOT NULL,
  entity_type TEXT NOT NULL CHECK(length(entity_type) BETWEEN 1 AND 120),
  entity_id TEXT NOT NULL CHECK(length(entity_id) BETWEEN 1 AND 240),
  relation_type TEXT NOT NULL DEFAULT 'primary' CHECK(length(relation_type) BETWEEN 1 AND 120),
  source TEXT NOT NULL CHECK(source IN('legacy','api','domain','migration')),
  recorded_by UUID NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,id),
  UNIQUE(organization_id,document_id,entity_type,entity_id,relation_type),
  FOREIGN KEY(organization_id,document_id)
    REFERENCES documents(organization_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(organization_id,recorded_by)
    REFERENCES users(organization_id,id) ON DELETE RESTRICT
);
CREATE INDEX document_links_tenant_entity_idx
  ON document_links(organization_id,entity_type,entity_id,recorded_at DESC);
CREATE INDEX document_links_tenant_document_idx
  ON document_links(organization_id,document_id,recorded_at DESC);

-- Deterministic compatibility projection only. This copies an explicit
-- relationship already stored on the document and does not claim a historical
-- event time or infer any missing relationship.
INSERT INTO document_links(
  organization_id,document_id,entity_type,entity_id,relation_type,source,recorded_by
)
SELECT organization_id,id,linked_entity_type,linked_entity_id,'primary','legacy',created_by
  FROM documents
 WHERE linked_entity_type IS NOT NULL
   AND linked_entity_id IS NOT NULL
ON CONFLICT(organization_id,document_id,entity_type,entity_id,relation_type) DO NOTHING;

ALTER TABLE correspondence_records ADD COLUMN canonical_document_id UUID;
ALTER TABLE correspondence_records
  ADD CONSTRAINT correspondence_records_canonical_document_tenant_fk
  FOREIGN KEY(organization_id,canonical_document_id)
  REFERENCES documents(organization_id,id) ON DELETE RESTRICT;
CREATE INDEX correspondence_records_canonical_document_idx
  ON correspondence_records(organization_id,canonical_document_id)
  WHERE canonical_document_id IS NOT NULL;

ALTER TABLE archive_records ADD COLUMN canonical_document_id UUID;
ALTER TABLE archive_records
  ADD CONSTRAINT archive_records_canonical_document_tenant_fk
  FOREIGN KEY(organization_id,canonical_document_id)
  REFERENCES documents(organization_id,id) ON DELETE RESTRICT;
CREATE INDEX archive_records_canonical_document_idx
  ON archive_records(organization_id,canonical_document_id)
  WHERE canonical_document_id IS NOT NULL;

ALTER TABLE attachments ADD COLUMN canonical_document_id UUID;
ALTER TABLE attachments
  ADD CONSTRAINT attachments_canonical_document_tenant_fk
  FOREIGN KEY(organization_id,canonical_document_id)
  REFERENCES documents(organization_id,id) ON DELETE RESTRICT;
CREATE INDEX attachments_canonical_document_idx
  ON attachments(organization_id,canonical_document_id)
  WHERE canonical_document_id IS NOT NULL;

CREATE VIEW document_entity_links_compat AS
SELECT organization_id,document_id,entity_type,entity_id,relation_type,source,recorded_by,recorded_at
  FROM document_links
UNION ALL
SELECT d.organization_id,d.id,d.linked_entity_type,d.linked_entity_id,
       'primary'::text,'legacy'::text,d.created_by,d.created_at
  FROM documents d
 WHERE d.linked_entity_type IS NOT NULL
   AND d.linked_entity_id IS NOT NULL
   AND NOT EXISTS(
     SELECT 1 FROM document_links l
      WHERE l.organization_id=d.organization_id
        AND l.document_id=d.id
        AND l.entity_type=d.linked_entity_type
        AND l.entity_id=d.linked_entity_id
        AND l.relation_type='primary'
   );

CREATE TRIGGER document_links_append_only BEFORE UPDATE OR DELETE ON document_links
  FOR EACH ROW EXECUTE FUNCTION overva_reject_audit_mutation();
CREATE POLICY document_links_tenant_policy ON document_links
  USING(organization_id=overva_current_organization_id())
  WITH CHECK(organization_id=overva_current_organization_id());

COMMENT ON TABLE document_links IS
  'Append-only canonical document-to-domain relationships. Existing document linked_entity fields remain a supported compatibility path.';
COMMENT ON VIEW document_entity_links_compat IS
  'Read compatibility across canonical document_links and legacy linked_entity fields, including old writers after migration.';
COMMENT ON COLUMN correspondence_records.canonical_document_id IS
  'Optional canonical document reference; legacy correspondence metadata remains authoritative and unchanged.';
COMMENT ON COLUMN archive_records.canonical_document_id IS
  'Optional canonical document reference; archive state and retention remain authoritative in archive_records.';

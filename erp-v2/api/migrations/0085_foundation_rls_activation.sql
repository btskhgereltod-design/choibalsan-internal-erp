-- Controlled RLS activation for the audited Phase 1 foundation only.
-- Existing application authorization remains mandatory. Other staged policy
-- tables require separate route/worker/report audits before activation.

-- The compatibility view reads both the new RLS-protected link table and the
-- legacy columns on documents. Filter both branches explicitly so the legacy
-- branch also fails closed without transaction-local tenant context.
CREATE OR REPLACE VIEW document_entity_links_compat
WITH (security_invoker=true) AS
SELECT organization_id,document_id,entity_type,entity_id,relation_type,source,recorded_by,recorded_at
  FROM document_links
 WHERE organization_id=overva_current_organization_id()
UNION ALL
SELECT d.organization_id,d.id,d.linked_entity_type,d.linked_entity_id,
       'primary'::text,'legacy'::text,d.created_by,d.created_at
  FROM documents d
 WHERE d.organization_id=overva_current_organization_id()
   AND d.linked_entity_type IS NOT NULL
   AND d.linked_entity_id IS NOT NULL
   AND NOT EXISTS(
     SELECT 1 FROM document_links l
      WHERE l.organization_id=d.organization_id
        AND l.document_id=d.id
        AND l.entity_type=d.linked_entity_type
        AND l.entity_id=d.linked_entity_id
        AND l.relation_type='primary'
   );

ALTER TABLE workflow_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_transition_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_assignment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_decision_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_comment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_notification_delivery_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_notification_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_links ENABLE ROW LEVEL SECURITY;

COMMENT ON FUNCTION overva_current_organization_id() IS
  'Transaction-local tenant context. Missing app.organization_id returns null so tenant RLS policies fail closed.';

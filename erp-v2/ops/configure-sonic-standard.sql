\set ON_ERROR_STOP on

BEGIN;

WITH sonic AS (
  SELECT id FROM organizations WHERE slug='1980' AND lower(name)='sonic'
)
UPDATE organization_modules
   SET enabled=false,enabled_at=now()
 WHERE organization_id=(SELECT id FROM sonic)
   AND module_code IN ('map','fleet','iot','ai-director','integration-lab','automation');

INSERT INTO audit_logs(organization_id,user_id,action,entity_type,entity_id,detail)
SELECT o.id,u.id,'organization.standard_workspace_applied','organization',o.id::text,
       jsonb_build_object(
         'mode','primary-admin-setup',
         'hiddenSurfaces',jsonb_build_array('map','fleet','iot','ai-director','developer','industry-profile','builder'),
         'disabledModules',jsonb_build_array('map','fleet','iot','ai-director','integration-lab','automation')
       )
  FROM organizations o
  JOIN LATERAL (
    SELECT u.id FROM users u
    JOIN user_roles ur ON ur.organization_id=u.organization_id AND ur.user_id=u.id
    JOIN organization_roles r ON r.organization_id=ur.organization_id AND r.id=ur.role_id
    WHERE u.organization_id=o.id AND r.code='owner' AND u.active=true
    ORDER BY u.created_at LIMIT 1
  ) u ON true
 WHERE o.slug='1980' AND lower(o.name)='sonic';

COMMIT;


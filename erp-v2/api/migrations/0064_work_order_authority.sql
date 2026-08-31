-- Replace legacy users.role authorization in Work Orders with explicit,
-- tenant-scoped permissions. Legacy job roles are used only once to seed the
-- equivalent domain roles so existing users keep their current access.

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('work-orders.read-all','Бүх ажлыг харах','work-orders','Байгууллагын бүх нэгжийн ажлын захиалгыг харах'),
('work-orders.create','Ажил үүсгэх','work-orders','Шинэ ажлын захиалга үүсгэх'),
('work-orders.assign','Ажил хуваарилах','work-orders','Зөвшөөрөгдсөн нэгжийн ажлыг ажилтанд хуваарилах'),
('work-orders.progress','Ажлын гүйцэтгэл шинэчлэх','work-orders','Өөрт хуваарилагдсан ажлын төлөв ба гүйцэтгэлийг шинэчлэх'),
('work-orders.scope.manage','Ажлын хэмжигдэх үр дүн удирдах','work-orders','Ажлын хэмжигдэх үр дүнгийн мөр үүсгэх, шинэчлэх'),
('work-orders.workflow.safety','ХАБЭА шат батлах','work-orders','Ажлын эхлэл ба дуусгалтын ХАБЭА шатыг шийдэх'),
('work-orders.workflow.approve','Удирдлагын шат батлах','work-orders','Ажлын эхлэл, дуусгалтын удирдлагын шатыг шийдэх'),
('work-orders.exception.decide','Үл хамаарах нөхцөл шийдэх','work-orders','Ажлын хэмжилтийн үл хамаарах нөхцөлийг зөвшөөрөх эсвэл буцаах')
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,module_code=EXCLUDED.module_code,description=EXCLUDED.description;

INSERT INTO organization_roles(organization_id,code,name,system)
SELECT o.id,r.code,r.name,true
FROM organizations o CROSS JOIN (VALUES
  ('work-order-manager','Ажлын урсгалын удирдагч'),
  ('work-order-safety-reviewer','Ажлын ХАБЭА баталгаажуулагч'),
  ('work-order-coordinator','Ажлын зохицуулагч')
) AS r(code,name)
ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,active=true;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.permission_code
FROM organization_roles r
JOIN LATERAL (VALUES
  ('work-order-manager','work-orders.read-all'),
  ('work-order-manager','work-orders.create'),
  ('work-order-manager','work-orders.assign'),
  ('work-order-manager','work-orders.progress'),
  ('work-order-manager','work-orders.scope.manage'),
  ('work-order-manager','work-orders.workflow.approve'),
  ('work-order-manager','work-orders.exception.decide'),
  ('work-order-safety-reviewer','work-orders.read-all'),
  ('work-order-safety-reviewer','work-orders.create'),
  ('work-order-safety-reviewer','work-orders.progress'),
  ('work-order-safety-reviewer','work-orders.scope.manage'),
  ('work-order-safety-reviewer','work-orders.workflow.safety'),
  ('work-order-coordinator','work-orders.create'),
  ('work-order-coordinator','work-orders.assign'),
  ('work-order-coordinator','work-orders.progress'),
  ('work-order-coordinator','work-orders.scope.manage')
) p(role_code,permission_code) ON p.role_code=r.code
ON CONFLICT DO NOTHING;

-- Existing tenant owners/administrators already represent explicit system
-- authority. Keep their permission catalog complete, matching provisioning.
INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code
FROM organization_roles r CROSS JOIN permission_catalog p
WHERE r.code IN ('owner','administrator')
ON CONFLICT DO NOTHING;

INSERT INTO user_roles(organization_id,user_id,role_id)
SELECT u.organization_id,u.id,r.id
FROM users u
JOIN organization_roles r ON r.organization_id=u.organization_id
 AND r.code=CASE
   WHEN u.role IN ('director','chief_engineer') THEN 'work-order-manager'
   WHEN u.role='safety' THEN 'work-order-safety-reviewer'
   WHEN u.role IN ('engineer','electric','camera_engineer') THEN 'work-order-coordinator'
 END
WHERE u.active=true AND u.role IN ('director','chief_engineer','safety','engineer','electric','camera_engineer')
ON CONFLICT DO NOTHING;

UPDATE organization_workflow_policies
SET config=config || jsonb_build_object(
  'startSafetyPermission','work-orders.workflow.safety',
  'startApprovalPermission','work-orders.workflow.approve',
  'completionSafetyPermission','work-orders.workflow.safety',
  'completionApprovalPermission','work-orders.workflow.approve'
),updated_at=now()
WHERE domain='work_order';

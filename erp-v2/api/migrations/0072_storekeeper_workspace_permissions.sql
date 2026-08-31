-- Role-facing storekeeper workspace over the universal inventory domain.
INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('inventory.read','Нөөцийн бүртгэл харах','inventory','Агуулах, бараа материал, үлдэгдэл болон хөдөлгөөн харах')
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,module_code=EXCLUDED.module_code,description=EXCLUDED.description;

INSERT INTO organization_roles(organization_id,code,name,system)
SELECT o.id,r.code,r.name,true FROM organizations o CROSS JOIN (VALUES
  ('inventory-custodian','Нярав'),
  ('inventory-observer','Нөөцийн хяналтын хэрэглэгч')
) r(code,name)
ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,active=true;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.permission_code FROM organization_roles r
JOIN LATERAL (VALUES
  ('inventory-custodian','inventory.read'),
  ('inventory-custodian','inventory.manage'),
  ('inventory-observer','inventory.read')
) p(role_code,permission_code) ON p.role_code=r.code
ON CONFLICT DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code FROM organization_roles r CROSS JOIN permission_catalog p
WHERE r.code IN('owner','administrator') ON CONFLICT DO NOTHING;

INSERT INTO user_roles(organization_id,user_id,role_id)
SELECT u.organization_id,u.id,r.id FROM users u JOIN organization_roles r
  ON r.organization_id=u.organization_id
 AND r.code=CASE WHEN u.role='storekeeper' THEN 'inventory-custodian' ELSE 'inventory-observer' END
WHERE u.active=true AND u.role IN('storekeeper','chief_engineer','accountant')
ON CONFLICT DO NOTHING;

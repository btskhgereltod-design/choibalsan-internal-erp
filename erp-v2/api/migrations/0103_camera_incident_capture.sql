-- Camera incident intake reuses the governed operational incident ledger.
-- Camera-specific reference types and roles remain tenant-owned and explicit.

UPDATE permission_catalog SET
  name=CASE code
    WHEN 'operational-incidents.report' THEN 'Үйл ажиллагааны гэмтэл мэдээлэх'
    WHEN 'operational-incidents.correct' THEN 'Үйл ажиллагааны гэмтэл залруулах'
    WHEN 'operational-incidents.cancel' THEN 'Үйл ажиллагааны гэмтэл цуцлах'
  END,
  module_code=NULL,
  description=CASE code
    WHEN 'operational-incidents.report' THEN 'Эрх бүхий ажлын талбараас объектын гэмтлийг batch-аар бүртгэх'
    WHEN 'operational-incidents.correct' THEN 'Үйл ажиллагааны гэмтлийн лавлагаа, хэмжээг шалтгаантай залруулах'
    WHEN 'operational-incidents.cancel' THEN 'Алдаатай гэмтлийн бүртгэлийг шалтгаантай хүчингүй болгох'
  END
WHERE code IN('operational-incidents.report','operational-incidents.correct','operational-incidents.cancel');

INSERT INTO organization_operational_incident_types(
  organization_id,domain,code,name,quantity_unit,sort_order
)
SELECT om.organization_id,'camera',item.code,item.name,item.quantity_unit,item.sort_order
FROM organization_modules om
CROSS JOIN (VALUES
  ('device_unavailable','Камер ажиллахгүй','камер',10),
  ('image_quality','Дүрс муу, тасалдсан','камер',20),
  ('physical_damage','Камерын төхөөрөмж гэмтсэн','камер',30),
  ('power_fault','Тэжээлийн гэмтэл','тохиолдол',40),
  ('network_fault','Сүлжээ, дамжуулалтын гэмтэл','тохиолдол',50),
  ('inspection_finding','Үзлэгийн зөрчил','тохиолдол',60)
) item(code,name,quantity_unit,sort_order)
WHERE om.module_code='camera-operations' AND om.enabled=true
ON CONFLICT(organization_id,domain,code) DO UPDATE SET
  name=EXCLUDED.name,quantity_unit=EXCLUDED.quantity_unit,sort_order=EXCLUDED.sort_order;

INSERT INTO organization_roles(organization_id,code,name,system)
SELECT om.organization_id,role.code,role.name,true
FROM organization_modules om
CROSS JOIN (VALUES
  ('camera-incident-reporter','Камерын гэмтэл мэдээлэгч'),
  ('camera-incident-supervisor','Камерын гэмтлийн хянагч')
) role(code,name)
WHERE om.module_code='camera-operations' AND om.enabled=true
ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,active=true;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT role.organization_id,role.id,grant_row.permission_code
FROM organization_roles role
JOIN LATERAL (VALUES
  ('camera-incident-reporter','operational-incidents.report'),
  ('camera-incident-supervisor','operational-incidents.report'),
  ('camera-incident-supervisor','operational-incidents.correct'),
  ('camera-incident-supervisor','operational-incidents.cancel')
) grant_row(role_code,permission_code) ON grant_row.role_code=role.code
ON CONFLICT DO NOTHING;

-- Compatibility assignment only: runtime authorization checks permissions,
-- never the legacy job label.
INSERT INTO user_roles(organization_id,user_id,role_id)
SELECT user_row.organization_id,user_row.id,role.id
FROM users user_row
JOIN organization_modules om ON om.organization_id=user_row.organization_id
  AND om.module_code='camera-operations' AND om.enabled=true
JOIN organization_roles role ON role.organization_id=user_row.organization_id
  AND role.code=CASE
    WHEN user_row.role IN('director','chief_engineer') THEN 'camera-incident-supervisor'
    WHEN user_row.role='camera_engineer' THEN 'camera-incident-reporter'
  END
WHERE user_row.active=true
  AND user_row.role IN('director','chief_engineer','camera_engineer')
ON CONFLICT DO NOTHING;

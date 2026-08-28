INSERT INTO module_catalog(code,name,description,category,monthly_price,core,active)
VALUES(
  'camera-operations',
  'Камерын үйл ажиллагаа',
  'Камерын объект, гэмтэл, засвар үйлчилгээ болон ажлын урсгалын нэгдсэн талбар.',
  'Үйл ажиллагаа',
  0,
  false,
  true
)
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,
  description=EXCLUDED.description,
  category=EXCLUDED.category,
  active=true;

INSERT INTO organization_modules(organization_id,module_code,enabled)
SELECT id,'camera-operations',true
FROM organizations
WHERE slug='choibalsan-hugjil'
ON CONFLICT(organization_id,module_code) DO UPDATE SET
  enabled=true,
  enabled_at=now();

INSERT INTO organization_work_types(organization_id,code,name,category,description,active)
SELECT o.id,v.code,v.name,'camera',v.description,true
FROM organizations o
CROSS JOIN (VALUES
  ('camera-inspection','Камерын үзлэг','Камер, сүлжээ болон тэжээлийн төлөвийг шалгах ажил.'),
  ('camera-repair','Камерын засвар','Камерын төхөөрөмжийн гэмтлийг оношлох, засварлах ажил.'),
  ('camera-maintenance','Камерын урьдчилан сэргийлэх үйлчилгээ','Камерын системийн төлөвлөгөөт үзлэг, үйлчилгээ.'),
  ('camera-network-repair','Камерын сүлжээний засвар','Камерын дамжуулах сүлжээ, холбоос болон тохиргооны засвар.')
) AS v(code,name,description)
WHERE o.slug='choibalsan-hugjil'
ON CONFLICT(organization_id,code) DO UPDATE SET
  name=EXCLUDED.name,
  category=EXCLUDED.category,
  description=EXCLUDED.description,
  active=true;

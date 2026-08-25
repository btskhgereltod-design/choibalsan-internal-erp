ALTER TABLE organization_skills
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS organization_skills_org_category_name_idx
  ON organization_skills(organization_id, category, name)
  WHERE active = true;

INSERT INTO data_catalog_assets
  (code,name,domain,source_object,description,classification_code,owner_role_code,contains_personal_data,data_kind)
VALUES
  ('organization-skill','Organization skill catalog','people','organization_skills',
   'Tenant-owned skill catalog grouped by a configurable category.','internal','hr-officer',false,'reference')
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,
  domain=EXCLUDED.domain,
  source_object=EXCLUDED.source_object,
  description=EXCLUDED.description,
  classification_code=EXCLUDED.classification_code,
  owner_role_code=EXCLUDED.owner_role_code,
  contains_personal_data=EXCLUDED.contains_personal_data,
  data_kind=EXCLUDED.data_kind,
  active=true,
  updated_at=now();

-- Operational-object master lifecycle. Business records are never hard-deleted:
-- edits are version checked and retirement preserves every relationship/history.

ALTER TABLE operational_objects
  ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK(version > 0);

ALTER TABLE operational_object_events
  DROP CONSTRAINT operational_object_events_event_type_check;
ALTER TABLE operational_object_events
  ADD CONSTRAINT operational_object_events_event_type_check
  CHECK(event_type IN('component_assigned','component_removed','note','updated','retired'));

INSERT INTO permission_catalog(code,name,module_code,description) VALUES
('operational-objects.update','Объектын үндсэн мэдээлэл засах','assets','Ашиглалтын объектын нэр, байршил, шугамын уртыг version болон audit түүхтэй шинэчлэх'),
('operational-objects.retire','Объектыг ашиглалтаас гаргах','assets','Хамааралтай идэвхтэй бүртгэлгүй ашиглалтын объектыг устгахын оронд түүхтэй нь архивлах')
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,module_code=EXCLUDED.module_code,description=EXCLUDED.description;

-- The operational manager may correct master details. Retirement is a more
-- consequential lifecycle decision and remains with tenant administration.
INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,'operational-objects.update'
FROM organization_roles r
WHERE r.code='work-order-manager'
ON CONFLICT DO NOTHING;

INSERT INTO organization_role_permissions(organization_id,role_id,permission_code)
SELECT r.organization_id,r.id,p.code
FROM organization_roles r CROSS JOIN permission_catalog p
WHERE r.code IN ('owner','administrator')
ON CONFLICT DO NOTHING;

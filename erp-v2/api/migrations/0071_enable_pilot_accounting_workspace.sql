-- Enable the reviewed accounting workspace only for the Choibalsan pilot.
INSERT INTO organization_modules(organization_id,module_code,enabled,enabled_at)
SELECT id,'finance',true,now() FROM organizations WHERE slug='choibalsan-hugjil'
ON CONFLICT(organization_id,module_code) DO UPDATE SET enabled=true,enabled_at=now();

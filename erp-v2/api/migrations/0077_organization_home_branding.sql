-- Tenant-owned organization home identity. Assets remain presentation settings;
-- they do not cross tenant data or authorization boundaries.
ALTER TABLE organization_settings
  ADD COLUMN home_banner_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN home_welcome_text TEXT NOT NULL DEFAULT '';

UPDATE organization_settings s
SET logo_url='/organization-assets/choibalsan-hugjil-logo.jpg',
    home_banner_url='/organization-assets/choibalsan-hugjil-banner.png',
    home_welcome_text='Хотын гэрэлтүүлэг, камер, аюулгүй ажиллагаа — нэг дор.',
    updated_at=now()
FROM organizations o
WHERE o.id=s.organization_id AND o.slug='choibalsan-hugjil';

-- Keep a person's job title separate from their OVERVA system responsibility.
-- The internal role codes remain stable for API compatibility.
UPDATE organization_roles SET name='Байгууллагын үндсэн админ' WHERE code='owner';
UPDATE organization_roles SET name='Байгууллагын админ' WHERE code='administrator';


-- Preserve generally useful HR profile details from legacy systems without
-- coupling an employee record to an optional login account.
ALTER TABLE employee_profiles ADD COLUMN spouse_name TEXT;
ALTER TABLE employee_profiles ADD COLUMN children_count INTEGER CHECK (children_count IS NULL OR children_count >= 0);
ALTER TABLE employee_profiles ADD COLUMN children_names TEXT;
ALTER TABLE employee_profiles ADD COLUMN diploma TEXT;
ALTER TABLE employee_profiles ADD COLUMN professional_cert TEXT;
ALTER TABLE employee_profiles ADD COLUMN id_card_no TEXT;
ALTER TABLE employee_profiles ADD COLUMN contract_date DATE;
ALTER TABLE employee_profiles ADD COLUMN contract_notes TEXT;


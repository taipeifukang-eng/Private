-- 藥師主檔新增學歷欄位
ALTER TABLE pharmacist_profiles
ADD COLUMN IF NOT EXISTS education_level TEXT;

COMMENT ON COLUMN pharmacist_profiles.education_level IS '學歷 (博士/碩士/學士)';

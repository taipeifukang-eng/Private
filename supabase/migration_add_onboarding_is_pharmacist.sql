-- 入職異動補充欄位：是否為藥師
-- 供批次輸入異動時保存，並在每月人員狀態初始化自動帶入

ALTER TABLE employee_movement_history
ADD COLUMN IF NOT EXISTS onboarding_is_pharmacist BOOLEAN;

COMMENT ON COLUMN employee_movement_history.onboarding_is_pharmacist IS '僅 onboarding 使用：是否為藥師';

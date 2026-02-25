-- ============================================================
-- 修正 employee_movement_history 的 old_value / new_value 為可 NULL
-- 說明: 某些異動類型（如入職、過試用期）不一定需要 old_value / new_value
-- ============================================================

ALTER TABLE employee_movement_history
ALTER COLUMN old_value DROP NOT NULL;

ALTER TABLE employee_movement_history
ALTER COLUMN new_value DROP NOT NULL;

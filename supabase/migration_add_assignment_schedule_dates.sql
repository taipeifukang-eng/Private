ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS planned_start_date DATE,
  ADD COLUMN IF NOT EXISTS planned_end_date DATE;

COMMENT ON COLUMN assignments.planned_start_date IS '任務預計起始日，可為空';
COMMENT ON COLUMN assignments.planned_end_date IS '任務預計完成日，可為空';
-- ============================================
-- 新增巡店當班人員記錄表 inspection_on_duty_staff
-- 日期: 2026-02-24
-- 說明: 記錄每次巡店時的當班人員，含員編、姓名、職位、是否當班主管
-- ============================================

-- 建立當班人員表
CREATE TABLE IF NOT EXISTS inspection_on_duty_staff (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  inspection_id UUID NOT NULL REFERENCES inspection_masters(id) ON DELETE CASCADE,
  employee_code VARCHAR(20),
  employee_name VARCHAR(100) NOT NULL,
  position VARCHAR(50),
  is_duty_supervisor BOOLEAN DEFAULT false,
  is_manually_added BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_inspection_on_duty_staff_inspection_id 
  ON inspection_on_duty_staff(inspection_id);

-- 欄位說明
COMMENT ON TABLE inspection_on_duty_staff IS '巡店當班人員記錄';
COMMENT ON COLUMN inspection_on_duty_staff.inspection_id IS '對應的巡店主記錄ID';
COMMENT ON COLUMN inspection_on_duty_staff.employee_code IS '員工代號';
COMMENT ON COLUMN inspection_on_duty_staff.employee_name IS '員工姓名';
COMMENT ON COLUMN inspection_on_duty_staff.position IS '職位';
COMMENT ON COLUMN inspection_on_duty_staff.is_duty_supervisor IS '是否為當班主管';
COMMENT ON COLUMN inspection_on_duty_staff.is_manually_added IS '是否手動新增（非從月報表帶入）';

-- RLS 政策
ALTER TABLE inspection_on_duty_staff ENABLE ROW LEVEL SECURITY;

-- 查看：已登入使用者可查看
CREATE POLICY "inspection_on_duty_staff_select" ON inspection_on_duty_staff
  FOR SELECT TO authenticated
  USING (true);

-- 新增：已登入使用者可新增
CREATE POLICY "inspection_on_duty_staff_insert" ON inspection_on_duty_staff
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- 刪除：已登入使用者可刪除（跟隨巡店記錄刪除）
CREATE POLICY "inspection_on_duty_staff_delete" ON inspection_on_duty_staff
  FOR DELETE TO authenticated
  USING (true);

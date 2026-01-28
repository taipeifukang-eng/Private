-- 創建誤餐費記錄表
-- 用於記錄每個門市每月的員工誤餐費

CREATE TABLE IF NOT EXISTS public.meal_allowance_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  year_month TEXT NOT NULL, -- 年月 (YYYY-MM)
  store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  record_date TEXT NOT NULL, -- 記錄日期 (MM/DD)
  employee_code TEXT, -- 員編
  employee_name TEXT NOT NULL, -- 姓名
  work_hours TEXT NOT NULL, -- 上班區間 (HH:MM-HH:MM)
  meal_period TEXT NOT NULL, -- 誤餐時段 (中餐/晚餐/晚晚餐)
  employee_type TEXT NOT NULL, -- 身分 (藥師/非藥師)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 加上索引
CREATE INDEX IF NOT EXISTS idx_meal_allowance_year_month ON public.meal_allowance_records(year_month);
CREATE INDEX IF NOT EXISTS idx_meal_allowance_store_id ON public.meal_allowance_records(store_id);
CREATE INDEX IF NOT EXISTS idx_meal_allowance_year_month_store ON public.meal_allowance_records(year_month, store_id);

-- 加上註解
COMMENT ON TABLE public.meal_allowance_records IS '誤餐費記錄表';
COMMENT ON COLUMN public.meal_allowance_records.year_month IS '年月 (YYYY-MM)';
COMMENT ON COLUMN public.meal_allowance_records.store_id IS '門市ID';
COMMENT ON COLUMN public.meal_allowance_records.record_date IS '記錄日期 (MM/DD)';
COMMENT ON COLUMN public.meal_allowance_records.employee_code IS '員編';
COMMENT ON COLUMN public.meal_allowance_records.employee_name IS '姓名';
COMMENT ON COLUMN public.meal_allowance_records.work_hours IS '上班區間 (HH:MM-HH:MM)';
COMMENT ON COLUMN public.meal_allowance_records.meal_period IS '誤餐時段 (中餐/晚餐/晚晚餐)';
COMMENT ON COLUMN public.meal_allowance_records.employee_type IS '身分 (藥師/非藥師)';

-- 啟用 RLS
ALTER TABLE public.meal_allowance_records ENABLE ROW LEVEL SECURITY;

-- 查看權限：店長可以看自己管理的門市、督導可以看所屬督導區的門市、營業部可以看所有門市、admin可以看所有
CREATE POLICY "Users can view meal allowance records based on role"
  ON public.meal_allowance_records
  FOR SELECT
  USING (
    -- admin 可以看所有
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
    OR
    -- 店長可以看自己管理的門市
    EXISTS (
      SELECT 1 FROM public.store_managers
      WHERE store_managers.store_id = meal_allowance_records.store_id
      AND store_managers.user_id = auth.uid()
      AND store_managers.role_type = 'store_manager'
      AND store_managers.is_primary = true
    )
    OR
    -- 督導可以看所屬督導區的門市
    EXISTS (
      SELECT 1 FROM public.store_managers sm
      INNER JOIN public.stores s ON sm.store_id = s.id
      WHERE s.id = meal_allowance_records.store_id
      AND sm.user_id = auth.uid()
      AND sm.role_type = 'supervisor'
      AND sm.is_primary = true
    )
    OR
    -- 營業部主管或營業部助理可以看所有
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.department = '營業部'
      AND (profiles.role = 'manager' OR (profiles.role = 'manager' AND profiles.job_title = '助理'))
    )
  );

-- 新增權限：店長可以新增自己管理的門市、admin可以新增所有
CREATE POLICY "Users can insert meal allowance records based on role"
  ON public.meal_allowance_records
  FOR INSERT
  WITH CHECK (
    -- admin 可以新增所有
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
    OR
    -- 店長可以新增自己管理的門市
    EXISTS (
      SELECT 1 FROM public.store_managers
      WHERE store_managers.store_id = meal_allowance_records.store_id
      AND store_managers.user_id = auth.uid()
      AND store_managers.role_type = 'store_manager'
      AND store_managers.is_primary = true
    )
  );

-- 更新權限：店長可以更新自己管理的門市、admin可以更新所有
CREATE POLICY "Users can update meal allowance records based on role"
  ON public.meal_allowance_records
  FOR UPDATE
  USING (
    -- admin 可以更新所有
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
    OR
    -- 店長可以更新自己管理的門市
    EXISTS (
      SELECT 1 FROM public.store_managers
      WHERE store_managers.store_id = meal_allowance_records.store_id
      AND store_managers.user_id = auth.uid()
      AND store_managers.role_type = 'store_manager'
      AND store_managers.is_primary = true
    )
  );

-- 刪除權限：店長可以刪除自己管理的門市、admin可以刪除所有
CREATE POLICY "Users can delete meal allowance records based on role"
  ON public.meal_allowance_records
  FOR DELETE
  USING (
    -- admin 可以刪除所有
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
    OR
    -- 店長可以刪除自己管理的門市
    EXISTS (
      SELECT 1 FROM public.store_managers
      WHERE store_managers.store_id = meal_allowance_records.store_id
      AND store_managers.user_id = auth.uid()
      AND store_managers.role_type = 'store_manager'
      AND store_managers.is_primary = true
    )
  );

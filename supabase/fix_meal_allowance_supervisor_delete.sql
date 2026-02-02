-- 修正誤餐費記錄的刪除權限，加入督導權限
-- 執行日期：2026-02-02

-- 1. 先刪除舊的 DELETE policy
DROP POLICY IF EXISTS "Users can delete meal allowance records based on role" ON public.meal_allowance_records;

-- 2. 建立新的 DELETE policy，加入督導權限
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
    OR
    -- 督導也可以刪除自己管理的門市
    EXISTS (
      SELECT 1 FROM public.store_managers
      WHERE store_managers.store_id = meal_allowance_records.store_id
      AND store_managers.user_id = auth.uid()
      AND store_managers.role_type = 'supervisor'
    )
  );

-- 3. 同時更新 UPDATE policy，確保督導也有更新權限
DROP POLICY IF EXISTS "Users can update meal allowance records based on role" ON public.meal_allowance_records;

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
    OR
    -- 督導也可以更新自己管理的門市
    EXISTS (
      SELECT 1 FROM public.store_managers
      WHERE store_managers.store_id = meal_allowance_records.store_id
      AND store_managers.user_id = auth.uid()
      AND store_managers.role_type = 'supervisor'
    )
  );

-- 修正員工刪除的 RLS 策略
-- 允許管理員和店長刪除員工記錄及相關月度狀態

-- 1. 更新 store_employees 的刪除策略
-- 先刪除所有現有策略
DROP POLICY IF EXISTS "Users can view store employees" ON store_employees;
DROP POLICY IF EXISTS "Managers can manage store employees" ON store_employees;
DROP POLICY IF EXISTS "Managers can insert store employees" ON store_employees;
DROP POLICY IF EXISTS "Managers can update store employees" ON store_employees;
DROP POLICY IF EXISTS "Managers can delete store employees" ON store_employees;

-- 重新創建分開的 SELECT, INSERT, UPDATE, DELETE 權限
CREATE POLICY "Users can view store employees" ON store_employees FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = store_employees.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
);

CREATE POLICY "Managers can insert store employees" ON store_employees FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = store_employees.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "Managers can update store employees" ON store_employees FOR UPDATE USING (
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = store_employees.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "Managers can delete store employees" ON store_employees FOR DELETE USING (
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = store_employees.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- 2. 更新 monthly_staff_status 的刪除策略
-- 先刪除所有現有策略
DROP POLICY IF EXISTS "Users can view monthly staff status" ON monthly_staff_status;
DROP POLICY IF EXISTS "Store managers can edit monthly status" ON monthly_staff_status;
DROP POLICY IF EXISTS "Store managers can insert monthly status" ON monthly_staff_status;
DROP POLICY IF EXISTS "Store managers can update monthly status" ON monthly_staff_status;
DROP POLICY IF EXISTS "Store managers can delete monthly status" ON monthly_staff_status;

-- 重新創建分開的操作權限
CREATE POLICY "Users can view monthly staff status" ON monthly_staff_status FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = monthly_staff_status.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
);

CREATE POLICY "Store managers can insert monthly status" ON monthly_staff_status FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = monthly_staff_status.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
);

CREATE POLICY "Store managers can update monthly status" ON monthly_staff_status FOR UPDATE USING (
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = monthly_staff_status.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
);

CREATE POLICY "Store managers can delete monthly status" ON monthly_staff_status FOR DELETE USING (
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = monthly_staff_status.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
);

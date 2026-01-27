-- 修正 RLS 策略：允許營業部人員查看/管理所有門市資料
-- 執行日期: 2026-01-27
-- 
-- 權限說明（使用角色 role 區分）：
-- - 營業部助理（部門=營業X部，角色=member）：可查看所有門市資料、編輯月度狀態和統計資料
-- - 營業部主管（部門=營業X部，角色=manager）：擁有完整管理權限（創建、編輯、刪除門市和員工）

-- =====================================================
-- 1. 更新 monthly_staff_status 查看權限
-- =====================================================
DROP POLICY IF EXISTS "Users can view monthly staff status" ON monthly_staff_status;
CREATE POLICY "Users can view monthly staff status" ON monthly_staff_status FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = monthly_staff_status.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager')) OR
  -- 營業部人員（member 或 manager）可以查看所有門市
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND department LIKE '營業%' AND role IN ('member', 'manager'))
);

-- =====================================================
-- 2. 更新 monthly_staff_status 編輯權限
-- =====================================================
DROP POLICY IF EXISTS "Store managers can edit monthly status" ON monthly_staff_status;
CREATE POLICY "Store managers can edit monthly status" ON monthly_staff_status FOR ALL USING (
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = monthly_staff_status.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager')) OR
  -- 營業部人員（member 或 manager）可以編輯所有門市資料
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND department LIKE '營業%' AND role IN ('member', 'manager'))
);

-- =====================================================
-- 3. 更新 monthly_store_summary 查看權限
-- =====================================================
DROP POLICY IF EXISTS "Users can view monthly store summary" ON monthly_store_summary;
CREATE POLICY "Users can view monthly store summary" ON monthly_store_summary FOR SELECT USING (
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = monthly_store_summary.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager')) OR
  -- 營業部人員可以查看所有門市摘要
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND department LIKE '營業%' AND role IN ('member', 'manager'))
);

-- =====================================================
-- 4. 更新 monthly_store_summary 編輯權限
-- =====================================================
DROP POLICY IF EXISTS "Managers can manage monthly store summary" ON monthly_store_summary;
CREATE POLICY "Managers can manage monthly store summary" ON monthly_store_summary FOR ALL USING (
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = monthly_store_summary.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager')) OR
  -- 營業部人員可以管理所有門市摘要（包含統計資料）
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND department LIKE '營業%' AND role IN ('member', 'manager'))
);

-- =====================================================
-- 5. 更新 store_employees 查看和編輯權限
-- =====================================================
DROP POLICY IF EXISTS "Users can view store employees" ON store_employees;
CREATE POLICY "Users can view store employees" ON store_employees FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = store_employees.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager')) OR
  -- 營業部人員可以查看所有門市員工
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND department LIKE '營業%' AND role IN ('member', 'manager'))
);

-- 營業部主管（manager 角色）可以管理所有門市員工（新增/編輯/刪除）
DROP POLICY IF EXISTS "Managers can manage store employees" ON store_employees;
CREATE POLICY "Managers can manage store employees" ON store_employees FOR ALL USING (
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = store_employees.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') OR
  -- 營業部主管（manager 角色）可以管理所有門市員工
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND department LIKE '營業%' AND role = 'manager')
);

-- =====================================================
-- 6. 更新 stores 表管理權限
-- =====================================================
-- 確保所有人可以查看門市
DROP POLICY IF EXISTS "Anyone can view stores" ON stores;
CREATE POLICY "Anyone can view stores" ON stores FOR SELECT USING (true);

-- 營業部主管（manager 角色）可以管理門市（創建、編輯、停用）
DROP POLICY IF EXISTS "Admins can manage stores" ON stores;
CREATE POLICY "Admins can manage stores" ON stores FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') OR
  -- 營業部主管（manager 角色）可以管理所有門市
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND department LIKE '營業%' AND role = 'manager')
);

-- =====================================================
-- 7. 更新 store_managers 表權限（店長指派）
-- =====================================================
-- 營業部主管（manager 角色）可以指派店長和督導
DROP POLICY IF EXISTS "Admins can manage store managers" ON store_managers;
CREATE POLICY "Admins can manage store managers" ON store_managers FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') OR
  -- 營業部主管（manager 角色）可以管理門市管理者指派
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND department LIKE '營業%' AND role = 'manager')
);

-- =====================================================
-- 驗證查詢（執行後可以測試）
-- =====================================================
-- 測試查詢：檢查特定用戶的權限
-- SELECT 
--   p.full_name,
--   p.department,
--   p.job_title,
--   p.role,
--   CASE 
--     WHEN p.department LIKE '營業%' AND p.role = 'manager' THEN '✓ 營業部主管（manager）：完整管理權限（創建/編輯/刪除）'
--     WHEN p.department LIKE '營業%' AND p.role = 'member' THEN '✓ 營業部助理（member）：可查看和編輯月度資料'
--     WHEN p.role = 'admin' THEN '✓ 管理員：完整權限'
--     ELSE '✗ 一般成員：僅限指派門市'
--   END AS permission_status
-- FROM profiles p
-- WHERE p.email IN ('supervisor@example.com', 'assistant@example.com');  -- 替換為實際 email

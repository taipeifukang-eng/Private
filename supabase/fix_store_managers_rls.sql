-- 修復 store_managers 表的 RLS 政策
-- 日期: 2026-01-25
-- 說明: 為管理員提供完整的增刪改查權限

-- 刪除所有可能存在的舊政策
DROP POLICY IF EXISTS "Admins can manage store managers" ON store_managers;
DROP POLICY IF EXISTS "Admins can insert store managers" ON store_managers;
DROP POLICY IF EXISTS "Admins can update store managers" ON store_managers;
DROP POLICY IF EXISTS "Admins can delete store managers" ON store_managers;

-- 建立新的政策，分別處理 INSERT, UPDATE, DELETE
CREATE POLICY "Admins can insert store managers" ON store_managers FOR INSERT 
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "Admins can update store managers" ON store_managers FOR UPDATE 
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

CREATE POLICY "Admins can delete store managers" ON store_managers FOR DELETE 
USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

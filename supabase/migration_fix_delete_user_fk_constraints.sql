-- ============================================
-- 修復刪除使用者時外鍵約束問題
-- 日期: 2026-02-24
-- 問題: 刪除 profiles 紀錄時，多個表的外鍵約束阻止操作
-- 方案: 所有 submitted_by/confirmed_by/created_by/closed_by/updated_by/inspector_id
--       改為 ON DELETE SET NULL（保留歷史紀錄，僅把引用設為 NULL）
-- ============================================

-- =====================================================
-- 1. monthly_staff_status 表
-- =====================================================
ALTER TABLE monthly_staff_status 
DROP CONSTRAINT IF EXISTS monthly_staff_status_submitted_by_fkey;

ALTER TABLE monthly_staff_status 
ADD CONSTRAINT monthly_staff_status_submitted_by_fkey 
FOREIGN KEY (submitted_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE monthly_staff_status 
DROP CONSTRAINT IF EXISTS monthly_staff_status_confirmed_by_fkey;

ALTER TABLE monthly_staff_status 
ADD CONSTRAINT monthly_staff_status_confirmed_by_fkey 
FOREIGN KEY (confirmed_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- =====================================================
-- 2. monthly_store_summary 表
-- =====================================================
ALTER TABLE monthly_store_summary 
DROP CONSTRAINT IF EXISTS monthly_store_summary_submitted_by_fkey;

ALTER TABLE monthly_store_summary 
ADD CONSTRAINT monthly_store_summary_submitted_by_fkey 
FOREIGN KEY (submitted_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE monthly_store_summary 
DROP CONSTRAINT IF EXISTS monthly_store_summary_confirmed_by_fkey;

ALTER TABLE monthly_store_summary 
ADD CONSTRAINT monthly_store_summary_confirmed_by_fkey 
FOREIGN KEY (confirmed_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- =====================================================
-- 3. inspection_masters 表
-- =====================================================
ALTER TABLE inspection_masters 
DROP CONSTRAINT IF EXISTS inspection_masters_inspector_id_fkey;

ALTER TABLE inspection_masters 
ADD CONSTRAINT inspection_masters_inspector_id_fkey 
FOREIGN KEY (inspector_id) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE inspection_masters 
DROP CONSTRAINT IF EXISTS inspection_masters_closed_by_fkey;

ALTER TABLE inspection_masters 
ADD CONSTRAINT inspection_masters_closed_by_fkey 
FOREIGN KEY (closed_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE inspection_masters 
DROP CONSTRAINT IF EXISTS inspection_masters_created_by_fkey;

ALTER TABLE inspection_masters 
ADD CONSTRAINT inspection_masters_created_by_fkey 
FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- =====================================================
-- 4. inspection_categories 表
-- =====================================================
ALTER TABLE inspection_categories 
DROP CONSTRAINT IF EXISTS inspection_categories_created_by_fkey;

ALTER TABLE inspection_categories 
ADD CONSTRAINT inspection_categories_created_by_fkey 
FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- =====================================================
-- 5. inspection_grade_mapping 表
-- =====================================================
ALTER TABLE inspection_grade_mapping 
DROP CONSTRAINT IF EXISTS inspection_grade_mapping_updated_by_fkey;

ALTER TABLE inspection_grade_mapping 
ADD CONSTRAINT inspection_grade_mapping_updated_by_fkey 
FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- =====================================================
-- 6. employee_promotions 表
-- =====================================================
ALTER TABLE employee_promotions 
DROP CONSTRAINT IF EXISTS employee_promotions_created_by_fkey;

ALTER TABLE employee_promotions 
ADD CONSTRAINT employee_promotions_created_by_fkey 
FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- =====================================================
-- 7. support_staff_bonus 表
-- =====================================================
ALTER TABLE support_staff_bonus 
DROP CONSTRAINT IF EXISTS support_staff_bonus_created_by_fkey;

ALTER TABLE support_staff_bonus 
ADD CONSTRAINT support_staff_bonus_created_by_fkey 
FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- =====================================================
-- 驗證：確認所有約束已更新
-- =====================================================
SELECT 
  tc.table_name,
  kcu.column_name,
  tc.constraint_name,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.referential_constraints rc 
  ON tc.constraint_name = rc.constraint_name
JOIN information_schema.constraint_column_usage ccu 
  ON rc.unique_constraint_name = ccu.constraint_name
WHERE ccu.table_name = 'profiles'
  AND tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name, kcu.column_name;

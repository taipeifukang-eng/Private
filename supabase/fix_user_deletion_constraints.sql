-- ============================================
-- 修復使用者刪除外鍵約束問題
-- ============================================
-- 問題：刪除 profiles 使用者時，因為 monthly_staff_status.submitted_by 外鍵約束而失敗

-- 【檢查 1】找出所有引用 profiles 的外鍵約束
SELECT 
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  tc.constraint_name,
  rc.update_rule,
  rc.delete_rule
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND ccu.table_name = 'profiles'
ORDER BY tc.table_name, kcu.column_name;

-- 【檢查 2】檢查 monthly_staff_status 中有多少記錄引用使用者
SELECT 
  COUNT(*) as total_records,
  COUNT(DISTINCT submitted_by) as unique_submitters,
  COUNT(DISTINCT created_by) as unique_creators,
  '⚠️ 這些記錄會阻止刪除使用者' as warning
FROM monthly_staff_status;

-- ============================================
-- 【方案 A】軟刪除（推薦）
-- ============================================
-- 優點：保留歷史記錄和審計追蹤，不影響現有數據
-- 缺點：需要修改應用程式代碼以過濾已刪除使用者

-- 步驟 1：為 profiles 添加軟刪除欄位
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES profiles(id) NULL,
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE NOT NULL;

-- 步驟 2：創建索引以提升查詢效能
CREATE INDEX IF NOT EXISTS idx_profiles_is_deleted ON profiles(is_deleted) WHERE is_deleted = false;

-- 步驟 3：創建軟刪除函數
CREATE OR REPLACE FUNCTION soft_delete_user(
  user_id_to_delete UUID,
  deleted_by_user_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
  v_employee_code TEXT;
  v_full_name TEXT;
  v_related_records JSON;
BEGIN
  -- 檢查使用者是否存在
  SELECT employee_code, full_name 
  INTO v_employee_code, v_full_name
  FROM profiles 
  WHERE id = user_id_to_delete AND is_deleted = false;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', '使用者不存在或已被刪除'
    );
  END IF;
  
  -- 計算相關記錄數量
  SELECT json_build_object(
    'monthly_staff_status_submitted', (SELECT COUNT(*) FROM monthly_staff_status WHERE submitted_by = user_id_to_delete),
    'monthly_staff_status_created', (SELECT COUNT(*) FROM monthly_staff_status WHERE created_by = user_id_to_delete),
    'store_managers', (SELECT COUNT(*) FROM store_managers WHERE user_id = user_id_to_delete),
    'user_roles', (SELECT COUNT(*) FROM user_roles WHERE user_id = user_id_to_delete)
  ) INTO v_related_records;
  
  -- 執行軟刪除
  UPDATE profiles 
  SET 
    is_deleted = true,
    deleted_at = NOW(),
    deleted_by = deleted_by_user_id
  WHERE id = user_id_to_delete;
  
  -- 停用相關的角色指派
  UPDATE user_roles 
  SET is_active = false
  WHERE user_id = user_id_to_delete;
  
  -- 停用門市管理指派
  UPDATE store_managers 
  SET is_primary = false
  WHERE user_id = user_id_to_delete;
  
  RETURN json_build_object(
    'success', true,
    'deleted_user', json_build_object(
      'id', user_id_to_delete,
      'employee_code', v_employee_code,
      'full_name', v_full_name
    ),
    'related_records', v_related_records,
    'message', '使用者已軟刪除，相關角色和門市指派已停用'
  );
END;
$$;

-- 步驟 4：創建還原軟刪除函數
CREATE OR REPLACE FUNCTION restore_deleted_user(user_id_to_restore UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
BEGIN
  UPDATE profiles 
  SET 
    is_deleted = false,
    deleted_at = NULL,
    deleted_by = NULL
  WHERE id = user_id_to_restore AND is_deleted = true;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'error', '使用者不存在或未被刪除'
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'message', '使用者已還原，請手動重新指派角色和門市'
  );
END;
$$;

-- 步驟 5：修改 RLS 政策以排除已刪除使用者
DROP POLICY IF EXISTS "Users can view active profiles" ON profiles;
CREATE POLICY "Users can view active profiles"
ON profiles FOR SELECT
USING (is_deleted = false);

-- ============================================
-- 【方案 B】修改外鍵為 SET NULL（不推薦）
-- ============================================
-- 警告：這會導致無法追蹤誰提交了每月人員狀態
-- 只有在不需要審計追蹤時才使用

/*
-- 刪除舊的外鍵約束
ALTER TABLE monthly_staff_status 
DROP CONSTRAINT IF EXISTS monthly_staff_status_submitted_by_fkey;

-- 添加新的外鍵約束（ON DELETE SET NULL）
ALTER TABLE monthly_staff_status 
ADD CONSTRAINT monthly_staff_status_submitted_by_fkey 
FOREIGN KEY (submitted_by) 
REFERENCES profiles(id) 
ON DELETE SET NULL;

-- 對 created_by 也做同樣處理
ALTER TABLE monthly_staff_status 
DROP CONSTRAINT IF EXISTS monthly_staff_status_created_by_fkey;

ALTER TABLE monthly_staff_status 
ADD CONSTRAINT monthly_staff_status_created_by_fkey 
FOREIGN KEY (created_by) 
REFERENCES profiles(id) 
ON DELETE SET NULL;
*/

-- ============================================
-- 【方案 C】批次處理相關記錄後刪除（最不推薦）
-- ============================================
-- 警告：會刪除所有歷史記錄！僅用於測試環境

/*
-- 創建硬刪除函數（會刪除所有相關記錄）
CREATE OR REPLACE FUNCTION hard_delete_user(user_id_to_delete UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_records JSON;
BEGIN
  -- 刪除相關記錄
  WITH deleted_data AS (
    SELECT 
      (SELECT COUNT(*) FROM monthly_staff_status WHERE submitted_by = user_id_to_delete OR created_by = user_id_to_delete) as monthly_status_count,
      (SELECT COUNT(*) FROM store_managers WHERE user_id = user_id_to_delete) as store_manager_count,
      (SELECT COUNT(*) FROM user_roles WHERE user_id = user_id_to_delete) as role_count
  )
  SELECT row_to_json(deleted_data.*) INTO v_deleted_records FROM deleted_data;
  
  -- 刪除 monthly_staff_status 記錄
  DELETE FROM monthly_staff_status 
  WHERE submitted_by = user_id_to_delete OR created_by = user_id_to_delete;
  
  -- 刪除 store_managers 記錄
  DELETE FROM store_managers WHERE user_id = user_id_to_delete;
  
  -- 刪除 user_roles 記錄
  DELETE FROM user_roles WHERE user_id = user_id_to_delete;
  
  -- 最後刪除使用者
  DELETE FROM profiles WHERE id = user_id_to_delete;
  
  RETURN json_build_object(
    'success', true,
    'deleted_records', v_deleted_records,
    'message', '⚠️ 使用者和所有相關記錄已永久刪除'
  );
END;
$$;
*/

-- ============================================
-- 【測試】軟刪除功能
-- ============================================

-- 測試 1：查看系統中有哪些使用者可以刪除
SELECT 
  id,
  employee_code,
  full_name,
  email,
  role,
  department,
  is_deleted,
  (SELECT COUNT(*) FROM monthly_staff_status WHERE submitted_by = p.id) as submitted_records,
  (SELECT COUNT(*) FROM store_managers WHERE user_id = p.id) as managed_stores,
  (SELECT COUNT(*) FROM user_roles WHERE user_id = p.id) as roles_count
FROM profiles p
WHERE is_deleted = false
ORDER BY employee_code;

-- 測試 2：軟刪除一個使用者（請替換 UUID）
/*
SELECT soft_delete_user(
  '使用者的UUID'::UUID,
  '執行刪除者的UUID'::UUID  -- 可選，記錄誰執行了刪除
);
*/

-- 測試 3：查看已刪除的使用者
SELECT 
  id,
  employee_code,
  full_name,
  deleted_at,
  (SELECT full_name FROM profiles WHERE id = p.deleted_by) as deleted_by_name
FROM profiles p
WHERE is_deleted = true
ORDER BY deleted_at DESC;

-- 測試 4：還原已刪除的使用者（請替換 UUID）
/*
SELECT restore_deleted_user('使用者的UUID'::UUID);
*/

-- ============================================
-- 【驗證】檢查軟刪除是否正常運作
-- ============================================
DO $$
BEGIN
  RAISE NOTICE '================================================';
  RAISE NOTICE '✅ 軟刪除方案已準備完成！';
  RAISE NOTICE '';
  RAISE NOTICE '使用方式：';
  RAISE NOTICE '1. 執行上方的【方案 A】所有步驟';
  RAISE NOTICE '2. 前端調用: SELECT soft_delete_user(''user_id''::UUID)';
  RAISE NOTICE '3. 使用者會被標記為已刪除，但數據保留';
  RAISE NOTICE '4. 如需還原: SELECT restore_deleted_user(''user_id''::UUID)';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️ 重要提示：';
  RAISE NOTICE '- 軟刪除後使用者無法登入';
  RAISE NOTICE '- 相關角色和門市指派會被停用';
  RAISE NOTICE '- 歷史記錄（如每月人員狀態提交者）完整保留';
  RAISE NOTICE '- 前端需要過濾 is_deleted = false 的使用者';
  RAISE NOTICE '';
  RAISE NOTICE '如果堅持要硬刪除，請使用【方案 B】或【方案 C】';
  RAISE NOTICE '但會失去審計追蹤能力！';
  RAISE NOTICE '================================================';
END $$;

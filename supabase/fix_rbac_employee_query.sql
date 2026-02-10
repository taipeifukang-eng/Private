-- ============================================================
-- 修正 RBAC 員工查詢函數 - 支援從 profiles 表查詢員編
-- 說明: 修正角色指派無法找到使用者管理頁面設定的員工編號問題
-- 執行日期: 2026-02-10
-- 問題: 原本的函數只查詢 store_employees 表，但員編可能存在於 profiles 表
-- 解決: 
--   1. 確保 profiles 表有 employee_code 欄位
--   2. 合併查詢兩個表，優先使用 profiles 表的資料
-- ============================================================

-- 0. 確保 profiles 表有 employee_code 欄位
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS employee_code VARCHAR(20);

-- 為 employee_code 欄位添加索引以提升搜尋效能
CREATE INDEX IF NOT EXISTS idx_profiles_employee_code ON profiles(employee_code);

-- 添加註解說明
COMMENT ON COLUMN profiles.employee_code IS '員工編號（例如: FK0171, FKPT0171）';

-- 1. 更新 get_all_employees_for_rbac 函數
-- 用於查詢所有員工，供 RBAC 角色指派使用
CREATE OR REPLACE FUNCTION get_all_employees_for_rbac()
RETURNS TABLE (
  user_id UUID,
  employee_code VARCHAR,
  employee_name VARCHAR,
  email TEXT
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  -- 檢查調用者是否有 role.user_role.assign 權限
  -- 這裡暫時信任應用層的權限檢查，因為函數本身無法直接查詢 RBAC 權限
  -- 應用層必須在調用前驗證權限
  
  RETURN QUERY
  -- 合併查詢：優先使用 profiles 表的員編，其次使用 store_employees 表
  WITH combined_employees AS (
    -- 從 profiles 表取得有員編的使用者
    SELECT 
      p.id as user_id,
      p.employee_code::VARCHAR as employee_code,
      p.full_name::VARCHAR as employee_name,
      p.email::TEXT as email
    FROM profiles p
    WHERE p.employee_code IS NOT NULL
      AND p.id IS NOT NULL
    
    UNION
    
    -- 從 store_employees 表取得有員編的使用者（如果 profiles 沒有）
    SELECT 
      se.user_id,
      se.employee_code::VARCHAR,
      se.employee_name::VARCHAR,
      p.email::TEXT
    FROM store_employees se
    LEFT JOIN profiles p ON p.id = se.user_id
    WHERE se.user_id IS NOT NULL
      AND se.employee_code IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM profiles p2 
        WHERE p2.id = se.user_id 
        AND p2.employee_code IS NOT NULL
      )
  )
  SELECT DISTINCT ON (ce.user_id)
    ce.user_id,
    ce.employee_code,
    ce.employee_name,
    ce.email
  FROM combined_employees ce
  ORDER BY ce.user_id, ce.employee_code;
END;
$$;

-- 2. 更新 get_employees_by_codes 函數
-- 用於依員工編號批次查詢員工資料
CREATE OR REPLACE FUNCTION get_employees_by_codes(
  codes VARCHAR[]
)
RETURNS TABLE (
  user_id UUID,
  employee_code VARCHAR,
  employee_name VARCHAR
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  -- 合併查詢：優先使用 profiles 表的員編，其次使用 store_employees 表
  WITH combined_employees AS (
    -- 從 profiles 表取得有員編的使用者
    SELECT 
      p.id as user_id,
      p.employee_code::VARCHAR as employee_code,
      p.full_name::VARCHAR as employee_name
    FROM profiles p
    WHERE p.employee_code = ANY(codes)
      AND p.id IS NOT NULL
    
    UNION
    
    -- 從 store_employees 表取得有員編的使用者（如果 profiles 沒有）
    SELECT 
      se.user_id,
      se.employee_code::VARCHAR,
      se.employee_name::VARCHAR
    FROM store_employees se
    WHERE se.employee_code = ANY(codes)
      AND se.user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM profiles p2 
        WHERE p2.id = se.user_id 
        AND p2.employee_code = ANY(codes)
      )
  )
  SELECT DISTINCT ON (ce.user_id)
    ce.user_id,
    ce.employee_code,
    ce.employee_name
  FROM combined_employees ce
  ORDER BY ce.user_id, ce.employee_code;
END;
$$;

-- 3. 更新函數說明
COMMENT ON FUNCTION get_all_employees_for_rbac() IS '查詢所有員工資料（供 RBAC 系統使用，已去重，優先從 profiles 表查詢）';
COMMENT ON FUNCTION get_employees_by_codes(VARCHAR[]) IS '依員工編號批次查詢員工資料（供 RBAC 系統使用，優先從 profiles 表查詢）';

-- 4. 測試查詢
-- 查詢 FK0436 員工
SELECT * FROM get_employees_by_codes(ARRAY['FK0436']);

-- 查詢所有員工（前 10 筆）
SELECT * FROM get_all_employees_for_rbac() LIMIT 10;

-- 驗證：檢查 profiles 表中有員編的使用者
SELECT 
  id,
  email,
  full_name,
  employee_code,
  department,
  job_title
FROM profiles 
WHERE employee_code IS NOT NULL
ORDER BY employee_code;

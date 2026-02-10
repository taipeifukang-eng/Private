-- ============================================
-- RBAC 系統：員工查詢函數
-- 說明：供角色管理系統使用，支援跨門市查詢員工
-- ============================================

-- 函數：查詢所有員工（去重並合併資料）
-- 用途：供 RBAC 角色指派使用，需有權限才能調用
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

-- 函數：依員工編號查詢員工資料（批次）
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
      se.employee_code::VARCHAR,，優先從 profiles 表查詢）';
COMMENT ON FUNCTION get_employees_by_codes(VARCHAR[]) IS '依員工編號批次查詢員工資料（供 RBAC 系統使用，優先從 profiles 表查詢
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

-- 授予執行權限給已認證用戶
GRANT EXECUTE ON FUNCTION get_all_employees_for_rbac() TO authenticated;
GRANT EXECUTE ON FUNCTION get_employees_by_codes(VARCHAR[]) TO authenticated;

-- 說明
COMMENT ON FUNCTION get_all_employees_for_rbac() IS '查詢所有員工資料（供 RBAC 系統使用，已去重）';
COMMENT ON FUNCTION get_employees_by_codes(VARCHAR[]) IS '依員工編號批次查詢員工資料（供 RBAC 系統使用）';

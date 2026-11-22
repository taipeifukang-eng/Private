-- M3 A.4 步驟 B：補授權。
-- 【重要】請只單獨執行本檔，本檔以 BEGIN; 開頭，不會自動提交：
--   執行完看過回傳筆數，再另外執行 COMMIT;（確認）或 ROLLBACK;（放棄）。忘了的話連線結束會自動回滾。
--   請先看過步驟 A 的預覽。
BEGIN;
-- 備份表：記錄本次新增的授權列，步驟 C（rollback）依此刪除。
CREATE TABLE IF NOT EXISTS public.m3_task_view_archived_grants (
  role_permission_id text PRIMARY KEY,
  role_id uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);
-- 備份表只供步驟 C 使用：開啟 RLS 並收回 anon／authenticated 權限（service_role 與 SQL editor 的 postgres 不受影響），避免被 PostgREST 讀寫或竄改。
ALTER TABLE public.m3_task_view_archived_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m3_task_view_archived_grants FROM anon, authenticated;
WITH perm AS (
  SELECT id FROM permissions WHERE code = 'task.view_archived' AND is_active LIMIT 1
), has_perm AS (
  SELECT DISTINCT ur.user_id
  FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.is_allowed
  JOIN permissions p ON p.id = rp.permission_id AND p.is_active AND p.code = 'task.view_archived'
  WHERE ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
), lacking AS (
  SELECT pr.id FROM profiles pr WHERE pr.role = 'manager' AND NOT EXISTS (SELECT 1 FROM has_perm h WHERE h.user_id = pr.id)
), pure_roles AS (
  SELECT r.id AS role_id
  FROM roles r
  JOIN user_roles ur ON ur.role_id = r.id AND ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
  LEFT JOIN profiles pr ON pr.id = ur.user_id
  GROUP BY r.id
  HAVING count(DISTINCT ur.user_id) FILTER (WHERE ur.user_id IN (SELECT id FROM lacking)) > 0
     AND count(*) FILTER (WHERE coalesce(pr.role,'') NOT IN ('manager','admin')) = 0
), ins AS (
  INSERT INTO role_permissions (role_id, permission_id, is_allowed)
  SELECT pure_roles.role_id, perm.id, true
  FROM pure_roles CROSS JOIN perm
  WHERE NOT EXISTS (
    SELECT 1 FROM role_permissions x WHERE x.role_id = pure_roles.role_id AND x.permission_id = perm.id
  )
  RETURNING id, role_id
)
INSERT INTO public.m3_task_view_archived_grants (role_permission_id, role_id)
SELECT id::text, role_id FROM ins;
-- 本次新增的授權（筆數與角色）：
SELECT g.role_id, r.code, r.name FROM public.m3_task_view_archived_grants g JOIN roles r ON r.id = g.role_id ORDER BY r.code;
-- 檢查完畢後，另外執行 COMMIT; 或 ROLLBACK;

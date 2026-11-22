-- M3 F1 補授權 task.manage：步驟 B（寫入，不自動提交）。
-- 【重要】請只單獨執行本檔，本檔以 BEGIN; 開頭：執行完看過回傳，再另外執行 COMMIT;（確認）或 ROLLBACK;（放棄）。忘了的話連線結束會自動回滾。
-- 作法：只建立一個專用角色 task_proxy_manager（授權 task.manage 與 task.view_own），再把名單上的人加進去；
--   不改現有角色的權限，所以不會連帶讓同角色的其他人也拿到任務管理權。
-- 請先看過步驟 A，並在下方 target 清單填入與步驟 A 相同的名單。
BEGIN;
-- 備份表：記錄本次新增的角色、授權與人員指派，步驟 C（rollback）只依此刪除。
CREATE TABLE IF NOT EXISTS public.m3_task_manage_grants (
  kind text NOT NULL,            -- 'role' | 'role_permission' | 'user_role'
  row_id uuid NOT NULL,
  user_id uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, row_id)
);
-- 備份表只供步驟 C 使用：開啟 RLS 並收回 anon／authenticated 權限（service_role 與 SQL editor 的 postgres 不受影響），避免被 PostgREST 讀寫或竄改。
ALTER TABLE public.m3_task_manage_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m3_task_manage_grants FROM anon, authenticated;
-- 1) 專用角色（已存在則沿用，不覆蓋）
WITH new_role AS (
  INSERT INTO roles (name, code, description, is_system, is_active)
  VALUES ('任務管理（可代勾他人任務）', 'task_proxy_manager', 'M3 F1：讓營業主管可開啟他人任務並代為勾選；只含 task.manage、task.view_own', false, true)
  ON CONFLICT (code) DO NOTHING
  RETURNING id
)
INSERT INTO public.m3_task_manage_grants (kind, row_id) SELECT 'role', id FROM new_role;
-- 2) 角色授權 task.manage 與 task.view_own（新版 taskDetail 先檢查 task.view_own，缺了仍會 403）
WITH r AS (SELECT id FROM roles WHERE code = 'task_proxy_manager'),
     p AS (SELECT id FROM permissions WHERE code IN ('task.manage','task.view_own') AND is_active),
     ins AS (
       INSERT INTO role_permissions (role_id, permission_id, is_allowed)
       SELECT r.id, p.id, true FROM r, p
       ON CONFLICT (role_id, permission_id) DO NOTHING
       RETURNING id
     )
INSERT INTO public.m3_task_manage_grants (kind, row_id) SELECT 'role_permission', id FROM ins;
-- 3) 名單上的人（profiles.role 必須是 manager，且目前缺 task.manage 或 task.view_own 其中之一）加入角色
WITH target(ident) AS (
  VALUES
    -- ('A001'),
    -- ('00000000-0000-0000-0000-000000000000'),
    ('__填入員工編號或_user_id__')
), has_both AS (
  SELECT ur.user_id
  FROM user_roles ur
  JOIN role_permissions rp ON rp.role_id = ur.role_id AND rp.is_allowed
  JOIN permissions p ON p.id = rp.permission_id AND p.is_active AND p.code IN ('task.manage','task.view_own')
  WHERE ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
  GROUP BY ur.user_id
  HAVING count(DISTINCT p.code) = 2
), who AS (
  SELECT DISTINCT pr.id
  FROM target t JOIN profiles pr ON pr.employee_code = t.ident OR pr.id::text = t.ident
  WHERE pr.role = 'manager' AND pr.id NOT IN (SELECT user_id FROM has_both)
), ins AS (
  INSERT INTO user_roles (user_id, role_id, is_active)
  SELECT who.id, (SELECT id FROM roles WHERE code = 'task_proxy_manager'), true FROM who
  ON CONFLICT (user_id, role_id) DO NOTHING
  RETURNING id, user_id
)
INSERT INTO public.m3_task_manage_grants (kind, row_id, user_id) SELECT 'user_role', id, user_id FROM ins;
-- 本次新增（請核對筆數與人員）：
SELECT g.kind, g.user_id, pr.employee_code, pr.full_name
FROM public.m3_task_manage_grants g LEFT JOIN profiles pr ON pr.id = g.user_id
ORDER BY g.kind, pr.employee_code;
-- 若某人先前已有這個專用角色但被停用／過期，上面不會改動它（ON CONFLICT DO NOTHING），請另行處理。
-- 檢查完畢後，另外執行 COMMIT; 或 ROLLBACK;

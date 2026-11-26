-- M9 95 角色權限授權（只開不關，可重複執行）
-- 來源：新權限勾選頁（survey/m9-permissions，送出時間 2026-11-24T14:17:43.674Z）
-- 授權配對數：33
-- 只新增或把「被關閉的列」打開，不關任何授權；已經持有的配對不動。授權前的狀態記進 m9_role_grant_log，供 rollback 使用。
-- 角色或權限碼在正式區找不到的配對會被略過（不報錯），最後一個查詢會列出每一組的結果，請看有沒有「找不到」。
BEGIN;
CREATE TABLE IF NOT EXISTS public.m9_role_grant_log (
  role_code       text        NOT NULL,
  permission_code text        NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_code, permission_code)
);
-- prev_denied：true 代表授權前該列已存在但是被關閉（授權列被關閉），rollback 要改回關閉；false 代表原本沒有這一列，rollback 要刪掉。
ALTER TABLE public.m9_role_grant_log ADD COLUMN IF NOT EXISTS prev_denied boolean NOT NULL DEFAULT false;
ALTER TABLE public.m9_role_grant_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m9_role_grant_log FROM PUBLIC, anon, authenticated;

CREATE TEMP TABLE m9_wanted (role_code text, permission_code text) ON COMMIT DROP;
INSERT INTO m9_wanted (role_code, permission_code) VALUES
    ('admin', 'cross_dept.maintenance.update'),
    ('admin', 'employee.store_transfer.confirm'),
    ('admin', 'general_affairs.maintenance_request.view_own_store'),
    ('admin', 'general_affairs.purchase_order.approve'),
    ('admin', 'general_affairs.purchase_payment.manage'),
    ('admin', 'general_affairs.purchase_payment.view'),
    ('admin', 'general_affairs.request.view_own_store'),
    ('admin', 'general_affairs.service_center.access'),
    ('admin', 'general_affairs.work_order.view_own_store'),
    ('admin', 'inventory.result_analysis.delete'),
    ('admin', 'inventory.result_analysis.import'),
    ('admin', 'inventory.result_analysis.view_own'),
    ('admin', 'supervisor.management_log.create'),
    ('admin', 'supervisor.management_log.follow_up'),
    ('admin', 'supervisor.management_log.manage'),
    ('admin', 'supervisor.management_log.update_own'),
    ('admin', 'supervisor.management_log.view_own'),
    ('admin', 'supervisor.management_log.view_team'),
    ('business_supervisor', 'inventory.result_analysis.import'),
    ('business_supervisor', 'inventory.result_analysis.view_own'),
    ('business_supervisor', 'task.manage'),
    ('general_affairs', 'task.view_archived'),
    ('inventory_team', 'inventory.result_analysis.delete'),
    ('inventory_team', 'inventory.result_analysis.import'),
    ('merchandise_assistant', 'task.view_archived'),
    ('store_manager_role', 'inventory.result_analysis.view_own'),
    ('supervisor_role', 'employee.store_transfer.confirm'),
    ('supervisor_role', 'inventory.result_analysis.view_own'),
    ('supervisor_role', 'supervisor.management_log.create'),
    ('supervisor_role', 'supervisor.management_log.follow_up'),
    ('supervisor_role', 'supervisor.management_log.update_own'),
    ('supervisor_role', 'supervisor.management_log.view_own'),
    ('supervisor_role', 'supervisor.management_log.view_team');

-- 需要處理的配對：還沒有授權列，或有授權列但被關閉
CREATE TEMP TABLE m9_todo ON COMMIT DROP AS
SELECT r.id AS role_id, p.id AS permission_id, w.role_code, w.permission_code,
       (rp.role_id IS NOT NULL) AS prev_denied
FROM m9_wanted w
JOIN public.roles r ON r.code = w.role_code
JOIN public.permissions p ON p.code = w.permission_code
LEFT JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.permission_id = p.id
WHERE rp.role_id IS NULL OR rp.is_allowed IS NOT TRUE;

INSERT INTO public.m9_role_grant_log (role_code, permission_code, prev_denied)
SELECT role_code, permission_code, prev_denied FROM m9_todo
ON CONFLICT (role_code, permission_code) DO NOTHING;

UPDATE public.role_permissions rp SET is_allowed = true
FROM m9_todo t
WHERE t.prev_denied AND rp.role_id = t.role_id AND rp.permission_id = t.permission_id;

INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT role_id, permission_id, true FROM m9_todo WHERE NOT prev_denied;

COMMIT;

-- 結果：每一組的狀態（ok = 目前確實持有；找不到 = 正式區沒有這個角色或權限碼，沒有授權，要先建立該碼）
SELECT v.role_code AS role, v.permission_code AS code,
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.code = v.role_code) THEN '找不到角色'
    WHEN NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.code = v.permission_code) THEN '找不到權限碼'
    WHEN EXISTS (
      SELECT 1 FROM public.roles r
      JOIN public.permissions p ON p.code = v.permission_code
      JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.permission_id = p.id
      WHERE r.code = v.role_code AND rp.is_allowed
    ) THEN 'ok'
    ELSE '未持有'
  END AS status
FROM (
  VALUES
    ('admin', 'cross_dept.maintenance.update'),
    ('admin', 'employee.store_transfer.confirm'),
    ('admin', 'general_affairs.maintenance_request.view_own_store'),
    ('admin', 'general_affairs.purchase_order.approve'),
    ('admin', 'general_affairs.purchase_payment.manage'),
    ('admin', 'general_affairs.purchase_payment.view'),
    ('admin', 'general_affairs.request.view_own_store'),
    ('admin', 'general_affairs.service_center.access'),
    ('admin', 'general_affairs.work_order.view_own_store'),
    ('admin', 'inventory.result_analysis.delete'),
    ('admin', 'inventory.result_analysis.import'),
    ('admin', 'inventory.result_analysis.view_own'),
    ('admin', 'supervisor.management_log.create'),
    ('admin', 'supervisor.management_log.follow_up'),
    ('admin', 'supervisor.management_log.manage'),
    ('admin', 'supervisor.management_log.update_own'),
    ('admin', 'supervisor.management_log.view_own'),
    ('admin', 'supervisor.management_log.view_team'),
    ('business_supervisor', 'inventory.result_analysis.import'),
    ('business_supervisor', 'inventory.result_analysis.view_own'),
    ('business_supervisor', 'task.manage'),
    ('general_affairs', 'task.view_archived'),
    ('inventory_team', 'inventory.result_analysis.delete'),
    ('inventory_team', 'inventory.result_analysis.import'),
    ('merchandise_assistant', 'task.view_archived'),
    ('store_manager_role', 'inventory.result_analysis.view_own'),
    ('supervisor_role', 'employee.store_transfer.confirm'),
    ('supervisor_role', 'inventory.result_analysis.view_own'),
    ('supervisor_role', 'supervisor.management_log.create'),
    ('supervisor_role', 'supervisor.management_log.follow_up'),
    ('supervisor_role', 'supervisor.management_log.update_own'),
    ('supervisor_role', 'supervisor.management_log.view_own'),
    ('supervisor_role', 'supervisor.management_log.view_team')
) AS v(role_code, permission_code)
ORDER BY v.role_code, v.permission_code;

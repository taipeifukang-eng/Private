-- M9 正式區 06：補建「新版程式用到、但正式區 permissions 表沒有、總表也沒有其他步驟會建」的 11 個權限碼。
-- 只 INSERT permissions，不授權給任何角色（授權由權限勾選頁決定）。可重複執行：已存在的碼不動（NOT EXISTS ＋ ON CONFLICT (code) DO NOTHING）。
-- module／feature／action／description 照 DEV permissions 表的值（2026-11-24 唯讀查詢）。
-- 來源：2026-11-24 正式區角色盤點（prod-role-inventory）比對新版程式碼用到的權限碼：
--   inventory.result_analysis.delete                        盤點刪除（舊版 supabase/migration_inventory_result_analysis_delete_permission.sql 建，正式區沒有）
--   supervisor.management_log.* 6 碼＋management_category.manage  督導管理日誌（舊版 20260812093000_supervisor_management_log_foundation.sql 建，正式區沒有）
--   activity.support_request.edit、monthly.allowance.view_support_hours、store.clinic_selfpay.mapping.manage（舊版 20260724 production_*_compatibility 建，正式區沒有）
-- 注意：督導管理日誌的 7 個權限碼在舊版是跟 supervisor_management_* 資料表一起建的；若正式區連資料表也沒有，
--   總表「督導日誌軟刪除」那一步（m6 20261122130000）的前置檢查會中止；上線前請確認正式區有 supervisor_management_cases 等資料表。
-- 不影響資料、不動任何函式。還原：06_missing_permission_codes.rollback.sql；檢查：06_missing_permission_codes.verify.sql。
DO $$
BEGIN
  IF to_regclass('public.permissions') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: permissions';
  END IF;
END $$;

INSERT INTO public.permissions (module, feature, code, action, description, is_active)
SELECT v.module, v.feature, v.code, v.action, v.description, true
FROM (VALUES
  ('activity', 'support_request', 'activity.support_request.edit', 'edit', '編輯支援需求'),
  ('inventory', 'result_analysis', 'inventory.result_analysis.delete', 'delete', '刪除盤點結果'),
  ('monthly', 'allowance', 'monthly.allowance.view_support_hours', 'view_support_hours', '查看支援時數'),
  ('store', 'clinic_selfpay', 'store.clinic_selfpay.mapping.manage', 'manage', '管理自費價差對照'),
  ('supervisor', 'management_category', 'supervisor.management_category.manage', 'manage', '管理督導管理日誌分類'),
  ('supervisor', 'management_log', 'supervisor.management_log.create', 'create', '建立督導管理日誌案件與管理紀錄'),
  ('supervisor', 'management_log', 'supervisor.management_log.follow_up', 'follow_up', '建立督導管理日誌追蹤紀錄'),
  ('supervisor', 'management_log', 'supervisor.management_log.manage', 'manage', '管理全部督導管理日誌與分類設定'),
  ('supervisor', 'management_log', 'supervisor.management_log.update_own', 'update_own', '編輯自己建立且未結案的督導管理日誌'),
  ('supervisor', 'management_log', 'supervisor.management_log.view_own', 'view_own', '查看自己建立或指派給自己的督導管理日誌'),
  ('supervisor', 'management_log', 'supervisor.management_log.view_team', 'view_team', '查看自己管理門市範圍內的督導管理日誌')
) AS v(module, feature, code, action, description)
WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.code = v.code)
ON CONFLICT (code) DO NOTHING;

-- 核對：應列出 11 列，授權角色數（granted_roles）此刻為 0
SELECT p.code, p.is_active,
       (SELECT count(*) FROM public.role_permissions rp WHERE rp.permission_id = p.id) AS granted_roles
FROM public.permissions p
WHERE p.code IN (
  'activity.support_request.edit',
  'inventory.result_analysis.delete',
  'monthly.allowance.view_support_hours',
  'store.clinic_selfpay.mapping.manage',
  'supervisor.management_category.manage',
  'supervisor.management_log.create',
  'supervisor.management_log.follow_up',
  'supervisor.management_log.manage',
  'supervisor.management_log.update_own',
  'supervisor.management_log.view_own',
  'supervisor.management_log.view_team'
)
ORDER BY p.code;

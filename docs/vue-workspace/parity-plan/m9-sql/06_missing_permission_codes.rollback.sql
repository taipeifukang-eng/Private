-- 還原 06：只刪「本檔建立的」權限碼，而且只在沒有任何 role_permissions 參照時才刪。
-- 判斷「本檔建立」：code 相同且 description 與 06 主檔寫入的字串完全相同（正式區原本就有、description 不同的碼不會被刪）。
-- 已被授權給任何角色的碼一律保留（要連授權一起移除，請先由權限勾選頁／人工處理，再重跑本檔）。可重複執行。
DELETE FROM public.permissions p
USING (VALUES
  ('activity.support_request.edit', '編輯支援需求'),
  ('inventory.result_analysis.delete', '刪除盤點結果'),
  ('monthly.allowance.view_support_hours', '查看支援時數'),
  ('store.clinic_selfpay.mapping.manage', '管理自費價差對照'),
  ('supervisor.management_category.manage', '管理督導管理日誌分類'),
  ('supervisor.management_log.create', '建立督導管理日誌案件與管理紀錄'),
  ('supervisor.management_log.follow_up', '建立督導管理日誌追蹤紀錄'),
  ('supervisor.management_log.manage', '管理全部督導管理日誌與分類設定'),
  ('supervisor.management_log.update_own', '編輯自己建立且未結案的督導管理日誌'),
  ('supervisor.management_log.view_own', '查看自己建立或指派給自己的督導管理日誌'),
  ('supervisor.management_log.view_team', '查看自己管理門市範圍內的督導管理日誌')
) AS v(code, description)
WHERE p.code = v.code
  AND p.description = v.description
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.permission_id = p.id);

-- 核對：仍留著的碼（有授權參照，或 description 不是本檔寫的）
SELECT p.code,
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

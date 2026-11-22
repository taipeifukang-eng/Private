-- M5 W19 Q1：只讀。列出「活動新增／修改／刪除／儲存排程」新舊結果不同的帳號。不改任何資料；請在正式區 SQL editor 由使用者自行執行。
-- 對應 m5-spec.md Q1（只看角色權限）。上線前用這份名單核對，確認「新版突然能改」的人是否合理。
--
-- 舊版（app/api/campaigns 的 POST/PUT/DELETE）要同時過兩關：
--   (L1) profiles.role 必須是 'admin' 或 'manager'，否則回 403「權限不足」；
--   (L2) 資料庫 RLS（p1h_campaigns_write）要求 has_permission：activity.manage 或 activity.campaign.edit，沒有就失敗（500）。
--   舊版 has_permission 在資料庫端「不檢查 roles.is_active、沒有 admin 放行」，所以 admin 身分但沒被授予權限碼的人，舊版也寫不進去。
-- 新版（app/api/workspace/campaigns）只看：
--   (N1) 持有 activity.campaign.edit 或 activity.manage（同樣不檢查 roles.is_active）；或
--   (N2) 管理員後備：profiles.role = 'admin'，或持有管理員類角色（admin、system_admin、full_admin、full_admin_role、dev_full_admin、owner、owner_role、admin_role）。
--
-- 結果欄位 diff_kind：
--   'NEW_ONLY 新版可寫、舊版不可'：例如有活動編輯權的營業助理（舊式身分是一般成員），或只靠管理員後備的人；上線後這些人會突然能改排程、刪活動。
--   'LEGACY_ONLY 舊版可寫、新版不可'：理論上不存在（舊版要有權限碼才寫得進去，而新版有權限碼就放行）；若出現請先回報。
-- 處理方式：確認「新版可寫」名單；不該有權限的人，請移除其角色的 activity.campaign.edit／activity.manage，或調整其管理員類角色。
WITH valid_roles AS (
  SELECT ur.user_id, ur.role_id
  FROM user_roles ur
  WHERE ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
), write_perm AS (
  SELECT DISTINCT vr.user_id
  FROM valid_roles vr
  JOIN role_permissions rp ON rp.role_id = vr.role_id AND rp.is_allowed
  JOIN permissions p ON p.id = rp.permission_id AND p.is_active
  WHERE p.code IN ('activity.campaign.edit', 'activity.manage')
), admin_like AS (
  SELECT pr.id AS user_id FROM profiles pr WHERE pr.role = 'admin'
  UNION
  SELECT vr.user_id
  FROM valid_roles vr
  JOIN roles r ON r.id = vr.role_id
  WHERE r.code IN ('admin','system_admin','full_admin','full_admin_role','dev_full_admin','owner','owner_role','admin_role')
), eval AS (
  SELECT pr.id AS user_id, pr.employee_code, pr.full_name, pr.email, pr.role AS profile_role,
         (pr.role IN ('admin', 'manager') AND pr.id IN (SELECT user_id FROM write_perm)) AS legacy_can_write,
         (pr.id IN (SELECT user_id FROM write_perm) OR pr.id IN (SELECT user_id FROM admin_like)) AS native_can_write,
         (pr.id IN (SELECT user_id FROM write_perm)) AS has_write_permission,
         (pr.id IN (SELECT user_id FROM admin_like)) AS is_admin_like
  FROM profiles pr
)
SELECT CASE WHEN native_can_write AND NOT legacy_can_write THEN 'NEW_ONLY 新版可寫、舊版不可'
            ELSE 'LEGACY_ONLY 舊版可寫、新版不可' END AS diff_kind,
       employee_code, full_name, email, profile_role, has_write_permission, is_admin_like,
       (SELECT string_agg(r.code, ', ' ORDER BY r.code)
          FROM valid_roles vr JOIN roles r ON r.id = vr.role_id WHERE vr.user_id = e.user_id) AS current_roles,
       user_id
FROM eval e
WHERE native_can_write IS DISTINCT FROM legacy_can_write
ORDER BY diff_kind, employee_code NULLS LAST, email;

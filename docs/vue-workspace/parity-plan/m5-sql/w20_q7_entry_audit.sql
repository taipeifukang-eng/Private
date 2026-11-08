-- M5 W20：只讀。列出「活動檢視入口」新舊都看不到的人，以及入口與資料範圍的現況。不改任何資料；請在正式區 SQL editor 由使用者自行執行。
-- 對應 m5-spec.md「只靠部門身分、沒有『查看全部』也沒有門市任命的人看不到活動檢視入口：這是舊版已定規則、無新舊差異」——上線前列出這些人，由你決定誰要補授權。
--
-- 入口規則（lib/campaign-access.ts canEnterCampaignView；新舊版相同）：
--   (1) 有 activity.campaign.view_all：可進入（看全部，含未發布草稿）；或
--   (2) 有 activity.campaign.view_own（第一階段含舊的 activity.campaign.view），且「在 store_managers 至少有一筆任命」或「部門為營業部-盤點組」。
-- 權限判定照正式區 has_permission：user_roles.is_active 且未過期、role_permissions.is_allowed、permissions.is_active，不檢查 roles.is_active，資料庫端沒有 admin 放行。
--
-- 結果欄位 entry_state：
--   'CAN_ENTER'                      可進入活動檢視
--   'NO_ENTRY 有檢視權但沒有任命也不是盤點組'  ← 需要你決定：補門市任命，或確認他們本來就不需要看
--   'NO_PERMISSION 沒有活動檢視權限'    不在名單內的一般同仁（本檢查預設不列，改 WHERE 的註解即可列出）
-- 只列有「活動檢視權限」的人，避免整間公司都出現在名單裡。
WITH valid_roles AS (
  SELECT ur.user_id, ur.role_id
  FROM user_roles ur
  WHERE ur.is_active AND (ur.expires_at IS NULL OR ur.expires_at > now())
), perms AS (
  SELECT vr.user_id, p.code
  FROM valid_roles vr
  JOIN role_permissions rp ON rp.role_id = vr.role_id AND rp.is_allowed
  JOIN permissions p ON p.id = rp.permission_id AND p.is_active
  WHERE p.code IN ('activity.campaign.view_all', 'activity.campaign.view_own', 'activity.campaign.view')
), eval AS (
  SELECT pr.id AS user_id, pr.employee_code, pr.full_name, pr.email, pr.department, pr.job_title,
         EXISTS (SELECT 1 FROM perms x WHERE x.user_id = pr.id AND x.code = 'activity.campaign.view_all') AS view_all,
         EXISTS (SELECT 1 FROM perms x WHERE x.user_id = pr.id AND x.code IN ('activity.campaign.view_own', 'activity.campaign.view')) AS view_own,
         EXISTS (SELECT 1 FROM store_managers sm WHERE sm.user_id = pr.id) AS has_appointment,
         EXISTS (SELECT 1 FROM store_managers sm WHERE sm.user_id = pr.id AND sm.role_type = 'supervisor') AS is_supervisor,
         EXISTS (SELECT 1 FROM store_managers sm WHERE sm.user_id = pr.id AND sm.role_type = 'store_manager') AS is_store_manager,
         (pr.department = '營業部-盤點組') AS is_inventory_team
  FROM profiles pr
)
SELECT CASE WHEN view_all OR (view_own AND (has_appointment OR is_inventory_team)) THEN 'CAN_ENTER'
            WHEN view_own THEN 'NO_ENTRY 有檢視權但沒有任命也不是盤點組'
            ELSE 'NO_PERMISSION 沒有活動檢視權限' END AS entry_state,
       employee_code, full_name, email, department, job_title,
       view_all, view_own, is_supervisor, is_store_manager, is_inventory_team, has_appointment,
       (SELECT string_agg(r.code, ', ' ORDER BY r.code)
          FROM valid_roles vr JOIN roles r ON r.id = vr.role_id WHERE vr.user_id = e.user_id) AS current_roles,
       user_id
FROM eval e
WHERE view_all OR view_own          -- 要連沒有權限的人一起看，把這行整個註解掉
ORDER BY entry_state, department NULLS LAST, employee_code NULLS LAST, email;

-- ============================================================================
-- pharm_onboard_C_rollback.sql  （還原 pharm_onboard_B_apply.sql 已 COMMIT 的結果）
-- 前提：B 已 COMMIT，備份表 pharm_onboard_bak_store_employees / pharm_onboard_bak_snapshot_inserted 仍在。
-- 只有 BEGIN，沒有 COMMIT：看完最後的核對結果再自己 COMMIT（或 ROLLBACK 放棄還原）。
-- 還原內容：
--   1. 主檔 is_pharmacist / updated_at 還原成備份時的值
--   2. 刪除 B 新增的快照列（只刪備份表內記錄的 id，且 notes 仍是補登註記）
-- 備份表不會自動刪除；確認不再需要時再手動 DROP TABLE。
-- ============================================================================
BEGIN;

UPDATE store_employees se
SET is_pharmacist = b.is_pharmacist, updated_at = b.updated_at
FROM pharm_onboard_bak_store_employees b
WHERE se.id = b.id;

DELETE FROM pharmacist_monthly_snapshot ps
USING pharm_onboard_bak_snapshot_inserted b
WHERE ps.id = b.id
  AND ps.notes LIKE 'backfilled: onboarding not synced%';

-- 核對：主檔應回到備份值；補登列應為 0
SELECT se.employee_code, se.employee_name, b.is_pharmacist AS backup_value, se.is_pharmacist AS current_value
FROM pharm_onboard_bak_store_employees b JOIN store_employees se ON se.id = b.id
ORDER BY se.employee_code;

SELECT count(*) AS backfilled_rows_remaining_should_be_0
FROM pharmacist_monthly_snapshot ps JOIN pharm_onboard_bak_snapshot_inserted b ON b.id = ps.id;

-- 看完核對結果後，請自己決定：  COMMIT;  或  ROLLBACK;

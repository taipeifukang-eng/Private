-- M5 W19 Q2（選用）還原：依 m5_w19_campaign_backup 把活動的啟用旗標改回備份當時的值。以 BEGIN 開頭，不會自動提交。
BEGIN;
UPDATE campaigns c SET is_active = b.was_active
FROM (SELECT DISTINCT ON (campaign_id) campaign_id, was_active
      FROM m5_w19_campaign_backup ORDER BY campaign_id, backed_up_at) b
WHERE c.id = b.campaign_id;
SELECT count(DISTINCT campaign_id) AS restored FROM m5_w19_campaign_backup;
-- 確認無誤後另外執行 COMMIT; 有疑慮就執行 ROLLBACK;

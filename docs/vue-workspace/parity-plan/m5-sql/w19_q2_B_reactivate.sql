-- M5 W19 Q2（選用）：把指定的停用活動改回啟用。需要寫入：以 BEGIN 開頭，不會自動提交；先備份、再改、核對後由使用者另外執行 COMMIT 或 ROLLBACK。
-- 先執行 w19_q2_inactive_campaigns.sql 確認要改回啟用的活動，把 id 填進下面暫存表 m5_w19_targets（三處都用同一張表，只需要改這一個地方）。
BEGIN;

CREATE TABLE IF NOT EXISTS m5_w19_campaign_backup (
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  campaign_id uuid NOT NULL,
  was_active boolean,
  PRIMARY KEY (campaign_id, backed_up_at)
);
ALTER TABLE m5_w19_campaign_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON m5_w19_campaign_backup FROM anon, authenticated;

CREATE TEMP TABLE m5_w19_targets (id uuid PRIMARY KEY) ON COMMIT DROP;
-- 把要改回啟用的活動 id 一行一個填在這裡（取消註解並替換）：
-- INSERT INTO m5_w19_targets (id) VALUES ('00000000-0000-0000-0000-000000000000');

-- 1) 預覽：將被改動的活動
SELECT c.id, c.name, c.is_active FROM campaigns c WHERE c.id IN (SELECT id FROM m5_w19_targets);

-- 2) 備份
INSERT INTO m5_w19_campaign_backup (campaign_id, was_active)
SELECT c.id, c.is_active FROM campaigns c WHERE c.id IN (SELECT id FROM m5_w19_targets);

-- 3) 改回啟用
UPDATE campaigns SET is_active = true
WHERE id IN (SELECT id FROM m5_w19_targets) AND is_active IS DISTINCT FROM true;

-- 4) 核對：目標筆數、已備份筆數、目前仍停用的目標筆數（應為 0）
SELECT (SELECT count(*) FROM m5_w19_targets) AS targets,
       (SELECT count(*) FROM m5_w19_campaign_backup WHERE campaign_id IN (SELECT id FROM m5_w19_targets) AND backed_up_at >= now() - interval '10 minutes') AS backed_up,
       (SELECT count(*) FROM campaigns WHERE id IN (SELECT id FROM m5_w19_targets) AND is_active IS DISTINCT FROM true) AS still_inactive;

-- 確認無誤後另外執行 COMMIT; 有疑慮就執行 ROLLBACK;

-- M5 W19 Q2：只讀。查正式區有沒有被設成「停用」的活動。不改任何資料；請在正式區 SQL editor 由使用者自行執行。
-- 背景：舊版畫面沒有停用開關，新增活動一律啟用，理論上全部都是啟用。新版上線後，停用的活動會對督導、店長、活動檢視、門市端隱藏，
-- 所以要先確認有沒有被誤設停用的活動（有的話，上線當天它們就會從店長端消失）。
-- 欄位：published_to_* 表示目前發布給誰；schedule_count 是已排程門市數；is_future_or_current 表示今天（台灣）以後還沒結束。
-- 處理方式：看名單決定哪些要改回啟用（可用 w19_q2_B_reactivate.sql，含備份與還原），其餘維持停用。
SELECT c.id, c.name, c.campaign_type, c.start_date, c.end_date,
       c.is_active,
       c.published_to_supervisors, c.published_to_store_managers, c.published_to_inventory_team,
       (c.end_date >= (now() AT TIME ZONE 'Asia/Taipei')::date) AS is_future_or_current,
       (SELECT count(*) FROM campaign_schedules s WHERE s.campaign_id = c.id) AS schedule_count,
       c.updated_at
FROM campaigns c
WHERE c.is_active IS DISTINCT FROM true
ORDER BY is_future_or_current DESC, c.start_date DESC;

-- 總覽：停用與啟用各幾筆
SELECT is_active, count(*) AS campaigns FROM campaigns GROUP BY is_active ORDER BY is_active;

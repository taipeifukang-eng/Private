-- M5 W19 Q4：只讀。列出正式區「排程日期落在活動期間外」的既有資料（舊版改期後不檢查、留下的隱形排程）。不改任何資料。
-- 新版上線後，排程頁會在月曆上方顯示這些門市並提供「移回尚未安排」；這份名單讓你上線前先看有多少。
SELECT c.id AS campaign_id, c.name, c.start_date, c.end_date,
       st.store_code, st.store_name, s.activity_date
FROM campaign_schedules s
JOIN campaigns c ON c.id = s.campaign_id
LEFT JOIN stores st ON st.id = s.store_id
WHERE s.activity_date < c.start_date OR s.activity_date > c.end_date
ORDER BY c.start_date DESC, c.name, s.activity_date;

-- 同一份資料依活動彙總
SELECT c.id AS campaign_id, c.name, count(*) AS stores_outside_range
FROM campaign_schedules s
JOIN campaigns c ON c.id = s.campaign_id
WHERE s.activity_date < c.start_date OR s.activity_date > c.end_date
GROUP BY c.id, c.name
ORDER BY stores_outside_range DESC;

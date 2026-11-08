-- M5 W19 Q5：只讀。列出已排在「禁止排程」特殊日期、或門市設定禁止的星期上的既有排程（舊版手動排程不檢查）。不改任何資料。
-- 新版之後手動排到這些日子會先跳提醒；既有的不會被動到，這份名單只是讓你知道現況。
-- 星期：1=週一 … 7=週日（與門市活動設定一致）。
SELECT c.name AS campaign, st.store_code, st.store_name, s.activity_date,
       EXTRACT(ISODOW FROM s.activity_date)::int AS weekday,
       (e.id IS NOT NULL) AS on_blocked_event,
       e.description AS event_description,
       (a.forbidden_days IS NOT NULL AND EXTRACT(ISODOW FROM s.activity_date)::int = ANY (a.forbidden_days)) AS on_forbidden_weekday,
       (a.allowed_days IS NOT NULL AND cardinality(a.allowed_days) > 0
          AND NOT (EXTRACT(ISODOW FROM s.activity_date)::int = ANY (a.allowed_days))) AS outside_allowed_weekday
FROM campaign_schedules s
JOIN campaigns c ON c.id = s.campaign_id
LEFT JOIN stores st ON st.id = s.store_id
LEFT JOIN event_dates e ON e.event_date = s.activity_date AND e.is_blocked
LEFT JOIN store_activity_settings a ON a.store_id = s.store_id
WHERE e.id IS NOT NULL
   OR (a.forbidden_days IS NOT NULL AND EXTRACT(ISODOW FROM s.activity_date)::int = ANY (a.forbidden_days))
   OR (a.allowed_days IS NOT NULL AND cardinality(a.allowed_days) > 0
       AND NOT (EXTRACT(ISODOW FROM s.activity_date)::int = ANY (a.allowed_days)))
ORDER BY c.start_date DESC, c.name, s.activity_date;

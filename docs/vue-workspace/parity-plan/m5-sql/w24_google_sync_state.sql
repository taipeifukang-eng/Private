-- M5 W24 Q19、Q20：只讀。Google 同步目前的連線與待同步狀況。不改任何資料，也不讀取授權金鑰（refresh_token_ciphertext 不查）。
-- 請在正式區 SQL editor 由使用者自行執行。

-- 1) 連線狀態（全公司只有一列，id = 1）
SELECT calendar_id, google_account_email, connected_at, last_sync_at, last_sync_status, last_sync_error
FROM organization_calendar_google_connections;

-- 2) 同步連結：成功、有錯誤待重試各幾筆（對應畫面「N 筆待同步」的舊算法；新算法還會把缺連結的算進去）
SELECT source_type,
       count(*) AS links,
       count(*) FILTER (WHERE last_error IS NOT NULL) AS with_error,
       max(last_synced_at) AS last_synced_at
FROM organization_calendar_google_event_links
GROUP BY source_type;

-- 3) 有效的公司行事裡，還沒有同步連結的（授權失效、或連結前就存在的行事）：新版「待同步」筆數會算進去
SELECT e.id, e.title, e.start_date, e.created_at
FROM organization_calendar_events e
WHERE e.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM organization_calendar_google_event_links l WHERE l.source_key = 'company:' || e.id::text)
ORDER BY e.start_date;

-- 4) 已發布假日裡，還沒有同步連結的日期筆數
SELECT count(*) AS holidays_without_link
FROM organization_calendar_holidays h
JOIN organization_calendar_holiday_imports i ON i.id = h.import_id AND i.status = 'published'
WHERE NOT EXISTS (SELECT 1 FROM organization_calendar_google_event_links l WHERE l.source_key = 'holiday:' || h.holiday_date::text);

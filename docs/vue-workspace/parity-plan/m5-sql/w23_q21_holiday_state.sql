-- M5 W23 Q21：只讀。政府假日各年度目前的發布狀態與歷史版本。不改任何資料；請在正式區 SQL editor 由使用者自行執行。
-- 新版再次匯入同一年度時，會拿「已發布版本」跟新資料比較並要求二次確認；這份名單讓你先看現況（哪些年度已發布、被取代過幾次）。

-- 1) 每個年度目前已發布的版本與筆數
SELECT i.calendar_year, i.source_name, i.source_revision, i.imported_at, i.status,
       (SELECT count(*) FROM organization_calendar_holidays h WHERE h.import_id = i.id) AS holidays
FROM organization_calendar_holiday_imports i
WHERE i.status = 'published'
ORDER BY i.calendar_year;

-- 2) 各年度被取代的版本數（取代過越多次，越常有人重新匯入）
SELECT calendar_year,
       count(*) FILTER (WHERE status = 'superseded') AS superseded_versions,
       count(*) FILTER (WHERE status = 'published') AS published_versions,
       count(*) FILTER (WHERE status = 'draft') AS draft_leftovers
FROM organization_calendar_holiday_imports
GROUP BY calendar_year
ORDER BY calendar_year;

-- M5 W23：只讀。確認正式區年度行事曆的資料表、函式與讀取規則的狀態。不改任何資料；請在正式區 SQL editor 由使用者自行執行。
-- DEV 原本沒有這兩份 migration（20261008100000、20261010120000），是這次補套用的；正式區舊頁依賴它們，理論上已套用，這裡確認。

-- 1) 八張資料表是否都在（應該 8 列）
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND (table_name LIKE 'organization\_calendar\_%' OR table_name LIKE 'organization\_personal\_calendar\_%')
ORDER BY table_name;

-- 2) 個人行程的讀取規則與判斷函式的波動性（provolatile：s = STABLE）。
--    DEV 實測：讀取規則只呼叫 STABLE 函式 organization_calendar_personal_event_can_view(id) 時，
--    新增個人行程後的回讀（INSERT ... RETURNING）看不到剛插入的列，新增會失敗並回「new row violates row-level security policy」。
--    如果這裡的 qual 只有函式、沒有 owner_id = auth.uid()，正式區的「新增個人行程」可能同樣存不進去（請先確認是否真的有人回報過）。
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'organization_personal_calendar_events'
ORDER BY policyname;
SELECT proname, provolatile, prosecdef
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'organization\_calendar\_personal\_event%';

-- 3) 正式區是否已有個人行程資料（有資料代表新增曾經成功過，代表正式區規則可能與 DEV 不同）
SELECT count(*) AS personal_events, min(created_at) AS first_created, max(created_at) AS last_created
FROM organization_personal_calendar_events;

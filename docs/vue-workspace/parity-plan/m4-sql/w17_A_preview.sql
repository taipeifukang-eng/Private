-- M4 W17 步驟 A：只讀預覽（不改任何資料）。請在正式區 SQL editor 逐段貼上執行。
-- 目的：上線「改善回補改按台灣日期算（Q17）、逾期一律可補報但回補 0（Q19）」前，看目前函式內容與受影響的資料量。

-- 1) 目前的改善回補函式與觸發器：確認是 improved_at::date（UTC 日期）版本，且沒有逾期保護。
SELECT proname,
       prosrc LIKE '%Asia/Taipei%' AS already_taipei,
       prosrc LIKE '%deadline%' AS has_deadline_guard,
       left(pg_get_functiondef(p.oid), 500) AS head
FROM pg_proc p WHERE proname = 'calculate_improvement_bonus';
SELECT tgrelid::regclass AS table_name, tgname, pg_get_triggerdef(t.oid) AS def
FROM pg_trigger t
WHERE NOT tgisinternal AND tgrelid = 'public.inspection_improvements'::regclass
ORDER BY 1, 2;

-- 2) 啟用中的回補規則（依 sort_order）；deadline 是巡店日加最大 day_to。
SELECT sort_order, day_from, day_to, bonus_score AS percent, is_active, description
FROM public.inspection_bonus_config ORDER BY sort_order;

-- 3) 歷史資料：已改善的項目中，「UTC 日期算的天數」與「台灣日期算的天數」不同的筆數（只在台灣 0 到 8 點回報才會不同）。
--    這些歷史紀錄不會被改動（步驟 B 只換函式，不重算既有資料），這裡只是讓你知道過去有多少筆當時少算一天。
SELECT count(*) AS improved_total,
       count(*) FILTER (WHERE (i.improved_at::date - m.inspection_date)
                           IS DISTINCT FROM ((i.improved_at AT TIME ZONE 'Asia/Taipei')::date - m.inspection_date)) AS days_differ_utc_vs_taipei
FROM public.inspection_improvements i
JOIN public.inspection_masters m ON m.id = i.inspection_id
WHERE i.status = 'improved';

-- 4) 狀態分佈：pending、improved、被補跑程式標成 overdue 的數量；以及 pending 但已過期限（新版顯示成「已逾期」，仍可補報）的數量。
SELECT status, count(*) AS items FROM public.inspection_improvements GROUP BY status ORDER BY status;
SELECT count(*) AS pending_past_deadline_taipei
FROM public.inspection_improvements
WHERE status = 'pending' AND deadline < (now() AT TIME ZONE 'Asia/Taipei')::date;

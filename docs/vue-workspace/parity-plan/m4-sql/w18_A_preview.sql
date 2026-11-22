-- M4 W18 步驟 A：只讀預覽（不改任何資料）。請在正式區 SQL editor 逐段貼上執行。
-- 目的：上線「評級門檻 snapshot」前，確認正式區目前的評級對照、加分重算函式、已完成巡店數、
--       以及 Q7（回補規則重疊）與範本區塊排序（1 到 5）有沒有需要先處理的資料。

-- 1) 目前評級對照表，與舊版寫死值對照（diff 欄位為 true 表示與舊版寫死值不同）。
SELECT g.grade, g.min_score,
       d.min_score AS legacy_hardcoded,
       g.min_score IS DISTINCT FROM d.min_score AS differs
FROM public.inspection_grade_mapping g
FULL JOIN (VALUES (10,220),(9,215),(8,191),(7,181),(6,171),(5,161),(4,151),(3,141),(2,131),(1,121),(0,0)) d(grade,min_score) ON d.grade = g.grade
ORDER BY coalesce(g.grade, d.grade) DESC;

-- 2) 目前的改善加分重算函式內容：確認是寫死門檻（含 215、191）版本，以及觸發器掛在哪些表。
SELECT proname, prosrc LIKE '%215%' AS hardcoded_215, left(pg_get_functiondef(p.oid), 400) AS head
FROM pg_proc p WHERE proname IN ('update_inspection_bonus_total', 'calculate_improvement_bonus');
SELECT tgrelid::regclass AS table_name, tgname, pg_get_triggerdef(t.oid) AS def
FROM pg_trigger t
WHERE NOT tgisinternal AND tgrelid IN ('public.inspection_masters'::regclass, 'public.inspection_improvements'::regclass)
ORDER BY 1, 2;

-- 3) 巡店單狀態分佈；步驟 B 會替已完成與已結案的單補 snapshot（用目前對照表）。
SELECT status, count(*) AS masters FROM public.inspection_masters GROUP BY status ORDER BY status;

-- 4) 已完成單的目前評級，與「用目前對照表重算」是否一致（不一致的單，補 snapshot 後評級不會被改動，只是 snapshot 與當時實際不同，請先看是否為 0 筆）。
SELECT count(*) FILTER (WHERE m.grade IS DISTINCT FROM (
         SELECT g.grade::text FROM public.inspection_grade_mapping g WHERE g.min_score <= m.total_score ORDER BY g.grade DESC LIMIT 1)) AS grade_differs_from_current_mapping,
       count(*) AS completed_or_closed
FROM public.inspection_masters m WHERE m.status IN ('completed', 'closed');

-- 5) Q7：啟用中的回補規則是否已有天數重疊（有的話要先修正，否則新版會擋住其他規則的儲存）。
SELECT a.id AS rule_a, a.day_from AS a_from, a.day_to AS a_to, b.id AS rule_b, b.day_from AS b_from, b.day_to AS b_to
FROM public.inspection_bonus_config a
JOIN public.inspection_bonus_config b ON a.id < b.id AND a.is_active AND b.is_active AND a.day_from <= b.day_to AND a.day_to >= b.day_from;

-- 6) 範本區塊排序（新版限制 1 到 5）：列出超過 5 的區塊。
SELECT section, section_name, section_order, count(*) AS items
FROM public.inspection_templates WHERE section_order > 5 OR section_order < 1 GROUP BY 1, 2, 3 ORDER BY 3;

-- 7) Q8：啟用項目滿分總和（不等於 220 時，設定頁會出現警告；評分仍固定從 220 起算）。
SELECT sum(max_score) AS active_max_score_total, count(*) AS active_items FROM public.inspection_templates WHERE is_active;

-- 8) Q6：目前等待改善的項目數（日後回補規則變動會影響這些項目的回補比例）。
SELECT count(*) AS pending_improvements FROM public.inspection_improvements WHERE status = 'pending';

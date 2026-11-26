-- 55_improvements_bonus 唯讀驗證（只有 SELECT，不改任何資料；套用前、後、還原後皆可執行）
-- 每列 ok = true 代表符合「已套用本檔」的預期；套用前執行時 ok = false 是正常的（代表尚未套用）。
-- info_ 開頭的列只是資訊（ok 固定 true），不判斷對錯。
WITH fn AS (
  SELECT p.proname, p.prosrc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  WHERE p.pronargs = 0
), trg AS (
  SELECT t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) AS def
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  WHERE NOT t.tgisinternal
)
SELECT '01 calculate_improvement_bonus 台灣時區與逾期保護' AS check_name,
       COALESCE((SELECT prosrc LIKE '%Asia/Taipei%' AND prosrc LIKE '%v_report_date > NEW.deadline%' FROM fn WHERE proname = 'calculate_improvement_bonus'), false) AS ok,
       NULL::text AS detail
UNION ALL
SELECT '02 update_inspection_bonus_total 先鎖單且基礎分為 NUMERIC',
       COALESCE((SELECT prosrc LIKE '%FOR UPDATE%' AND prosrc LIKE '%v_base_score NUMERIC%' FROM fn WHERE proname = 'update_inspection_bonus_total'), false), NULL
UNION ALL
SELECT '03 另外 3 個函式存在且 search_path=public',
       (SELECT count(*) = 3 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
         WHERE p.pronargs = 0 AND p.proname IN ('generate_inspection_improvements','generate_improvement_from_result','cleanup_improvements_on_result_delete')
           AND p.proconfig::text LIKE '%search_path=public%'),
       NULL
UNION ALL
SELECT '04 全部 5 個函式皆為 SECURITY DEFINER',
       (SELECT count(*) = 5 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
         WHERE p.pronargs = 0 AND p.prosecdef
           AND p.proname IN ('calculate_improvement_bonus','cleanup_improvements_on_result_delete','generate_improvement_from_result','generate_inspection_improvements','update_inspection_bonus_total')),
       NULL
UNION ALL
SELECT '05 trigger_generate_improvements（AFTER INSERT OR UPDATE，inspection_masters）',
       COALESCE((SELECT tgenabled = 'O' AND def LIKE '%AFTER INSERT OR UPDATE ON %inspection_masters%generate_inspection_improvements%' FROM trg WHERE tgname = 'trigger_generate_improvements'), false), NULL
UNION ALL
SELECT '06 trigger_generate_improvement_from_result（AFTER INSERT，inspection_results）',
       COALESCE((SELECT tgenabled = 'O' AND def LIKE '%AFTER INSERT ON %inspection_results%generate_improvement_from_result%' FROM trg WHERE tgname = 'trigger_generate_improvement_from_result'), false), NULL
UNION ALL
SELECT '07 trigger_calculate_bonus（BEFORE UPDATE，inspection_improvements）',
       COALESCE((SELECT tgenabled = 'O' AND def LIKE '%BEFORE UPDATE ON %inspection_improvements%calculate_improvement_bonus%' FROM trg WHERE tgname = 'trigger_calculate_bonus'), false), NULL
UNION ALL
SELECT '08 trigger_update_bonus_total（AFTER UPDATE 且 WHEN 變成 improved）',
       COALESCE((SELECT tgenabled = 'O' AND def LIKE '%AFTER UPDATE ON %inspection_improvements%WHEN%improved%update_inspection_bonus_total%' FROM trg WHERE tgname = 'trigger_update_bonus_total'), false), NULL
UNION ALL
SELECT '09 trigger_cleanup_improvements（AFTER DELETE，inspection_results）',
       COALESCE((SELECT tgenabled = 'O' AND def LIKE '%AFTER DELETE ON %inspection_results%cleanup_improvements_on_result_delete%' FROM trg WHERE tgname = 'trigger_cleanup_improvements'), false), NULL
UNION ALL
SELECT '10 備份表存在且含 5 個函式備份',
       CASE WHEN to_regclass('public.m9_improvements_backup') IS NULL THEN false
            ELSE COALESCE((xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public.m9_improvements_backup WHERE kind = ''function''', false, true, '')))[1]::text::int, 0) = 5 END,
       NULL
UNION ALL
SELECT '11 備份表含 5 個觸發器備份（正式區原本就有者）',
       CASE WHEN to_regclass('public.m9_improvements_backup') IS NULL THEN false
            ELSE COALESCE((xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM public.m9_improvements_backup WHERE kind = ''trigger''', false, true, '')))[1]::text::int, 0) = 5 END,
       NULL
UNION ALL
SELECT '12 備份表已啟用 RLS（anon/authenticated 讀不到）',
       COALESCE((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE c.relname = 'm9_improvements_backup'), false), NULL
UNION ALL
SELECT '13 加分規則至少有一條啟用中',
       (SELECT count(*) > 0 FROM public.inspection_bonus_config WHERE is_active = true), NULL
UNION ALL
SELECT 'info_bonus_config 加分規則（天數區間 / 回補%）', true,
       (SELECT string_agg(day_from || '-' || day_to || '天:' || bonus_score || '%' || CASE WHEN is_active THEN '' ELSE '(停用)' END, '; ' ORDER BY sort_order) FROM public.inspection_bonus_config)
UNION ALL
SELECT 'info_improvements_by_status 改善項目狀態分布', true,
       (SELECT string_agg(COALESCE(status, 'NULL') || '=' || n, ', ' ORDER BY status) FROM (SELECT status, count(*) AS n FROM public.inspection_improvements GROUP BY status) s)
UNION ALL
SELECT 'info_overdue_deadline_pending 已過期限但仍 pending（套用後補報回補為 0）', true,
       (SELECT count(*)::text FROM public.inspection_improvements WHERE status = 'pending' AND deadline < (now() AT TIME ZONE 'Asia/Taipei')::date)
ORDER BY 1;

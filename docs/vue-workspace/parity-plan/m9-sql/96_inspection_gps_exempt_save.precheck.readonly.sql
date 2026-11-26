-- 96 套用前檢查（唯讀，只有 SELECT；不改任何東西，可重複執行）。
-- 白話：確認正式區「舊版巡店定位例外」的 SQL（docs/inspection-gps-exemption-prod.sql）真的已經套用，
--       以及 M9 步驟 50 已套用。96 只是在它們之上替換一個函式，前置缺一個就不能做。
-- 看結果：第一列「總判斷」必須是 ok。不是 ok 就停下，不要做 96，也不要合併新版程式到 main
--       （main 現有的舊版巡店頁本來就讀 gps_exempt 欄位，欄位不在代表正式區現況與預期不符，要先查清楚）。
-- 其餘各列是逐項結果（ok = true 才算過）；最後一列是 workspace_save_inspection 現況（只供參考，不影響總判斷）。
WITH items AS (
  SELECT 1 AS ord, 'inspection_masters.gps_exempt 欄位存在（boolean、NOT NULL、預設 false）' AS item,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inspection_masters' AND column_name='gps_exempt'
             AND data_type='boolean' AND is_nullable='NO' AND column_default='false') AS ok
  UNION ALL SELECT 2, '權限碼 inspection.gps_exempt 存在且啟用',
    EXISTS(SELECT 1 FROM public.permissions WHERE code='inspection.gps_exempt' AND is_active)
  UNION ALL SELECT 3, 'can_use_inspection_gps_exempt() 函式存在',
    to_regprocedure('public.can_use_inspection_gps_exempt()') IS NOT NULL
  UNION ALL SELECT 4, '新增檢查 trigger trg_inspection_masters_require_gps 存在、啟用，且是「認得 gps_exempt」的新版本',
    COALESCE((SELECT t.tgenabled <> 'D' AND p.prosrc LIKE '%gps_exempt%'
                FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
               WHERE t.tgrelid='public.inspection_masters'::regclass AND NOT t.tgisinternal AND t.tgname='trg_inspection_masters_require_gps'), false)
  UNION ALL SELECT 5, '防竄改 trigger trg_inspection_masters_gps_exempt_guard 存在且啟用',
    EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.inspection_masters'::regclass AND NOT t.tgisinternal
             AND t.tgname='trg_inspection_masters_gps_exempt_guard' AND t.tgenabled <> 'D')
  UNION ALL SELECT 6, 'M9 步驟 50 已套用：workspace_save_inspection 存在',
    to_regprocedure('public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb)') IS NOT NULL
)
SELECT 0 AS ord, '總判斷（必須是 ok）' AS item,
       CASE WHEN bool_and(ok) THEN 'ok' ELSE 'STOP：前置不齊，不要做 96，也不要合併新版程式' END AS result
  FROM items
UNION ALL SELECT ord, item, CASE WHEN ok THEN 'true' ELSE 'false（缺這項）' END FROM items
UNION ALL SELECT 7, '參考：workspace_save_inspection 現況',
  CASE
    WHEN to_regprocedure('public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb)') IS NULL THEN '函式不存在（步驟 50 沒做）'
    WHEN (SELECT prosrc LIKE '%gps_exempt%' FROM pg_proc WHERE oid = to_regprocedure('public.workspace_save_inspection(uuid,uuid,bigint,uuid,text,jsonb,jsonb,jsonb)')) THEN '已含 gps_exempt（96 之前做過了，重跑也無妨）'
    ELSE '還是步驟 50 的版本（不含 gps_exempt），正常，等 96 替換'
  END
ORDER BY ord;

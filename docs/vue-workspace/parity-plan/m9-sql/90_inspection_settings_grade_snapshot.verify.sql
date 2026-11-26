-- 唯讀驗證：90_inspection_settings_grade_snapshot（只有 SELECT，可在套用前後各跑一次）。
-- 套用前：1～5 應為 false／空；6、7 用來評估風險。套用後：1～5 應全為 true，8 的 completed_without_snapshot 應為 0。
-- 8、9、10 在套用前會因欄位／函式不存在而報錯，屬正常，請逐段執行。

-- 1. 資料表與欄位
SELECT to_regclass('public.workspace_inspection_settings_revision') IS NOT NULL AS has_revision_table,
       to_regclass('public.workspace_inspection_settings_writes')   IS NOT NULL AS has_writes_table,
       to_regclass('public.m9_inspection_settings_backup')          IS NOT NULL AS has_backup_table,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='inspection_masters' AND column_name='grade_thresholds') AS has_grade_thresholds_column;

-- 2. 函式（含參數簽名）
SELECT to_regprocedure('public.workspace_bump_inspection_settings()') IS NOT NULL AS has_bump_fn,
       to_regprocedure('public.workspace_save_inspection_settings(uuid,bigint,uuid,text,text,uuid,jsonb)') IS NOT NULL AS has_save_settings_fn,
       to_regprocedure('public.workspace_grade_for_score(numeric,jsonb)') IS NOT NULL AS has_grade_for_score_fn,
       to_regprocedure('public.workspace_snapshot_grade_thresholds()') IS NOT NULL AS has_snapshot_fn,
       to_regprocedure('public.workspace_grade_from_settings()') IS NOT NULL AS has_grade_from_settings_fn;

-- 3. 觸發器（套用後應有 5 列：masters 2 個、templates／bonus_config／grade_mapping 各 1 個）
SELECT c.relname AS table_name, t.tgname AS trigger_name
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND t.tgname IN ('workspace_01_grade_snapshot','workspace_grade_from_settings','workspace_settings_changed')
ORDER BY c.relname, t.tgname;

-- 4. update_inspection_bonus_total 是否已是新版，且舊版 trigger_update_bonus_total 仍在
SELECT p.prosecdef AS security_definer,
       pg_get_functiondef(p.oid) LIKE '%workspace_grade_for_score%' AS uses_snapshot_grade,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trigger_update_bonus_total' AND NOT tgisinternal) AS legacy_trigger_still_there
FROM pg_proc p WHERE p.proname='update_inspection_bonus_total' AND p.pronamespace='public'::regnamespace;

-- 5. 備份是否留下（套用後應有 3 列）
SELECT name, definition IS NOT NULL AS has_definition, payload IS NOT NULL AS has_payload, backed_up_at
FROM public.m9_inspection_settings_backup ORDER BY name;

-- 6. 目前評級對照表（與舊版寫死值 220/215/191/181/171/161/151/141/131/121/0 不同的列要先回報）
SELECT g.grade, g.min_score,
       (g.grade, g.min_score) IN ((10,220),(9,215),(8,191),(7,181),(6,171),(5,161),(4,151),(3,141),(2,131),(1,121),(0,0)) AS same_as_legacy_hardcoded
FROM public.inspection_grade_mapping g ORDER BY g.grade DESC;

-- 7. 目前加分設定（百分比語意：回補扣分 %）
SELECT day_from, day_to, bonus_score, is_active, sort_order, description
FROM public.inspection_bonus_config ORDER BY sort_order, day_from;

-- 8. snapshot 回補狀況（套用後 completed_without_snapshot 與 draft_with_snapshot 都應為 0）
SELECT count(*) FILTER (WHERE status IN ('completed','closed')) AS completed_or_closed,
       count(*) FILTER (WHERE status IN ('completed','closed') AND grade_thresholds IS NULL) AS completed_without_snapshot,
       count(*) FILTER (WHERE status NOT IN ('completed','closed') AND grade_thresholds IS NOT NULL) AS draft_with_snapshot
FROM public.inspection_masters;

-- 9. 評級函式抽樣（套用後；對照表為預設值時期望 0→0、121→1、190→7、191→8、214→8、215→9、220→10）
SELECT s AS score, public.workspace_grade_for_score(s, NULL) AS grade_by_current_mapping
FROM (VALUES (0::numeric),(121),(190),(191),(214),(215),(220)) v(s);

-- 10. 已完成單中「儲存的評級」與「用其 snapshot 重算的評級」不一致的筆數（套用後；非 0 要先查原因）
SELECT count(*) AS grade_mismatch_with_snapshot
FROM public.inspection_masters m
WHERE m.status IN ('completed','closed') AND m.grade_thresholds IS NOT NULL
  AND m.grade IS DISTINCT FROM public.workspace_grade_for_score(coalesce(m.total_score,0), m.grade_thresholds);

-- 11. 授權檢查：這兩個函式不應授權給 PUBLIC／anon／authenticated（預期 0 列）
SELECT p.proname, a.grantee
FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
WHERE p.pronamespace='public'::regnamespace
  AND p.proname IN ('workspace_save_inspection_settings','workspace_grade_for_score')
  AND a.privilege_type='EXECUTE'
  AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated')));

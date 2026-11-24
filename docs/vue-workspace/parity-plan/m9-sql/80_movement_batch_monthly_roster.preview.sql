-- M9 草稿 80 預覽：「套用前看現況」+「套用後看某月重算會改什麼」。尚未套用到正式區。
-- 第一部分（套用前可跑）：全部只有 SELECT，不改資料，回答「套用會不會卡住、日後重算影響範圍多大」。
-- 第二部分（套用 80 之後才跑）：對指定月份、全部有效門市，實際呼叫 workspace_roster_apply_store_month 算一遍，
--   把「會改哪些欄位、有幾筆進需重新確認」整理成文字，最後一律 RAISE EXCEPTION，讓整個交易還原，不會留下任何寫入。
--   結果會顯示在錯誤訊息裡（訊息開頭「預覽完成」就是成功，不是失敗）。

-- ===== 第一部分：套用前現況（唯讀）=====

-- 1) 異動類型分佈。valid_movement_type 放寬前會檢查：出現「不在新清單」的類型時，80 會中止（預期 0 列有 outside_new_list = true）
SELECT movement_type, count(*) AS n,
       movement_type NOT IN ('onboarding','promotion','acting_manager','leave_without_pay','return_to_work','pass_probation','resignation','store_transfer') AS outside_new_list
FROM public.employee_movement_history GROUP BY movement_type ORDER BY n DESC;

-- 2) 舊版把「代理店長」記成 promotion + new_value='代理店長'；新版兩種寫法都認（供對照筆數）
SELECT count(*) FILTER (WHERE movement_type='promotion' AND new_value='代理店長') AS legacy_acting_as_promotion,
       count(*) FILTER (WHERE movement_type='acting_manager') AS acting_manager_rows,
       count(*) AS all_rows
FROM public.employee_movement_history;

-- 3) 每月人員名冊規模與狀態（草稿月份日後會被異動重算覆蓋；已送審／已確認月份只記需重新確認、不改）。近 15 個月。
SELECT year_month, status, count(*) AS rows, count(DISTINCT store_id) AS stores
FROM public.monthly_staff_status
WHERE year_month >= to_char((now() AT TIME ZONE 'Asia/Taipei')::date - interval '15 months', 'YYYY-MM')
GROUP BY year_month, status ORDER BY year_month DESC, status;

-- 4) 同店同月同員編重複列（重算會取最早一列，登記調店會因重複而拒絕；預期 0 列）
SELECT store_id, year_month, employee_code, count(*) AS n
FROM public.monthly_staff_status WHERE employee_code IS NOT NULL
GROUP BY store_id, year_month, employee_code HAVING count(*) > 1 ORDER BY year_month DESC LIMIT 50;

-- 5) 同一員工有效（is_active）主檔列不是恰好 1 列（調店／異動函式要求恰好 1 列；預期 0 列）
SELECT employee_code, count(*) AS active_rows FROM public.store_employees
WHERE is_active GROUP BY employee_code HAVING count(*) <> 1 ORDER BY active_rows DESC LIMIT 50;

-- 6) 員編格式：異動批次要求 ^[A-Z0-9_-]{1,20}$（不符者無法用新版登記；預期 0 列）
SELECT employee_code FROM public.employee_movement_history
WHERE employee_code !~ '^[A-Z0-9_-]{1,20}$' GROUP BY employee_code LIMIT 50;

-- 7) 區塊計算：確認正式區現有版本存在，且內容含「代理店長」判斷（80 不替換它；以下兩欄都應為 true）
SELECT to_regprocedure('public.calculate_bonus_block(character varying,character varying,boolean,character varying,boolean,boolean,numeric,text[],boolean)') IS NOT NULL AS block_fn_9arg_exists,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trigger_update_calculated_block' AND tgrelid='public.monthly_staff_status'::regclass AND NOT tgisinternal) AS block_trigger_exists;

-- 8) 同名物件現況（預期除了 apply_due_promotions（草稿 30）與前置草稿的物件外，其餘 80 建立的都是 false）
SELECT x.name, to_regprocedure(x.sig) IS NOT NULL AS exists_now FROM (VALUES
 ('workspace_roster_recompute','public.workspace_roster_recompute(uuid,text,text,text,uuid,boolean,boolean,text,text,text)'),
 ('workspace_movement_save','public.workspace_movement_save(uuid,uuid,jsonb,text)'),
 ('workspace_movement_update','public.workspace_movement_update(uuid,uuid,jsonb)'),
 ('workspace_monthly_roster_page','public.workspace_monthly_roster_page(uuid,text)'),
 ('workspace_apply_due_promotions','public.workspace_apply_due_promotions(date)')) AS x(name,sig);

-- ===== 第二部分：套用 80 之後，預覽某月重算會改什麼（寫入後必定還原）=====
-- 用法：把 v_month 改成要預覽的月份（YYYY-MM），v_store 填門市 id 只預覽單店（NULL = 全部有效門市）。
-- 逐月驗證請從最舊的草稿月份開始，一個月一個月跑，看過沒問題再往下一個月。
DO $$
DECLARE
  v_month text := '2026-10';      -- ← 改這裡
  v_store uuid := NULL;           -- ← 只預覽單店時填 stores.id
  s record; r jsonb; t_upd int:=0; t_cre int:=0; t_rem int:=0; t_rec int:=0; t_adj int:=0; t_emp int:=0;
  by_field text; samples text; started timestamptz := transaction_timestamp();
BEGIN
  IF to_regprocedure('public.workspace_roster_apply_store_month(uuid,uuid,text,boolean,boolean,text)') IS NULL THEN
    RAISE NOTICE '尚未套用 80_movement_batch_monthly_roster.sql，第二部分略過。';
    RETURN;
  END IF;
  FOR s IN SELECT id FROM public.stores WHERE is_active AND (v_store IS NULL OR id = v_store) ORDER BY store_code LOOP
    r := public.workspace_roster_apply_store_month(NULL, s.id, v_month, true, false, '預覽');
    t_upd := t_upd + (r->>'updated')::int;  t_cre := t_cre + (r->>'created')::int;  t_rem := t_rem + (r->>'removed')::int;
    t_rec := t_rec + (r->>'recheck')::int;  t_adj := t_adj + (r->>'adjusted')::int; t_emp := t_emp + (r->>'employees')::int;
  END LOOP;
  SELECT string_agg(field || '：' || n, '；' ORDER BY n DESC) INTO by_field
    FROM (SELECT field, count(*) AS n FROM public.monthly_staff_adjustment_log WHERE created_at >= started AND movement_label = '預覽' GROUP BY field) q;
  SELECT string_agg(employee_code || ' ' || year_month || ' ' || field || ' ' || coalesce(old_value,'∅') || ' → ' || coalesce(new_value,'∅'), E'\n') INTO samples
    FROM (SELECT * FROM public.monthly_staff_adjustment_log WHERE created_at >= started AND movement_label = '預覽' ORDER BY store_id, employee_code, field LIMIT 40) q;
  RAISE EXCEPTION E'預覽完成（%，已全部還原，沒有寫入任何資料）。處理員工 % 人；更新列 %、新增列 %、移出列 %、進需重新確認 %、欄位調整紀錄 %。\n欄位分佈：%\n前 40 筆調整：\n%',
    v_month, t_emp, t_upd, t_cre, t_rem, t_rec, t_adj, coalesce(by_field,'（無）'), coalesce(samples,'（無）');
END $$;

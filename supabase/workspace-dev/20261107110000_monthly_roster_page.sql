-- 每月人員狀態加速（monthly-speed-spec 項目 C）：一支 RPC 一次回傳名冊頁的名冊與門市統計列（DEV 專用，CREATE OR REPLACE，可重複套用）。
-- 內容：名冊（含 user 關聯、上月單品獎金、扣除其他加盟店後的業績）與門市本月統計列，
-- 與 app/store/actions.ts getMonthlyStaffStatus／getStoreMonthlySummary 逐欄相同。
--
-- 權限設計（偏離規格 C.2「REVOKE authenticated」的原因）：
-- 舊版這些查詢都是用「使用者身分」讀，受 RLS 限制：
--   * support_staff_bonus 只有 performance.bonus.view／import 或被指派該店者看得到（無權限者上月單品獎金為 null）。
--   * profiles 只能讀自己（user 關聯對其他人是 null）。
--   * stores 只能讀被指派的有效門市／有 GA 權限者（影響加盟店清單與本店代碼）。
--   * monthly_performance_details、monthly_staff_status、monthly_store_summary 各有權限條件。
-- 若改用 service role 呼叫，這些資料會對沒權限的人外露（一致性測試也會失敗），在 SQL 裡手寫複製 RLS 條件則會與政策漂移。
-- 所以這支函式是 SECURITY INVOKER：必須以使用者的 session 呼叫，RLS 原封不動套用，等於把原本的多趟查詢包成一趟，不放大任何權限。
-- 因此 EXECUTE 給 authenticated（與 service_role），REVOKE PUBLIC／anon。需要 service role 才能讀的 recheck／adjustments
-- 仍由 API 在確認使用者可看該門市後以 service role 讀取（與原本相同）。
BEGIN;

-- 先前草稿版（service role 版、含 recheck／adjustments）若曾套用過就移除，避免留下可繞過 RLS 的函式。
DROP FUNCTION IF EXISTS public.workspace_monthly_roster_page(uuid, text, timestamptz);

-- 與 TypeScript extractStoreCode 相同：大寫後取第一段「4 碼數字＋選擇性 1 碼英文」，找不到就用去空白的大寫原字串。
CREATE OR REPLACE FUNCTION public.workspace_extract_store_code(p_raw text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce((regexp_match(upper(coalesce(p_raw,'')), '[0-9]{4}[A-Z]?'))[1], btrim(upper(coalesce(p_raw,'')), E' \t\r\n'))
$$;

CREATE OR REPLACE FUNCTION public.workspace_monthly_roster_page(p_store uuid, p_month text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public','pg_temp' AS $$
DECLARE
 cur_code text;
 has_franchise boolean;
 summary_count integer;
 v_records jsonb;
 v_summary jsonb;
BEGIN
 IF p_store IS NULL OR p_month IS NULL OR p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'WORKSPACE_INVALID'; END IF;
 -- 本店代碼：看不到本店（RLS）時與 TypeScript 相同視為空字串。
 SELECT coalesce((SELECT workspace_extract_store_code(store_code) FROM stores WHERE id = p_store), '') INTO cur_code;
 SELECT EXISTS(SELECT 1 FROM stores WHERE is_franchise = true AND workspace_extract_store_code(store_code) <> '') INTO has_franchise;

 WITH fr AS (
   SELECT DISTINCT workspace_extract_store_code(store_code) AS c FROM stores WHERE is_franchise = true AND workspace_extract_store_code(store_code) <> ''
 ), staff AS (
   SELECT s.* FROM monthly_staff_status s WHERE s.year_month = p_month AND s.store_id = p_store
 ), agg AS (
   -- 與 TypeScript 相同：加盟店（非本店）的明細不計入；沒有任何加盟店設定時完全不覆寫業績。
   SELECT d.staff_status_id,
          sum(coalesce(d.transaction_count,0)::float8) AS tx,
          sum(coalesce(d.sales_amount,0)::float8) AS sales,
          sum(coalesce(d.gross_profit,0)::float8) AS gp
   FROM monthly_performance_details d
   WHERE has_franchise
     AND d.staff_status_id IN (SELECT id FROM staff)
     AND NOT (workspace_extract_store_code(d.store_code) IN (SELECT c FROM fr)
              AND workspace_extract_store_code(d.store_code) IS DISTINCT FROM cur_code)
   GROUP BY d.staff_status_id
 )
 SELECT coalesce(jsonb_agg(
   (to_jsonb(s)
     || jsonb_build_object(
          'user', (SELECT jsonb_build_object('id', p.id, 'email', p.email, 'full_name', p.full_name) FROM profiles p WHERE p.id = s.user_id),
          'last_month_single_item_bonus', (SELECT nullif(b.bonus_amount, 0) FROM support_staff_bonus b WHERE b.year_month = p_month AND b.store_id = p_store AND b.employee_code = s.employee_code LIMIT 1))
     || coalesce((SELECT jsonb_build_object(
          'transaction_count', a.tx,
          'sales_amount', floor(a.sales * 100 + 0.5) / 100,
          'gross_profit', floor(a.gp * 100 + 0.5) / 100,
          'gross_profit_rate', CASE WHEN a.sales > 0 THEN floor((a.gp / a.sales) * 10000 + 0.5) / 100 ELSE 0 END)
        FROM agg a WHERE a.staff_status_id = s.id), '{}'::jsonb))
   ORDER BY s.employee_code), '[]'::jsonb)
 INTO v_records
 FROM staff s;

 -- 與 getStoreMonthlySummary 相同：剛好一列才回傳，沒有或重複視為沒有。
 SELECT count(*) INTO summary_count FROM monthly_store_summary WHERE year_month = p_month AND store_id = p_store;
 IF summary_count = 1 THEN
  SELECT to_jsonb(m) INTO v_summary FROM monthly_store_summary m WHERE m.year_month = p_month AND m.store_id = p_store;
 END IF;

 RETURN jsonb_build_object('records', v_records, 'summary', v_summary);
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_extract_store_code(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.workspace_monthly_roster_page(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_extract_store_code(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_monthly_roster_page(uuid, text) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- 45-b6-utility-bills.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261118110000_m7m8_b6_utility_bills.sql 相同。
-- 第 6 批 C（G23 水電網費）（2026-11-17 第 6 批問卷 V6、V7、V8、V10 與 m7m8-spec Q23）。
-- 性質：新增 1 個欄位（ga_utility_bills.deletion_reason）、1 個部分索引（未繳且未刪除的到期日）、改 1 條讀取政策（移除店長直讀條件）、新增函式（對外 9 個 ga_ws_ub_*、內部輔助 ga_ub_*）；不改既有帳單資料。
--   全部函式 SECURITY DEFINER、固定 search_path、權限一律用 has_permission（只看角色權限；profiles.role = admin 不是後備）；寫入同交易、鎖列、更新帶 expected_updated_at（不符 409 STALE）。
-- 行為（與舊版不同處已登記白名單；問卷已核可）：已繳與未繳帳單都可編輯並留修改者，已繳帳單改金額或識別欄位與刪除需二次確認；刪除必填原因並軟刪除、可看「已刪除」唯讀檢視；
--   重複帳單用白話指出既有那一筆；金額異常（近三筆平均的 2 倍、一半、0 元）只提醒；標記已繳預設台北今天、不可未來、不早於帳單月份前 1 個月，改回待繳需確認；
--   逾期＝未繳且到期日早於台北今天，待繳與逾期摘要不受月份與筆數上限影響；報表的「其他據點」名稱正規化後合併；店長不能再直讀水電帳單（資料庫層與「店長看不到水電網費」一致）。
-- 另有 1 個既有函式的小改動：ga_resource_attachment_can_manage（附件資料表寫入觸發器與政策用的管理判斷）原本沒有 UTILITY_BILL 分支，水電帳單附件不論誰都上傳不了；本檔不整支覆蓋，而是讀出現行定義、只在結尾 RETURN false 前插入 UTILITY_BILL 分支再重建（有水電網費管理權限且帳單未刪除；已有就略過；結尾格式不符就中止，請人工處理）。撤回會拿掉這個分支。
-- 先決條件：第 4 批 32（ga_rq_*）、33（ga_po_today、ga_po_like_escape）；水電帳單 migration 20260925103000、20260926090000、20260926093000 已套用（41 第 10 區會檢查，不能有 MISSING）。
-- **套用前一定要做**：(1) 跑 41 並把第 10 區「水電帳單讀取政策」整列存檔（撤回要照這份）；(2) 看「店長直讀」人數，確認沒有功能依賴店長讀取水電帳單；(3) 套用後舊版 /general-affairs/utility-bills 頁的店長直讀會讀不到（舊頁不動，已登記白名單）。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：45-b6-utility-bills-rollback.sql。套用前先跑 41-b6-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.ga_rq_err(integer,text,text,jsonb)') IS NULL OR to_regprocedure('public.ga_rq_raise(integer,text,text,jsonb)') IS NULL OR to_regprocedure('public.ga_rq_catch(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用第 4 批 20261112100000_m7m8_b4_request_rules（ga_rq_*）';
  END IF;
  IF to_regprocedure('public.ga_po_today()') IS NULL OR to_regprocedure('public.ga_po_like_escape(text)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用第 4 批 20261112110000_m7m8_b4_purchase_orders（ga_po_*）';
  END IF;
  IF to_regclass('public.ga_utility_bills') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: ga_utility_bills（請先套用 20260925103000 與其後水電帳單 migration）';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_utility_bills' AND column_name IN ('service_identifier', 'equipment_serial', 'service_label') GROUP BY table_name HAVING count(*) = 3) THEN
    RAISE EXCEPTION 'Missing prerequisite columns: ga_utility_bills.service_identifier／equipment_serial／service_label（請先套用 20260926090000、20260926093000）';
  END IF;
END $$;

-- ================================================================ 1. 欄位與索引
ALTER TABLE public.ga_utility_bills ADD COLUMN IF NOT EXISTS deletion_reason text;
CREATE INDEX IF NOT EXISTS idx_ga_utility_bills_unpaid_due ON public.ga_utility_bills (due_date) WHERE paid_at IS NULL AND deleted_at IS NULL;

-- ================================================================ 2. 讀取 policy：移除店長直讀條件
DROP POLICY IF EXISTS ga_utility_bills_read ON public.ga_utility_bills;
CREATE POLICY ga_utility_bills_read ON public.ga_utility_bills FOR SELECT TO authenticated
USING (
  deleted_at IS NULL AND (
    public.current_user_has_permission('general_affairs.utility_bill.view')
    OR public.current_user_has_permission('general_affairs.utility_bill.manage')
  )
);

-- ================================================================ 2b. 帳單附件：附件管理判斷函式補上 UTILITY_BILL
-- 既有 ga_resource_attachment_can_manage（附件資料表的寫入觸發器與政策都靠它）沒有 UTILITY_BILL 分支，結果水電帳單附件不論用誰的身分都上傳不了（回「沒有附件管理權限」）。
-- 這裡不整支覆蓋（正式區與 DEV 的分支可能不同，覆蓋會洗掉別人的分支），而是讀出現行定義、只在最後的 RETURN false 前插入 UTILITY_BILL 分支再重建；已經有就略過（可重複執行）。
-- 規則：有水電網費管理權限、且帳單未刪除。附件的讀取仍由伺服端水電權限判斷（API 以管理者身分讀取，帳單刪除後讀不到）。
DO $$
DECLARE
  v_def text;
  v_new text;
  v_block text := $blk$IF p_resource_type = 'UTILITY_BILL' THEN
    RETURN public.current_user_has_permission('general_affairs.utility_bill.manage')
      AND EXISTS (SELECT 1 FROM public.ga_utility_bills b WHERE b.id = p_resource_id AND b.deleted_at IS NULL);
  END IF;$blk$;
BEGIN
  IF to_regprocedure('public.ga_resource_attachment_can_manage(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: ga_resource_attachment_can_manage（請先套用第 1 批附件 migration 20260729125755）';
  END IF;
  v_def := pg_get_functiondef('public.ga_resource_attachment_can_manage(text,uuid)'::regprocedure);
  IF position('UTILITY_BILL' in v_def) > 0 THEN RETURN; END IF;
  v_new := regexp_replace(v_def, 'RETURN false;(\s*END;\s*\$function\$\s*)$', v_block || E'\n\n  RETURN false;' || '\1');
  IF v_new = v_def OR position('UTILITY_BILL' in v_new) = 0 THEN
    RAISE EXCEPTION 'ga_resource_attachment_can_manage 現行定義的結尾不是預期的 RETURN false; END;，請人工確認後再加 UTILITY_BILL 分支';
  END IF;
  EXECUTE v_new;
END $$;

-- ================================================================ 3. 內部輔助
CREATE OR REPLACE FUNCTION public.ga_ub_can_view(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT has_permission(p_uid, 'general_affairs.utility_bill.view') OR has_permission(p_uid, 'general_affairs.utility_bill.manage'); $$;

CREATE OR REPLACE FUNCTION public.ga_ub_can_manage(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT has_permission(p_uid, 'general_affairs.utility_bill.manage'); $$;

-- 逾期：未刪除、未繳、有到期日且早於台北今天（到期當天不算逾期）。列表篩選、摘要、首頁與導覽徽章都用這一支。
CREATE OR REPLACE FUNCTION public.ga_ub_is_overdue(p_paid_at date, p_due_date date, p_deleted_at timestamptz) RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT p_deleted_at IS NULL AND p_paid_at IS NULL AND p_due_date IS NOT NULL AND p_due_date < public.ga_po_today(); $$;

-- 待繳、逾期、未填到期日三組數字（全部月份、完整計算、不受筆數上限與任何篩選影響）。內部用，不開放直接呼叫。
CREATE OR REPLACE FUNCTION public.ga_ub_pending_stats() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'today', public.ga_po_today(),
    'pending_count', count(*), 'pending_amount', COALESCE(sum(amount), 0),
    'overdue_count', count(*) FILTER (WHERE public.ga_ub_is_overdue(paid_at, due_date, deleted_at)),
    'overdue_amount', COALESCE(sum(amount) FILTER (WHERE public.ga_ub_is_overdue(paid_at, due_date, deleted_at)), 0),
    'no_due_count', count(*) FILTER (WHERE due_date IS NULL),
    'no_due_amount', COALESCE(sum(amount) FILTER (WHERE due_date IS NULL), 0))
  FROM public.ga_utility_bills WHERE deleted_at IS NULL AND paid_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.ga_ub_txt(p jsonb, p_key text, p_max integer, p_label text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v text;
BEGIN
  IF jsonb_typeof(p -> p_key) IS NOT NULL AND jsonb_typeof(p -> p_key) NOT IN ('string', 'null') THEN PERFORM public.ga_rq_raise(400, 'FIELD_TYPE', p_label || '格式錯誤'); END IF;
  v := nullif(btrim(p ->> p_key), '');
  IF v IS NOT NULL AND char_length(v) > p_max THEN PERFORM public.ga_rq_raise(400, 'FIELD_TOO_LONG', p_label || '不可超過 ' || p_max || ' 個字'); END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ub_date(p_value text, p_label text) RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN RETURN NULL; END IF;
  IF btrim(p_value) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN PERFORM public.ga_rq_raise(400, 'DATE_FORMAT', p_label || '格式要是 YYYY-MM-DD'); END IF;
  BEGIN
    RETURN btrim(p_value)::date;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.ga_rq_raise(400, 'DATE_FORMAT', p_label || '不是有效的日期');
  END;
  RETURN NULL;
END;
$$;

-- 帳單月份：接受 YYYY-MM 或 YYYY-MM-DD，一律回該月 1 日。
CREATE OR REPLACE FUNCTION public.ga_ub_month(p_value text) RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v text := btrim(COALESCE(p_value, ''));
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  IF v !~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$' THEN PERFORM public.ga_rq_raise(400, 'MONTH_FORMAT', '帳單月份格式要是 YYYY-MM'); END IF;
  BEGIN
    RETURN (substr(v, 1, 7) || '-01')::date;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.ga_rq_raise(400, 'MONTH_FORMAT', '帳單月份不是有效的月份');
  END;
  RETURN NULL;
END;
$$;

-- 金額：非負、最多兩位小數（超過四捨五入）、上限 9,999,999,999.99；p_required 為 true 時空值回 400。
CREATE OR REPLACE FUNCTION public.ga_ub_num(p jsonb, p_key text, p_label text, p_required boolean) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v text;
BEGIN
  IF jsonb_typeof(p -> p_key) IS NOT NULL AND jsonb_typeof(p -> p_key) NOT IN ('string', 'number', 'null') THEN PERFORM public.ga_rq_raise(400, 'FIELD_TYPE', p_label || '格式錯誤'); END IF;
  v := nullif(btrim(p ->> p_key), '');
  IF v IS NULL THEN
    IF p_required THEN PERFORM public.ga_rq_raise(400, 'AMOUNT_REQUIRED', '請輸入' || p_label); END IF;
    RETURN NULL;
  END IF;
  IF v !~ '^[0-9]+(\.[0-9]+)?$' THEN PERFORM public.ga_rq_raise(400, 'AMOUNT_FORMAT', '請輸入正確的' || p_label || '（不可為負數或含文字）'); END IF;
  IF v::numeric > 9999999999.99 THEN PERFORM public.ga_rq_raise(400, 'AMOUNT_TOO_LARGE', p_label || '太大，請確認'); END IF;
  RETURN round(v::numeric, 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ub_ident(p_service_identifier text, p_equipment_serial text, p_account_number text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT lower(btrim(COALESCE(nullif(btrim(p_service_identifier), ''), nullif(btrim(p_equipment_serial), ''), nullif(btrim(p_account_number), ''), ''))); $$;

CREATE OR REPLACE FUNCTION public.ga_ub_money_text(p_value numeric) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT to_char(round(p_value), 'FM999,999,999,990'); $$;

CREATE OR REPLACE FUNCTION public.ga_ub_store_label(p_store_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT s.store_code || ' ' || COALESCE(nullif(btrim(s.short_name), ''), s.store_name) FROM public.stores s WHERE s.id = p_store_id; $$;

-- 金額異常（V7）：同據點＋同費用類型＋同識別號碼，取帳單月份早於本筆的最近三筆未刪除帳單（排除自己與 0 元）算平均；
-- 本筆 > 平均 2 倍、< 平均一半、或本筆為 0 元時提醒（恰好 2 倍或一半不提醒），歷史 0 筆不比較（只提醒 0 元），1–2 筆照用現有筆數並標「僅 N 筆參考」。
CREATE OR REPLACE FUNCTION public.ga_ub_anomaly(p_store_id uuid, p_location text, p_type text, p_ident text, p_month date, p_amount numeric, p_exclude uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_samples jsonb;
  v_n integer;
  v_avg numeric;
  v_reason text;
  v_msg text;
  v_tail text := '';
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'billing_month', x.billing_month, 'amount', x.amount) ORDER BY x.billing_month DESC, x.created_at DESC), '[]'::jsonb), count(*)::integer, avg(x.amount)
    INTO v_samples, v_n, v_avg
    FROM (SELECT b.id, b.billing_month, b.amount, b.created_at FROM public.ga_utility_bills b
           WHERE b.deleted_at IS NULL AND b.id IS DISTINCT FROM p_exclude
             AND COALESCE(b.store_id::text, '') = COALESCE(p_store_id::text, '') AND lower(btrim(b.location_name)) = lower(btrim(COALESCE(p_location, '')))
             AND b.expense_type = p_type AND public.ga_ub_ident(b.service_identifier, b.equipment_serial, b.account_number) = p_ident
             AND b.billing_month < p_month AND b.amount > 0
           ORDER BY b.billing_month DESC, b.created_at DESC LIMIT 3) x;
  IF v_n > 0 AND v_n < 3 THEN v_tail := '（僅 ' || v_n || ' 筆參考）'; END IF;
  IF p_amount = 0 THEN
    v_reason := 'ZERO';
    v_msg := '這筆金額是 0 元，請確認是否漏填' || CASE WHEN v_n > 0 THEN '；近 ' || v_n || ' 筆平均是 ' || public.ga_ub_money_text(v_avg) || ' 元' || v_tail ELSE '' END;
  ELSIF v_n > 0 AND p_amount > 2 * v_avg THEN
    v_reason := 'HIGH';
    v_msg := '這筆 ' || public.ga_ub_money_text(p_amount) || ' 元，超過近 ' || v_n || ' 筆平均 ' || public.ga_ub_money_text(v_avg) || ' 元的 2 倍，請確認是否多打' || v_tail;
  ELSIF v_n > 0 AND p_amount < v_avg / 2 THEN
    v_reason := 'LOW';
    v_msg := '這筆 ' || public.ga_ub_money_text(p_amount) || ' 元，不到近 ' || v_n || ' 筆平均 ' || public.ga_ub_money_text(v_avg) || ' 元的一半，請確認是否少打' || v_tail;
  END IF;
  RETURN jsonb_build_object('warn', v_reason IS NOT NULL, 'code', 'AMOUNT_ANOMALY', 'reason', v_reason, 'message', v_msg,
    'baseline', CASE WHEN v_n > 0 THEN round(v_avg, 2) END, 'sample_count', v_n, 'partial', v_n > 0 AND v_n < 3, 'samples', v_samples);
END;
$$;

-- 帳單 JSON（含據點、建立與最後修改者名稱、刪除資訊、狀態）。
CREATE OR REPLACE FUNCTION public.ga_ub_json(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'id', b.id, 'store_id', b.store_id, 'location_name', b.location_name, 'expense_type', b.expense_type, 'billing_month', b.billing_month,
    'provider_name', b.provider_name, 'service_label', b.service_label, 'service_identifier', b.service_identifier, 'account_number', b.account_number,
    'equipment_serial', b.equipment_serial, 'amount', b.amount, 'electricity_kwh', b.electricity_kwh, 'due_date', b.due_date, 'paid_at', b.paid_at,
    'reference_no', b.reference_no, 'notes', b.notes, 'created_at', b.created_at, 'updated_at', b.updated_at,
    'created_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = b.created_by),
    'updated_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = b.updated_by),
    'deleted_at', b.deleted_at, 'deletion_reason', b.deletion_reason,
    'deleted_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = b.deleted_by),
    'status', CASE WHEN b.deleted_at IS NOT NULL THEN 'deleted' WHEN b.paid_at IS NOT NULL THEN 'paid' WHEN public.ga_ub_is_overdue(b.paid_at, b.due_date, b.deleted_at) THEN 'overdue' ELSE 'unpaid' END,
    'overdue', public.ga_ub_is_overdue(b.paid_at, b.due_date, b.deleted_at),
    'store', (SELECT jsonb_build_object('id', s.id, 'store_code', s.store_code, 'store_name', s.store_name, 'short_name', s.short_name, 'is_active', s.is_active) FROM public.stores s WHERE s.id = b.store_id))
  FROM public.ga_utility_bills b WHERE b.id = p_id;
$$;

-- 已繳帳單的關鍵欄位原值（要二次確認時一併回給畫面顯示）。
CREATE OR REPLACE FUNCTION public.ga_ub_original(b public.ga_utility_bills) RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT jsonb_build_object('amount', b.amount, 'location_name', b.location_name, 'expense_type', b.expense_type, 'billing_month', b.billing_month, 'provider_name', b.provider_name,
  'service_identifier', b.service_identifier, 'equipment_serial', b.equipment_serial, 'account_number', b.account_number, 'paid_at', b.paid_at); $$;

-- 繳費日期範圍：不可未來、不可早於帳單月份前 1 個月（例如 2038-03 帳單最早 2038-02-01）。
CREATE OR REPLACE FUNCTION public.ga_ub_check_paid_date(p_paid date, p_month date) RETURNS void LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_min date := (p_month - interval '1 month')::date;
BEGIN
  IF p_paid > public.ga_po_today() THEN PERFORM public.ga_rq_raise(400, 'PAID_FUTURE', '繳費日期不能是未來的日期（今天是 ' || public.ga_po_today() || '）'); END IF;
  IF p_paid < v_min THEN PERFORM public.ga_rq_raise(400, 'PAID_TOO_EARLY', '繳費日期不能早於帳單月份的前 1 個月（這筆帳單最早可選 ' || v_min || '）'); END IF;
END;
$$;

-- ================================================================ 4. 對外函式
-- 啟用中的門市（新增與篩選下拉；店長不可用）。
CREATE OR REPLACE FUNCTION public.ga_ws_ub_stores() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_ub_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看水電網費的權限'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'today', public.ga_po_today(), 'data', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'store_code', s.store_code, 'store_name', s.store_name, 'short_name', s.short_name) ORDER BY s.store_code)
    FROM public.stores s WHERE s.is_active IS TRUE), '[]'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 列表：filters = {month:'YYYY-MM', type, store_id, status:'paid|unpaid|overdue|no_due', overdue:true, search, deleted:true}；
--   summary 照篩選；pending／overdue／no_due 三組數字不受月份、類型、據點篩選與筆數上限影響。
CREATE OR REPLACE FUNCTION public.ga_ws_ub_list(p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  v_month date;
  v_type text;
  v_store uuid;
  v_status text;
  v_overdue boolean := COALESCE(v_f ->> 'overdue', '') IN ('true', '1');
  v_deleted boolean := COALESCE(v_f ->> 'deleted', '') IN ('true', '1');
  v_q text;
  v_pat text;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_ub_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看水電網費的權限'); END IF;
  v_month := public.ga_ub_month(public.ga_ub_txt(v_f, 'month', 10, '月份'));
  v_type := upper(public.ga_ub_txt(v_f, 'type', 20, '費用類型'));
  v_store := CASE WHEN v_f ->> 'store_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (v_f ->> 'store_id')::uuid END;
  v_status := lower(public.ga_ub_txt(v_f, 'status', 20, '狀態'));
  v_q := public.ga_ub_txt(v_f, 'search', 100, '搜尋');
  IF v_type IS NOT NULL AND v_type NOT IN ('WATER', 'ELECTRICITY', 'PHONE', 'INTERNET') THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '費用類型篩選值錯誤'); END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('paid', 'unpaid', 'overdue', 'no_due') THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '狀態篩選值錯誤'); END IF;
  IF nullif(v_f ->> 'store_id', '') IS NOT NULL AND v_store IS NULL THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '據點篩選值錯誤'); END IF;
  IF v_overdue THEN v_status := 'overdue'; END IF;
  IF v_q IS NOT NULL THEN v_pat := '%' || public.ga_po_like_escape(v_q) || '%'; END IF;
  WITH f AS (
    SELECT b.* FROM public.ga_utility_bills b
     WHERE ((v_deleted AND b.deleted_at IS NOT NULL) OR (NOT v_deleted AND b.deleted_at IS NULL))
       AND (v_month IS NULL OR b.billing_month = v_month) AND (v_type IS NULL OR b.expense_type = v_type) AND (v_store IS NULL OR b.store_id = v_store)
       AND (v_status IS NULL OR (v_status = 'paid' AND b.paid_at IS NOT NULL) OR (v_status = 'unpaid' AND b.paid_at IS NULL)
            OR (v_status = 'overdue' AND public.ga_ub_is_overdue(b.paid_at, b.due_date, b.deleted_at)) OR (v_status = 'no_due' AND b.paid_at IS NULL AND b.due_date IS NULL))
       AND (v_pat IS NULL OR b.location_name ILIKE v_pat ESCAPE '\' OR COALESCE(b.provider_name, '') ILIKE v_pat ESCAPE '\' OR COALESCE(b.service_label, '') ILIKE v_pat ESCAPE '\'
            OR COALESCE(b.service_identifier, '') ILIKE v_pat ESCAPE '\' OR COALESCE(b.account_number, '') ILIKE v_pat ESCAPE '\' OR COALESCE(b.equipment_serial, '') ILIKE v_pat ESCAPE '\'
            OR COALESCE(b.reference_no, '') ILIKE v_pat ESCAPE '\')
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM f),
    'summary', (SELECT jsonb_build_object('count', count(*), 'total_amount', COALESCE(sum(amount), 0),
        'paid_count', count(*) FILTER (WHERE paid_at IS NOT NULL), 'paid_amount', COALESCE(sum(amount) FILTER (WHERE paid_at IS NOT NULL), 0),
        'unpaid_count', count(*) FILTER (WHERE paid_at IS NULL), 'unpaid_amount', COALESCE(sum(amount) FILTER (WHERE paid_at IS NULL), 0)) FROM f),
    'rows', COALESCE((SELECT jsonb_agg(public.ga_ub_json(x.id) ORDER BY x.billing_month DESC, x.due_date ASC NULLS LAST, x.created_at DESC, x.id)
        FROM (SELECT id, billing_month, due_date, created_at FROM f ORDER BY billing_month DESC, due_date ASC NULLS LAST, created_at DESC, id LIMIT v_size OFFSET (v_page - 1) * v_size) x), '[]'::jsonb))
    INTO v_out;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_out -> 'rows', 'total', v_out -> 'total', 'page', v_page, 'page_size', v_size,
    'summary', v_out -> 'summary', 'global', public.ga_ub_pending_stats(), 'deleted_view', v_deleted));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ws_ub_get(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  b public.ga_utility_bills%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_ub_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看水電網費的權限'); END IF;
  SELECT * INTO b FROM public.ga_utility_bills WHERE id = p_id;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這筆帳單'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_ub_json(b.id));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 儲存前的異常檢查（不寫入）：payload 欄位同 save；p_exclude_id 是編輯中的那一筆（比較時排除自己）。
CREATE OR REPLACE FUNCTION public.ga_ws_ub_anomaly(p_payload jsonb, p_exclude_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_store uuid;
  v_loc text;
  v_type text := upper(public.ga_ub_txt(p, 'expense_type', 20, '費用類型'));
  v_month date := public.ga_ub_month(public.ga_ub_txt(p, 'billing_month', 10, '帳單月份'));
  v_amount numeric := public.ga_ub_num(p, 'amount', '金額', true);
  v_ident text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_ub_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有新增或編輯水電網費的權限（需要水電網費管理權限）'); END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;
  IF v_type IS NULL OR v_type NOT IN ('WATER', 'ELECTRICITY', 'PHONE', 'INTERNET') THEN RETURN public.ga_rq_err(400, 'TYPE_REQUIRED', '請選擇費用類型'); END IF;
  IF v_month IS NULL THEN RETURN public.ga_rq_err(400, 'MONTH_REQUIRED', '請選擇帳單月份'); END IF;
  IF p ->> 'store_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_store := (p ->> 'store_id')::uuid; END IF;
  v_loc := CASE WHEN v_store IS NOT NULL THEN COALESCE(public.ga_ub_store_label(v_store), public.ga_ub_txt(p, 'location_name', 120, '據點')) ELSE public.ga_ub_txt(p, 'location_name', 120, '據點') END;
  IF v_loc IS NULL THEN RETURN public.ga_rq_err(400, 'LOCATION_REQUIRED', '請選擇或輸入據點'); END IF;
  -- 編輯既有帳單時，據點沿用原本的（含已停用門市的舊帳單：label 以原 location_name 為準）。
  IF p_exclude_id IS NOT NULL THEN
    SELECT CASE WHEN b.store_id IS NOT DISTINCT FROM v_store AND v_store IS NOT NULL THEN b.location_name ELSE v_loc END INTO v_loc FROM public.ga_utility_bills b WHERE b.id = p_exclude_id;
    v_loc := COALESCE(v_loc, public.ga_ub_store_label(v_store), public.ga_ub_txt(p, 'location_name', 120, '據點'));
  END IF;
  v_ident := public.ga_ub_ident(public.ga_ub_txt(p, 'service_identifier', 200, '服務識別號碼'), CASE WHEN v_type = 'INTERNET' THEN public.ga_ub_txt(p, 'equipment_serial', 200, '設備序號') END, public.ga_ub_txt(p, 'account_number', 200, '帳號'));
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_ub_anomaly(v_store, v_loc, v_type, v_ident, v_month, v_amount, p_exclude_id));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 新增（p_id 為 NULL）與編輯。編輯：沒帶的欄位維持原值；已繳帳單改關鍵欄位需 p_confirm_paid_change。回 data（帳單）、anomaly 與 warnings（金額異常只提醒，仍已儲存）。
CREATE OR REPLACE FUNCTION public.ga_ws_ub_save(p_id uuid, p_payload jsonb, p_expected_updated_at timestamptz DEFAULT NULL, p_confirm_paid_change boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_new boolean := p_id IS NULL;
  c public.ga_utility_bills%ROWTYPE;
  b public.ga_utility_bills%ROWTYPE;
  v_type text;
  v_month date;
  v_amount numeric;
  v_kwh numeric;
  v_store uuid;
  v_store_changed boolean := false;
  v_loc text;
  v_provider text;
  v_label text;
  v_ident text;
  v_account text;
  v_serial text;
  v_ref text;
  v_notes text;
  v_due date;
  v_paid date;
  v_changed jsonb := '[]'::jsonb;
  v_dup public.ga_utility_bills%ROWTYPE;
  v_anomaly jsonb;
  v_warn jsonb := '[]'::jsonb;
  s public.stores%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_ub_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有新增或編輯水電網費的權限（需要水電網費管理權限）'); END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;
  IF NOT v_new THEN
    SELECT * INTO c FROM public.ga_utility_bills WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這筆帳單'); END IF;
    IF c.deleted_at IS NOT NULL THEN RETURN public.ga_rq_err(409, 'DELETED', '這筆帳單已被刪除，不能編輯'); END IF;
    IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再操作'); END IF;
    IF c.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這筆帳單剛被其他人修改，請重新載入後再操作'); END IF;
  END IF;

  v_type := CASE WHEN jsonb_exists(p, 'expense_type') THEN upper(public.ga_ub_txt(p, 'expense_type', 20, '費用類型')) ELSE c.expense_type END;
  IF v_type IS NULL OR v_type NOT IN ('WATER', 'ELECTRICITY', 'PHONE', 'INTERNET') THEN RETURN public.ga_rq_err(400, 'TYPE_REQUIRED', '請選擇費用類型'); END IF;
  v_month := CASE WHEN jsonb_exists(p, 'billing_month') THEN public.ga_ub_month(public.ga_ub_txt(p, 'billing_month', 10, '帳單月份')) ELSE c.billing_month END;
  IF v_month IS NULL THEN RETURN public.ga_rq_err(400, 'MONTH_REQUIRED', '請選擇帳單月份'); END IF;
  v_amount := CASE WHEN jsonb_exists(p, 'amount') THEN public.ga_ub_num(p, 'amount', '金額', true) ELSE c.amount END;
  IF v_amount IS NULL THEN RETURN public.ga_rq_err(400, 'AMOUNT_REQUIRED', '請輸入金額'); END IF;
  v_kwh := CASE WHEN jsonb_exists(p, 'electricity_kwh') THEN public.ga_ub_num(p, 'electricity_kwh', '用電度數', false) ELSE c.electricity_kwh END;
  IF v_type <> 'ELECTRICITY' THEN v_kwh := NULL; END IF;

  -- 據點：選了門市就同步 location_name；門市沒變時保留原本的名稱（含已停用門市的舊帳單）；新選門市必須是啟用中。
  v_store := CASE WHEN jsonb_exists(p, 'store_id') THEN CASE WHEN nullif(btrim(p ->> 'store_id'), '') IS NULL THEN NULL
      WHEN (p ->> 'store_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (p ->> 'store_id')::uuid
      ELSE public.ga_ub_bad_uuid() END ELSE c.store_id END;
  v_store_changed := v_new OR v_store IS DISTINCT FROM c.store_id;
  IF v_store IS NOT NULL THEN
    SELECT * INTO s FROM public.stores WHERE id = v_store;
    IF NOT FOUND THEN RETURN public.ga_rq_err(400, 'STORE_NOT_FOUND', '找不到選擇的門市，請重新整理後再試'); END IF;
    IF v_store_changed AND s.is_active IS NOT TRUE THEN RETURN public.ga_rq_err(400, 'STORE_INACTIVE', '這間門市已停用，不能新選；請改選其他據點'); END IF;
    v_loc := CASE WHEN v_store_changed THEN public.ga_ub_store_label(v_store) ELSE c.location_name END;
  ELSE
    v_loc := CASE WHEN jsonb_exists(p, 'location_name') THEN public.ga_ub_txt(p, 'location_name', 120, '據點') ELSE c.location_name END;
  END IF;
  IF v_loc IS NULL THEN RETURN public.ga_rq_err(400, 'LOCATION_REQUIRED', '請選擇或輸入據點'); END IF;

  v_provider := CASE WHEN jsonb_exists(p, 'provider_name') THEN public.ga_ub_txt(p, 'provider_name', 120, '供應商') ELSE c.provider_name END;
  v_label := CASE WHEN jsonb_exists(p, 'service_label') THEN public.ga_ub_txt(p, 'service_label', 120, '線路名稱') ELSE c.service_label END;
  v_ident := CASE WHEN jsonb_exists(p, 'service_identifier') THEN public.ga_ub_txt(p, 'service_identifier', 200, '服務識別號碼') ELSE c.service_identifier END;
  v_account := CASE WHEN jsonb_exists(p, 'account_number') THEN public.ga_ub_txt(p, 'account_number', 200, '客戶帳號') ELSE c.account_number END;
  v_serial := CASE WHEN jsonb_exists(p, 'equipment_serial') THEN public.ga_ub_txt(p, 'equipment_serial', 200, '設備序號') ELSE c.equipment_serial END;
  IF v_type <> 'INTERNET' THEN v_serial := NULL; END IF;
  IF v_type = 'INTERNET' AND v_ident IS NULL AND v_serial IS NULL THEN RETURN public.ga_rq_err(400, 'IDENT_REQUIRED', '網路費請至少填寫電路編號或設備序號'); END IF;
  IF v_type <> 'INTERNET' AND v_ident IS NULL THEN RETURN public.ga_rq_err(400, 'IDENT_REQUIRED', '請填寫服務識別號碼（水號、電號或電話號碼）'); END IF;
  v_ref := CASE WHEN jsonb_exists(p, 'reference_no') THEN public.ga_ub_txt(p, 'reference_no', 200, '銷帳編號') ELSE c.reference_no END;
  v_notes := CASE WHEN jsonb_exists(p, 'notes') THEN public.ga_ub_txt(p, 'notes', 1000, '備註') ELSE c.notes END;
  v_due := CASE WHEN jsonb_exists(p, 'due_date') THEN public.ga_ub_date(public.ga_ub_txt(p, 'due_date', 10, '繳費期限'), '繳費期限') ELSE c.due_date END;

  -- 繳費日期：新增時可直接填；編輯時可修正日期，但不可用編輯清空（要改回待繳請用「改回待繳」）。日期有變動才檢查範圍。
  v_paid := CASE WHEN jsonb_exists(p, 'paid_at') THEN public.ga_ub_date(public.ga_ub_txt(p, 'paid_at', 10, '繳費日期'), '繳費日期') ELSE c.paid_at END;
  IF NOT v_new AND c.paid_at IS NOT NULL AND v_paid IS NULL THEN RETURN public.ga_rq_err(400, 'USE_UNPAY', '要把已繳帳單改回待繳，請用「改回待繳」（會要求確認）'); END IF;
  IF v_paid IS NOT NULL AND (v_new OR v_paid IS DISTINCT FROM c.paid_at) THEN PERFORM public.ga_ub_check_paid_date(v_paid, v_month); END IF;

  -- 已繳帳單改關鍵欄位：要確認，並回原值。
  IF NOT v_new AND c.paid_at IS NOT NULL THEN
    IF v_amount IS DISTINCT FROM c.amount THEN v_changed := v_changed || to_jsonb('amount'::text); END IF;
    IF v_store IS DISTINCT FROM c.store_id OR v_loc IS DISTINCT FROM c.location_name THEN v_changed := v_changed || to_jsonb('location'::text); END IF;
    IF v_type IS DISTINCT FROM c.expense_type THEN v_changed := v_changed || to_jsonb('expense_type'::text); END IF;
    IF v_month IS DISTINCT FROM c.billing_month THEN v_changed := v_changed || to_jsonb('billing_month'::text); END IF;
    IF v_provider IS DISTINCT FROM c.provider_name THEN v_changed := v_changed || to_jsonb('provider_name'::text); END IF;
    IF v_ident IS DISTINCT FROM c.service_identifier OR v_serial IS DISTINCT FROM c.equipment_serial OR v_account IS DISTINCT FROM c.account_number THEN v_changed := v_changed || to_jsonb('identifier'::text); END IF;
    IF jsonb_array_length(v_changed) > 0 AND NOT COALESCE(p_confirm_paid_change, false) THEN
      RETURN public.ga_rq_err(409, 'PAID_CHANGE_CONFIRM_REQUIRED', '這筆帳單已繳費（' || c.paid_at || '），要修改金額或識別欄位，請確認後再送出', jsonb_build_object('original', public.ga_ub_original(c), 'changed_fields', v_changed));
    END IF;
  END IF;

  -- 重複：同據點、類型、月份、供應商、識別號碼已有一筆（未刪除、排除自己）。
  SELECT * INTO v_dup FROM public.ga_utility_bills d
   WHERE d.deleted_at IS NULL AND (v_new OR d.id <> c.id)
     AND COALESCE(d.store_id::text, '') = COALESCE(v_store::text, '') AND lower(btrim(d.location_name)) = lower(btrim(v_loc))
     AND d.expense_type = v_type AND d.billing_month = v_month AND lower(btrim(COALESCE(d.provider_name, ''))) = lower(btrim(COALESCE(v_provider, '')))
     AND public.ga_ub_ident(d.service_identifier, d.equipment_serial, d.account_number) = public.ga_ub_ident(v_ident, v_serial, v_account)
   LIMIT 1;
  IF FOUND THEN
    RETURN public.ga_rq_err(409, 'DUPLICATE_BILL', '這個據點、費用類型、月份、供應商與識別號碼已經有一筆帳單（金額 ' || public.ga_ub_money_text(v_dup.amount) || ' 元'
      || CASE WHEN v_dup.due_date IS NOT NULL THEN '、繳費期限 ' || v_dup.due_date ELSE '' END || CASE WHEN v_dup.paid_at IS NOT NULL THEN '、已繳費' ELSE '、尚未繳費' END
      || '），請直接編輯那一筆；補收或調整請改原帳單', jsonb_build_object('existing', jsonb_build_object('id', v_dup.id, 'amount', v_dup.amount, 'billing_month', v_dup.billing_month, 'due_date', v_dup.due_date,
        'paid_at', v_dup.paid_at, 'location_name', v_dup.location_name, 'expense_type', v_dup.expense_type)));
  END IF;

  IF v_new THEN
    INSERT INTO public.ga_utility_bills (store_id, location_name, expense_type, billing_month, provider_name, service_label, service_identifier, account_number, equipment_serial, amount, electricity_kwh, due_date, paid_at, reference_no, notes)
    VALUES (v_store, v_loc, v_type, v_month, v_provider, v_label, v_ident, v_account, v_serial, v_amount, v_kwh, v_due, v_paid, v_ref, v_notes) RETURNING * INTO b;
  ELSE
    UPDATE public.ga_utility_bills SET store_id = v_store, location_name = v_loc, expense_type = v_type, billing_month = v_month, provider_name = v_provider, service_label = v_label,
      service_identifier = v_ident, account_number = v_account, equipment_serial = v_serial, amount = v_amount, electricity_kwh = v_kwh, due_date = v_due, paid_at = v_paid, reference_no = v_ref, notes = v_notes
     WHERE id = c.id RETURNING * INTO b;
  END IF;

  v_anomaly := public.ga_ub_anomaly(b.store_id, b.location_name, b.expense_type, public.ga_ub_ident(b.service_identifier, b.equipment_serial, b.account_number), b.billing_month, b.amount, b.id);
  IF (v_anomaly ->> 'warn')::boolean THEN v_warn := jsonb_build_array(v_anomaly); END IF;
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN v_new THEN 201 ELSE 200 END, 'data', public.ga_ub_json(b.id), 'anomaly', v_anomaly, 'warnings', v_warn);
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- store_id 不是 uuid 格式時的 400（放在表達式裡用）。
CREATE OR REPLACE FUNCTION public.ga_ub_bad_uuid() RETURNS uuid LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$ BEGIN PERFORM public.ga_rq_raise(400, 'STORE_FORMAT', '據點格式錯誤'); RETURN NULL; END; $$;

-- 標記已繳：預設台北今天；不可未來、不可早於帳單月份前 1 個月。已繳且日期相同＝冪等成功（不改版本）；已繳且日期不同請用編輯修正日期。
CREATE OR REPLACE FUNCTION public.ga_ws_ub_pay(p_id uuid, p_paid_at text DEFAULT NULL, p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  c public.ga_utility_bills%ROWTYPE;
  v_date date;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_ub_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有標記繳費的權限（需要水電網費管理權限）'); END IF;
  SELECT * INTO c FROM public.ga_utility_bills WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這筆帳單'); END IF;
  IF c.deleted_at IS NOT NULL THEN RETURN public.ga_rq_err(409, 'DELETED', '這筆帳單已被刪除'); END IF;
  v_date := COALESCE(public.ga_ub_date(p_paid_at, '繳費日期'), public.ga_po_today());
  IF c.paid_at IS NOT NULL THEN
    IF c.paid_at = v_date THEN RETURN jsonb_build_object('ok', true, 'status', 200, 'noop', true, 'data', public.ga_ub_json(c.id)); END IF;
    RETURN public.ga_rq_err(409, 'ALREADY_PAID', '這筆帳單已經標記為已繳（' || c.paid_at || '）；要修正繳費日期請用編輯');
  END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再操作'); END IF;
  IF c.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這筆帳單剛被其他人修改，請重新載入後再操作'); END IF;
  PERFORM public.ga_ub_check_paid_date(v_date, c.billing_month);
  UPDATE public.ga_utility_bills SET paid_at = v_date WHERE id = c.id RETURNING * INTO c;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_ub_json(c.id));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 改回待繳：要確認（回原繳費日期），確認後清除日期。本來就未繳＝冪等成功。
CREATE OR REPLACE FUNCTION public.ga_ws_ub_unpay(p_id uuid, p_confirm boolean DEFAULT false, p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  c public.ga_utility_bills%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_ub_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有改回待繳的權限（需要水電網費管理權限）'); END IF;
  SELECT * INTO c FROM public.ga_utility_bills WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這筆帳單'); END IF;
  IF c.deleted_at IS NOT NULL THEN RETURN public.ga_rq_err(409, 'DELETED', '這筆帳單已被刪除'); END IF;
  IF c.paid_at IS NULL THEN RETURN jsonb_build_object('ok', true, 'status', 200, 'noop', true, 'data', public.ga_ub_json(c.id)); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再操作'); END IF;
  IF c.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這筆帳單剛被其他人修改，請重新載入後再操作'); END IF;
  IF NOT COALESCE(p_confirm, false) THEN
    RETURN public.ga_rq_err(409, 'UNPAY_CONFIRM_REQUIRED', '這筆帳單已在 ' || c.paid_at || ' 繳費，確定要改回待繳嗎？改回後會清除繳費日期', jsonb_build_object('paid_at', c.paid_at, 'original', public.ga_ub_original(c)));
  END IF;
  UPDATE public.ga_utility_bills SET paid_at = NULL WHERE id = c.id RETURNING * INTO c;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_ub_json(c.id));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 刪除（軟刪除）：原因必填；已繳帳單要確認並回原值；已刪除＝冪等成功。附件保持原狀（帳單不存在，附件不可讀）。
CREATE OR REPLACE FUNCTION public.ga_ws_ub_delete(p_id uuid, p_reason text, p_confirm_paid_change boolean DEFAULT false, p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  c public.ga_utility_bills%ROWTYPE;
  v_reason text := nullif(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_ub_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有刪除帳單的權限（需要水電網費管理權限）'); END IF;
  SELECT * INTO c FROM public.ga_utility_bills WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這筆帳單'); END IF;
  IF c.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'status', 200, 'noop', true, 'data', public.ga_ub_json(c.id)); END IF;
  IF v_reason IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '請填寫刪除原因'); END IF;
  IF char_length(v_reason) > 500 THEN RETURN public.ga_rq_err(400, 'REASON_TOO_LONG', '刪除原因不可超過 500 個字'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再操作'); END IF;
  IF c.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這筆帳單剛被其他人修改，請重新載入後再操作'); END IF;
  IF c.paid_at IS NOT NULL AND NOT COALESCE(p_confirm_paid_change, false) THEN
    RETURN public.ga_rq_err(409, 'PAID_CHANGE_CONFIRM_REQUIRED', '這筆帳單已繳費（' || c.paid_at || '），確定要刪除嗎？', jsonb_build_object('original', public.ga_ub_original(c), 'changed_fields', jsonb_build_array('delete')));
  END IF;
  UPDATE public.ga_utility_bills SET deleted_at = now(), deleted_by = v_uid, deletion_reason = v_reason WHERE id = c.id RETURNING * INTO c;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_ub_json(c.id));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 報表：mode = month|quarter|year；period = YYYY-MM／1–4／（年報表不用）。每間啟用門市都列（沒帳單算 0）；其他據點名稱正規化（全半形、前後空白、連續空白、大小寫）後分組。
CREATE OR REPLACE FUNCTION public.ga_ws_ub_report(p_mode text, p_year integer, p_period text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_start date;
  v_end date;
  v_q integer;
  v_rows jsonb;
  v_totals jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_ub_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看水電網費的權限'); END IF;
  IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN RETURN public.ga_rq_err(400, 'BAD_YEAR', '請選擇正確年度'); END IF;
  IF p_mode = 'month' THEN
    IF p_period IS NULL OR p_period !~ ('^' || p_year || '-(0[1-9]|1[0-2])$') THEN RETURN public.ga_rq_err(400, 'BAD_PERIOD', '請選擇正確月份'); END IF;
    v_start := (p_period || '-01')::date; v_end := (v_start + interval '1 month')::date;
  ELSIF p_mode = 'quarter' THEN
    IF p_period IS NULL OR p_period !~ '^[1-4]$' THEN RETURN public.ga_rq_err(400, 'BAD_PERIOD', '請選擇正確季度'); END IF;
    v_q := p_period::integer; v_start := make_date(p_year, (v_q - 1) * 3 + 1, 1); v_end := (v_start + interval '3 months')::date;
  ELSIF p_mode = 'year' THEN
    v_start := make_date(p_year, 1, 1); v_end := make_date(p_year + 1, 1, 1);
  ELSE
    RETURN public.ga_rq_err(400, 'BAD_MODE', '請選擇月、季或年報表');
  END IF;
  WITH bills AS (
    SELECT b.store_id, b.location_name, b.expense_type, b.amount, b.created_at, b.id,
           CASE WHEN b.store_id IS NOT NULL THEN 's:' || b.store_id::text
                ELSE 'o:' || lower(btrim(regexp_replace(normalize(COALESCE(nullif(btrim(b.location_name), ''), '未命名據點'), NFKC), '\s+', ' ', 'g'))) END AS gkey
      FROM public.ga_utility_bills b WHERE b.deleted_at IS NULL AND b.billing_month >= v_start AND b.billing_month < v_end
  ), agg AS (
    SELECT gkey, (array_agg(store_id))[1] AS store_id, (array_agg(COALESCE(nullif(btrim(location_name), ''), '未命名據點') ORDER BY created_at, id))[1] AS location_name,
           COALESCE(sum(amount) FILTER (WHERE expense_type = 'WATER'), 0) AS water, COALESCE(sum(amount) FILTER (WHERE expense_type = 'ELECTRICITY'), 0) AS electricity,
           COALESCE(sum(amount) FILTER (WHERE expense_type = 'PHONE'), 0) AS phone, COALESCE(sum(amount) FILTER (WHERE expense_type = 'INTERNET'), 0) AS internet,
           COALESCE(sum(amount), 0) AS total, count(*) AS bill_count
      FROM bills GROUP BY gkey
  ), merged AS (
    SELECT COALESCE(a.store_id, s.id) AS store_id, s.store_code,
           CASE WHEN s.id IS NOT NULL THEN s.store_code || ' ' || COALESCE(nullif(btrim(s.short_name), ''), s.store_name) ELSE a.location_name END AS location_name,
           COALESCE(a.water, 0) AS water, COALESCE(a.electricity, 0) AS electricity, COALESCE(a.phone, 0) AS phone, COALESCE(a.internet, 0) AS internet, COALESCE(a.total, 0) AS total, COALESCE(a.bill_count, 0) AS bill_count
      FROM agg a FULL JOIN (SELECT * FROM public.stores WHERE is_active IS TRUE) s ON a.gkey = 's:' || s.id::text
      WHERE a.gkey IS NOT NULL OR s.id IS NOT NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('store_id', m.store_id, 'store_code', m.store_code, 'location_name', m.location_name, 'WATER', m.water, 'ELECTRICITY', m.electricity, 'PHONE', m.phone, 'INTERNET', m.internet,
           'total', m.total, 'bill_count', m.bill_count) ORDER BY m.total DESC, m.location_name), '[]'::jsonb),
         jsonb_build_object('WATER', COALESCE(sum(m.water), 0), 'ELECTRICITY', COALESCE(sum(m.electricity), 0), 'PHONE', COALESCE(sum(m.phone), 0), 'INTERNET', COALESCE(sum(m.internet), 0), 'total', COALESCE(sum(m.total), 0), 'bill_count', COALESCE(sum(m.bill_count), 0))
    INTO v_rows, v_totals FROM merged m;
  -- 帶 store_id 但門市已停用的帳單：agg 的 store_id 有值、但 s（只含啟用）沒對到，store_code 會是空；補上門市名稱。
  SELECT COALESCE(jsonb_agg(CASE WHEN r ->> 'store_code' IS NULL AND r ->> 'store_id' IS NOT NULL
      THEN r || jsonb_build_object('store_code', (SELECT st.store_code FROM public.stores st WHERE st.id = (r ->> 'store_id')::uuid), 'location_name', COALESCE(public.ga_ub_store_label((r ->> 'store_id')::uuid), r ->> 'location_name')) ELSE r END ORDER BY ord), '[]'::jsonb)
    INTO v_rows FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(r, ord);
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'totals', v_totals, 'start', v_start, 'end', v_end));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- ================================================================ 授權：內部輔助不開放，只開放 ga_ws_ub_*。
REVOKE ALL ON FUNCTION public.ga_ub_can_view(uuid), public.ga_ub_can_manage(uuid), public.ga_ub_is_overdue(date, date, timestamptz), public.ga_ub_pending_stats(),
  public.ga_ub_txt(jsonb, text, integer, text), public.ga_ub_date(text, text), public.ga_ub_month(text), public.ga_ub_num(jsonb, text, text, boolean), public.ga_ub_ident(text, text, text),
  public.ga_ub_money_text(numeric), public.ga_ub_store_label(uuid), public.ga_ub_anomaly(uuid, text, text, text, date, numeric, uuid), public.ga_ub_json(uuid),
  public.ga_ub_original(public.ga_utility_bills), public.ga_ub_check_paid_date(date, date), public.ga_ub_bad_uuid() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_ub_stores(), public.ga_ws_ub_list(jsonb, integer, integer), public.ga_ws_ub_get(uuid), public.ga_ws_ub_anomaly(jsonb, uuid),
  public.ga_ws_ub_save(uuid, jsonb, timestamptz, boolean), public.ga_ws_ub_pay(uuid, text, timestamptz), public.ga_ws_ub_unpay(uuid, boolean, timestamptz),
  public.ga_ws_ub_delete(uuid, text, boolean, timestamptz), public.ga_ws_ub_report(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_ub_stores(), public.ga_ws_ub_list(jsonb, integer, integer), public.ga_ws_ub_get(uuid), public.ga_ws_ub_anomaly(jsonb, uuid),
  public.ga_ws_ub_save(uuid, jsonb, timestamptz, boolean), public.ga_ws_ub_pay(uuid, text, timestamptz), public.ga_ws_ub_unpay(uuid, boolean, timestamptz),
  public.ga_ws_ub_delete(uuid, text, boolean, timestamptz), public.ga_ws_ub_report(text, integer, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- 核對：前兩個數字都應是 0（匿名不可執行對外函式；登入者不可直接執行內部輔助函式）；第三個應是 9（對外函式數）
SELECT count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')) AS anon_can_run,
       count(*) FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE') AND p.proname LIKE 'ga\_ub\_%') AS authenticated_can_run_internal,
       count(*) FILTER (WHERE p.proname LIKE 'ga\_ws\_ub\_%') AS public_functions
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'ga\_ws\_ub\_%' OR p.proname LIKE 'ga\_ub\_%');

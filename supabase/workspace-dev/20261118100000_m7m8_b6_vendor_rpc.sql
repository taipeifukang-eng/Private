-- M7/M8 第 6 批 B（G20 服務分類與區域、G21 廠商資料）：廠商、服務分類、服務區域的讀寫函式。全部 SECURITY DEFINER、固定 search_path、只用 has_permission(auth.uid(), 碼)（照正式區語意：
-- 不看 profiles.role、資料庫沒有管理員後備），回傳 {ok,status,data,error,code,...}；寫入同一交易、全成功或全不變、更新必帶 expected_updated_at（不符回 409 STALE）。
-- 內容：
--   1. 內部輔助（前綴 ga_vd_）：權限判斷、統編標準化與檢查碼、名稱正規化、欄位解析（文字、日期、陣列）、樹狀循環檢查、廠商 JSON（V1：帳務機密 8 欄只有廠商檢視／管理者拿得到，其他人函式根本不回傳）。
--   2. 廠商：ga_ws_vendor_list／get／save／set_status／options（options 給工單與需求單採購評估頁下拉，含聯絡人與電話，統編與付款條件依權限遮蔽，V2）。
--   3. 服務分類 ga_ws_svc_category_list／get／save、服務區域 ga_ws_svc_region_list／get／save（前綴 svc 避免與第 2 批 ga_ws_category_* 撞名；沒有刪除函式：代碼建立後鎖定、上層禁止循環、停用後仍顯示名稱）。
-- 規則：統編標準化（去空白、全形轉半角）、非空時 8 碼數字、唯一（含停用廠商，函式內檢查並以 advisory lock 序列化，暫不建唯一索引）、檢查碼不符只提醒；名稱與別名正規化後相同或互相包含只提醒（可儲存）；
--       新增與編輯不可「新勾選」停用的分類與區域（已勾選者保留）；停用或暫停廠商時若有未結採購單或進行中工單，回 warnings 與筆數（不擋）。
-- 先決：第 4 批 20261112100000（ga_rq_*）、20261112110000（ga_po_can_view、ga_po_like_escape、ga_po_today）、20261118090000（本批欄位與 RLS）、DEV 已有 maintenance_requests.vendor_id。
-- 還原：20261118100000_m7m8_b6_vendor_rpc.rollback.sql。可重複執行。

DO $$
BEGIN
  IF to_regprocedure('public.ga_rq_err(integer,text,text,jsonb)') IS NULL OR to_regprocedure('public.ga_rq_raise(integer,text,text,jsonb)') IS NULL OR to_regprocedure('public.ga_rq_catch(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用第 4 批 20261112100000_m7m8_b4_request_rules（ga_rq_*）';
  END IF;
  IF to_regprocedure('public.ga_po_can_view(uuid)') IS NULL OR to_regprocedure('public.ga_po_like_escape(text)') IS NULL OR to_regprocedure('public.ga_po_today()') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用第 4 批 20261112110000_m7m8_b4_purchase_orders（ga_po_*）';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_vendors' AND column_name = 'updated_by') THEN
    RAISE EXCEPTION 'Missing prerequisite column: ga_vendors.updated_by（請先套用 20261118090000_m7m8_b6_vendor_columns_rls）';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'maintenance_requests' AND column_name = 'vendor_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_purchase_orders' AND column_name = 'vendor_id') THEN
    RAISE EXCEPTION 'Missing prerequisite column: maintenance_requests.vendor_id／ga_purchase_orders.vendor_id';
  END IF;
END $$;

-- ================================================================ 1. 內部輔助
CREATE OR REPLACE FUNCTION public.ga_vd_can_view(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT has_permission(p_uid, 'general_affairs.vendor.view') OR has_permission(p_uid, 'general_affairs.vendor.manage'); $$;

CREATE OR REPLACE FUNCTION public.ga_vd_can_manage(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT has_permission(p_uid, 'general_affairs.vendor.manage'); $$;

-- 廠商下拉可用：廠商檢視／管理、工單更新／管理、採購評估檢視／管理、需求單管理、採購單查看（含核准人）。
CREATE OR REPLACE FUNCTION public.ga_vd_can_options(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT public.ga_vd_can_view(p_uid)
  OR has_permission(p_uid, 'general_affairs.work_order.update') OR has_permission(p_uid, 'general_affairs.work_order.manage')
  OR has_permission(p_uid, 'general_affairs.purchase_review.view') OR has_permission(p_uid, 'general_affairs.purchase_review.manage')
  OR has_permission(p_uid, 'general_affairs.request.manage') OR public.ga_po_can_view(p_uid); $$;

-- 統編標準化：全形轉半角、去掉所有空白。
CREATE OR REPLACE FUNCTION public.ga_vd_norm_tax(p_value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT regexp_replace(normalize(COALESCE(p_value, ''), NFKC), '\s', '', 'g'); $$;

-- 統編檢查碼（財政部規則）：權重 1,2,1,2,1,2,4,1，乘積的十位與個位相加後總和能被 5 整除；第 7 碼是 7 時，總和或總和加 1 能被 5 整除。
CREATE OR REPLACE FUNCTION public.ga_vd_tax_checksum_ok(p_tax text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_w integer[] := ARRAY[1, 2, 1, 2, 1, 2, 4, 1];
  v_sum integer := 0;
  v_prod integer;
  i integer;
BEGIN
  IF p_tax IS NULL OR p_tax !~ '^[0-9]{8}$' THEN RETURN false; END IF;
  FOR i IN 1..8 LOOP
    v_prod := substr(p_tax, i, 1)::integer * v_w[i];
    v_sum := v_sum + (v_prod / 10) + (v_prod % 10);
  END LOOP;
  IF v_sum % 5 = 0 THEN RETURN true; END IF;
  IF substr(p_tax, 7, 1) = '7' AND (v_sum + 1) % 5 = 0 THEN RETURN true; END IF;
  RETURN false;
END;
$$;

-- 名稱正規化（相近比對用）：全半形統一、轉小寫、去空白與常見標點、去公司型態字尾（最多兩層）。
CREATE OR REPLACE FUNCTION public.ga_vd_norm_name(p_value text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v text := lower(normalize(COALESCE(p_value, ''), NFKC));
  i integer;
BEGIN
  v := regexp_replace(v, '[\s\-_.,，。、()（）「」]', '', 'g');
  FOR i IN 1..2 LOOP
    v := regexp_replace(v, '(股份有限公司|有限公司|股份公司|企業有限公司|企業社|企業行|商行)$', '');
  END LOOP;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_vd_date(p_value text, p_label text) RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
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

-- 文字欄位：去前後空白、空字串視為空；長度超過回 400。
CREATE OR REPLACE FUNCTION public.ga_vd_txt(p jsonb, p_key text, p_max integer, p_label text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
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

CREATE OR REPLACE FUNCTION public.ga_vd_txt_arr(p jsonb, p_key text, p_max_items integer, p_max_len integer, p_label text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_out text[] := ARRAY[]::text[];
  v_el jsonb;
  v_t text;
BEGIN
  IF jsonb_typeof(p -> p_key) IS NULL OR jsonb_typeof(p -> p_key) = 'null' THEN RETURN v_out; END IF;
  IF jsonb_typeof(p -> p_key) <> 'array' THEN PERFORM public.ga_rq_raise(400, 'FIELD_TYPE', p_label || '格式錯誤'); END IF;
  FOR v_el IN SELECT value FROM jsonb_array_elements(p -> p_key) LOOP
    IF jsonb_typeof(v_el) <> 'string' THEN PERFORM public.ga_rq_raise(400, 'FIELD_TYPE', p_label || '格式錯誤'); END IF;
    v_t := nullif(btrim(v_el #>> '{}'), '');
    IF v_t IS NULL OR v_t = ANY (v_out) THEN CONTINUE; END IF;
    IF char_length(v_t) > p_max_len THEN PERFORM public.ga_rq_raise(400, 'FIELD_TOO_LONG', p_label || '每一項不可超過 ' || p_max_len || ' 個字'); END IF;
    v_out := v_out || v_t;
  END LOOP;
  IF COALESCE(array_length(v_out, 1), 0) > p_max_items THEN PERFORM public.ga_rq_raise(400, 'FIELD_TOO_MANY', p_label || '最多 ' || p_max_items || ' 項'); END IF;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_vd_uuid_arr(p jsonb, p_key text, p_label text) RETURNS uuid[] LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_out uuid[] := ARRAY[]::uuid[];
  v_el jsonb;
  v_t text;
BEGIN
  IF jsonb_typeof(p -> p_key) IS NULL OR jsonb_typeof(p -> p_key) = 'null' THEN RETURN v_out; END IF;
  IF jsonb_typeof(p -> p_key) <> 'array' THEN PERFORM public.ga_rq_raise(400, 'FIELD_TYPE', p_label || '格式錯誤'); END IF;
  FOR v_el IN SELECT value FROM jsonb_array_elements(p -> p_key) LOOP
    v_t := v_el #>> '{}';
    IF jsonb_typeof(v_el) <> 'string' OR v_t !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN PERFORM public.ga_rq_raise(400, 'FIELD_TYPE', p_label || '格式錯誤'); END IF;
    IF NOT (v_t::uuid = ANY (v_out)) THEN v_out := v_out || v_t::uuid; END IF;
  END LOOP;
  IF COALESCE(array_length(v_out, 1), 0) > 200 THEN PERFORM public.ga_rq_raise(400, 'FIELD_TOO_MANY', p_label || '最多 200 項'); END IF;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_vd_bool(p jsonb, p_key text, p_label text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF jsonb_typeof(p -> p_key) <> 'boolean' THEN PERFORM public.ga_rq_raise(400, 'FIELD_TYPE', p_label || '要是「是」或「否」'); END IF;
  RETURN (p ->> p_key)::boolean;
END;
$$;

-- 排序數字：整數、絕對值不超過 99999。
CREATE OR REPLACE FUNCTION public.ga_vd_int(p jsonb, p_key text, p_label text) RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF jsonb_typeof(p -> p_key) <> 'number' OR (p ->> p_key) !~ '^-?[0-9]{1,5}$' THEN PERFORM public.ga_rq_raise(400, 'FIELD_TYPE', p_label || '要是整數'); END IF;
  RETURN (p ->> p_key)::integer;
END;
$$;

-- 合約到期待辦條件（V4、V9 #3）：合作中、需簽合約、有到期日，到期日在台北今日 +30 天內（含已過期）。徽章與列表篩選共用。
CREATE OR REPLACE FUNCTION public.ga_vd_contract_due(p_status text, p_required boolean, p_end date) RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT p_status = 'active' AND COALESCE(p_required, false) AND p_end IS NOT NULL AND p_end <= public.ga_po_today() + 30; $$;

-- 樹狀循環檢查：把 p_id 的上層設為 p_parent，若 p_parent 的祖先鏈（含自己）碰到 p_id 就是循環。
CREATE OR REPLACE FUNCTION public.ga_vd_tree_cycle(p_table text, p_id uuid, p_parent uuid) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_cyc boolean;
BEGIN
  IF p_table NOT IN ('ga_service_categories', 'ga_service_regions') THEN RAISE EXCEPTION 'invalid table'; END IF;
  EXECUTE format('WITH RECURSIVE a AS (SELECT id, parent_id FROM public.%I WHERE id = $1 UNION SELECT t.id, t.parent_id FROM public.%I t JOIN a ON t.id = a.parent_id) SELECT EXISTS (SELECT 1 FROM a WHERE id = $2)', p_table, p_table)
    INTO v_cyc USING p_parent, p_id;
  RETURN COALESCE(v_cyc, false);
END;
$$;

-- 廠商 JSON。p_full = true（廠商檢視／管理者）：全部欄位，含帳務機密 8 欄（tax_id、billing_title、billing_address、invoice_type、payment_terms、payment_methods、accounting_notes、total_amount）；
-- p_full = false：只有名稱、別名、類型、狀態、分類、區域、聯絡人（V1：欄位根本不回傳，不是回傳後再隱藏）。
CREATE OR REPLACE FUNCTION public.ga_vd_json(v public.ga_vendors, p_full boolean) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_base jsonb;
BEGIN
  v_base := jsonb_build_object('id', v.id, 'name', v.name, 'alias', v.alias, 'vendor_type', v.vendor_type, 'status', v.status,
    'service_category_ids', to_jsonb(v.service_category_ids), 'service_region_ids', to_jsonb(v.service_region_ids),
    'contact_name', v.contact_name, 'contact_phone', v.contact_phone, 'line_id', v.line_id, 'email', v.email, 'updated_at', v.updated_at);
  IF NOT p_full THEN RETURN v_base; END IF;
  RETURN v_base || jsonb_build_object(
    'founded_date', v.founded_date, 'phone', v.phone, 'fax', v.fax, 'website', v.website, 'city', v.city, 'district', v.district, 'address', v.address,
    'service_city', v.service_city, 'service_district', v.service_district, 'service_address', v.service_address, 'same_service_address', v.same_service_address,
    'description', v.description, 'tags', to_jsonb(v.tags), 'brands', to_jsonb(v.brands), 'equipment_types', to_jsonb(v.equipment_types),
    'service_capability_note', v.service_capability_note, 'cooperation_start_date', v.cooperation_start_date, 'contract_end_date', v.contract_end_date,
    'contract_required', v.contract_required, 'preferred_vendor', v.preferred_vendor, 'cooperation_notes', v.cooperation_notes, 'attachment_names', to_jsonb(v.attachment_names),
    'contract_due', public.ga_vd_contract_due(v.status, v.contract_required, v.contract_end_date), 'created_at', v.created_at, 'updated_by', v.updated_by,
    'updated_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = v.updated_by),
    -- 帳務機密 8 欄
    'tax_id', v.tax_id, 'billing_title', v.billing_title, 'billing_address', v.billing_address, 'invoice_type', v.invoice_type, 'payment_terms', v.payment_terms,
    'payment_methods', to_jsonb(v.payment_methods), 'accounting_notes', v.accounting_notes, 'total_amount', v.total_amount,
    'service_categories', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status) ORDER BY c.sort_order, c.name) FROM public.ga_service_categories c WHERE c.id = ANY (v.service_category_ids)), '[]'::jsonb),
    'service_regions', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'status', r.status, 'region_type', r.region_type) ORDER BY r.sort_order, r.name) FROM public.ga_service_regions r WHERE r.id = ANY (v.service_region_ids)), '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.ga_vd_can_view(uuid), public.ga_vd_can_manage(uuid), public.ga_vd_can_options(uuid), public.ga_vd_norm_tax(text), public.ga_vd_tax_checksum_ok(text), public.ga_vd_norm_name(text),
  public.ga_vd_date(text, text), public.ga_vd_txt(jsonb, text, integer, text), public.ga_vd_txt_arr(jsonb, text, integer, integer, text), public.ga_vd_uuid_arr(jsonb, text, text),
  public.ga_vd_bool(jsonb, text, text), public.ga_vd_int(jsonb, text, text), public.ga_vd_contract_due(text, boolean, date), public.ga_vd_tree_cycle(text, uuid, uuid),
  public.ga_vd_json(public.ga_vendors, boolean) FROM PUBLIC, anon, authenticated;

-- ================================================================ 2. 廠商
-- 列表：伺服端搜尋（跳脫萬用字元）、篩選、分頁、精確筆數。filters：search、status、vendor_type、category_id、region_id、contract_due（true 時用與徽章相同的條件）。
CREATE OR REPLACE FUNCTION public.ga_ws_vendor_list(p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  v_q text := public.ga_vd_txt(v_f, 'search', 100, '搜尋');
  v_pat text;
  v_status text := public.ga_vd_txt(v_f, 'status', 20, '狀態');
  v_type text := public.ga_vd_txt(v_f, 'vendor_type', 20, '類型');
  v_cat uuid := CASE WHEN v_f ->> 'category_id' ~* '^[0-9a-f-]{36}$' THEN (v_f ->> 'category_id')::uuid END;
  v_reg uuid := CASE WHEN v_f ->> 'region_id' ~* '^[0-9a-f-]{36}$' THEN (v_f ->> 'region_id')::uuid END;
  v_due boolean := COALESCE(v_f ->> 'contract_due', '') IN ('true', '1');
  v_total integer;
  v_rows jsonb;
  v_stats jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_vd_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看廠商資料的權限'); END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('active', 'paused', 'inactive') THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '狀態篩選值錯誤'); END IF;
  IF v_type IS NOT NULL AND v_type NOT IN ('company', 'studio', 'personal') THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '類型篩選值錯誤'); END IF;
  IF v_q IS NOT NULL THEN v_pat := '%' || public.ga_po_like_escape(v_q) || '%'; END IF;
  SELECT count(*)::integer INTO v_total FROM public.ga_vendors v
   WHERE (v_status IS NULL OR v.status = v_status) AND (v_type IS NULL OR v.vendor_type = v_type)
     AND (v_cat IS NULL OR v_cat = ANY (v.service_category_ids)) AND (v_reg IS NULL OR v_reg = ANY (v.service_region_ids))
     AND (NOT v_due OR public.ga_vd_contract_due(v.status, v.contract_required, v.contract_end_date))
     AND (v_pat IS NULL OR v.name ILIKE v_pat ESCAPE '\' OR COALESCE(v.alias, '') ILIKE v_pat ESCAPE '\' OR COALESCE(v.contact_name, '') ILIKE v_pat ESCAPE '\'
          OR COALESCE(v.contact_phone, '') ILIKE v_pat ESCAPE '\' OR COALESCE(v.phone, '') ILIKE v_pat ESCAPE '\' OR COALESCE(v.email, '') ILIKE v_pat ESCAPE '\'
          OR COALESCE(v.tax_id, '') ILIKE v_pat ESCAPE '\' OR array_to_string(v.tags, ' ') ILIKE v_pat ESCAPE '\');
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.ord_name, x.ord_id), '[]'::jsonb) INTO v_rows
    FROM (SELECT jsonb_build_object('id', v.id, 'name', v.name, 'alias', v.alias, 'vendor_type', v.vendor_type, 'status', v.status, 'tax_id', v.tax_id,
                 'contact_name', v.contact_name, 'contact_phone', v.contact_phone, 'phone', v.phone, 'email', v.email, 'tags', to_jsonb(v.tags),
                 'service_category_ids', to_jsonb(v.service_category_ids), 'service_region_ids', to_jsonb(v.service_region_ids),
                 'contract_required', v.contract_required, 'contract_end_date', v.contract_end_date,
                 'contract_due', public.ga_vd_contract_due(v.status, v.contract_required, v.contract_end_date), 'updated_at', v.updated_at) AS j, v.name AS ord_name, v.id AS ord_id
            FROM public.ga_vendors v
           WHERE (v_status IS NULL OR v.status = v_status) AND (v_type IS NULL OR v.vendor_type = v_type)
             AND (v_cat IS NULL OR v_cat = ANY (v.service_category_ids)) AND (v_reg IS NULL OR v_reg = ANY (v.service_region_ids))
             AND (NOT v_due OR public.ga_vd_contract_due(v.status, v.contract_required, v.contract_end_date))
             AND (v_pat IS NULL OR v.name ILIKE v_pat ESCAPE '\' OR COALESCE(v.alias, '') ILIKE v_pat ESCAPE '\' OR COALESCE(v.contact_name, '') ILIKE v_pat ESCAPE '\'
                  OR COALESCE(v.contact_phone, '') ILIKE v_pat ESCAPE '\' OR COALESCE(v.phone, '') ILIKE v_pat ESCAPE '\' OR COALESCE(v.email, '') ILIKE v_pat ESCAPE '\'
                  OR COALESCE(v.tax_id, '') ILIKE v_pat ESCAPE '\' OR array_to_string(v.tags, ' ') ILIKE v_pat ESCAPE '\')
           ORDER BY v.name, v.id LIMIT v_size OFFSET (v_page - 1) * v_size) x;
  SELECT jsonb_build_object('total', count(*), 'active', count(*) FILTER (WHERE status = 'active'), 'paused', count(*) FILTER (WHERE status = 'paused'), 'inactive', count(*) FILTER (WHERE status = 'inactive'),
           'contract_due', count(*) FILTER (WHERE public.ga_vd_contract_due(status, contract_required, contract_end_date)))
    INTO v_stats FROM public.ga_vendors;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size, 'stats', v_stats));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ws_vendor_get(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v public.ga_vendors%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_vd_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看廠商資料的權限'); END IF;
  SELECT * INTO v FROM public.ga_vendors WHERE id = p_id;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這個廠商'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_vd_json(v, true), 'can_manage', public.ga_vd_can_manage(v_uid));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 新增（p_id 為 NULL）與編輯（部分欄位更新：payload 有給的欄位才改；更新必帶 expected_updated_at）。狀態不在這裡改（用 ga_ws_vendor_set_status；新增時可指定，預設合作中）。
CREATE OR REPLACE FUNCTION public.ga_ws_vendor_save(p_id uuid, p_payload jsonb, p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new boolean := (p_id IS NULL);
  v public.ga_vendors%ROWTYPE;
  v_old public.ga_vendors%ROWTYPE;
  v_ids uuid[];
  v_x uuid;
  v_s text;
  v_nm text;
  v_warn jsonb := '[]'::jsonb;
  v_dup record;
  v_sim jsonb;
  v_tax_changed boolean := false;
  v_names text[];
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_vd_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有新增或編輯廠商的權限（需要廠商管理權限）'); END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;

  IF v_new THEN
    v.id := gen_random_uuid(); v.vendor_type := 'company'; v.status := 'active'; v.same_service_address := true;
    v.tags := '{}'; v.brands := '{}'; v.equipment_types := '{}'; v.service_category_ids := '{}'; v.service_region_ids := '{}'; v.payment_methods := '{}'; v.attachment_names := '{}';
    v.rating := 0; v.review_count := 0; v.work_order_count := 0; v.monthly_order_count := 0; v.total_amount := 0; v.avg_days := 0;
    v.contract_required := false; v.preferred_vendor := false;
    v_old := v;
  ELSE
    SELECT * INTO v FROM public.ga_vendors WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這個廠商'); END IF;
    IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再儲存'); END IF;
    IF v.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這個廠商剛被其他人修改，請重新載入後再儲存'); END IF;
    v_old := v;
  END IF;

  -- 基本
  IF p_payload ? 'name' THEN v.name := public.ga_vd_txt(p_payload, 'name', 100, '廠商名稱'); END IF;
  IF v.name IS NULL THEN RETURN public.ga_rq_err(400, 'NAME_REQUIRED', '請填寫廠商名稱'); END IF;
  IF p_payload ? 'alias' THEN v.alias := public.ga_vd_txt(p_payload, 'alias', 100, '別名'); END IF;
  IF p_payload ? 'vendor_type' THEN
    v.vendor_type := public.ga_vd_txt(p_payload, 'vendor_type', 20, '廠商類型');
    IF v.vendor_type IS NULL OR v.vendor_type NOT IN ('company', 'studio', 'personal') THEN RETURN public.ga_rq_err(400, 'VENDOR_TYPE', '廠商類型只能是公司、工作室或個人'); END IF;
  END IF;
  IF v_new AND p_payload ? 'status' THEN
    v_status := public.ga_vd_txt(p_payload, 'status', 20, '狀態');
    IF v_status IS NULL OR v_status NOT IN ('active', 'paused', 'inactive') THEN RETURN public.ga_rq_err(400, 'STATUS', '狀態只能是合作中、暫停或停用'); END IF;
    v.status := v_status;
  END IF;
  IF p_payload ? 'tax_id' THEN v.tax_id := nullif(public.ga_vd_norm_tax(public.ga_vd_txt(p_payload, 'tax_id', 40, '統一編號')), ''); END IF;
  IF p_payload ? 'founded_date' THEN v.founded_date := public.ga_vd_date(p_payload ->> 'founded_date', '成立日期'); END IF;
  IF p_payload ? 'phone' THEN v.phone := public.ga_vd_txt(p_payload, 'phone', 40, '公司電話'); END IF;
  IF p_payload ? 'fax' THEN v.fax := public.ga_vd_txt(p_payload, 'fax', 40, '傳真'); END IF;
  IF p_payload ? 'website' THEN v.website := public.ga_vd_txt(p_payload, 'website', 200, '網站'); END IF;
  IF p_payload ? 'city' THEN v.city := public.ga_vd_txt(p_payload, 'city', 40, '縣市'); END IF;
  IF p_payload ? 'district' THEN v.district := public.ga_vd_txt(p_payload, 'district', 40, '行政區'); END IF;
  IF p_payload ? 'address' THEN v.address := public.ga_vd_txt(p_payload, 'address', 200, '地址'); END IF;
  IF p_payload ? 'service_city' THEN v.service_city := public.ga_vd_txt(p_payload, 'service_city', 40, '服務縣市'); END IF;
  IF p_payload ? 'service_district' THEN v.service_district := public.ga_vd_txt(p_payload, 'service_district', 40, '服務行政區'); END IF;
  IF p_payload ? 'service_address' THEN v.service_address := public.ga_vd_txt(p_payload, 'service_address', 200, '服務地址'); END IF;
  IF p_payload ? 'same_service_address' THEN v.same_service_address := public.ga_vd_bool(p_payload, 'same_service_address', '服務地址同公司地址'); END IF;
  -- 聯絡
  IF p_payload ? 'contact_name' THEN v.contact_name := public.ga_vd_txt(p_payload, 'contact_name', 60, '聯絡人'); END IF;
  IF p_payload ? 'contact_phone' THEN v.contact_phone := public.ga_vd_txt(p_payload, 'contact_phone', 40, '聯絡電話'); END IF;
  IF p_payload ? 'line_id' THEN v.line_id := public.ga_vd_txt(p_payload, 'line_id', 60, 'LINE'); END IF;
  IF p_payload ? 'email' THEN
    v.email := public.ga_vd_txt(p_payload, 'email', 120, 'Email');
    IF v.email IS NOT NULL AND v.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RETURN public.ga_rq_err(400, 'EMAIL_FORMAT', 'Email 格式不正確'); END IF;
  END IF;
  -- 服務
  IF p_payload ? 'description' THEN v.description := public.ga_vd_txt(p_payload, 'description', 1000, '簡介'); END IF;
  IF p_payload ? 'tags' THEN v.tags := public.ga_vd_txt_arr(p_payload, 'tags', 30, 30, '標籤'); END IF;
  IF p_payload ? 'brands' THEN v.brands := public.ga_vd_txt_arr(p_payload, 'brands', 50, 50, '品牌'); END IF;
  IF p_payload ? 'equipment_types' THEN v.equipment_types := public.ga_vd_txt_arr(p_payload, 'equipment_types', 50, 50, '設備類型'); END IF;
  IF p_payload ? 'service_capability_note' THEN v.service_capability_note := public.ga_vd_txt(p_payload, 'service_capability_note', 1000, '服務能力說明'); END IF;
  IF p_payload ? 'service_category_ids' THEN
    v_ids := public.ga_vd_uuid_arr(p_payload, 'service_category_ids', '服務分類');
    FOREACH v_x IN ARRAY v_ids LOOP
      IF v_x = ANY (v.service_category_ids) THEN CONTINUE; END IF;
      SELECT status, name INTO v_s, v_nm FROM public.ga_service_categories WHERE id = v_x;
      IF NOT FOUND THEN RETURN public.ga_rq_err(400, 'CATEGORY_NOT_FOUND', '找不到勾選的服務分類，請重新整理後再試'); END IF;
      IF v_s <> 'active' THEN RETURN public.ga_rq_err(400, 'CATEGORY_INACTIVE', '服務分類「' || v_nm || '」已停用，不能新勾選'); END IF;
    END LOOP;
    v.service_category_ids := v_ids;
  END IF;
  IF p_payload ? 'service_region_ids' THEN
    v_ids := public.ga_vd_uuid_arr(p_payload, 'service_region_ids', '服務區域');
    FOREACH v_x IN ARRAY v_ids LOOP
      IF v_x = ANY (v.service_region_ids) THEN CONTINUE; END IF;
      SELECT status, name INTO v_s, v_nm FROM public.ga_service_regions WHERE id = v_x;
      IF NOT FOUND THEN RETURN public.ga_rq_err(400, 'REGION_NOT_FOUND', '找不到勾選的服務區域，請重新整理後再試'); END IF;
      IF v_s <> 'active' THEN RETURN public.ga_rq_err(400, 'REGION_INACTIVE', '服務區域「' || v_nm || '」已停用，不能新勾選'); END IF;
    END LOOP;
    v.service_region_ids := v_ids;
  END IF;
  -- 合作與帳務
  IF p_payload ? 'billing_title' THEN v.billing_title := public.ga_vd_txt(p_payload, 'billing_title', 100, '發票抬頭'); END IF;
  IF p_payload ? 'billing_address' THEN v.billing_address := public.ga_vd_txt(p_payload, 'billing_address', 200, '發票地址'); END IF;
  IF p_payload ? 'invoice_type' THEN v.invoice_type := public.ga_vd_txt(p_payload, 'invoice_type', 40, '發票類型'); END IF;
  IF p_payload ? 'payment_terms' THEN v.payment_terms := public.ga_vd_txt(p_payload, 'payment_terms', 100, '付款條件'); END IF;
  IF p_payload ? 'payment_methods' THEN v.payment_methods := public.ga_vd_txt_arr(p_payload, 'payment_methods', 10, 30, '付款方式'); END IF;
  IF p_payload ? 'accounting_notes' THEN v.accounting_notes := public.ga_vd_txt(p_payload, 'accounting_notes', 1000, '帳務備註'); END IF;
  IF p_payload ? 'cooperation_start_date' THEN v.cooperation_start_date := public.ga_vd_date(p_payload ->> 'cooperation_start_date', '合作開始日'); END IF;
  IF p_payload ? 'contract_end_date' THEN v.contract_end_date := public.ga_vd_date(p_payload ->> 'contract_end_date', '合約到期日'); END IF;
  IF p_payload ? 'contract_required' THEN v.contract_required := public.ga_vd_bool(p_payload, 'contract_required', '需簽合約'); END IF;
  IF p_payload ? 'preferred_vendor' THEN v.preferred_vendor := public.ga_vd_bool(p_payload, 'preferred_vendor', '優先廠商'); END IF;
  IF p_payload ? 'cooperation_notes' THEN v.cooperation_notes := public.ga_vd_txt(p_payload, 'cooperation_notes', 1000, '合作備註'); END IF;
  IF v.cooperation_start_date IS NOT NULL AND v.contract_end_date IS NOT NULL AND v.contract_end_date < v.cooperation_start_date THEN
    RETURN public.ga_rq_err(400, 'CONTRACT_DATES', '合約到期日不能早於合作開始日');
  END IF;

  -- 統編：變動時才檢查格式與唯一（避免舊資料的歷史重複擋住不相關的編輯）。新增公司與工作室需要統編。
  v_tax_changed := v_new OR v.tax_id IS DISTINCT FROM v_old.tax_id;
  IF v_new AND v.tax_id IS NULL AND v.vendor_type <> 'personal' THEN RETURN public.ga_rq_err(400, 'TAX_ID_REQUIRED', '公司與工作室請填寫 8 碼統一編號（個人可留空）'); END IF;
  IF v.tax_id IS NOT NULL AND v_tax_changed THEN
    IF v.tax_id !~ '^[0-9]{8}$' THEN RETURN public.ga_rq_err(400, 'TAX_ID_FORMAT', '統一編號要是 8 碼數字'); END IF;
    PERFORM pg_advisory_xact_lock(hashtext('ga_vendor_tax:' || v.tax_id));
    SELECT d.id, d.name, d.status INTO v_dup FROM public.ga_vendors d WHERE d.id <> v.id AND public.ga_vd_norm_tax(d.tax_id) = v.tax_id ORDER BY d.created_at LIMIT 1;
    IF FOUND THEN
      RETURN public.ga_rq_err(409, 'TAX_ID_DUPLICATE', '統一編號 ' || v.tax_id || ' 已經登錄在「' || v_dup.name || '」' || CASE WHEN v_dup.status <> 'active' THEN '（' || CASE v_dup.status WHEN 'paused' THEN '暫停' ELSE '停用' END || '）' ELSE '' END || '，同一個統編不能重複建立',
        jsonb_build_object('existing', jsonb_build_object('id', v_dup.id, 'name', v_dup.name, 'status', v_dup.status)));
    END IF;
    IF NOT public.ga_vd_tax_checksum_ok(v.tax_id) THEN
      v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'TAX_CHECKSUM', 'message', '統一編號 ' || v.tax_id || ' 的檢查碼不符，請確認是否輸入正確（仍可儲存）'));
    END IF;
  END IF;

  -- 名稱相近提醒（新增、或名稱與別名有變動時）：正規化後相同或互相包含。
  IF v_new OR v.name IS DISTINCT FROM v_old.name OR v.alias IS DISTINCT FROM v_old.alias THEN
    v_names := ARRAY(SELECT n FROM unnest(ARRAY[public.ga_vd_norm_name(v.name), public.ga_vd_norm_name(v.alias)]) n WHERE n <> '');
    IF COALESCE(array_length(v_names, 1), 0) > 0 THEN
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status) ORDER BY c.name), '[]'::jsonb) INTO v_sim
        FROM public.ga_vendors c
       WHERE c.id <> v.id
         AND EXISTS (SELECT 1 FROM unnest(v_names) a, unnest(ARRAY[public.ga_vd_norm_name(c.name), public.ga_vd_norm_name(c.alias)]) b
                      WHERE a <> '' AND b <> '' AND (a = b OR (char_length(a) >= 2 AND char_length(b) >= 2 AND (position(a IN b) > 0 OR position(b IN a) > 0))));
      IF jsonb_array_length(v_sim) > 0 THEN
        v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'NAME_SIMILAR', 'message', '已經有名稱相近的廠商，請確認是否重複建立（仍可儲存）', 'vendors', v_sim));
      END IF;
    END IF;
  END IF;

  IF v_new THEN
    INSERT INTO public.ga_vendors (id, name, vendor_type, tax_id, alias, founded_date, status, phone, fax, website, city, district, address, service_city, service_district, service_address, same_service_address,
      contact_name, contact_phone, line_id, email, description, tags, brands, equipment_types, service_category_ids, service_region_ids, service_capability_note, billing_title, billing_address,
      invoice_type, payment_terms, payment_methods, accounting_notes, cooperation_start_date, contract_end_date, contract_required, preferred_vendor, cooperation_notes, attachment_names, updated_by)
    VALUES (v.id, v.name, v.vendor_type, v.tax_id, v.alias, v.founded_date, v.status, v.phone, v.fax, v.website, v.city, v.district, v.address, v.service_city, v.service_district, v.service_address, v.same_service_address,
      v.contact_name, v.contact_phone, v.line_id, v.email, v.description, v.tags, v.brands, v.equipment_types, v.service_category_ids, v.service_region_ids, v.service_capability_note, v.billing_title, v.billing_address,
      v.invoice_type, v.payment_terms, v.payment_methods, v.accounting_notes, v.cooperation_start_date, v.contract_end_date, v.contract_required, v.preferred_vendor, v.cooperation_notes, v.attachment_names, v_uid)
    RETURNING * INTO v;
  ELSE
    UPDATE public.ga_vendors SET name = v.name, vendor_type = v.vendor_type, tax_id = v.tax_id, alias = v.alias, founded_date = v.founded_date, phone = v.phone, fax = v.fax, website = v.website,
      city = v.city, district = v.district, address = v.address, service_city = v.service_city, service_district = v.service_district, service_address = v.service_address, same_service_address = v.same_service_address,
      contact_name = v.contact_name, contact_phone = v.contact_phone, line_id = v.line_id, email = v.email, description = v.description, tags = v.tags, brands = v.brands, equipment_types = v.equipment_types,
      service_category_ids = v.service_category_ids, service_region_ids = v.service_region_ids, service_capability_note = v.service_capability_note, billing_title = v.billing_title, billing_address = v.billing_address,
      invoice_type = v.invoice_type, payment_terms = v.payment_terms, payment_methods = v.payment_methods, accounting_notes = v.accounting_notes, cooperation_start_date = v.cooperation_start_date,
      contract_end_date = v.contract_end_date, contract_required = v.contract_required, preferred_vendor = v.preferred_vendor, cooperation_notes = v.cooperation_notes,
      updated_at = now(), updated_by = v_uid
     WHERE id = v.id RETURNING * INTO v;
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN v_new THEN 201 ELSE 200 END, 'data', public.ga_vd_json(v, true), 'warnings', v_warn);
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 狀態（合作中、暫停、停用）：沒有刪除。改成暫停或停用時，若還有未結採購單（草稿、待核准、已核准、已下訂、部分到貨）或進行中工單，回 warnings 與筆數（只提醒不擋，V3）。
CREATE OR REPLACE FUNCTION public.ga_ws_vendor_set_status(p_id uuid, p_status text, p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v public.ga_vendors%ROWTYPE;
  v_po integer := 0;
  v_wo integer := 0;
  v_warn jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_vd_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有變更廠商狀態的權限（需要廠商管理權限）'); END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'paused', 'inactive') THEN RETURN public.ga_rq_err(400, 'STATUS', '狀態只能是合作中、暫停或停用'); END IF;
  SELECT * INTO v FROM public.ga_vendors WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這個廠商'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再操作'); END IF;
  IF v.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這個廠商剛被其他人修改，請重新載入後再操作'); END IF;
  IF v.status <> p_status THEN
    UPDATE public.ga_vendors SET status = p_status, updated_at = now(), updated_by = v_uid WHERE id = v.id RETURNING * INTO v;
  END IF;
  IF p_status <> 'active' THEN
    SELECT count(*)::integer INTO v_po FROM public.ga_purchase_orders o WHERE o.vendor_id = v.id AND o.status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED');
    SELECT count(*)::integer INTO v_wo FROM public.maintenance_requests m WHERE m.vendor_id = v.id AND m.status <> 'COMPLETED';
    IF v_po + v_wo > 0 THEN
      v_warn := jsonb_build_array(jsonb_build_object('code', 'OPEN_DOCS', 'open_purchase_orders', v_po, 'open_work_orders', v_wo,
        'message', '這個廠商還有 ' || v_po || ' 張未結採購單、' || v_wo || ' 張進行中工單；已下訂的採購單仍可收貨結案，新單不能再選這個廠商'));
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_vd_json(v, true), 'warnings', v_warn);
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 下拉（工單、需求單採購評估頁）：預設只列合作中；p_include_ids 讓「目前已選、但已暫停或停用」的廠商仍能顯示（畫面加「（已停用）」「（暫停）」）。
-- 回傳 id、名稱、別名、類型、狀態、聯絡人、電話（V2）；統編與付款條件只在呼叫者有廠商檢視／管理權限時回（其他人不回這兩個欄位）。
CREATE OR REPLACE FUNCTION public.ga_ws_vendor_options(p_q text DEFAULT NULL, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_include_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_q text := nullif(btrim(COALESCE(p_q, '')), '');
  v_pat text;
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);
  v_inc uuid[] := COALESCE(p_include_ids, ARRAY[]::uuid[]);
  v_billing boolean;
  v_total integer;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_vd_can_options(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看廠商選項的權限'); END IF;
  IF COALESCE(array_length(v_inc, 1), 0) > 100 THEN RETURN public.ga_rq_err(400, 'TOO_MANY', '一次最多帶 100 個已選廠商'); END IF;
  v_billing := public.ga_vd_can_view(v_uid);
  IF v_q IS NOT NULL THEN v_pat := '%' || public.ga_po_like_escape(left(v_q, 100)) || '%'; END IF;
  SELECT count(*)::integer INTO v_total FROM public.ga_vendors v
   WHERE (v.status = 'active' OR v.id = ANY (v_inc)) AND (v_pat IS NULL OR v.name ILIKE v_pat ESCAPE '\' OR COALESCE(v.alias, '') ILIKE v_pat ESCAPE '\');
  SELECT COALESCE(jsonb_agg(CASE WHEN v_billing THEN x.j || jsonb_build_object('tax_id', x.tax_id, 'payment_terms', x.payment_terms) ELSE x.j END ORDER BY x.name, x.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT jsonb_build_object('id', v.id, 'name', v.name, 'alias', v.alias, 'vendor_type', v.vendor_type, 'status', v.status, 'contact_name', v.contact_name, 'contact_phone', v.contact_phone) AS j,
                 v.name, v.id, v.tax_id, v.payment_terms
            FROM public.ga_vendors v
           WHERE (v.status = 'active' OR v.id = ANY (v_inc)) AND (v_pat IS NULL OR v.name ILIKE v_pat ESCAPE '\' OR COALESCE(v.alias, '') ILIKE v_pat ESCAPE '\')
           ORDER BY v.name, v.id LIMIT v_size OFFSET (v_page - 1) * v_size) x;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size, 'billing_visible', v_billing);
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- ================================================================ 3. 服務分類
CREATE OR REPLACE FUNCTION public.ga_ws_svc_category_list(p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_manage boolean;
  v_read boolean;
  v_vendor boolean;
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);
  v_q text := public.ga_vd_txt(v_f, 'search', 100, '搜尋');
  v_pat text;
  v_status text := public.ga_vd_txt(v_f, 'status', 20, '狀態');
  v_parent uuid := CASE WHEN v_f ->> 'parent_id' ~* '^[0-9a-f-]{36}$' THEN (v_f ->> 'parent_id')::uuid END;
  v_options boolean := COALESCE(v_f ->> 'options', '') IN ('true', '1');
  v_total integer;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  v_manage := has_permission(v_uid, 'general_affairs.service_category.manage');
  v_read := v_manage OR has_permission(v_uid, 'general_affairs.service_category.view');
  v_vendor := public.ga_vd_can_view(v_uid);
  IF NOT v_read AND NOT v_vendor THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看服務分類的權限'); END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('active', 'inactive') THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '狀態篩選值錯誤'); END IF;
  -- 只有廠商權限（沒有分類權限）者：唯讀、只列啟用的分類（供廠商表單下拉）。
  IF NOT v_read THEN v_status := 'active'; END IF;
  IF v_q IS NOT NULL THEN v_pat := '%' || public.ga_po_like_escape(v_q) || '%'; END IF;
  IF v_options THEN v_size := 2000; v_page := 1; END IF;
  SELECT count(*)::integer INTO v_total FROM public.ga_service_categories c
   WHERE (v_status IS NULL OR c.status = v_status) AND (v_parent IS NULL OR c.parent_id = v_parent)
     AND (v_pat IS NULL OR c.name ILIKE v_pat ESCAPE '\' OR c.code ILIKE v_pat ESCAPE '\' OR COALESCE(c.description, '') ILIKE v_pat ESCAPE '\');
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.so, x.nm, x.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT jsonb_build_object('id', c.id, 'name', c.name, 'code', c.code, 'parent_id', c.parent_id, 'parent_name', (SELECT p.name FROM public.ga_service_categories p WHERE p.id = c.parent_id),
                 'description', c.description, 'icon_key', c.icon_key, 'status', c.status, 'sort_order', c.sort_order, 'common_items', to_jsonb(c.common_items), 'updated_at', c.updated_at,
                 'child_count', (SELECT count(*) FROM public.ga_service_categories k WHERE k.parent_id = c.id),
                 'vendor_count', CASE WHEN v_vendor THEN (SELECT count(*) FROM public.ga_vendors v WHERE c.id = ANY (v.service_category_ids)) END) AS j, c.sort_order AS so, c.name AS nm, c.id
            FROM public.ga_service_categories c
           WHERE (v_status IS NULL OR c.status = v_status) AND (v_parent IS NULL OR c.parent_id = v_parent)
             AND (v_pat IS NULL OR c.name ILIKE v_pat ESCAPE '\' OR c.code ILIKE v_pat ESCAPE '\' OR COALESCE(c.description, '') ILIKE v_pat ESCAPE '\')
           ORDER BY c.sort_order, c.name, c.id LIMIT v_size OFFSET (v_page - 1) * v_size) x;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size, 'can_manage', v_manage));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ws_svc_category_get(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_manage boolean;
  c public.ga_service_categories%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  v_manage := has_permission(v_uid, 'general_affairs.service_category.manage');
  IF NOT v_manage AND NOT has_permission(v_uid, 'general_affairs.service_category.view') AND NOT public.ga_vd_can_view(v_uid) THEN
    RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看服務分類的權限');
  END IF;
  SELECT * INTO c FROM public.ga_service_categories WHERE id = p_id;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這個服務分類'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'can_manage', v_manage, 'data', to_jsonb(c) || jsonb_build_object('common_items', to_jsonb(c.common_items),
    'vendor_count', (SELECT count(*) FROM public.ga_vendors v WHERE c.id = ANY (v.service_category_ids)), 'child_count', (SELECT count(*) FROM public.ga_service_categories k WHERE k.parent_id = c.id)));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 新增（p_id NULL）與編輯。代碼轉大寫、全公司唯一、建立後鎖定；上層不可是自己或自己的子孫（循環）；停用不影響既有廠商（仍顯示名稱）。沒有刪除。
CREATE OR REPLACE FUNCTION public.ga_ws_svc_category_save(p_id uuid, p_payload jsonb, p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new boolean := (p_id IS NULL);
  c public.ga_service_categories%ROWTYPE;
  v_code text;
  v_dup text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.service_category.manage') THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有新增或編輯服務分類的權限（需要服務分類管理權限）'); END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ga_svc_tree:ga_service_categories'));
  IF v_new THEN
    c.id := gen_random_uuid(); c.status := 'active'; c.sort_order := 10; c.icon_key := 'wrench'; c.common_items := '{}';
  ELSE
    SELECT * INTO c FROM public.ga_service_categories WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這個服務分類'); END IF;
    IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再儲存'); END IF;
    IF c.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這個服務分類剛被其他人修改，請重新載入後再儲存'); END IF;
  END IF;
  IF p_payload ? 'name' THEN c.name := public.ga_vd_txt(p_payload, 'name', 50, '分類名稱'); END IF;
  IF c.name IS NULL THEN RETURN public.ga_rq_err(400, 'NAME_REQUIRED', '請填寫分類名稱'); END IF;
  IF p_payload ? 'code' THEN
    v_code := upper(public.ga_vd_txt(p_payload, 'code', 30, '分類代碼'));
    IF NOT v_new AND v_code IS DISTINCT FROM c.code THEN RETURN public.ga_rq_err(400, 'CODE_LOCKED', '分類代碼建立後不能修改'); END IF;
    IF v_new THEN c.code := v_code; END IF;
  END IF;
  IF v_new THEN
    IF c.code IS NULL OR c.code !~ '^[A-Z0-9][A-Z0-9_-]{0,29}$' THEN RETURN public.ga_rq_err(400, 'CODE_FORMAT', '分類代碼只能用英文字母、數字、底線與連字號（最長 30 字）'); END IF;
    SELECT name INTO v_dup FROM public.ga_service_categories WHERE code = c.code;
    IF FOUND THEN RETURN public.ga_rq_err(409, 'CODE_DUPLICATE', '分類代碼 ' || c.code || ' 已經被「' || v_dup || '」使用'); END IF;
  END IF;
  IF p_payload ? 'parent_id' THEN
    IF jsonb_typeof(p_payload -> 'parent_id') = 'null' THEN c.parent_id := NULL;
    ELSE
      IF jsonb_typeof(p_payload -> 'parent_id') <> 'string' OR (p_payload ->> 'parent_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN public.ga_rq_err(400, 'FIELD_TYPE', '上層分類格式錯誤'); END IF;
      c.parent_id := (p_payload ->> 'parent_id')::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.ga_service_categories WHERE id = c.parent_id) THEN RETURN public.ga_rq_err(400, 'PARENT_NOT_FOUND', '找不到上層分類'); END IF;
      IF c.parent_id = c.id OR public.ga_vd_tree_cycle('ga_service_categories', c.id, c.parent_id) THEN RETURN public.ga_rq_err(400, 'PARENT_CYCLE', '上層分類不能是自己或自己底下的分類'); END IF;
    END IF;
  END IF;
  IF p_payload ? 'description' THEN c.description := public.ga_vd_txt(p_payload, 'description', 500, '說明'); END IF;
  IF p_payload ? 'icon_key' THEN c.icon_key := COALESCE(public.ga_vd_txt(p_payload, 'icon_key', 30, '圖示'), 'wrench'); END IF;
  IF p_payload ? 'status' THEN
    c.status := public.ga_vd_txt(p_payload, 'status', 20, '狀態');
    IF c.status IS NULL OR c.status NOT IN ('active', 'inactive') THEN RETURN public.ga_rq_err(400, 'STATUS', '狀態只能是啟用或停用'); END IF;
  END IF;
  IF p_payload ? 'sort_order' THEN c.sort_order := public.ga_vd_int(p_payload, 'sort_order', '排序'); END IF;
  IF p_payload ? 'common_items' THEN c.common_items := public.ga_vd_txt_arr(p_payload, 'common_items', 50, 50, '常用項目'); END IF;
  IF v_new THEN
    INSERT INTO public.ga_service_categories (id, name, code, parent_id, description, icon_key, status, sort_order, common_items, updated_by)
    VALUES (c.id, c.name, c.code, c.parent_id, c.description, c.icon_key, c.status, c.sort_order, c.common_items, v_uid) RETURNING * INTO c;
  ELSE
    UPDATE public.ga_service_categories SET name = c.name, parent_id = c.parent_id, description = c.description, icon_key = c.icon_key, status = c.status, sort_order = c.sort_order,
      common_items = c.common_items, updated_at = now(), updated_by = v_uid WHERE id = c.id RETURNING * INTO c;
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN v_new THEN 201 ELSE 200 END, 'data', to_jsonb(c) || jsonb_build_object('common_items', to_jsonb(c.common_items)));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- ================================================================ 4. 服務區域
CREATE OR REPLACE FUNCTION public.ga_ws_svc_region_list(p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_manage boolean;
  v_read boolean;
  v_vendor boolean;
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 100);
  v_q text := public.ga_vd_txt(v_f, 'search', 100, '搜尋');
  v_pat text;
  v_status text := public.ga_vd_txt(v_f, 'status', 20, '狀態');
  v_type text := public.ga_vd_txt(v_f, 'region_type', 20, '類型');
  v_parent uuid := CASE WHEN v_f ->> 'parent_id' ~* '^[0-9a-f-]{36}$' THEN (v_f ->> 'parent_id')::uuid END;
  v_options boolean := COALESCE(v_f ->> 'options', '') IN ('true', '1');
  v_total integer;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  v_manage := has_permission(v_uid, 'general_affairs.service_region.manage');
  v_read := v_manage OR has_permission(v_uid, 'general_affairs.service_region.view');
  v_vendor := public.ga_vd_can_view(v_uid);
  IF NOT v_read AND NOT v_vendor THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看服務區域的權限'); END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('active', 'inactive', 'archived') THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '狀態篩選值錯誤'); END IF;
  IF v_type IS NOT NULL AND v_type NOT IN ('country', 'region', 'city', 'district') THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '類型篩選值錯誤'); END IF;
  IF NOT v_read THEN v_status := 'active'; END IF;
  IF v_q IS NOT NULL THEN v_pat := '%' || public.ga_po_like_escape(v_q) || '%'; END IF;
  IF v_options THEN v_size := 2000; v_page := 1; END IF;
  SELECT count(*)::integer INTO v_total FROM public.ga_service_regions r
   WHERE (v_status IS NULL OR r.status = v_status) AND (v_type IS NULL OR r.region_type = v_type) AND (v_parent IS NULL OR r.parent_id = v_parent)
     AND (v_pat IS NULL OR r.name ILIKE v_pat ESCAPE '\' OR r.code ILIKE v_pat ESCAPE '\' OR COALESCE(r.description, '') ILIKE v_pat ESCAPE '\');
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.so, x.nm, x.id), '[]'::jsonb) INTO v_rows
    FROM (SELECT jsonb_build_object('id', r.id, 'name', r.name, 'code', r.code, 'parent_id', r.parent_id, 'parent_name', (SELECT p.name FROM public.ga_service_regions p WHERE p.id = r.parent_id),
                 'region_type', r.region_type, 'description', r.description, 'included_locations', to_jsonb(r.included_locations), 'status', r.status, 'sort_order', r.sort_order, 'updated_at', r.updated_at,
                 'child_count', (SELECT count(*) FROM public.ga_service_regions k WHERE k.parent_id = r.id),
                 'vendor_count', CASE WHEN v_vendor THEN (SELECT count(*) FROM public.ga_vendors v WHERE r.id = ANY (v.service_region_ids)) END) AS j, r.sort_order AS so, r.name AS nm, r.id
            FROM public.ga_service_regions r
           WHERE (v_status IS NULL OR r.status = v_status) AND (v_type IS NULL OR r.region_type = v_type) AND (v_parent IS NULL OR r.parent_id = v_parent)
             AND (v_pat IS NULL OR r.name ILIKE v_pat ESCAPE '\' OR r.code ILIKE v_pat ESCAPE '\' OR COALESCE(r.description, '') ILIKE v_pat ESCAPE '\')
           ORDER BY r.sort_order, r.name, r.id LIMIT v_size OFFSET (v_page - 1) * v_size) x;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_total, 'page', v_page, 'page_size', v_size, 'can_manage', v_manage));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ws_svc_region_get(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_manage boolean;
  r public.ga_service_regions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  v_manage := has_permission(v_uid, 'general_affairs.service_region.manage');
  IF NOT v_manage AND NOT has_permission(v_uid, 'general_affairs.service_region.view') AND NOT public.ga_vd_can_view(v_uid) THEN
    RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看服務區域的權限');
  END IF;
  SELECT * INTO r FROM public.ga_service_regions WHERE id = p_id;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這個服務區域'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'can_manage', v_manage, 'data', to_jsonb(r) || jsonb_build_object('included_locations', to_jsonb(r.included_locations),
    'vendor_count', (SELECT count(*) FROM public.ga_vendors v WHERE r.id = ANY (v.service_region_ids)), 'child_count', (SELECT count(*) FROM public.ga_service_regions k WHERE k.parent_id = r.id)));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ws_svc_region_save(p_id uuid, p_payload jsonb, p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new boolean := (p_id IS NULL);
  r public.ga_service_regions%ROWTYPE;
  v_code text;
  v_dup text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.service_region.manage') THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有新增或編輯服務區域的權限（需要服務區域管理權限）'); END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ga_svc_tree:ga_service_regions'));
  IF v_new THEN
    r.id := gen_random_uuid(); r.status := 'active'; r.sort_order := 10; r.region_type := 'city'; r.included_locations := '{}';
  ELSE
    SELECT * INTO r FROM public.ga_service_regions WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這個服務區域'); END IF;
    IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再儲存'); END IF;
    IF r.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這個服務區域剛被其他人修改，請重新載入後再儲存'); END IF;
  END IF;
  IF p_payload ? 'name' THEN r.name := public.ga_vd_txt(p_payload, 'name', 50, '區域名稱'); END IF;
  IF r.name IS NULL THEN RETURN public.ga_rq_err(400, 'NAME_REQUIRED', '請填寫區域名稱'); END IF;
  IF p_payload ? 'code' THEN
    v_code := upper(public.ga_vd_txt(p_payload, 'code', 30, '區域代碼'));
    IF NOT v_new AND v_code IS DISTINCT FROM r.code THEN RETURN public.ga_rq_err(400, 'CODE_LOCKED', '區域代碼建立後不能修改'); END IF;
    IF v_new THEN r.code := v_code; END IF;
  END IF;
  IF v_new THEN
    IF r.code IS NULL OR r.code !~ '^[A-Z0-9][A-Z0-9_-]{0,29}$' THEN RETURN public.ga_rq_err(400, 'CODE_FORMAT', '區域代碼只能用英文字母、數字、底線與連字號（最長 30 字）'); END IF;
    SELECT name INTO v_dup FROM public.ga_service_regions WHERE code = r.code;
    IF FOUND THEN RETURN public.ga_rq_err(409, 'CODE_DUPLICATE', '區域代碼 ' || r.code || ' 已經被「' || v_dup || '」使用'); END IF;
  END IF;
  IF p_payload ? 'region_type' THEN
    r.region_type := public.ga_vd_txt(p_payload, 'region_type', 20, '區域類型');
    IF r.region_type IS NULL OR r.region_type NOT IN ('country', 'region', 'city', 'district') THEN RETURN public.ga_rq_err(400, 'REGION_TYPE', '區域類型只能是國家、大區、縣市或行政區'); END IF;
  END IF;
  IF p_payload ? 'parent_id' THEN
    IF jsonb_typeof(p_payload -> 'parent_id') = 'null' THEN r.parent_id := NULL;
    ELSE
      IF jsonb_typeof(p_payload -> 'parent_id') <> 'string' OR (p_payload ->> 'parent_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN public.ga_rq_err(400, 'FIELD_TYPE', '上層區域格式錯誤'); END IF;
      r.parent_id := (p_payload ->> 'parent_id')::uuid;
      IF NOT EXISTS (SELECT 1 FROM public.ga_service_regions WHERE id = r.parent_id) THEN RETURN public.ga_rq_err(400, 'PARENT_NOT_FOUND', '找不到上層區域'); END IF;
      IF r.parent_id = r.id OR public.ga_vd_tree_cycle('ga_service_regions', r.id, r.parent_id) THEN RETURN public.ga_rq_err(400, 'PARENT_CYCLE', '上層區域不能是自己或自己底下的區域'); END IF;
    END IF;
  END IF;
  IF p_payload ? 'description' THEN r.description := public.ga_vd_txt(p_payload, 'description', 500, '說明'); END IF;
  IF p_payload ? 'included_locations' THEN r.included_locations := public.ga_vd_txt_arr(p_payload, 'included_locations', 100, 50, '包含地點'); END IF;
  IF p_payload ? 'status' THEN
    r.status := public.ga_vd_txt(p_payload, 'status', 20, '狀態');
    IF r.status IS NULL OR r.status NOT IN ('active', 'inactive', 'archived') THEN RETURN public.ga_rq_err(400, 'STATUS', '狀態只能是啟用、停用或封存'); END IF;
  END IF;
  IF p_payload ? 'sort_order' THEN r.sort_order := public.ga_vd_int(p_payload, 'sort_order', '排序'); END IF;
  IF v_new THEN
    INSERT INTO public.ga_service_regions (id, name, code, parent_id, region_type, description, included_locations, status, sort_order, updated_by)
    VALUES (r.id, r.name, r.code, r.parent_id, r.region_type, r.description, r.included_locations, r.status, r.sort_order, v_uid) RETURNING * INTO r;
  ELSE
    UPDATE public.ga_service_regions SET name = r.name, parent_id = r.parent_id, region_type = r.region_type, description = r.description, included_locations = r.included_locations,
      status = r.status, sort_order = r.sort_order, updated_at = now(), updated_by = v_uid WHERE id = r.id RETURNING * INTO r;
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN v_new THEN 201 ELSE 200 END, 'data', to_jsonb(r) || jsonb_build_object('included_locations', to_jsonb(r.included_locations)));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- ================================================================ 授權
REVOKE ALL ON FUNCTION public.ga_ws_vendor_list(jsonb, integer, integer), public.ga_ws_vendor_get(uuid), public.ga_ws_vendor_save(uuid, jsonb, timestamptz),
  public.ga_ws_vendor_set_status(uuid, text, timestamptz), public.ga_ws_vendor_options(text, integer, integer, uuid[]),
  public.ga_ws_svc_category_list(jsonb, integer, integer), public.ga_ws_svc_category_get(uuid), public.ga_ws_svc_category_save(uuid, jsonb, timestamptz),
  public.ga_ws_svc_region_list(jsonb, integer, integer), public.ga_ws_svc_region_get(uuid), public.ga_ws_svc_region_save(uuid, jsonb, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_vendor_list(jsonb, integer, integer), public.ga_ws_vendor_get(uuid), public.ga_ws_vendor_save(uuid, jsonb, timestamptz),
  public.ga_ws_vendor_set_status(uuid, text, timestamptz), public.ga_ws_vendor_options(text, integer, integer, uuid[]),
  public.ga_ws_svc_category_list(jsonb, integer, integer), public.ga_ws_svc_category_get(uuid), public.ga_ws_svc_category_save(uuid, jsonb, timestamptz),
  public.ga_ws_svc_region_list(jsonb, integer, integer), public.ga_ws_svc_region_get(uuid), public.ga_ws_svc_region_save(uuid, jsonb, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';

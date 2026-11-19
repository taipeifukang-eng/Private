-- 56-b45-functions.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261119150000_m7m8_b45_functions.sql 相同。
-- 第 4.5 批 F（進貨憑證、進貨發票、請款單、付款標記、請款設定、對帳匯出、採購單摘要函式，以及廠商銀行欄位讀寫擴充）（2026-11-19 第 4.5 批問卷 P1 至 P10）。
-- 性質：會寫入（只新增與替換函式，不動資料）。新增對外函式 ga_ws_pay_*（settings_get／set、voucher_set、invoice_save／get／list／void、receipt_candidates、request_create／update／action／get／list、export、po_summary）與內部輔助 ga_pay_*（只開給 service_role）；
--   全部 SECURITY DEFINER、固定 search_path、必須是登入使用者、權限只用 has_permission(auth.uid(), 碼)（正式區語意：資料庫沒有管理員後備，profiles.role = admin 不放行）、回 {ok,status,data,error,code}、寫入同交易鎖列、固定識別冪等、expected_updated_at 版本檢查。
--   另讀出 ga_vd_json 與 ga_ws_vendor_save 的現行定義做文字替換，加入銀行四欄（形狀不符就中止，請人工處理；已套用就略過）。
-- 先決條件：先套 51、52、53、54、55；第 4 批 33（ga_rq_*、ga_po_*）、第 6 批 44（ga_vd_*、ga_ws_vendor_save）已套用。套用後請用 DEV 已測過的 G45-db 與 G45-att-inv 測試項目自己抽查權限矩陣與遮蔽。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：56-b45-functions-rollback.sql。套用前先跑 50-b45-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.ga_payment_requests') IS NULL OR to_regclass('public.ga_purchase_invoices') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: 請先套用 20261119100000、20261119110000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_vendors' AND column_name = 'bank_account') THEN
    RAISE EXCEPTION 'Missing prerequisite columns: 請先套用 20261119120000_m7m8_b45_vendor_bank';
  END IF;
  IF to_regprocedure('public.ga_rq_err(integer,text,text,jsonb)') IS NULL OR to_regprocedure('public.ga_rq_raise(integer,text,text,jsonb)') IS NULL OR to_regprocedure('public.ga_rq_catch(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用第 4 批 20261112100000（ga_rq_*）';
  END IF;
  IF to_regprocedure('public.ga_po_today()') IS NULL OR to_regprocedure('public.ga_po_like_escape(text)') IS NULL OR to_regprocedure('public.ga_po_can_view(uuid)') IS NULL OR to_regprocedure('public.ga_wf_num(text,numeric)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用第 4 批 20261112110000（ga_po_*、ga_wf_num）';
  END IF;
  IF to_regprocedure('public.ga_vd_json(public.ga_vendors,boolean)') IS NULL OR to_regprocedure('public.ga_ws_vendor_save(uuid,jsonb,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用第 6 批 44（ga_vd_json、ga_ws_vendor_save）';
  END IF;
  IF to_regprocedure('public.ga_pay_invoice_missing_image(text,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用 20261119130000_m7m8_b45_attachment_types';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE code IN ('general_affairs.purchase_payment.view', 'general_affairs.purchase_payment.manage') HAVING count(*) = 2) THEN
    RAISE EXCEPTION 'Missing prerequisite permissions: 請先套用 20261119140000_m7m8_b45_permissions';
  END IF;
END $$;

-- ================================================================ 1. 權限與基本輔助
CREATE OR REPLACE FUNCTION public.ga_pay_can_view(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT has_permission(p_uid, 'general_affairs.purchase_payment.view') OR has_permission(p_uid, 'general_affairs.purchase_payment.manage'); $$;

CREATE OR REPLACE FUNCTION public.ga_pay_can_manage(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT has_permission(p_uid, 'general_affairs.purchase_payment.manage'); $$;

CREATE OR REPLACE FUNCTION public.ga_pay_can_vendor(p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT has_permission(p_uid, 'general_affairs.vendor.view') OR has_permission(p_uid, 'general_affairs.vendor.manage'); $$;

-- 尾差容許（元）：設定 pay_tolerance_amount，預設 5。
CREATE OR REPLACE FUNCTION public.ga_pay_tol() RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT public.ga_wf_num('pay_tolerance_amount', 5); $$;

CREATE OR REPLACE FUNCTION public.ga_pay_money(p_value numeric) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT to_char(round(p_value), 'FM999,999,999,990'); $$;

CREATE OR REPLACE FUNCTION public.ga_pay_txt(p jsonb, p_key text, p_max integer, p_label text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
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

-- 整數金額（元，非負）；p_required 為 true 時空值回 400。接受數字或數字字串。
CREATE OR REPLACE FUNCTION public.ga_pay_int(p jsonb, p_key text, p_label text, p_required boolean) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
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
  IF v !~ '^[0-9]+$' THEN PERFORM public.ga_rq_raise(400, 'AMOUNT_FORMAT', p_label || '請輸入整數元（不可為負數、小數或含文字）'); END IF;
  IF char_length(v) > 12 THEN PERFORM public.ga_rq_raise(400, 'AMOUNT_TOO_LARGE', p_label || '太大，請確認'); END IF;
  RETURN v::numeric;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_pay_date(p_value text, p_label text) RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
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

CREATE OR REPLACE FUNCTION public.ga_pay_uuid(p_value text, p_label text, p_required boolean) RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    IF p_required THEN PERFORM public.ga_rq_raise(400, 'FIELD_REQUIRED', '請選擇' || p_label); END IF;
    RETURN NULL;
  END IF;
  IF btrim(p_value) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN PERFORM public.ga_rq_raise(400, 'FIELD_TYPE', p_label || '格式錯誤'); END IF;
  RETURN btrim(p_value)::uuid;
END;
$$;

-- 統編只留數字（比對用）。
CREATE OR REPLACE FUNCTION public.ga_pay_norm_tax(p_value text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT regexp_replace(COALESCE(p_value, ''), '[^0-9]', '', 'g'); $$;

CREATE OR REPLACE FUNCTION public.ga_pay_lock_po(p_po uuid) RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$ BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('ga_pay_po:' || p_po::text, 0)); END; $$;

-- 發票儲存前先鎖「目前連結的進貨單」與「這次要連結的進貨單」所屬的採購單（依 id 排序避免死結）。
-- 鎖的順序與請款單建立（先鎖採購單、再讀發票列）、作廢進貨（先鎖採購單）一致，發票連結與作廢進貨、請款引用就不會互相漏看。
CREATE OR REPLACE FUNCTION public.ga_pay_lock_pos_of_invoice(p_invoice uuid, p_links jsonb) RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_po uuid;
BEGIN
  FOR v_po IN
    SELECT DISTINCT x.po_id FROM (
      SELECT r.po_id FROM public.ga_purchase_invoice_receipts ir JOIN public.ga_purchase_receipts r ON r.id = ir.receipt_id WHERE p_invoice IS NOT NULL AND ir.invoice_id = p_invoice
      UNION
      SELECT r.po_id FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_links) = 'array' THEN p_links ELSE '[]'::jsonb END) e
        JOIN public.ga_purchase_receipts r ON r.id = CASE WHEN jsonb_typeof(e.value) = 'object' AND (e.value ->> 'receipt_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (e.value ->> 'receipt_id')::uuid END
    ) x ORDER BY 1
  LOOP
    PERFORM public.ga_pay_lock_po(v_po);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.ga_pay_lock_pos_of_invoice(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ================================================================ 2. 金額計算
-- 進貨單未稅金額（未作廢才有意義；呼叫端自己檢查作廢）。
CREATE OR REPLACE FUNCTION public.ga_pay_receipt_untaxed(p_receipt uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT COALESCE(sum(amount_untaxed), 0) FROM public.ga_purchase_receipt_items WHERE receipt_id = p_receipt; $$;

CREATE OR REPLACE FUNCTION public.ga_pay_receipt_rate(p_receipt uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT o.tax_rate FROM public.ga_purchase_receipts r JOIN public.ga_purchase_orders o ON o.id = r.po_id WHERE r.id = p_receipt; $$;

-- 進貨單含稅額：未稅 ＋ round(未稅 × 採購單稅率快照)。
CREATE OR REPLACE FUNCTION public.ga_pay_receipt_total(p_receipt uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT public.ga_pay_receipt_untaxed(p_receipt) + round(public.ga_pay_receipt_untaxed(p_receipt) * COALESCE(public.ga_pay_receipt_rate(p_receipt), 0)); $$;

-- 採購單累計驗入（未作廢進貨）：{untaxed, tax, total, rate}。稅額「逐張進貨各自四捨五入後加總」（與請款預設稅額、進貨單含稅額同一口徑，分批進貨不會因進位累積而被擋）。
CREATE OR REPLACE FUNCTION public.ga_pay_po_received(p_po uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object('untaxed', s.u, 'tax', s.t, 'total', s.u + s.t, 'rate', o.tax_rate)
    FROM public.ga_purchase_orders o,
         LATERAL (SELECT COALESCE(sum(x.u), 0) AS u, COALESCE(sum(round(x.u * o.tax_rate)), 0) AS t
                    FROM (SELECT sum(ri.amount_untaxed) AS u FROM public.ga_purchase_receipts r JOIN public.ga_purchase_receipt_items ri ON ri.receipt_id = r.id
                           WHERE r.po_id = p_po AND r.voided_at IS NULL GROUP BY r.id) x) s
   WHERE o.id = p_po;
$$;

-- 採購單累計請款（有效請款單：非作廢）；p_exclude 排除某張請款單。p_status 非空時只算該狀態。
CREATE OR REPLACE FUNCTION public.ga_pay_po_claimed(p_po uuid, p_exclude uuid DEFAULT NULL, p_status text DEFAULT NULL) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(sum(l.claim_total), 0) FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id
   WHERE l.po_id = p_po AND q.status <> 'VOID' AND q.id IS DISTINCT FROM p_exclude AND (p_status IS NULL OR q.status = p_status);
$$;

-- ================================================================ 3. 事件與 JSON
CREATE OR REPLACE FUNCTION public.ga_pay_event(p_pr uuid, p_type text, p_from text, p_to text, p_actor uuid, p_reason text, p_amount numeric, p_payload jsonb, p_key text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ INSERT INTO public.ga_payment_request_events (pr_id, event_type, from_status, to_status, actor_id, reason, amount_total, payload, idempotency_key)
      VALUES (p_pr, p_type, p_from, p_to, p_actor, p_reason, p_amount, COALESCE(p_payload, '{}'::jsonb), p_key); $$;

CREATE OR REPLACE FUNCTION public.ga_pay_invoice_json(p_id uuid, p_vendor boolean) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT (to_jsonb(i) - 'idempotency_key' - 'payload_hash' - 'void_key' - 'seller_tax_id_snapshot') || jsonb_build_object(
    'seller_tax_id_snapshot', CASE WHEN p_vendor THEN i.seller_tax_id_snapshot END,
    'seller_tax_masked', (NOT p_vendor) AND i.seller_tax_id_snapshot IS NOT NULL,
    'vendor_name', (SELECT v.name FROM public.ga_vendors v WHERE v.id = i.vendor_id),
    'image_count', public.ga_pay_invoice_image_count(i.id),
    'missing_image', public.ga_pay_invoice_missing_image(i.invoice_type, i.no_image_reason, public.ga_pay_invoice_image_count(i.id)),
    'created_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = i.created_by),
    'updated_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = i.updated_by),
    'voided_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = i.voided_by),
    'receipts', (SELECT COALESCE(jsonb_agg(jsonb_build_object('receipt_id', r.id, 'receipt_no', r.receipt_no, 'po_id', r.po_id, 'po_no', o.po_no, 'received_date', r.received_date,
                    'voided', r.voided_at IS NOT NULL, 'allocated_untaxed', ir.allocated_untaxed, 'allocated_tax', ir.allocated_tax,
                    'receipt_untaxed', public.ga_pay_receipt_untaxed(r.id), 'receipt_total', public.ga_pay_receipt_total(r.id)) ORDER BY r.received_date, r.receipt_no), '[]'::jsonb)
                   FROM public.ga_purchase_invoice_receipts ir JOIN public.ga_purchase_receipts r ON r.id = ir.receipt_id JOIN public.ga_purchase_orders o ON o.id = r.po_id WHERE ir.invoice_id = i.id),
    'referenced_by', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'pr_no', x.pr_no, 'status', x.status) ORDER BY x.pr_no), '[]'::jsonb)
                       FROM (SELECT DISTINCT q.id, q.pr_no, q.status FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.invoice_id = i.id AND q.status <> 'VOID') x))
  FROM public.ga_purchase_invoices i WHERE i.id = p_id;
$$;

-- 請款單 JSON。p_vendor：可看統編與銀行；p_po：可看採購單明細（品項並排）；p_detail：含明細與操作紀錄。
CREATE OR REPLACE FUNCTION public.ga_pay_request_json(p_id uuid, p_vendor boolean, p_po boolean, p_detail boolean) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  q public.ga_payment_requests%ROWTYPE;
  v_out jsonb;
BEGIN
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_out := (to_jsonb(q) - 'idempotency_key' - 'payload_hash' - 'vendor_tax_id_snapshot' - 'bank_snapshot') || jsonb_build_object(
    'vendor_tax_id_snapshot', CASE WHEN p_vendor THEN q.vendor_tax_id_snapshot END,
    'bank_snapshot', CASE WHEN p_vendor THEN q.bank_snapshot ELSE '{}'::jsonb END,
    'vendor_masked', NOT p_vendor,
    'line_count', (SELECT count(*) FROM public.ga_payment_request_lines l WHERE l.pr_id = q.id),
    'po_nos', (SELECT COALESCE(jsonb_agg(x.po_no ORDER BY x.po_no), '[]'::jsonb) FROM (SELECT DISTINCT o.po_no FROM public.ga_payment_request_lines l JOIN public.ga_purchase_orders o ON o.id = l.po_id WHERE l.pr_id = q.id) x),
    'created_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = q.created_by),
    'submitted_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = q.submitted_by),
    'paid_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = q.paid_by),
    'voided_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = q.voided_by),
    'po_masked', NOT p_po);
  IF p_detail THEN
    v_out := v_out || jsonb_build_object(
      'lines', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', l.id, 'line_no', l.line_no, 'po_id', l.po_id, 'po_no', o.po_no, 'tax_rate', o.tax_rate, 'receipt_id', l.receipt_id, 'receipt_no', r.receipt_no, 'received_date', r.received_date,
          'delivery_note_no', r.delivery_note_no, 'receipt_voided', r.voided_at IS NOT NULL, 'receipt_untaxed', public.ga_pay_receipt_untaxed(r.id), 'receipt_total', public.ga_pay_receipt_total(r.id),
          'invoice_id', l.invoice_id, 'invoice_no', i.invoice_no, 'invoice_type', i.invoice_type, 'invoice_status', i.status, 'invoice_total', i.amount_total,
          'invoice_missing_image', CASE WHEN i.id IS NULL THEN false ELSE public.ga_pay_invoice_missing_image(i.invoice_type, i.no_image_reason, public.ga_pay_invoice_image_count(i.id)) END,
          'claim_untaxed', l.claim_untaxed, 'claim_tax', l.claim_tax, 'claim_total', l.claim_total, 'diff_reason', l.diff_reason,
          'items', CASE WHEN p_po THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('item_name', pi.item_name, 'unit', pi.unit, 'ordered_qty', pi.quantity, 'unit_price', pi.unit_price,
                      'accepted_qty', ri.accepted_qty, 'rejected_qty', ri.rejected_qty, 'amount_untaxed', ri.amount_untaxed) ORDER BY pi.line_no), '[]'::jsonb)
                      FROM public.ga_purchase_receipt_items ri JOIN public.ga_purchase_order_items pi ON pi.id = ri.po_item_id WHERE ri.receipt_id = r.id) END
        ) ORDER BY l.line_no), '[]'::jsonb)
        FROM public.ga_payment_request_lines l JOIN public.ga_purchase_receipts r ON r.id = l.receipt_id JOIN public.ga_purchase_orders o ON o.id = l.po_id
        LEFT JOIN public.ga_purchase_invoices i ON i.id = l.invoice_id WHERE l.pr_id = q.id),
      'events', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type, 'from_status', e.from_status, 'to_status', e.to_status, 'actor_id', e.actor_id,
          'actor_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = e.actor_id), 'reason', e.reason, 'amount_total', e.amount_total, 'payload', e.payload - 'hash', 'created_at', e.created_at)
          ORDER BY e.created_at, e.id), '[]'::jsonb) FROM public.ga_payment_request_events e WHERE e.pr_id = q.id));
  END IF;
  RETURN v_out;
END;
$$;

-- ================================================================ 4. 請款設定
CREATE OR REPLACE FUNCTION public.ga_ws_pay_settings_get() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ver timestamptz;
  v_hist jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看請款資料的權限'); END IF;
  SELECT max(updated_at) INTO v_ver FROM public.ga_workflow_settings WHERE key LIKE 'pay\_%';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('setting_key', e.setting_key, 'old_value', e.old_value_num, 'new_value', e.new_value_num, 'note', e.note, 'actor_id', e.actor_id,
           'actor_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = e.actor_id), 'created_at', e.created_at) ORDER BY e.created_at DESC), '[]'::jsonb)
    INTO v_hist FROM (SELECT * FROM public.ga_workflow_setting_events WHERE setting_key LIKE 'pay\_%' ORDER BY created_at DESC LIMIT 20) e;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'tolerance_amount', public.ga_pay_tol(),
    'buyer_title', (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title'),
    'buyer_tax_id', (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id'),
    'updated_at', v_ver, 'can_edit', public.ga_pay_can_manage(v_uid), 'history', v_hist));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- p_values：{tolerance_amount（0 至 100 的整數）, buyer_title（≤100 字）, buyer_tax_id（8 碼數字，可清空）}；版本用 pay_ 開頭設定的最新更新時間。
CREATE OR REPLACE FUNCTION public.ga_ws_pay_settings_set(p_values jsonb, p_expected_updated_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_vals jsonb := COALESCE(p_values, '{}'::jsonb);
  v_ver timestamptz;
  v_key text;
  v_old numeric;
  v_new numeric;
  v_txt text;
  v_old_txt text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有調整請款設定的權限（需要請款管理權限）'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  IF jsonb_typeof(v_vals) <> 'object' THEN RETURN public.ga_rq_err(400, 'SETTINGS_INVALID', '設定格式錯誤'); END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_vals) LOOP
    IF v_key NOT IN ('tolerance_amount', 'buyer_title', 'buyer_tax_id') THEN RETURN public.ga_rq_err(400, 'SETTINGS_INVALID', '不支援的設定：' || v_key); END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(hashtextextended('ga_pay_settings', 0));
  SELECT max(updated_at) INTO v_ver FROM public.ga_workflow_settings WHERE key LIKE 'pay\_%';
  IF v_ver IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '設定已被其他人修改過，請重新載入後再調整'); END IF;
  IF v_vals ? 'tolerance_amount' THEN
    v_txt := btrim(COALESCE(v_vals ->> 'tolerance_amount', ''));
    IF v_txt !~ '^[0-9]+$' OR char_length(v_txt) > 4 OR v_txt::numeric > 100 THEN PERFORM public.ga_rq_raise(400, 'SETTINGS_INVALID', '尾差金額必須是 0 到 100 的整數（元）'); END IF;
    v_new := v_txt::numeric;
    v_old := public.ga_wf_num('pay_tolerance_amount', NULL);
    IF v_old IS DISTINCT FROM v_new THEN
      INSERT INTO public.ga_workflow_settings (key, value_num, updated_by, updated_at) VALUES ('pay_tolerance_amount', v_new, v_uid, clock_timestamp())
      ON CONFLICT (key) DO UPDATE SET value_num = EXCLUDED.value_num, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
      INSERT INTO public.ga_workflow_setting_events (setting_key, old_value_num, new_value_num, actor_id) VALUES ('pay_tolerance_amount', v_old, v_new, v_uid);
    END IF;
  END IF;
  IF v_vals ? 'buyer_title' THEN
    v_txt := public.ga_pay_txt(v_vals, 'buyer_title', 100, '買受人抬頭');
    SELECT value_text INTO v_old_txt FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title';
    IF v_old_txt IS DISTINCT FROM v_txt THEN
      INSERT INTO public.ga_workflow_settings (key, value_text, updated_by, updated_at) VALUES ('pay_buyer_title', v_txt, v_uid, clock_timestamp())
      ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
      INSERT INTO public.ga_workflow_setting_events (setting_key, actor_id, note) VALUES ('pay_buyer_title', v_uid, '買受人抬頭已變更');
    END IF;
  END IF;
  IF v_vals ? 'buyer_tax_id' THEN
    v_txt := public.ga_pay_txt(v_vals, 'buyer_tax_id', 20, '買受人統一編號');
    IF v_txt IS NOT NULL AND v_txt !~ '^[0-9]{8}$' THEN PERFORM public.ga_rq_raise(400, 'SETTINGS_INVALID', '買受人統一編號要是 8 碼數字'); END IF;
    SELECT value_text INTO v_old_txt FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id';
    IF v_old_txt IS DISTINCT FROM v_txt THEN
      INSERT INTO public.ga_workflow_settings (key, value_text, updated_by, updated_at) VALUES ('pay_buyer_tax_id', v_txt, v_uid, clock_timestamp())
      ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
      INSERT INTO public.ga_workflow_setting_events (setting_key, actor_id, note) VALUES ('pay_buyer_tax_id', v_uid, '買受人統一編號已變更');
    END IF;
  END IF;
  RETURN public.ga_ws_pay_settings_get();
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- ================================================================ 5. 進貨憑證
-- 進貨單的憑證狀態與發票連結同步：有有效發票連結 → LINKED；沒有且原本是 LINKED → NONE（NO_INVOICE 由人工設定，不被同步蓋掉）。
CREATE OR REPLACE FUNCTION public.ga_pay_sync_voucher(p_receipt uuid, p_actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_linked boolean;
  v_cur text;
BEGIN
  SELECT voucher_status INTO v_cur FROM public.ga_purchase_receipts WHERE id = p_receipt;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT EXISTS (SELECT 1 FROM public.ga_purchase_invoice_receipts ir JOIN public.ga_purchase_invoices i ON i.id = ir.invoice_id WHERE ir.receipt_id = p_receipt AND i.status = 'ACTIVE') INTO v_linked;
  IF v_linked AND v_cur <> 'LINKED' THEN
    UPDATE public.ga_purchase_receipts SET voucher_status = 'LINKED', voucher_recorded_by = p_actor, voucher_recorded_at = now(), updated_by = p_actor, updated_at = clock_timestamp() WHERE id = p_receipt;
  ELSIF NOT v_linked AND v_cur = 'LINKED' THEN
    UPDATE public.ga_purchase_receipts SET voucher_status = 'NONE', voucher_recorded_by = p_actor, voucher_recorded_at = now(), updated_by = p_actor, updated_at = clock_timestamp() WHERE id = p_receipt;
  END IF;
END;
$$;

-- 登錄進貨憑證狀態：p_status = NO_INVOICE（沒有發票或只有收據，必填說明）或 NONE（還沒有憑證）。已連有效發票時由發票決定（LINKED），不可手動改。
CREATE OR REPLACE FUNCTION public.ga_ws_pay_voucher_set(p_receipt_id uuid, p_status text, p_note text, p_expected_updated_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r public.ga_purchase_receipts%ROWTYPE;
  v_status text := upper(btrim(COALESCE(p_status, '')));
  v_note text := nullif(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有登錄進貨憑證的權限（需要請款管理權限）'); END IF;
  IF v_status NOT IN ('NONE', 'NO_INVOICE') THEN RETURN public.ga_rq_err(400, 'STATUS_INVALID', '憑證狀態只能是「尚未登錄」或「免開發票／僅收據」；連結發票請在發票頁登錄'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN RETURN public.ga_rq_err(400, 'FIELD_TOO_LONG', '憑證說明不可超過 200 個字'); END IF;
  IF v_status = 'NO_INVOICE' AND v_note IS NULL THEN RETURN public.ga_rq_err(400, 'NOTE_REQUIRED', '請填寫沒有發票的原因（例如僅有送貨單、對方免開發票）'); END IF;
  SELECT * INTO r FROM public.ga_purchase_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張進貨單'); END IF;
  IF r.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張進貨單剛被其他人修改，請重新載入後再儲存'); END IF;
  IF r.voided_at IS NOT NULL THEN RETURN public.ga_rq_err(409, 'RECEIPT_VOIDED', '這張進貨單已作廢，不能登錄憑證'); END IF;
  IF r.voucher_status = 'LINKED' THEN RETURN public.ga_rq_err(409, 'VOUCHER_LINKED', '這張進貨單已連結發票，憑證狀態由發票決定；要改請先作廢發票或到發票頁調整連結'); END IF;
  UPDATE public.ga_purchase_receipts SET voucher_status = v_status, voucher_note = CASE WHEN v_status = 'NO_INVOICE' THEN v_note END,
    voucher_recorded_by = v_uid, voucher_recorded_at = now(), updated_by = v_uid, updated_at = clock_timestamp() WHERE id = r.id RETURNING * INTO r;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('receipt_id', r.id, 'receipt_no', r.receipt_no, 'po_id', r.po_id, 'voucher_status', r.voucher_status,
    'voucher_note', r.voucher_note, 'voucher_recorded_at', r.voucher_recorded_at, 'updated_at', r.updated_at));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- ================================================================ 6. 進貨發票
-- 儲存發票（新增：p_id 為 NULL，需 p_key；編輯：需 p_expected_updated_at）。
-- payload：invoice_type（TRIPLE／DUPLEX／E_INVOICE／RECEIPT／NO_INVOICE）、invoice_no、invoice_date、vendor_id（可由進貨單推得）、seller_tax_id（發票上的賣方統編，沒填用採購單快照）、buyer_tax_id（三聯式；沒填用設定的買受人統編）、
--   amount_untaxed、tax_amount（沒填用採購單稅率自動算；可手改尾差）、amount_total（收據與免開發票用：稅額固定 0，未稅 = 含稅）、diff_reason、tax_mismatch_reason、no_image_reason（收據不傳圖的原因）、notes、
--   receipts:[{receipt_id, allocated_untaxed?, allocated_tax?}]。
-- 規則：同廠商同發票號碼（非作廢）不可重複；統編不符或金額差異超過尾差要填原因（可儲存）；缺圖只警示（發票可先存再傳圖），但缺圖發票不可被請款單引用；已被有效請款單引用時只能改備註與各項原因。
CREATE OR REPLACE FUNCTION public.ga_ws_pay_invoice_save(p_id uuid, p_payload jsonb, p_key text, p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_new boolean := (p_id IS NULL);
  v_key text := nullif(btrim(COALESCE(p_key, '')), '');
  v_hash text;
  i public.ga_purchase_invoices%ROWTYPE;
  o public.ga_purchase_invoices%ROWTYPE;
  v_type text;
  v_no text;
  v_date date;
  v_vendor uuid;
  v_vendor_tax text;
  v_expect_tax text;
  v_seller text;
  v_buyer text;
  v_buyer_cfg text;
  v_untaxed numeric;
  v_tax numeric;
  v_total numeric;
  v_rate numeric;
  v_rate_set boolean := false;
  v_links jsonb := '[]'::jsonb;
  v_calc jsonb := '[]'::jsonb;
  v_el jsonb;
  v_rid uuid;
  v_rec record;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_au numeric;
  v_at numeric;
  v_recv_total numeric := 0;
  v_alloc_total numeric := 0;
  v_tol numeric := public.ga_pay_tol();
  v_diff text;
  v_taxr text;
  v_noimg text;
  v_notes text;
  v_mismatch boolean := false;
  v_warn jsonb := '[]'::jsonb;
  v_dup record;
  v_refs text;
  v_old_receipts uuid[];
  v_changed boolean := false;
  v_images integer := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有新增或編輯發票的權限（需要請款管理權限）'); END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;
  -- 先鎖採購單（再鎖發票列），與作廢進貨、請款單建立同一把鎖與同一個順序
  PERFORM public.ga_pay_lock_pos_of_invoice(p_id, p -> 'receipts');

  IF v_new THEN
    IF v_key IS NULL OR char_length(v_key) > 64 THEN RETURN public.ga_rq_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼，請重新整理畫面後再送出'); END IF;
    v_hash := md5(p::text);
    PERFORM pg_advisory_xact_lock(hashtextextended('ga_pay_invoice_create:' || v_key, 0));
    SELECT * INTO i FROM public.ga_purchase_invoices WHERE idempotency_key = v_key;
    IF FOUND THEN
      IF i.payload_hash = v_hash AND i.created_by = v_uid THEN
        RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', true, 'data', public.ga_pay_invoice_json(i.id, public.ga_pay_can_vendor(v_uid)), 'warnings', '[]'::jsonb);
      END IF;
      RETURN public.ga_rq_err(409, 'IDEMPOTENCY_CONFLICT', '這個送出識別碼已被另一張不同內容的發票使用，請重新整理畫面後再送出');
    END IF;
  ELSE
    IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再儲存'); END IF;
    SELECT * INTO i FROM public.ga_purchase_invoices WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張發票'); END IF;
    IF i.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張發票剛被其他人修改，請重新載入後再儲存'); END IF;
    IF i.status = 'VOID' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '這張發票已作廢，不能再修改'); END IF;
    o := i;
  END IF;

  -- 類型、號碼、日期
  v_type := CASE WHEN p ? 'invoice_type' THEN upper(public.ga_pay_txt(p, 'invoice_type', 20, '發票類型')) ELSE i.invoice_type END;
  IF v_type IS NULL OR v_type NOT IN ('TRIPLE', 'DUPLEX', 'E_INVOICE', 'RECEIPT', 'NO_INVOICE') THEN RETURN public.ga_rq_err(400, 'INVOICE_TYPE', '發票類型只能是三聯式、二聯式、電子發票、收據或免開發票'); END IF;
  v_no := CASE WHEN p ? 'invoice_no' THEN upper(public.ga_pay_txt(p, 'invoice_no', 30, '發票號碼')) ELSE i.invoice_no END;
  IF v_type IN ('TRIPLE', 'DUPLEX', 'E_INVOICE') AND v_no IS NULL THEN RETURN public.ga_rq_err(400, 'INVOICE_NO_REQUIRED', '請填寫發票號碼'); END IF;
  IF v_type = 'NO_INVOICE' THEN v_no := NULL; END IF;
  v_date := CASE WHEN p ? 'invoice_date' THEN public.ga_pay_date(p ->> 'invoice_date', '發票日期') ELSE i.invoice_date END;
  IF v_date IS NULL THEN
    IF v_type = 'NO_INVOICE' THEN v_date := public.ga_po_today(); ELSE RETURN public.ga_rq_err(400, 'DATE_REQUIRED', '請填寫發票日期'); END IF;
  END IF;
  IF v_date > public.ga_po_today() THEN RETURN public.ga_rq_err(400, 'DATE_FUTURE', '發票日期不能是未來的日期（今天是 ' || public.ga_po_today() || '）'); END IF;

  -- 連結進貨單
  IF p ? 'receipts' THEN
    IF jsonb_typeof(p -> 'receipts') <> 'array' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '連結的進貨單格式錯誤'); END IF;
    IF jsonb_array_length(p -> 'receipts') > 50 THEN RETURN public.ga_rq_err(400, 'TOO_MANY_ITEMS', '一張發票最多連結 50 張進貨單'); END IF;
    v_links := p -> 'receipts';
  ELSIF NOT v_new THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('receipt_id', ir.receipt_id, 'allocated_untaxed', ir.allocated_untaxed, 'allocated_tax', ir.allocated_tax) ORDER BY ir.receipt_id), '[]'::jsonb)
      INTO v_links FROM public.ga_purchase_invoice_receipts ir WHERE ir.invoice_id = i.id;
  END IF;
  v_vendor := CASE WHEN p ? 'vendor_id' THEN public.ga_pay_uuid(p ->> 'vendor_id', '廠商', false) ELSE i.vendor_id END;

  -- 先掃一遍進貨單：取廠商、稅率、預期統編與含稅額
  FOR v_el IN SELECT value FROM jsonb_array_elements(v_links) LOOP
    IF jsonb_typeof(v_el) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '連結的進貨單格式錯誤'); END IF;
    v_rid := public.ga_pay_uuid(v_el ->> 'receipt_id', '進貨單', true);
    IF v_rid = ANY (v_seen) THEN RETURN public.ga_rq_err(400, 'DUPLICATE_LINE', '同一張進貨單在這張發票中重複出現，請合併成一列'); END IF;
    v_seen := array_append(v_seen, v_rid);
    SELECT r.id, r.receipt_no, r.voided_at, o2.id AS po_id, o2.po_no, o2.vendor_id, o2.tax_rate, o2.vendor_tax_id_snapshot INTO v_rec
      FROM public.ga_purchase_receipts r JOIN public.ga_purchase_orders o2 ON o2.id = r.po_id WHERE r.id = v_rid;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'RECEIPT_NOT_FOUND', '找不到要連結的進貨單，請重新整理後再試'); END IF;
    IF v_rec.voided_at IS NOT NULL THEN RETURN public.ga_rq_err(409, 'RECEIPT_VOIDED', '進貨單 ' || v_rec.receipt_no || ' 已作廢，不能連結發票'); END IF;
    IF v_vendor IS NULL THEN v_vendor := v_rec.vendor_id; END IF;
    IF v_rec.vendor_id IS DISTINCT FROM v_vendor THEN RETURN public.ga_rq_err(400, 'VENDOR_MISMATCH', '進貨單 ' || v_rec.receipt_no || ' 不是這個廠商的進貨，一張發票只能連結同一個廠商的進貨單'); END IF;
    IF NOT v_rate_set THEN v_rate := v_rec.tax_rate; v_rate_set := true; END IF;
    IF v_expect_tax IS NULL AND public.ga_pay_norm_tax(v_rec.vendor_tax_id_snapshot) <> '' THEN v_expect_tax := public.ga_pay_norm_tax(v_rec.vendor_tax_id_snapshot); END IF;
    v_recv_total := v_recv_total + public.ga_pay_receipt_total(v_rid);
  END LOOP;
  IF v_vendor IS NULL THEN RETURN public.ga_rq_err(400, 'VENDOR_REQUIRED', '請選擇廠商（或連結進貨單，由進貨單帶出廠商）'); END IF;
  SELECT public.ga_pay_norm_tax(tax_id) INTO v_vendor_tax FROM public.ga_vendors WHERE id = v_vendor;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'VENDOR_NOT_FOUND', '找不到這個廠商'); END IF;
  IF v_expect_tax IS NULL AND v_vendor_tax <> '' THEN v_expect_tax := v_vendor_tax; END IF;
  IF NOT v_rate_set THEN v_rate := public.ga_wf_num('po_tax_rate', 0.05); END IF;

  -- 金額
  IF v_type IN ('RECEIPT', 'NO_INVOICE') THEN
    IF public.ga_pay_int(p, 'amount_untaxed', '金額', false) IS NOT NULL AND public.ga_pay_int(p, 'amount_total', '金額', false) IS NOT NULL AND public.ga_pay_int(p, 'amount_untaxed', '金額', false) <> public.ga_pay_int(p, 'amount_total', '金額', false) THEN
      RETURN public.ga_rq_err(400, 'AMOUNT_MISMATCH', '收據與免開發票沒有稅額，未稅金額與含稅金額必須相同');
    END IF;
    v_untaxed := COALESCE(public.ga_pay_int(p, 'amount_total', '含稅金額', false), public.ga_pay_int(p, 'amount_untaxed', '金額', false), CASE WHEN NOT v_new THEN i.amount_total END);
    IF v_untaxed IS NULL THEN RETURN public.ga_rq_err(400, 'AMOUNT_REQUIRED', '請輸入金額'); END IF;
    v_tax := 0;
  ELSE
    v_untaxed := COALESCE(public.ga_pay_int(p, 'amount_untaxed', '未稅金額', false), CASE WHEN NOT v_new THEN i.amount_untaxed END);
    IF v_untaxed IS NULL THEN RETURN public.ga_rq_err(400, 'AMOUNT_REQUIRED', '請輸入未稅金額'); END IF;
    IF p ? 'tax_amount' AND jsonb_typeof(p -> 'tax_amount') <> 'null' THEN v_tax := public.ga_pay_int(p, 'tax_amount', '稅額', true);
    ELSIF v_new OR p ? 'amount_untaxed' OR (NOT v_new AND i.invoice_type IN ('RECEIPT', 'NO_INVOICE')) THEN v_tax := round(v_untaxed * v_rate);
    ELSE v_tax := i.tax_amount; END IF;
  END IF;
  v_total := v_untaxed + v_tax;

  -- 分攤：單一進貨單預設吃整張發票；多張預設各吃自己的金額
  FOR v_el IN SELECT value FROM jsonb_array_elements(v_links) LOOP
    v_rid := (v_el ->> 'receipt_id')::uuid;
    v_au := public.ga_pay_int(v_el, 'allocated_untaxed', '分攤未稅金額', false);
    v_at := public.ga_pay_int(v_el, 'allocated_tax', '分攤稅額', false);
    IF v_au IS NULL AND v_at IS NULL THEN
      IF jsonb_array_length(v_links) = 1 THEN v_au := v_untaxed; v_at := v_tax;
      ELSE v_au := public.ga_pay_receipt_untaxed(v_rid); v_at := round(v_au * COALESCE(public.ga_pay_receipt_rate(v_rid), 0)); END IF;
    ELSE
      v_au := COALESCE(v_au, 0); v_at := COALESCE(v_at, 0);
    END IF;
    v_alloc_total := v_alloc_total + v_au + v_at;
    v_calc := v_calc || jsonb_build_array(jsonb_build_object('receipt_id', v_rid, 'allocated_untaxed', v_au, 'allocated_tax', v_at));
  END LOOP;

  -- 統編核對（賣方：發票上的統編對採購單下訂快照；買受人：三聯式對設定）。沒有廠商檢視權限者填的賣方統編一律忽略（用預期統編），
  -- 否則可靠「統編不符」的回應反覆猜出廠商統編。
  v_seller := CASE WHEN p ? 'seller_tax_id' AND public.ga_pay_can_vendor(v_uid) THEN public.ga_pay_norm_tax(public.ga_pay_txt(p, 'seller_tax_id', 20, '賣方統編')) WHEN NOT v_new THEN public.ga_pay_norm_tax(i.seller_tax_id_snapshot) ELSE '' END;
  IF v_seller = '' THEN v_seller := COALESCE(v_expect_tax, ''); END IF;
  IF v_seller <> '' AND v_seller !~ '^[0-9]{8}$' THEN RETURN public.ga_rq_err(400, 'TAX_ID_FORMAT', '賣方統一編號要是 8 碼數字'); END IF;
  SELECT public.ga_pay_norm_tax(value_text) INTO v_buyer_cfg FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id';
  v_buyer := CASE WHEN p ? 'buyer_tax_id' THEN public.ga_pay_norm_tax(public.ga_pay_txt(p, 'buyer_tax_id', 20, '買受人統編')) WHEN NOT v_new THEN public.ga_pay_norm_tax(i.buyer_tax_id) ELSE '' END;
  IF v_type = 'TRIPLE' AND v_buyer = '' THEN v_buyer := COALESCE(v_buyer_cfg, ''); END IF;
  IF v_type <> 'TRIPLE' AND NOT (p ? 'buyer_tax_id') THEN v_buyer := ''; END IF;
  IF v_buyer <> '' AND v_buyer !~ '^[0-9]{8}$' THEN RETURN public.ga_rq_err(400, 'TAX_ID_FORMAT', '買受人統一編號要是 8 碼數字'); END IF;
  IF v_seller <> '' AND COALESCE(v_expect_tax, '') <> '' AND v_seller <> v_expect_tax THEN v_mismatch := true; END IF;
  IF v_type = 'TRIPLE' AND v_buyer <> '' AND COALESCE(v_buyer_cfg, '') <> '' AND v_buyer <> v_buyer_cfg THEN v_mismatch := true; END IF;

  -- 已被有效請款單引用時（在原因與重複檢查之前先擋）
  IF NOT v_new THEN
  -- 已被有效請款單引用：只能改備註與各項原因
  SELECT string_agg(DISTINCT q.pr_no, '、' ORDER BY q.pr_no) INTO v_refs FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.invoice_id = i.id AND q.status <> 'VOID';
  IF v_refs IS NOT NULL THEN
    SELECT COALESCE(array_agg(ir.receipt_id ORDER BY ir.receipt_id), ARRAY[]::uuid[]) INTO v_old_receipts FROM public.ga_purchase_invoice_receipts ir WHERE ir.invoice_id = i.id;
    v_changed := v_type IS DISTINCT FROM o.invoice_type OR v_no IS DISTINCT FROM o.invoice_no OR v_date IS DISTINCT FROM o.invoice_date OR v_vendor IS DISTINCT FROM o.vendor_id
      OR v_untaxed IS DISTINCT FROM o.amount_untaxed OR v_tax IS DISTINCT FROM o.tax_amount OR nullif(v_seller, '') IS DISTINCT FROM o.seller_tax_id_snapshot
      OR v_old_receipts IS DISTINCT FROM COALESCE((SELECT array_agg(x ORDER BY x) FROM unnest(v_seen) x), ARRAY[]::uuid[])
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_calc) c JOIN public.ga_purchase_invoice_receipts ir ON ir.receipt_id = (c.value ->> 'receipt_id')::uuid AND ir.invoice_id = i.id
                  WHERE ir.allocated_untaxed <> (c.value ->> 'allocated_untaxed')::numeric OR ir.allocated_tax <> (c.value ->> 'allocated_tax')::numeric);
    IF v_changed THEN
      RETURN public.ga_rq_err(409, 'INVOICE_IN_USE', '這張發票已被請款單 ' || v_refs || ' 使用，類型、號碼、日期、金額與連結的進貨單都不能改；請先作廢或退回請款單，或只修改備註與原因');
    END IF;
  END IF;
  END IF;

  -- 原因欄位
  v_diff := CASE WHEN p ? 'diff_reason' THEN public.ga_pay_txt(p, 'diff_reason', 200, '差異原因') ELSE i.diff_reason END;
  v_taxr := CASE WHEN p ? 'tax_mismatch_reason' THEN public.ga_pay_txt(p, 'tax_mismatch_reason', 200, '統編不符原因') ELSE i.tax_mismatch_reason END;
  v_noimg := CASE WHEN p ? 'no_image_reason' THEN public.ga_pay_txt(p, 'no_image_reason', 200, '沒有圖片的原因') ELSE i.no_image_reason END;
  v_notes := CASE WHEN p ? 'notes' THEN public.ga_pay_txt(p, 'notes', 500, '備註') ELSE i.notes END;
  IF v_type <> 'RECEIPT' THEN v_noimg := NULL; END IF;
  -- 已被有效請款單引用時，不能把「沒有圖片的原因」清掉而讓發票變成缺圖
  IF NOT v_new AND v_refs IS NOT NULL
     AND public.ga_pay_invoice_missing_image(v_type, v_noimg, public.ga_pay_invoice_image_count(i.id))
     AND NOT public.ga_pay_invoice_missing_image(o.invoice_type, o.no_image_reason, public.ga_pay_invoice_image_count(i.id)) THEN
    RETURN public.ga_rq_err(409, 'INVOICE_IN_USE', '這張發票已被請款單 ' || v_refs || ' 使用，沒有圖片的原因不能清掉（會變成缺圖）；請先上傳圖片，或先作廢、退回請款單');
  END IF;
  IF v_mismatch AND v_taxr IS NULL THEN
    RETURN public.ga_rq_err(400, 'TAX_MISMATCH_REASON_REQUIRED', '統一編號與採購單下訂時的廠商統編或設定的買受人統編不符，請填寫原因（仍可儲存）',
      jsonb_build_object('expected_seller_tax_id', CASE WHEN public.ga_pay_can_vendor(v_uid) THEN v_expect_tax END, 'buyer_tax_id', v_buyer_cfg));
  END IF;
  IF NOT v_mismatch THEN v_taxr := NULL; END IF;
  IF jsonb_array_length(v_links) > 0 AND (abs(v_total - v_recv_total) > v_tol OR abs(v_total - v_alloc_total) > v_tol) THEN
    IF v_diff IS NULL THEN
      RETURN public.ga_rq_err(400, 'DIFF_REASON_REQUIRED', '發票含稅金額 ' || public.ga_pay_money(v_total) || ' 元與連結進貨單合計 ' || public.ga_pay_money(v_recv_total) || ' 元相差 ' || public.ga_pay_money(abs(v_total - v_recv_total))
        || ' 元，超過尾差 ' || public.ga_pay_money(v_tol) || ' 元，請填寫差異原因（仍可儲存）', jsonb_build_object('invoice_total', v_total, 'receipts_total', v_recv_total, 'tolerance', v_tol));
    END IF;
  ELSE
    v_diff := NULL;
  END IF;

  -- 同廠商同發票號碼
  IF v_no IS NOT NULL THEN
    SELECT d.id, d.invoice_date, d.amount_total INTO v_dup FROM public.ga_purchase_invoices d
     WHERE d.vendor_id = v_vendor AND lower(btrim(d.invoice_no)) = lower(btrim(v_no)) AND d.status <> 'VOID' AND d.id IS DISTINCT FROM i.id LIMIT 1;
    IF FOUND THEN RETURN public.ga_rq_err(409, 'INVOICE_NO_DUPLICATE', '這個廠商已登錄過發票號碼 ' || v_no || '（發票日期 ' || v_dup.invoice_date || '，含稅 ' || public.ga_pay_money(v_dup.amount_total) || ' 元），同一個號碼不能重複登錄',
      jsonb_build_object('existing', jsonb_build_object('id', v_dup.id))); END IF;
  END IF;

  IF v_new THEN
    INSERT INTO public.ga_purchase_invoices (invoice_type, invoice_no, invoice_date, vendor_id, seller_tax_id_snapshot, buyer_tax_id, amount_untaxed, tax_amount, amount_total,
      diff_reason, tax_mismatch_reason, no_image_reason, notes, idempotency_key, payload_hash, created_by, updated_by)
    VALUES (v_type, v_no, v_date, v_vendor, nullif(v_seller, ''), nullif(v_buyer, ''), v_untaxed, v_tax, v_total, v_diff, v_taxr, v_noimg, v_notes, v_key, v_hash, v_uid, v_uid)
    RETURNING * INTO i;
  ELSE
    UPDATE public.ga_purchase_invoices SET invoice_type = v_type, invoice_no = v_no, invoice_date = v_date, vendor_id = v_vendor, seller_tax_id_snapshot = nullif(v_seller, ''), buyer_tax_id = nullif(v_buyer, ''),
      amount_untaxed = v_untaxed, tax_amount = v_tax, amount_total = v_total, diff_reason = v_diff, tax_mismatch_reason = v_taxr, no_image_reason = v_noimg, notes = v_notes,
      updated_by = v_uid, updated_at = clock_timestamp() WHERE id = i.id RETURNING * INTO i;
  END IF;

  -- 連結進貨單（整批取代）並同步憑證狀態
  SELECT COALESCE(array_agg(ir.receipt_id), ARRAY[]::uuid[]) INTO v_old_receipts FROM public.ga_purchase_invoice_receipts ir WHERE ir.invoice_id = i.id;
  DELETE FROM public.ga_purchase_invoice_receipts WHERE invoice_id = i.id;
  INSERT INTO public.ga_purchase_invoice_receipts (invoice_id, receipt_id, allocated_untaxed, allocated_tax)
    SELECT i.id, (c.value ->> 'receipt_id')::uuid, (c.value ->> 'allocated_untaxed')::numeric, (c.value ->> 'allocated_tax')::numeric FROM jsonb_array_elements(v_calc) c;
  FOR v_rid IN SELECT DISTINCT x FROM unnest(v_old_receipts || v_seen) x ORDER BY x LOOP
    PERFORM public.ga_pay_sync_voucher(v_rid, v_uid);
  END LOOP;

  v_images := public.ga_pay_invoice_image_count(i.id);
  IF public.ga_pay_invoice_missing_image(i.invoice_type, i.no_image_reason, v_images) THEN
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'MISSING_IMAGE', 'message', CASE WHEN i.invoice_type = 'RECEIPT' THEN '收據還沒有上傳圖片，請上傳圖片或填寫沒有圖片的原因；缺圖的發票不能放進請款單'
      ELSE '這張發票還沒有上傳圖片（缺圖），請上傳圖片；缺圖的發票不能放進請款單' END));
  END IF;
  IF v_mismatch THEN v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'TAX_MISMATCH', 'message', '統一編號與採購單或設定不符，已記錄原因')); END IF;
  IF v_diff IS NOT NULL THEN v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'AMOUNT_DIFF', 'message', '發票金額與進貨金額差異超過尾差，已記錄原因')); END IF;
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN v_new THEN 201 ELSE 200 END, 'replay', false, 'data', public.ga_pay_invoice_json(i.id, public.ga_pay_can_vendor(v_uid)), 'warnings', v_warn);
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ws_pay_invoice_get(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看發票的權限'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ga_purchase_invoices WHERE id = p_id) THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張發票'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_pay_invoice_json(p_id, public.ga_pay_can_vendor(v_uid)), 'can_manage', public.ga_pay_can_manage(v_uid));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 列表：filters = {vendor_id, status:'ACTIVE|VOID', type, missing_image:true, unreferenced:true, receipt_id, po_id, date_from, date_to, search}
CREATE OR REPLACE FUNCTION public.ga_ws_pay_invoice_list(p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  v_vendor uuid;
  v_status text;
  v_type text;
  v_receipt uuid;
  v_po uuid;
  v_from date;
  v_to date;
  v_q text;
  v_pat text;
  v_missing boolean := COALESCE(v_f ->> 'missing_image', '') IN ('true', '1');
  v_unref boolean := COALESCE(v_f ->> 'unreferenced', '') IN ('true', '1');
  v_can_vendor boolean;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看發票的權限'); END IF;
  v_can_vendor := public.ga_pay_can_vendor(v_uid);
  v_vendor := public.ga_pay_uuid(v_f ->> 'vendor_id', '廠商', false);
  v_receipt := public.ga_pay_uuid(v_f ->> 'receipt_id', '進貨單', false);
  v_po := public.ga_pay_uuid(v_f ->> 'po_id', '採購單', false);
  v_status := upper(public.ga_pay_txt(v_f, 'status', 10, '狀態'));
  v_type := upper(public.ga_pay_txt(v_f, 'type', 20, '發票類型'));
  v_from := public.ga_pay_date(v_f ->> 'date_from', '起始日期');
  v_to := public.ga_pay_date(v_f ->> 'date_to', '結束日期');
  v_q := public.ga_pay_txt(v_f, 'search', 100, '搜尋');
  IF v_status IS NOT NULL AND v_status NOT IN ('ACTIVE', 'VOID') THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '狀態篩選值錯誤'); END IF;
  IF v_type IS NOT NULL AND v_type NOT IN ('TRIPLE', 'DUPLEX', 'E_INVOICE', 'RECEIPT', 'NO_INVOICE') THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '發票類型篩選值錯誤'); END IF;
  IF v_q IS NOT NULL THEN v_pat := '%' || public.ga_po_like_escape(v_q) || '%'; END IF;
  WITH f AS (
    SELECT i.id, i.invoice_date, i.created_at, i.amount_total FROM public.ga_purchase_invoices i
     WHERE (v_vendor IS NULL OR i.vendor_id = v_vendor) AND (v_status IS NULL OR i.status = v_status) AND (v_type IS NULL OR i.invoice_type = v_type)
       AND (v_from IS NULL OR i.invoice_date >= v_from) AND (v_to IS NULL OR i.invoice_date <= v_to)
       AND (v_receipt IS NULL OR EXISTS (SELECT 1 FROM public.ga_purchase_invoice_receipts ir WHERE ir.invoice_id = i.id AND ir.receipt_id = v_receipt))
       AND (v_po IS NULL OR EXISTS (SELECT 1 FROM public.ga_purchase_invoice_receipts ir JOIN public.ga_purchase_receipts r ON r.id = ir.receipt_id WHERE ir.invoice_id = i.id AND r.po_id = v_po))
       AND (NOT v_missing OR (i.status = 'ACTIVE' AND public.ga_pay_invoice_missing_image(i.invoice_type, i.no_image_reason, public.ga_pay_invoice_image_count(i.id))))
       AND (NOT v_unref OR NOT EXISTS (SELECT 1 FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.invoice_id = i.id AND q.status <> 'VOID'))
       AND (v_pat IS NULL OR COALESCE(i.invoice_no, '') ILIKE v_pat ESCAPE '\' OR COALESCE(i.notes, '') ILIKE v_pat ESCAPE '\'
            OR EXISTS (SELECT 1 FROM public.ga_vendors v WHERE v.id = i.vendor_id AND v.name ILIKE v_pat ESCAPE '\'))
  )
  SELECT jsonb_build_object('total', (SELECT count(*) FROM f),
      'summary', (SELECT jsonb_build_object('count', count(*), 'total_amount', COALESCE(sum(amount_total), 0)) FROM f),
      'rows', COALESCE((SELECT jsonb_agg(public.ga_pay_invoice_json(x.id, v_can_vendor) ORDER BY x.invoice_date DESC, x.created_at DESC, x.id)
        FROM (SELECT id, invoice_date, created_at FROM f ORDER BY invoice_date DESC, created_at DESC, id LIMIT v_size OFFSET (v_page - 1) * v_size) x), '[]'::jsonb)) INTO v_out;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_out -> 'rows', 'total', v_out -> 'total', 'page', v_page, 'page_size', v_size, 'summary', v_out -> 'summary'));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 作廢發票：必填原因；已被有效請款單引用者擋下（先作廢或退回請款單）；作廢後同步進貨憑證狀態。同一個 p_key 重送回原結果。
CREATE OR REPLACE FUNCTION public.ga_ws_pay_invoice_void(p_id uuid, p_reason text, p_key text, p_expected_updated_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := nullif(btrim(COALESCE(p_key, '')), '');
  v_reason text := nullif(btrim(COALESCE(p_reason, '')), '');
  i public.ga_purchase_invoices%ROWTYPE;
  v_refs text;
  v_rid uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有作廢發票的權限（需要請款管理權限）'); END IF;
  IF v_key IS NULL OR char_length(v_key) > 64 THEN RETURN public.ga_rq_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼，請重新整理畫面後再送出'); END IF;
  IF v_reason IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '請填寫作廢原因'); END IF;
  IF char_length(v_reason) > 200 THEN RETURN public.ga_rq_err(400, 'FIELD_TOO_LONG', '作廢原因不可超過 200 個字'); END IF;
  SELECT * INTO i FROM public.ga_purchase_invoices WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張發票'); END IF;
  IF i.status = 'VOID' THEN
    IF i.void_key = v_key AND i.void_reason = v_reason THEN RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', true, 'data', public.ga_pay_invoice_json(i.id, public.ga_pay_can_vendor(v_uid))); END IF;
    RETURN public.ga_rq_err(409, 'INVALID_STATE', '這張發票已經作廢');
  END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再送出'); END IF;
  IF i.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張發票剛被其他人修改，請重新載入後再送出'); END IF;
  SELECT string_agg(DISTINCT q.pr_no, '、' ORDER BY q.pr_no) INTO v_refs FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.invoice_id = i.id AND q.status <> 'VOID';
  IF v_refs IS NOT NULL THEN RETURN public.ga_rq_err(409, 'INVOICE_IN_USE', '這張發票已被請款單 ' || v_refs || ' 使用，請先作廢或退回該請款單，再作廢發票'); END IF;
  UPDATE public.ga_purchase_invoices SET status = 'VOID', void_reason = v_reason, voided_by = v_uid, voided_at = now(), void_key = v_key, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = i.id RETURNING * INTO i;
  FOR v_rid IN SELECT ir.receipt_id FROM public.ga_purchase_invoice_receipts ir WHERE ir.invoice_id = i.id ORDER BY ir.receipt_id LOOP
    PERFORM public.ga_pay_sync_voucher(v_rid, v_uid);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', false, 'data', public.ga_pay_invoice_json(i.id, public.ga_pay_can_vendor(v_uid)));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- ================================================================ 7. 可請款進貨
-- filters = {vendor_id, po_id, search（採購單號、進貨單號、送貨單號）, only_claimable:true（預設只列採購單尚有可請款額的進貨）}
CREATE OR REPLACE FUNCTION public.ga_ws_pay_receipt_candidates(p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  v_vendor uuid;
  v_po uuid;
  v_q text;
  v_pat text;
  v_only boolean := COALESCE(v_f ->> 'only_claimable', 'true') NOT IN ('false', '0');
  v_tol numeric := public.ga_pay_tol();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看請款資料的權限'); END IF;
  IF NOT public.ga_po_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PO_VIEW_REQUIRED', '查看可請款的進貨需要「採購評估檢視」權限'); END IF;
  v_vendor := public.ga_pay_uuid(v_f ->> 'vendor_id', '廠商', false);
  v_po := public.ga_pay_uuid(v_f ->> 'po_id', '採購單', false);
  v_q := public.ga_pay_txt(v_f, 'search', 100, '搜尋');
  IF v_q IS NOT NULL THEN v_pat := '%' || public.ga_po_like_escape(v_q) || '%'; END IF;
  WITH base AS (
    SELECT r.id AS receipt_id, r.receipt_no, r.received_date, r.delivery_note_no, r.voucher_status, r.created_at, o.id AS po_id, o.po_no, o.vendor_id, COALESCE(o.vendor_name_snapshot, '') AS vendor_name,
           public.ga_pay_receipt_untaxed(r.id) AS u, o.tax_rate,
           (public.ga_pay_po_received(o.id) ->> 'total')::numeric AS po_received_total, public.ga_pay_po_claimed(o.id) AS po_claimed
      FROM public.ga_purchase_receipts r JOIN public.ga_purchase_orders o ON o.id = r.po_id
     WHERE r.voided_at IS NULL AND EXISTS (SELECT 1 FROM public.ga_purchase_receipt_items ri WHERE ri.receipt_id = r.id AND ri.accepted_qty > 0)
       AND (v_vendor IS NULL OR o.vendor_id = v_vendor) AND (v_po IS NULL OR o.id = v_po)
       AND (v_pat IS NULL OR o.po_no ILIKE v_pat ESCAPE '\' OR r.receipt_no ILIKE v_pat ESCAPE '\' OR COALESCE(r.delivery_note_no, '') ILIKE v_pat ESCAPE '\')
  ), f AS (
    SELECT * FROM base WHERE NOT v_only OR po_received_total - po_claimed > 0
  )
  SELECT jsonb_build_object('total', (SELECT count(*) FROM f),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'receipt_id', x.receipt_id, 'receipt_no', x.receipt_no, 'received_date', x.received_date, 'delivery_note_no', x.delivery_note_no, 'voucher_status', x.voucher_status,
        'po_id', x.po_id, 'po_no', x.po_no, 'vendor_id', x.vendor_id, 'vendor_name', x.vendor_name, 'tax_rate', x.tax_rate,
        'receipt_untaxed', x.u, 'receipt_tax', round(x.u * x.tax_rate), 'receipt_total', x.u + round(x.u * x.tax_rate),
        'receipt_claimed', (SELECT COALESCE(sum(l.claim_total), 0) FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.receipt_id = x.receipt_id AND q.status <> 'VOID'),
        'po_received_total', x.po_received_total, 'po_claimed_total', x.po_claimed, 'po_remaining', GREATEST(x.po_received_total - x.po_claimed, 0), 'po_remaining_max', GREATEST(x.po_received_total + v_tol - x.po_claimed, 0),
        'tolerance', v_tol,
        'invoices', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'invoice_no', i.invoice_no, 'invoice_type', i.invoice_type, 'amount_total', i.amount_total, 'allocated_total', ir.allocated_untaxed + ir.allocated_tax,
                        'missing_image', public.ga_pay_invoice_missing_image(i.invoice_type, i.no_image_reason, public.ga_pay_invoice_image_count(i.id))) ORDER BY i.invoice_date, i.id), '[]'::jsonb)
                       FROM public.ga_purchase_invoice_receipts ir JOIN public.ga_purchase_invoices i ON i.id = ir.invoice_id WHERE ir.receipt_id = x.receipt_id AND i.status = 'ACTIVE'))
        ORDER BY x.received_date DESC, x.receipt_no DESC)
      FROM (SELECT * FROM f ORDER BY received_date DESC, receipt_no DESC, receipt_id LIMIT v_size OFFSET (v_page - 1) * v_size) x), '[]'::jsonb)) INTO v_out;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_out -> 'rows', 'total', v_out -> 'total', 'page', v_page, 'page_size', v_size));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- ================================================================ 8. 請款單：明細寫入與檢查
-- 驗證並寫入請款明細（先鎖採購單，依序處理；呼叫端已鎖請款單列）。成功後回寫請款單金額；任何不符就 raise（由外層函式整筆回復）。
CREATE OR REPLACE FUNCTION public.ga_pay_apply_lines(p_pr uuid, p_vendor uuid, p_lines jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_el jsonb;
  v_no integer := 0;
  v_rid uuid;
  v_iid uuid;
  v_rec record;
  v_inv public.ga_purchase_invoices%ROWTYPE;
  v_ir public.ga_purchase_invoice_receipts%ROWTYPE;
  v_u numeric;
  v_t numeric;
  v_total numeric;
  v_diff text;
  v_tol numeric := public.ga_pay_tol();
  v_pos uuid[] := ARRAY[]::uuid[];
  v_po uuid;
  v_seen text[] := ARRAY[]::text[];
  v_recv numeric;
  v_claimed numeric;
  v_sum_u numeric := 0;
  v_sum_t numeric := 0;
  v_ponos text;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN PERFORM public.ga_rq_raise(400, 'LINES_REQUIRED', '請至少選擇一筆進貨來請款'); END IF;
  IF jsonb_array_length(p_lines) > 100 THEN PERFORM public.ga_rq_raise(400, 'TOO_MANY_ITEMS', '一張請款單最多 100 筆明細'); END IF;
  -- 先鎖採購單（依 id 排序避免死結）
  FOR v_el IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    IF jsonb_typeof(v_el) <> 'object' THEN PERFORM public.ga_rq_raise(400, 'LINE_INVALID', '請款明細格式錯誤'); END IF;
    v_rid := public.ga_pay_uuid(v_el ->> 'receipt_id', '進貨單', true);
    SELECT r.po_id INTO v_po FROM public.ga_purchase_receipts r WHERE r.id = v_rid;
    IF NOT FOUND THEN PERFORM public.ga_rq_raise(404, 'RECEIPT_NOT_FOUND', '找不到要請款的進貨單，請重新整理後再試'); END IF;
    IF NOT (v_po = ANY (v_pos)) THEN v_pos := array_append(v_pos, v_po); END IF;
  END LOOP;
  FOR v_po IN SELECT x FROM unnest(v_pos) x ORDER BY x LOOP PERFORM public.ga_pay_lock_po(v_po); END LOOP;

  FOR v_el IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_no := v_no + 1;
    v_rid := (v_el ->> 'receipt_id')::uuid;
    v_iid := public.ga_pay_uuid(v_el ->> 'invoice_id', '發票', false);
    IF (v_rid::text || ':' || COALESCE(v_iid::text, '')) = ANY (v_seen) THEN PERFORM public.ga_rq_raise(400, 'DUPLICATE_LINE', '同一筆進貨與發票的組合在這張請款單重複出現，請合併成一列'); END IF;
    v_seen := array_append(v_seen, v_rid::text || ':' || COALESCE(v_iid::text, ''));
    SELECT r.id, r.receipt_no, r.voided_at, o.id AS po_id, o.po_no, o.vendor_id, o.tax_rate INTO v_rec FROM public.ga_purchase_receipts r JOIN public.ga_purchase_orders o ON o.id = r.po_id WHERE r.id = v_rid;
    IF v_rec.voided_at IS NOT NULL THEN PERFORM public.ga_rq_raise(409, 'RECEIPT_VOIDED', '進貨單 ' || v_rec.receipt_no || ' 已作廢，不能請款'); END IF;
    IF v_rec.vendor_id IS DISTINCT FROM p_vendor THEN PERFORM public.ga_rq_raise(400, 'VENDOR_MISMATCH', '進貨單 ' || v_rec.receipt_no || ' 不是這個廠商的進貨，一張請款單只能請同一個廠商'); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ga_purchase_receipt_items ri WHERE ri.receipt_id = v_rid AND ri.accepted_qty > 0) THEN
      PERFORM public.ga_rq_raise(422, 'NO_ACCEPTED', '進貨單 ' || v_rec.receipt_no || ' 沒有驗入的品項（全部拒收），不能請款');
    END IF;
    -- 請款額：沒填用整張進貨單金額；稅額沒填用稅率自動算
    v_u := public.ga_pay_int(v_el, 'claim_untaxed', '請款未稅金額', false);
    IF v_u IS NULL THEN v_u := public.ga_pay_receipt_untaxed(v_rid); END IF;
    v_t := public.ga_pay_int(v_el, 'claim_tax', '請款稅額', false);
    IF v_t IS NULL THEN v_t := round(v_u * v_rec.tax_rate); END IF;
    v_total := v_u + v_t;
    IF v_total <= 0 THEN PERFORM public.ga_rq_raise(400, 'AMOUNT_REQUIRED', '進貨單 ' || v_rec.receipt_no || ' 的請款金額必須大於 0'); END IF;
    v_diff := public.ga_pay_txt(v_el, 'diff_reason', 200, '差異原因');
    IF v_iid IS NOT NULL THEN
      SELECT * INTO v_inv FROM public.ga_purchase_invoices WHERE id = v_iid FOR SHARE;
      IF NOT FOUND THEN PERFORM public.ga_rq_raise(404, 'INVOICE_NOT_FOUND', '找不到選擇的發票，請重新整理後再試'); END IF;
      IF v_inv.status <> 'ACTIVE' THEN PERFORM public.ga_rq_raise(409, 'INVOICE_VOID', '發票 ' || COALESCE(v_inv.invoice_no, '') || ' 已作廢，不能放進請款單'); END IF;
      IF v_inv.vendor_id IS DISTINCT FROM p_vendor THEN PERFORM public.ga_rq_raise(400, 'VENDOR_MISMATCH', '發票 ' || COALESCE(v_inv.invoice_no, '') || ' 不是這個廠商的發票'); END IF;
      SELECT * INTO v_ir FROM public.ga_purchase_invoice_receipts WHERE invoice_id = v_iid AND receipt_id = v_rid;
      IF NOT FOUND THEN PERFORM public.ga_rq_raise(400, 'INVOICE_NOT_LINKED', '發票 ' || COALESCE(v_inv.invoice_no, '') || ' 沒有連結進貨單 ' || v_rec.receipt_no || '，請先到發票頁連結'); END IF;
      IF public.ga_pay_invoice_missing_image(v_inv.invoice_type, v_inv.no_image_reason, public.ga_pay_invoice_image_count(v_iid)) THEN
        PERFORM public.ga_rq_raise(409, 'INVOICE_MISSING_IMAGE', '發票 ' || COALESCE(v_inv.invoice_no, v_inv.invoice_type) || ' 還沒有上傳圖片（缺圖），不能放進請款單；請先上傳圖片' || CASE WHEN v_inv.invoice_type = 'RECEIPT' THEN '或填寫沒有圖片的原因' ELSE '' END,
          jsonb_build_object('invoice_id', v_iid));
      END IF;
      IF abs(v_total - (v_ir.allocated_untaxed + v_ir.allocated_tax)) > v_tol AND v_diff IS NULL THEN
        PERFORM public.ga_rq_raise(400, 'DIFF_REASON_REQUIRED', '進貨單 ' || v_rec.receipt_no || ' 的請款額 ' || public.ga_pay_money(v_total) || ' 元與發票分攤金額 ' || public.ga_pay_money(v_ir.allocated_untaxed + v_ir.allocated_tax)
          || ' 元相差超過尾差 ' || public.ga_pay_money(v_tol) || ' 元，請填寫差異原因（仍可送出）', jsonb_build_object('line_no', v_no));
      END IF;
      IF abs(v_total - (v_ir.allocated_untaxed + v_ir.allocated_tax)) <= v_tol THEN v_diff := NULL; END IF;
    ELSE
      v_diff := NULL;
    END IF;
    INSERT INTO public.ga_payment_request_lines (pr_id, line_no, po_id, receipt_id, invoice_id, claim_untaxed, claim_tax, claim_total, diff_reason)
    VALUES (p_pr, v_no, v_rec.po_id, v_rid, v_iid, v_u, v_t, v_total, v_diff);
    v_sum_u := v_sum_u + v_u;
    v_sum_t := v_sum_t + v_t;
  END LOOP;

  -- 累計請款上限（硬擋）
  FOR v_po IN SELECT x FROM unnest(v_pos) x ORDER BY x LOOP
    v_recv := (public.ga_pay_po_received(v_po) ->> 'total')::numeric;
    v_claimed := public.ga_pay_po_claimed(v_po);
    IF v_claimed > v_recv + v_tol THEN
      SELECT po_no INTO v_ponos FROM public.ga_purchase_orders WHERE id = v_po;
      PERFORM public.ga_rq_raise(409, 'OVER_CLAIM', '採購單 ' || v_ponos || ' 累計請款 ' || public.ga_pay_money(v_claimed) || ' 元，超過累計驗入含稅金額 ' || public.ga_pay_money(v_recv) || ' 元（容許尾差 ' || public.ga_pay_money(v_tol) || ' 元）；拒收、未到貨的部分不能請款',
        jsonb_build_object('po_id', v_po, 'po_no', v_ponos, 'received_total', v_recv, 'claimed_total', v_claimed, 'tolerance', v_tol));
    END IF;
  END LOOP;
  UPDATE public.ga_payment_requests SET amount_untaxed = v_sum_u, tax_amount = v_sum_t, amount_total = v_sum_u + v_sum_t WHERE id = p_pr;
END;
$$;
REVOKE ALL ON FUNCTION public.ga_pay_apply_lines(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 送出前的即時檢查：進貨單未作廢、發票有效且不缺圖、累計請款不超過上限（呼叫端已鎖請款單）。
CREATE OR REPLACE FUNCTION public.ga_pay_check_live(p_pr uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  l record;
  v_po uuid;
  v_recv numeric;
  v_claimed numeric;
  v_tol numeric := public.ga_pay_tol();
  v_ponos text;
BEGIN
  FOR v_po IN SELECT DISTINCT x.po_id FROM public.ga_payment_request_lines x WHERE x.pr_id = p_pr ORDER BY 1 LOOP PERFORM public.ga_pay_lock_po(v_po); END LOOP;
  -- 引用的發票列加共享鎖（直到交易結束）：檢查與送出之間，發票不能被改金額、作廢或刪掉最後一張圖
  PERFORM 1 FROM public.ga_purchase_invoices i WHERE i.id IN (SELECT x.invoice_id FROM public.ga_payment_request_lines x WHERE x.pr_id = p_pr AND x.invoice_id IS NOT NULL) ORDER BY i.id FOR SHARE;
  FOR l IN SELECT x.line_no, r.receipt_no, r.voided_at, i.id AS inv_id, i.invoice_no, i.invoice_type, i.status AS inv_status, i.no_image_reason
             FROM public.ga_payment_request_lines x JOIN public.ga_purchase_receipts r ON r.id = x.receipt_id LEFT JOIN public.ga_purchase_invoices i ON i.id = x.invoice_id WHERE x.pr_id = p_pr ORDER BY x.line_no LOOP
    IF l.voided_at IS NOT NULL THEN PERFORM public.ga_rq_raise(409, 'RECEIPT_VOIDED', '進貨單 ' || l.receipt_no || ' 已作廢，請把它從請款單移除'); END IF;
    IF l.inv_id IS NOT NULL THEN
      IF l.inv_status <> 'ACTIVE' THEN PERFORM public.ga_rq_raise(409, 'INVOICE_VOID', '發票 ' || COALESCE(l.invoice_no, '') || ' 已作廢，請把它從請款單移除'); END IF;
      IF public.ga_pay_invoice_missing_image(l.invoice_type, l.no_image_reason, public.ga_pay_invoice_image_count(l.inv_id)) THEN
        PERFORM public.ga_rq_raise(409, 'INVOICE_MISSING_IMAGE', '發票 ' || COALESCE(l.invoice_no, l.invoice_type) || ' 還沒有上傳圖片（缺圖），不能送出請款；請先上傳圖片', jsonb_build_object('invoice_id', l.inv_id));
      END IF;
    END IF;
  END LOOP;
  FOR v_po IN SELECT DISTINCT x.po_id FROM public.ga_payment_request_lines x WHERE x.pr_id = p_pr ORDER BY 1 LOOP
    v_recv := (public.ga_pay_po_received(v_po) ->> 'total')::numeric;
    v_claimed := public.ga_pay_po_claimed(v_po);
    IF v_claimed > v_recv + v_tol THEN
      SELECT po_no INTO v_ponos FROM public.ga_purchase_orders WHERE id = v_po;
      PERFORM public.ga_rq_raise(409, 'OVER_CLAIM', '採購單 ' || v_ponos || ' 累計請款 ' || public.ga_pay_money(v_claimed) || ' 元，超過累計驗入含稅金額 ' || public.ga_pay_money(v_recv) || ' 元（容許尾差 ' || public.ga_pay_money(v_tol) || ' 元）',
        jsonb_build_object('po_id', v_po, 'po_no', v_ponos, 'received_total', v_recv, 'claimed_total', v_claimed, 'tolerance', v_tol));
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.ga_pay_check_live(uuid) FROM PUBLIC, anon, authenticated;

-- 廠商快照：名稱、統編、銀行（機密，只存在請款單快照；對外一律經 ga_pay_request_json 遮蔽）。
CREATE OR REPLACE FUNCTION public.ga_pay_vendor_snapshot(p_vendor uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT jsonb_build_object('name', v.name, 'tax_id', v.tax_id, 'bank', jsonb_build_object('bank_name', v.bank_name, 'bank_branch', v.bank_branch, 'bank_account', v.bank_account, 'bank_account_name', v.bank_account_name))
        FROM public.ga_vendors v WHERE v.id = p_vendor; $$;
REVOKE ALL ON FUNCTION public.ga_pay_vendor_snapshot(uuid) FROM PUBLIC, anon, authenticated;

-- ================================================================ 9. 請款單：建立、修改、動作
-- payload：vendor_id、expected_pay_date、notes、lines:[{receipt_id, invoice_id?, claim_untaxed?, claim_tax?, diff_reason?}]
CREATE OR REPLACE FUNCTION public.ga_ws_pay_request_create(p_payload jsonb, p_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_key text := nullif(btrim(COALESCE(p_key, '')), '');
  v_hash text;
  q public.ga_payment_requests%ROWTYPE;
  v_vendor uuid;
  v_snap jsonb;
  v_pay date;
  v_notes text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有建立請款單的權限（需要請款管理權限）'); END IF;
  IF v_key IS NULL OR char_length(v_key) > 64 THEN RETURN public.ga_rq_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼，請重新整理畫面後再送出'); END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;
  v_hash := md5(p::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('ga_pay_request_create:' || v_key, 0));
  SELECT * INTO q FROM public.ga_payment_requests WHERE idempotency_key = v_key;
  IF FOUND THEN
    IF q.payload_hash = v_hash AND q.created_by = v_uid THEN
      RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', true, 'data', public.ga_pay_request_json(q.id, public.ga_pay_can_vendor(v_uid), public.ga_po_can_view(v_uid), true));
    END IF;
    RETURN public.ga_rq_err(409, 'IDEMPOTENCY_CONFLICT', '這個送出識別碼已被另一張不同內容的請款單使用，請重新整理畫面後再送出');
  END IF;
  v_vendor := public.ga_pay_uuid(p ->> 'vendor_id', '廠商', true);
  v_snap := public.ga_pay_vendor_snapshot(v_vendor);
  IF v_snap IS NULL THEN RETURN public.ga_rq_err(404, 'VENDOR_NOT_FOUND', '找不到這個廠商'); END IF;
  v_pay := public.ga_pay_date(p ->> 'expected_pay_date', '預計付款日');
  v_notes := public.ga_pay_txt(p, 'notes', 500, '備註');
  INSERT INTO public.ga_payment_requests (pr_no, vendor_id, vendor_name_snapshot, vendor_tax_id_snapshot, bank_snapshot, status, expected_pay_date, notes, idempotency_key, payload_hash, created_by, updated_by)
  VALUES (public.ga_next_pr_no(), v_vendor, v_snap ->> 'name', v_snap ->> 'tax_id', v_snap -> 'bank', 'DRAFT', v_pay, v_notes, v_key, v_hash, v_uid, v_uid) RETURNING * INTO q;
  PERFORM public.ga_pay_apply_lines(q.id, v_vendor, p -> 'lines');
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = q.id;
  PERFORM public.ga_pay_event(q.id, 'create', NULL, 'DRAFT', v_uid, NULL, q.amount_total, jsonb_build_object('line_count', jsonb_array_length(p -> 'lines')), NULL);
  RETURN jsonb_build_object('ok', true, 'status', 201, 'replay', false, 'data', public.ga_pay_request_json(q.id, public.ga_pay_can_vendor(v_uid), public.ga_po_can_view(v_uid), true));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 修改草稿：payload 可含 expected_pay_date、notes、lines（有 lines 就整批取代）。只有 DRAFT 可改；已送出請先退回、已付款鎖定。
CREATE OR REPLACE FUNCTION public.ga_ws_pay_request_update(p_id uuid, p_payload jsonb, p_expected_updated_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  p jsonb := COALESCE(p_payload, '{}'::jsonb);
  q public.ga_payment_requests%ROWTYPE;
  v_pay date;
  v_notes text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有修改請款單的權限（需要請款管理權限）'); END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再儲存'); END IF;
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張請款單'); END IF;
  IF q.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張請款單剛被其他人修改，請重新載入後再儲存'); END IF;
  IF q.status <> 'DRAFT' THEN
    RETURN public.ga_rq_err(409, 'INVALID_STATE', CASE q.status WHEN 'SUBMITTED' THEN '這張請款單已送出，要修改請先退回草稿' WHEN 'PAID' THEN '這張請款單已付款，內容鎖定，只能加備註或作廢' ELSE '這張請款單已作廢，不能修改' END, jsonb_build_object('current_status', q.status));
  END IF;
  v_pay := CASE WHEN p ? 'expected_pay_date' THEN public.ga_pay_date(p ->> 'expected_pay_date', '預計付款日') ELSE q.expected_pay_date END;
  v_notes := CASE WHEN p ? 'notes' THEN public.ga_pay_txt(p, 'notes', 500, '備註') ELSE q.notes END;
  IF p ? 'lines' THEN
    DELETE FROM public.ga_payment_request_lines WHERE pr_id = q.id;
    PERFORM public.ga_pay_apply_lines(q.id, q.vendor_id, p -> 'lines');
  END IF;
  UPDATE public.ga_payment_requests SET expected_pay_date = v_pay, notes = v_notes, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;
  PERFORM public.ga_pay_event(q.id, 'update', 'DRAFT', 'DRAFT', v_uid, NULL, q.amount_total, jsonb_build_object('lines_replaced', p ? 'lines'), NULL);
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_pay_request_json(q.id, public.ga_pay_can_vendor(v_uid), public.ga_po_can_view(v_uid), true));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 動作：submit（送出）、return（退回草稿，原因必填）、mark_paid（標已付款：pay_method、paid_date、paid_ref）、void（作廢：已送出與已付款必填原因）、note（備註）、refresh_bank（草稿重抓廠商帳號）。
-- 同一個 p_key 重送回原結果（內容不同回 409 IDEMPOTENCY_CONFLICT）；版本不符回 409 STALE。
CREATE OR REPLACE FUNCTION public.ga_ws_pay_request_action(p_id uuid, p_action text, p_payload jsonb, p_key text, p_expected_updated_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_action text := lower(btrim(COALESCE(p_action, '')));
  p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_key text := nullif(btrim(COALESCE(p_key, '')), '');
  v_hash text;
  q public.ga_payment_requests%ROWTYPE;
  v_ev public.ga_payment_request_events%ROWTYPE;
  v_reason text;
  v_from text;
  v_to text;
  v_method text;
  v_paid date;
  v_ref text;
  v_note text;
  v_snap jsonb;
  v_payload jsonb := '{}'::jsonb;
  v_today date := public.ga_po_today();
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有操作請款單的權限（需要請款管理權限）'); END IF;
  IF v_action NOT IN ('submit', 'return', 'mark_paid', 'void', 'note', 'refresh_bank') THEN RETURN public.ga_rq_err(400, 'ACTION_INVALID', '不支援的操作：' || v_action); END IF;
  IF v_key IS NULL OR char_length(v_key) > 64 THEN RETURN public.ga_rq_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼，請重新整理畫面後再送出'); END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;
  v_hash := md5(v_action || '|' || p::text);
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張請款單'); END IF;
  -- 重送（同識別）：鎖住請款單後再查，併發的同識別請求依序拿到同一份結果
  SELECT * INTO v_ev FROM public.ga_payment_request_events WHERE pr_id = q.id AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_ev.payload ->> 'hash' = v_hash THEN
      RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', true, 'data', public.ga_pay_request_json(q.id, public.ga_pay_can_vendor(v_uid), public.ga_po_can_view(v_uid), true));
    END IF;
    RETURN public.ga_rq_err(409, 'IDEMPOTENCY_CONFLICT', '這個送出識別碼已被另一個不同內容的操作使用，請重新整理畫面後再送出');
  END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再送出'); END IF;
  IF q.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張請款單剛被其他人修改，請重新載入後再操作'); END IF;
  v_from := q.status;

  IF v_action = 'submit' THEN
    IF q.status <> 'DRAFT' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '只有草稿可以送出，目前狀態是「' || CASE q.status WHEN 'SUBMITTED' THEN '已送出' WHEN 'PAID' THEN '已付款' ELSE '已作廢' END || '」', jsonb_build_object('current_status', q.status)); END IF;
    IF NOT EXISTS (SELECT 1 FROM public.ga_payment_request_lines WHERE pr_id = q.id) THEN RETURN public.ga_rq_err(400, 'LINES_REQUIRED', '請款單沒有任何明細，不能送出'); END IF;
    PERFORM public.ga_pay_check_live(q.id);
    UPDATE public.ga_payment_requests SET status = 'SUBMITTED', submitted_by = v_uid, submitted_at = now(), updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;
    v_to := 'SUBMITTED';
  ELSIF v_action = 'return' THEN
    IF q.status <> 'SUBMITTED' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '只有已送出的請款單可以退回草稿，目前狀態是「' || CASE q.status WHEN 'DRAFT' THEN '草稿' WHEN 'PAID' THEN '已付款（已鎖定，只能作廢）' ELSE '已作廢' END || '」', jsonb_build_object('current_status', q.status)); END IF;
    v_reason := public.ga_pay_txt(p, 'reason', 200, '退回原因');
    IF v_reason IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '請填寫退回原因'); END IF;
    UPDATE public.ga_payment_requests SET status = 'DRAFT', submitted_by = NULL, submitted_at = NULL, last_return_reason = v_reason, last_return_at = now(), updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;
    v_to := 'DRAFT';
  ELSIF v_action = 'mark_paid' THEN
    IF q.status <> 'SUBMITTED' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '只有已送出的請款單可以標記已付款，目前狀態是「' || CASE q.status WHEN 'DRAFT' THEN '草稿（請先送出）' WHEN 'PAID' THEN '已付款' ELSE '已作廢' END || '」', jsonb_build_object('current_status', q.status)); END IF;
    v_method := upper(public.ga_pay_txt(p, 'pay_method', 20, '付款方式'));
    IF v_method IS NULL OR v_method NOT IN ('TRANSFER', 'CASH', 'CHECK') THEN RETURN public.ga_rq_err(400, 'PAY_METHOD', '付款方式只能是轉帳、現金或支票'); END IF;
    v_paid := COALESCE(public.ga_pay_date(p ->> 'paid_date', '付款日期'), v_today);
    IF v_paid > v_today THEN RETURN public.ga_rq_err(400, 'PAID_FUTURE', '付款日期不能是未來的日期（今天是 ' || v_today || '）'); END IF;
    IF v_paid < (q.created_at AT TIME ZONE 'Asia/Taipei')::date THEN RETURN public.ga_rq_err(400, 'PAID_TOO_EARLY', '付款日期不能早於請款單建立日（' || (q.created_at AT TIME ZONE 'Asia/Taipei')::date || '）'); END IF;
    v_ref := public.ga_pay_txt(p, 'paid_ref', 60, '付款參考號');
    UPDATE public.ga_payment_requests SET status = 'PAID', pay_method = v_method, paid_date = v_paid, paid_ref = v_ref, paid_by = v_uid, paid_at = now(), updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;
    v_to := 'PAID';
    v_payload := jsonb_build_object('pay_method', v_method, 'paid_date', v_paid, 'paid_ref', v_ref, 'self_paid', q.created_by = v_uid);
  ELSIF v_action = 'void' THEN
    IF q.status = 'VOID' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '這張請款單已經作廢', jsonb_build_object('current_status', q.status)); END IF;
    v_reason := public.ga_pay_txt(p, 'reason', 200, '作廢原因');
    IF v_reason IS NULL AND q.status IN ('SUBMITTED', 'PAID') THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '已送出或已付款的請款單作廢必須填寫原因'); END IF;
    UPDATE public.ga_payment_requests SET status = 'VOID', void_reason = v_reason, voided_by = v_uid, voided_at = now(), updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;
    v_to := 'VOID';
  ELSIF v_action = 'note' THEN
    IF q.status = 'VOID' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '已作廢的請款單不能再加備註', jsonb_build_object('current_status', q.status)); END IF;
    v_note := public.ga_pay_txt(p, 'note', 500, '備註');
    IF v_note IS NULL THEN RETURN public.ga_rq_err(400, 'NOTE_REQUIRED', '請填寫備註內容'); END IF;
    v_reason := v_note;
    UPDATE public.ga_payment_requests SET updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;
    v_to := q.status;
  ELSE
    IF q.status <> 'DRAFT' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '只有草稿可以重新抓取廠商帳號（已送出的請款單帳號是送出當下的快照）', jsonb_build_object('current_status', q.status)); END IF;
    v_snap := public.ga_pay_vendor_snapshot(q.vendor_id);
    IF v_snap IS NULL THEN RETURN public.ga_rq_err(404, 'VENDOR_NOT_FOUND', '找不到這個廠商'); END IF;
    v_payload := jsonb_build_object('changed', (q.bank_snapshot IS DISTINCT FROM (v_snap -> 'bank')) OR (q.vendor_tax_id_snapshot IS DISTINCT FROM (v_snap ->> 'tax_id')) OR (q.vendor_name_snapshot IS DISTINCT FROM (v_snap ->> 'name')));
    UPDATE public.ga_payment_requests SET vendor_name_snapshot = v_snap ->> 'name', vendor_tax_id_snapshot = v_snap ->> 'tax_id', bank_snapshot = v_snap -> 'bank', updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;
    v_to := 'DRAFT';
  END IF;
  PERFORM public.ga_pay_event(q.id, v_action, v_from, v_to, v_uid, v_reason, q.amount_total, v_payload || jsonb_build_object('hash', v_hash), v_key);
  RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', false, 'data', public.ga_pay_request_json(q.id, public.ga_pay_can_vendor(v_uid), public.ga_po_can_view(v_uid), true));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ws_pay_request_get(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看請款單的權限'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ga_payment_requests WHERE id = p_id) THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張請款單'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_pay_request_json(p_id, public.ga_pay_can_vendor(v_uid), public.ga_po_can_view(v_uid), true), 'can_manage', public.ga_pay_can_manage(v_uid),
    'buyer', jsonb_build_object('title', (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title'), 'tax_id', (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id')));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 列表：filters = {status, vendor_id, month:'YYYY-MM'（以請款單建立日的台北月份）, po_id, mine:true, search（請款單號、廠商名稱）}
CREATE OR REPLACE FUNCTION public.ga_ws_pay_request_list(p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  v_status text;
  v_vendor uuid;
  v_po uuid;
  v_month text;
  v_q text;
  v_pat text;
  v_mine boolean := COALESCE(v_f ->> 'mine', '') IN ('true', '1');
  v_can_vendor boolean;
  v_can_po boolean;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看請款單的權限'); END IF;
  v_can_vendor := public.ga_pay_can_vendor(v_uid);
  v_can_po := public.ga_po_can_view(v_uid);
  v_status := upper(public.ga_pay_txt(v_f, 'status', 10, '狀態'));
  v_vendor := public.ga_pay_uuid(v_f ->> 'vendor_id', '廠商', false);
  v_po := public.ga_pay_uuid(v_f ->> 'po_id', '採購單', false);
  v_month := public.ga_pay_txt(v_f, 'month', 7, '月份');
  v_q := public.ga_pay_txt(v_f, 'search', 100, '搜尋');
  IF v_status IS NOT NULL AND v_status NOT IN ('DRAFT', 'SUBMITTED', 'PAID', 'VOID') THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '狀態篩選值錯誤'); END IF;
  IF v_month IS NOT NULL AND v_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '月份格式要是 YYYY-MM'); END IF;
  IF v_q IS NOT NULL THEN v_pat := '%' || public.ga_po_like_escape(v_q) || '%'; END IF;
  WITH f AS (
    SELECT q.id, q.created_at, q.status, q.amount_total FROM public.ga_payment_requests q
     WHERE (v_status IS NULL OR q.status = v_status) AND (v_vendor IS NULL OR q.vendor_id = v_vendor)
       AND (v_month IS NULL OR to_char(q.created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') = v_month)
       AND (NOT v_mine OR q.created_by = v_uid)
       AND (v_po IS NULL OR EXISTS (SELECT 1 FROM public.ga_payment_request_lines l WHERE l.pr_id = q.id AND l.po_id = v_po))
       AND (v_pat IS NULL OR q.pr_no ILIKE v_pat ESCAPE '\' OR q.vendor_name_snapshot ILIKE v_pat ESCAPE '\')
  )
  SELECT jsonb_build_object('total', (SELECT count(*) FROM f),
      'summary', (SELECT jsonb_build_object('count', count(*), 'total_amount', COALESCE(sum(amount_total), 0),
          'draft_count', count(*) FILTER (WHERE status = 'DRAFT'), 'submitted_count', count(*) FILTER (WHERE status = 'SUBMITTED'),
          'submitted_amount', COALESCE(sum(amount_total) FILTER (WHERE status = 'SUBMITTED'), 0), 'paid_count', count(*) FILTER (WHERE status = 'PAID'),
          'paid_amount', COALESCE(sum(amount_total) FILTER (WHERE status = 'PAID'), 0), 'void_count', count(*) FILTER (WHERE status = 'VOID')) FROM f),
      'rows', COALESCE((SELECT jsonb_agg(public.ga_pay_request_json(x.id, v_can_vendor, v_can_po, false) ORDER BY x.created_at DESC, x.id)
        FROM (SELECT id, created_at FROM f ORDER BY created_at DESC, id LIMIT v_size OFFSET (v_page - 1) * v_size) x), '[]'::jsonb)) INTO v_out;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_out -> 'rows', 'total', v_out -> 'total', 'page', v_page, 'page_size', v_size, 'summary', v_out -> 'summary'),
    'global', (SELECT jsonb_build_object('submitted_count', count(*) FILTER (WHERE status = 'SUBMITTED'), 'submitted_amount', COALESCE(sum(amount_total) FILTER (WHERE status = 'SUBMITTED'), 0),
        'draft_count', count(*) FILTER (WHERE status = 'DRAFT')) FROM public.ga_payment_requests));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- ================================================================ 10. 對帳匯出與採購單摘要
-- 匯出（明細列，一列一筆請款明細；CSV 由伺服端組）：filters = {vendor_id, month:'YYYY-MM'（建立日的台北月份，必填）, status}。上限 5000 筆，超過回 400。
-- 統編與銀行只給有 vendor.view／manage 者（其他人整欄回 null，include_vendor_secret = false）。
CREATE OR REPLACE FUNCTION public.ga_ws_pay_export(p_filters jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_vendor uuid;
  v_month text;
  v_status text;
  v_can_vendor boolean;
  v_count integer;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有匯出對帳資料的權限'); END IF;
  v_can_vendor := public.ga_pay_can_vendor(v_uid);
  v_vendor := public.ga_pay_uuid(v_f ->> 'vendor_id', '廠商', false);
  v_month := public.ga_pay_txt(v_f, 'month', 7, '月份');
  v_status := upper(public.ga_pay_txt(v_f, 'status', 10, '狀態'));
  IF v_month IS NULL OR v_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '請選擇要匯出的月份（YYYY-MM）'); END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('DRAFT', 'SUBMITTED', 'PAID', 'VOID') THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '狀態篩選值錯誤'); END IF;
  SELECT count(*) INTO v_count FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id
   WHERE to_char(q.created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') = v_month AND (v_vendor IS NULL OR q.vendor_id = v_vendor) AND (v_status IS NULL OR q.status = v_status);
  IF v_count > 5000 THEN RETURN public.ga_rq_err(400, 'TOO_MANY_ROWS', '符合條件的明細有 ' || v_count || ' 筆，超過一次匯出的上限 5,000 筆，請縮小範圍（例如指定廠商或狀態）'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'pr_no', q.pr_no, 'status', q.status, 'created_at', q.created_at, 'vendor_name', q.vendor_name_snapshot, 'vendor_tax_id', CASE WHEN v_can_vendor THEN q.vendor_tax_id_snapshot END,
      'bank_name', CASE WHEN v_can_vendor THEN q.bank_snapshot ->> 'bank_name' END, 'bank_account', CASE WHEN v_can_vendor THEN q.bank_snapshot ->> 'bank_account' END,
      'po_no', o.po_no, 'receipt_no', r.receipt_no, 'invoice_no', i.invoice_no, 'invoice_type', i.invoice_type,
      'amount_untaxed', l.claim_untaxed, 'tax_amount', l.claim_tax, 'amount_total', l.claim_total, 'claim_total', l.claim_total,
      'paid_date', q.paid_date, 'pay_method', q.pay_method, 'paid_ref', q.paid_ref,
      'submitted_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = q.submitted_by), 'submitted_at', q.submitted_at,
      'paid_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = q.paid_by), 'paid_at', q.paid_at) ORDER BY q.created_at, q.pr_no, l.line_no), '[]'::jsonb)
    INTO v_rows
    FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id JOIN public.ga_purchase_orders o ON o.id = l.po_id JOIN public.ga_purchase_receipts r ON r.id = l.receipt_id
    LEFT JOIN public.ga_purchase_invoices i ON i.id = l.invoice_id
   WHERE to_char(q.created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') = v_month AND (v_vendor IS NULL OR q.vendor_id = v_vendor) AND (v_status IS NULL OR q.status = v_status);
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_count, 'month', v_month, 'vendor_id', v_vendor, 'include_vendor_secret', v_can_vendor));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 採購單「發票與請款」分頁摘要：進貨憑證狀態、已連發票、累計驗入含稅、已請款、已付款、尚可請款額。需請款查看權限，並需採購評估檢視（ga_po_can_view）。
CREATE OR REPLACE FUNCTION public.ga_ws_pay_po_summary(p_po_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  o public.ga_purchase_orders%ROWTYPE;
  v_recv jsonb;
  v_claimed numeric;
  v_paid numeric;
  v_tol numeric := public.ga_pay_tol();
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看請款資料的權限'); END IF;
  IF NOT public.ga_po_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PO_VIEW_REQUIRED', '查看採購單的發票與請款需要「採購評估檢視」權限'); END IF;
  SELECT * INTO o FROM public.ga_purchase_orders WHERE id = p_po_id;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張採購單'); END IF;
  v_recv := public.ga_pay_po_received(o.id);
  v_claimed := public.ga_pay_po_claimed(o.id);
  v_paid := public.ga_pay_po_claimed(o.id, NULL, 'PAID');
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'po_id', o.id, 'po_no', o.po_no, 'po_status', o.status, 'tax_rate', o.tax_rate, 'po_total_amount', o.total_amount, 'tolerance', v_tol,
    'received_untaxed', v_recv -> 'untaxed', 'received_tax', v_recv -> 'tax', 'received_total', v_recv -> 'total',
    'claimed_total', v_claimed, 'paid_total', v_paid, 'claimable', GREATEST((v_recv ->> 'total')::numeric - v_claimed, 0), 'claimable_max', GREATEST((v_recv ->> 'total')::numeric + v_tol - v_claimed, 0),
    'unclaimed_received', GREATEST((v_recv ->> 'total')::numeric - v_claimed, 0),
    'receipts', (SELECT COALESCE(jsonb_agg(jsonb_build_object('receipt_id', r.id, 'receipt_no', r.receipt_no, 'received_date', r.received_date, 'delivery_note_no', r.delivery_note_no,
          'voucher_status', r.voucher_status, 'voucher_note', r.voucher_note, 'voided', r.voided_at IS NOT NULL, 'updated_at', r.updated_at,
          'untaxed', public.ga_pay_receipt_untaxed(r.id), 'total', public.ga_pay_receipt_total(r.id),
          'claimed', (SELECT COALESCE(sum(l.claim_total), 0) FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.receipt_id = r.id AND q.status <> 'VOID'),
          'invoices', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'invoice_no', i.invoice_no, 'invoice_type', i.invoice_type, 'amount_total', i.amount_total,
                          'missing_image', public.ga_pay_invoice_missing_image(i.invoice_type, i.no_image_reason, public.ga_pay_invoice_image_count(i.id))) ORDER BY i.invoice_date, i.id), '[]'::jsonb)
                         FROM public.ga_purchase_invoice_receipts ir JOIN public.ga_purchase_invoices i ON i.id = ir.invoice_id WHERE ir.receipt_id = r.id AND i.status = 'ACTIVE'))
          ORDER BY r.received_date, r.receipt_no), '[]'::jsonb) FROM public.ga_purchase_receipts r WHERE r.po_id = o.id),
    'requests', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'pr_no', x.pr_no, 'status', x.status, 'claim_total', x.claim_total) ORDER BY x.created_at, x.pr_no), '[]'::jsonb)
                  FROM (SELECT q.id, q.pr_no, q.status, q.created_at, sum(l.claim_total) AS claim_total FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id
                         WHERE l.po_id = o.id GROUP BY q.id, q.pr_no, q.status, q.created_at) x)),
    'can_manage', public.ga_pay_can_manage(v_uid));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- ================================================================ 11. 廠商：銀行欄位讀寫擴充（機密，與第 6 批 V1 同規則）
-- 讀出現行定義做文字替換，不整支覆蓋；已有 bank_name 就略過；形狀不符（正式區與 DEV 的定義不同）就中止，請人工處理。
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  -- ga_vd_json：帳務機密欄位加四個銀行欄
  v_def := pg_get_functiondef('public.ga_vd_json(public.ga_vendors,boolean)'::regprocedure);
  IF position('bank_name' in v_def) = 0 THEN
    v_new := replace(v_def, $q$'accounting_notes', v.accounting_notes, 'total_amount', v.total_amount,$q$,
      $q$'accounting_notes', v.accounting_notes, 'total_amount', v.total_amount, 'bank_name', v.bank_name, 'bank_branch', v.bank_branch, 'bank_account', v.bank_account, 'bank_account_name', v.bank_account_name,$q$);
    IF v_new = v_def THEN RAISE EXCEPTION 'ga_vd_json 現行定義的帳務機密欄位段落與預期不同，請人工加入銀行四欄'; END IF;
    EXECUTE v_new;
  END IF;

  -- ga_ws_vendor_save：讀取 payload、INSERT、UPDATE 各加四個銀行欄
  v_def := pg_get_functiondef('public.ga_ws_vendor_save(uuid,jsonb,timestamptz)'::regprocedure);
  IF position('bank_name' in v_def) = 0 THEN
    v_new := replace(v_def, $q$IF p_payload ? 'accounting_notes' THEN v.accounting_notes := public.ga_vd_txt(p_payload, 'accounting_notes', 1000, '帳務備註'); END IF;$q$,
      $q$IF p_payload ? 'accounting_notes' THEN v.accounting_notes := public.ga_vd_txt(p_payload, 'accounting_notes', 1000, '帳務備註'); END IF;
  IF p_payload ? 'bank_name' THEN v.bank_name := public.ga_vd_txt(p_payload, 'bank_name', 60, '銀行名稱'); END IF;
  IF p_payload ? 'bank_branch' THEN v.bank_branch := public.ga_vd_txt(p_payload, 'bank_branch', 60, '分行'); END IF;
  IF p_payload ? 'bank_account' THEN v.bank_account := public.ga_vd_txt(p_payload, 'bank_account', 40, '銀行帳號'); END IF;
  IF p_payload ? 'bank_account_name' THEN v.bank_account_name := public.ga_vd_txt(p_payload, 'bank_account_name', 100, '戶名'); END IF;$q$);
    IF v_new = v_def THEN RAISE EXCEPTION 'ga_ws_vendor_save 現行定義的帳務欄位段落與預期不同，請人工加入銀行四欄'; END IF;
    v_def := v_new;
    v_new := replace(v_def, $q$cooperation_notes, attachment_names, updated_by)$q$, $q$cooperation_notes, attachment_names, bank_name, bank_branch, bank_account, bank_account_name, updated_by)$q$);
    IF v_new = v_def THEN RAISE EXCEPTION 'ga_ws_vendor_save 現行定義的 INSERT 欄位列與預期不同，請人工加入銀行四欄'; END IF;
    v_def := v_new;
    v_new := replace(v_def, $q$v.cooperation_notes, v.attachment_names, v_uid)$q$, $q$v.cooperation_notes, v.attachment_names, v.bank_name, v.bank_branch, v.bank_account, v.bank_account_name, v_uid)$q$);
    IF v_new = v_def THEN RAISE EXCEPTION 'ga_ws_vendor_save 現行定義的 INSERT 值列與預期不同，請人工加入銀行四欄'; END IF;
    v_def := v_new;
    v_new := replace(v_def, $q$cooperation_notes = v.cooperation_notes,
      updated_at = now(), updated_by = v_uid$q$, $q$cooperation_notes = v.cooperation_notes,
      bank_name = v.bank_name, bank_branch = v.bank_branch, bank_account = v.bank_account, bank_account_name = v.bank_account_name,
      updated_at = now(), updated_by = v_uid$q$);
    IF v_new = v_def THEN RAISE EXCEPTION 'ga_ws_vendor_save 現行定義的 UPDATE 段落與預期不同，請人工加入銀行四欄'; END IF;
    EXECUTE v_new;
  END IF;
END $$;

-- ================================================================ 12. 對外權限：只有登入者可呼叫對外函式（內部輔助不開放）
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'ga\_ws\_pay\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
  -- 內部輔助（金額、發票、請款單 JSON 等）不開放給登入者直接呼叫，避免繞過 ga_ws_pay_* 的權限檢查與遮蔽。
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'ga\_pay\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 核對
SELECT count(*) AS pay_functions FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'ga\_ws\_pay\_%';
-- 核對：對外函式數量與 DEV 相同
SELECT position('bank_name' in pg_get_functiondef('public.ga_vd_json(public.ga_vendors,boolean)'::regprocedure)) > 0 AS vd_json_has_bank;
-- 核對：true

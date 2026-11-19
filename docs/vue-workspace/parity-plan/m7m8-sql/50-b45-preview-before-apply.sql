-- 50-b45-preview-before-apply.sql
-- M7/M8 第 4.5 批（G45 進貨憑證、進貨發票、請款單、付款標記、廠商銀行資料、作廢進貨）套用 51 至 58 之前先看的現況檢查。
-- 唯讀（只有 SELECT；本檔沒有 rollback），整份可直接貼上執行，不會改任何資料。
-- 每列有 section（區）、item（項目）、value（數字或內容）、status：OK＝正常；MISSING＝缺東西，不要套用；ALREADY＝已經有了（重複套用沒問題，但請確認）；
-- WARN＝需要你看一下；INFO＝只是現況，給你決定上線怎麼安排。只需要看 MISSING、WARN、ALREADY；INFO 是現況數字與名單。
-- 重點（上線前一定要看）：
--   第 1 區：先決（第 3、4、6 批資料表與函式是否已套用）。有 MISSING 就先去套前面的批次。
--   第 2 區：進貨兩表現況與筆數——51 會替進貨明細加「未稅金額」並以「採購單品項單價 × 驗入量」回填（品項各自四捨五入到整數元），筆數就是回填影響範圍；
--           「單價為 0 或沒有採購單品項」的筆數會被回填成 0 元，請先確認（0 元的進貨單之後不能請款）。回填前請先備份（52 的 README 章節有備份指令）。
--   第 3 區：ga_resource_attachment_can_manage／can_read 現行定義全文（請整份存檔，撤回 54 要照這份）、結尾格式檢查（54 只在最後的 RETURN false 前插入分支；格式不符 54 會中止）、
--           resource_type 現行 CHECK（54 會重建並加入 PURCHASE_INVOICE、PURCHASE_RECEIPT）。第 6 批 45 若沒套，can_manage 沒有 UTILITY_BILL 分支（54 不會補它，也不受影響）。
--   第 4 區：ga_workflow_settings 現況（52 新增 pay_tolerance_amount = 5；買受人抬頭與統編由設定頁填）。
--   第 5 區：權限碼與角色代碼撞名檢查（55 只新增 purchase_payment.view／manage，不自動授權；角色授權由你決定）。
--   第 6 區：廠商表有沒有銀行欄位（53 新增 bank_name、bank_branch、bank_account、bank_account_name；帳務機密）。
--   第 7 區：has_permission 現行定義全文——新函式只用 has_permission(auth.uid(), 碼)，語意以正式區為準（不檢查 roles.is_active 的部分、資料庫沒有管理員後備）。請確認與預期一致。
--   第 8 區：56、57、58 的文字替換形狀檢查（56：ga_vd_json、ga_ws_vendor_save 要有預期的字串才能加銀行欄位；57：ga_hm_counts、ga_ws_home_badges、ga_ws_home_summary、ga_ws_po_list、ga_ws_purchase_analysis、ga_ws_vendor_perf 的錨點；58：進貨讀取與配發函式的庫存交易條件；不符對應的檔案會中止，MISSING 先不要套）。
--   第 9 區：目前有採購與廠商權限的角色與人數——建議授權對象名單：負責登錄發票、建請款單的總務採購（purchase_payment.manage）、會計（manage）、只需要看帳的主管（view）。
-- 正式區尚未套用 51 至 55 時：第 2、6 區的欄位多半是 INFO（將新增）；套用後再跑，會變 ALREADY。
WITH
req_tables AS (
  SELECT t AS name FROM unnest(ARRAY['ga_vendors', 'ga_purchase_orders', 'ga_purchase_order_items', 'ga_purchase_receipts', 'ga_purchase_receipt_items', 'ga_resource_attachments', 'ga_workflow_settings',
                                      'ga_workflow_setting_events', 'ga_inventory_transactions', 'profiles', 'permissions', 'roles', 'role_permissions', 'user_roles']) t
),
req_fns AS (
  SELECT f AS name FROM unnest(ARRAY['has_permission', 'current_user_has_permission', 'ga_normalize_optional_text', 'ga_rq_err', 'ga_rq_raise', 'ga_rq_catch', 'ga_po_today', 'ga_po_like_escape', 'ga_po_can_view',
                                      'ga_wf_num', 'ga_next_receipt_no', 'ga_ws_po_receive', 'ga_ws_inv_post', 'ga_vd_json', 'ga_ws_vendor_save', 'ga_resource_attachment_can_manage', 'ga_resource_attachment_can_read',
                                      'ga_soft_delete_resource_attachment', 'ga_validate_resource_attachment']) f
),
new_objs AS (
  SELECT t AS name FROM unnest(ARRAY['ga_purchase_invoices', 'ga_purchase_invoice_receipts', 'ga_payment_requests', 'ga_payment_request_lines', 'ga_payment_request_events']) t
),
new_cols AS (
  SELECT * FROM (VALUES
    ('ga_purchase_receipt_items', 'amount_untaxed'), ('ga_purchase_receipts', 'updated_at'), ('ga_purchase_receipts', 'updated_by'), ('ga_purchase_receipts', 'voucher_status'),
    ('ga_purchase_receipts', 'voucher_note'), ('ga_purchase_receipts', 'voucher_recorded_by'), ('ga_purchase_receipts', 'voucher_recorded_at'), ('ga_purchase_receipts', 'voided_at'),
    ('ga_purchase_receipts', 'voided_by'), ('ga_purchase_receipts', 'void_reason'),
    ('ga_vendors', 'bank_name'), ('ga_vendors', 'bank_branch'), ('ga_vendors', 'bank_account'), ('ga_vendors', 'bank_account_name')) AS v(tbl, col)
),
new_perms AS (
  SELECT c AS code FROM unnest(ARRAY['general_affairs.purchase_payment.view', 'general_affairs.purchase_payment.manage']) c
),
need_perms AS (
  SELECT c AS code FROM unnest(ARRAY['general_affairs.purchase_review.view', 'general_affairs.purchase_review.manage', 'general_affairs.inventory_transaction.manage', 'general_affairs.part.view',
                                      'general_affairs.vendor.view', 'general_affairs.vendor.manage', 'general_affairs.purchase_order.approve', 'general_affairs.service_center.access']) c
),
rcv AS (
  SELECT
    (SELECT count(*) FROM public.ga_purchase_receipts) AS receipts,
    (SELECT count(*) FROM public.ga_purchase_receipt_items) AS items,
    (SELECT count(*) FROM public.ga_purchase_receipt_items ri JOIN public.ga_purchase_order_items i ON i.id = ri.po_item_id WHERE i.unit_price = 0) AS zero_price_items,
    (SELECT count(*) FROM public.ga_purchase_receipt_items ri WHERE ri.accepted_qty = 0) AS zero_accept_items,
    (SELECT count(DISTINCT r.po_id) FROM public.ga_purchase_receipts r) AS pos_with_receipts,
    (SELECT COALESCE(sum(round(i.unit_price * ri.accepted_qty)), 0) FROM public.ga_purchase_receipt_items ri JOIN public.ga_purchase_order_items i ON i.id = ri.po_item_id) AS total_backfill_untaxed,
    (SELECT count(*) FROM public.ga_purchase_orders WHERE tax_rate = 0) AS zero_tax_pos
),
can_manage AS (SELECT pg_get_functiondef(to_regprocedure('public.ga_resource_attachment_can_manage(text,uuid)')) AS def),
can_read AS (SELECT pg_get_functiondef(to_regprocedure('public.ga_resource_attachment_can_read(text,uuid)')) AS def),
vdjson AS (SELECT pg_get_functiondef(to_regprocedure('public.ga_vd_json(public.ga_vendors,boolean)')) AS def),
vsave AS (SELECT pg_get_functiondef(to_regprocedure('public.ga_ws_vendor_save(uuid,jsonb,timestamp with time zone)')) AS def)
-- ================================================================ 1 先決
SELECT '1 先決' AS section, 'table ' || r.name AS item, COALESCE(to_regclass('public.' || r.name)::text, 'missing') AS value,
       CASE WHEN to_regclass('public.' || r.name) IS NULL THEN 'MISSING' ELSE 'OK' END AS status FROM req_tables r
UNION ALL
SELECT '1 先決', 'function ' || r.name, (SELECT count(*)::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.name),
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = r.name) THEN 'OK' ELSE 'MISSING' END FROM req_fns r
UNION ALL
SELECT '1 先決', '第 6 批 45 已套用（can_manage 含 UTILITY_BILL 分支）', (position('UTILITY_BILL' in c.def) > 0)::text, CASE WHEN position('UTILITY_BILL' in c.def) > 0 THEN 'OK' ELSE 'WARN' END FROM can_manage c
UNION ALL
SELECT '1 先決', '進貨資料表已有 amount_untaxed 以外的第 4 批欄位 dispatched_qty、inventory_transaction_id',
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_purchase_receipt_items' AND column_name IN ('dispatched_qty', 'inventory_transaction_id')),
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_purchase_receipt_items' AND column_name IN ('dispatched_qty', 'inventory_transaction_id')) = 2 THEN 'OK' ELSE 'MISSING' END
UNION ALL
-- ================================================================ 2 進貨兩表現況
SELECT '2 進貨兩表', 'new object ' || n.name, COALESCE(to_regclass('public.' || n.name)::text, 'not yet'), CASE WHEN to_regclass('public.' || n.name) IS NULL THEN 'INFO' ELSE 'ALREADY' END FROM new_objs n
UNION ALL
SELECT '2 進貨兩表', 'column ' || c.tbl || '.' || c.col,
       COALESCE((SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = c.tbl AND column_name = c.col), 'not yet'),
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = c.tbl AND column_name = c.col) THEN 'ALREADY' ELSE 'INFO' END FROM new_cols c
UNION ALL
SELECT '2 進貨兩表', '進貨單筆數', receipts::text, 'INFO' FROM rcv
UNION ALL SELECT '2 進貨兩表', '進貨明細筆數（51 要回填金額的筆數）', items::text, 'INFO' FROM rcv
UNION ALL SELECT '2 進貨兩表', '有進貨的採購單數', pos_with_receipts::text, 'INFO' FROM rcv
UNION ALL SELECT '2 進貨兩表', '單價為 0 的進貨明細（回填後 0 元，之後不能請款）', zero_price_items::text, CASE WHEN zero_price_items > 0 THEN 'WARN' ELSE 'OK' END FROM rcv
UNION ALL SELECT '2 進貨兩表', '驗入量為 0（全部拒收）的進貨明細（回填後 0 元）', zero_accept_items::text, 'INFO' FROM rcv
UNION ALL SELECT '2 進貨兩表', '回填後未稅金額合計（品項各自進位）', total_backfill_untaxed::text, 'INFO' FROM rcv
UNION ALL SELECT '2 進貨兩表', '稅率為 0 的採購單數（免稅廠商情境）', zero_tax_pos::text, 'INFO' FROM rcv
UNION ALL
-- ================================================================ 3 附件函式與 CHECK
SELECT '3 附件函式', 'can_manage 結尾格式（RETURN false; END;）', (c.def ~ 'RETURN false;\s*END;\s*\$function\$\s*$')::text, CASE WHEN c.def ~ 'RETURN false;\s*END;\s*\$function\$\s*$' THEN 'OK' ELSE 'MISSING' END FROM can_manage c
UNION ALL
SELECT '3 附件函式', 'can_read 結尾格式（RETURN false; END;）', (c.def ~ 'RETURN false;\s*END;\s*\$function\$\s*$')::text, CASE WHEN c.def ~ 'RETURN false;\s*END;\s*\$function\$\s*$' THEN 'OK' ELSE 'MISSING' END FROM can_read c
UNION ALL
SELECT '3 附件函式', 'can_manage 是否已有 PURCHASE_INVOICE 分支', (position('PURCHASE_INVOICE' in c.def) > 0)::text, CASE WHEN position('PURCHASE_INVOICE' in c.def) > 0 THEN 'ALREADY' ELSE 'INFO' END FROM can_manage c
UNION ALL
SELECT '3 附件函式', 'can_read 是否已有 PURCHASE_INVOICE 分支', (position('PURCHASE_INVOICE' in c.def) > 0)::text, CASE WHEN position('PURCHASE_INVOICE' in c.def) > 0 THEN 'ALREADY' ELSE 'INFO' END FROM can_read c
UNION ALL
SELECT '3 附件函式', '【請存檔】can_manage 現行定義全文', c.def, 'INFO' FROM can_manage c
UNION ALL
SELECT '3 附件函式', '【請存檔】can_read 現行定義全文', c.def, 'INFO' FROM can_read c
UNION ALL
SELECT '3 附件函式', '【請存檔】resource_type 現行 CHECK', pg_get_constraintdef(c.oid), 'INFO' FROM pg_constraint c WHERE c.conrelid = 'public.ga_resource_attachments'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%resource_type = ANY%'
UNION ALL
SELECT '3 附件函式', '附件表既有 PURCHASE_ 類型紀錄數', (SELECT count(*)::text FROM public.ga_resource_attachments WHERE resource_type LIKE 'PURCHASE\_%'), 'INFO'
UNION ALL
-- ================================================================ 4 設定
SELECT '4 設定', 'ga_workflow_settings ' || s.key, COALESCE(s.value_num::text, s.value_text, ''), CASE WHEN s.key LIKE 'pay\_%' THEN 'ALREADY' ELSE 'INFO' END FROM public.ga_workflow_settings s
UNION ALL
-- ================================================================ 5 權限碼與撞名
SELECT '5 權限與撞名', 'permission ' || n.code, (SELECT count(*)::text FROM public.permissions p WHERE p.code = n.code), CASE WHEN EXISTS (SELECT 1 FROM public.permissions p WHERE p.code = n.code) THEN 'ALREADY' ELSE 'INFO' END FROM new_perms n
UNION ALL
SELECT '5 權限與撞名', 'permissions 表是否有其他 purchase_payment 或 invoice 或 payment 開頭的碼', (SELECT COALESCE(string_agg(p.code, ', '), '無') FROM public.permissions p WHERE (p.code ILIKE '%payment%' OR p.code ILIKE '%invoice%') AND p.code NOT IN (SELECT code FROM new_perms)),
       CASE WHEN EXISTS (SELECT 1 FROM public.permissions p WHERE (p.code ILIKE '%payment%' OR p.code ILIKE '%invoice%') AND p.code NOT IN (SELECT code FROM new_perms)) THEN 'WARN' ELSE 'OK' END
UNION ALL
SELECT '5 權限與撞名', 'permissions 表欄位', (SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'permissions'), 'INFO'
UNION ALL
SELECT '5 權限與撞名', 'roles 代碼含 ga45 的角色（DEV 專用，正式區不該有）', (SELECT COALESCE(string_agg(code, ', '), '無') FROM public.roles WHERE code ILIKE '%ga45%'), CASE WHEN EXISTS (SELECT 1 FROM public.roles WHERE code ILIKE '%ga45%') THEN 'WARN' ELSE 'OK' END
UNION ALL
-- ================================================================ 6 廠商銀行欄位
SELECT '6 廠商', 'ga_vendors 銀行相關欄位', (SELECT COALESCE(string_agg(column_name, ', '), '無（53 會新增）') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_vendors' AND column_name LIKE 'bank%'),
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_vendors' AND column_name LIKE 'bank%') THEN 'ALREADY' ELSE 'INFO' END
UNION ALL
SELECT '6 廠商', '廠商筆數（銀行資料之後要請人逐一補）', (SELECT count(*)::text FROM public.ga_vendors), 'INFO'
UNION ALL
SELECT '6 廠商', '合作中且有統編的廠商數', (SELECT count(*)::text FROM public.ga_vendors WHERE status = 'active' AND tax_id IS NOT NULL AND btrim(tax_id) <> ''), 'INFO'
UNION ALL
-- ================================================================ 7 has_permission 現行語意
SELECT '7 has_permission', '【請確認語意】has_permission 現行定義全文（是否檢查 roles.is_active、是否有 admin 後備）', pg_get_functiondef(to_regprocedure('public.has_permission(uuid,character varying)')), 'INFO'
UNION ALL
-- ================================================================ 8 56 的文字替換形狀檢查
SELECT '8 函式形狀', 'ga_vd_json 含預期的帳務機密欄位段落（56 替換用）', (position($$'accounting_notes', v.accounting_notes, 'total_amount', v.total_amount,$$ in v.def) > 0)::text,
       CASE WHEN position('bank_name' in v.def) > 0 THEN 'ALREADY' WHEN position($$'accounting_notes', v.accounting_notes, 'total_amount', v.total_amount,$$ in v.def) > 0 THEN 'OK' ELSE 'MISSING' END FROM vdjson v
UNION ALL
SELECT '8 函式形狀', 'ga_ws_vendor_save 含預期的四個替換錨點（56 替換用）',
       ((position($$IF p_payload ? 'accounting_notes' THEN v.accounting_notes := public.ga_vd_txt(p_payload, 'accounting_notes', 1000, '帳務備註'); END IF;$$ in v.def) > 0)
        AND (position('cooperation_notes, attachment_names, updated_by)' in v.def) > 0) AND (position('v.cooperation_notes, v.attachment_names, v_uid)' in v.def) > 0)
        AND (position(E'cooperation_notes = v.cooperation_notes,\n      updated_at = now(), updated_by = v_uid' in v.def) > 0))::text,
       CASE WHEN position('bank_name' in v.def) > 0 THEN 'ALREADY'
            WHEN (position($$IF p_payload ? 'accounting_notes' THEN v.accounting_notes := public.ga_vd_txt(p_payload, 'accounting_notes', 1000, '帳務備註'); END IF;$$ in v.def) > 0)
                 AND (position('cooperation_notes, attachment_names, updated_by)' in v.def) > 0) AND (position('v.cooperation_notes, v.attachment_names, v_uid)' in v.def) > 0)
                 AND (position(E'cooperation_notes = v.cooperation_notes,\n      updated_at = now(), updated_by = v_uid' in v.def) > 0) THEN 'OK' ELSE 'MISSING' END FROM vsave v
UNION ALL
SELECT '8 函式形狀', '57：public.ga_hm_counts() 含預期的 5 個替換錨點（57 替換用）', ((position($$  v_n integer;$$ in v.def) > 0) AND (position($$  v_approve := has_permission(v_uid, 'general_affairs.purchase_order.approve');$$ in v.def) > 0) AND (position($$SELECT count(*) INTO v_n FROM public.ga_purchase_orders WHERE public.ga_att_po(status, expected_delivery_date, v_approve);$$ in v.def) > 0) AND (position($$    v_out := v_out || jsonb_build_object('po_menu', v_n);$$ in v.def) > 0) AND (position($$  RETURN v_out;$$ in v.def) > 0))::text,
       CASE WHEN position($$pay_unclaimed$$ in v.def) > 0 THEN 'ALREADY' WHEN (position($$  v_n integer;$$ in v.def) > 0) AND (position($$  v_approve := has_permission(v_uid, 'general_affairs.purchase_order.approve');$$ in v.def) > 0) AND (position($$SELECT count(*) INTO v_n FROM public.ga_purchase_orders WHERE public.ga_att_po(status, expected_delivery_date, v_approve);$$ in v.def) > 0) AND (position($$    v_out := v_out || jsonb_build_object('po_menu', v_n);$$ in v.def) > 0) AND (position($$  RETURN v_out;$$ in v.def) > 0) THEN 'OK' ELSE 'MISSING' END
  FROM (SELECT pg_get_functiondef(to_regprocedure('public.ga_hm_counts()')) AS def) v
UNION ALL
SELECT '8 函式形狀', '57：public.ga_ws_home_badges() 含預期的 1 個替換錨點（57 替換用）', ((position($$'onboarding', v_c -> 'onboarding_review'$$ in v.def) > 0))::text,
       CASE WHEN position($$pay_submitted$$ in v.def) > 0 THEN 'ALREADY' WHEN (position($$'onboarding', v_c -> 'onboarding_review'$$ in v.def) > 0) THEN 'OK' ELSE 'MISSING' END
  FROM (SELECT pg_get_functiondef(to_regprocedure('public.ga_ws_home_badges()')) AS def) v
UNION ALL
SELECT '8 函式形狀', '57：public.ga_ws_home_summary() 含預期的 1 個替換錨點（57 替換用）', ((position($$  IF v_c ? 'wo_store_rejected' THEN$$ in v.def) > 0))::text,
       CASE WHEN position($$pay_unclaimed$$ in v.def) > 0 THEN 'ALREADY' WHEN (position($$  IF v_c ? 'wo_store_rejected' THEN$$ in v.def) > 0) THEN 'OK' ELSE 'MISSING' END
  FROM (SELECT pg_get_functiondef(to_regprocedure('public.ga_ws_home_summary()')) AS def) v
UNION ALL
SELECT '8 函式形狀', '57：public.ga_ws_po_list(jsonb,integer,integer) 含預期的 3 個替換錨點（57 替換用）', ((position($$  v_attention boolean;$$ in v.def) > 0) AND (position($$  v_attention := COALESCE(v_f->>'attention', 'false') IN ('true', 't', '1');$$ in v.def) > 0) AND (position($$AND (NOT v_attention OR public.ga_att_po(o.status, o.expected_delivery_date, (SELECT has_permission(v_uid, 'general_affairs.purchase_order.approve'))))$$ in v.def) > 0))::text,
       CASE WHEN position($$v_pay_unclaimed$$ in v.def) > 0 THEN 'ALREADY' WHEN (position($$  v_attention boolean;$$ in v.def) > 0) AND (position($$  v_attention := COALESCE(v_f->>'attention', 'false') IN ('true', 't', '1');$$ in v.def) > 0) AND (position($$AND (NOT v_attention OR public.ga_att_po(o.status, o.expected_delivery_date, (SELECT has_permission(v_uid, 'general_affairs.purchase_order.approve'))))$$ in v.def) > 0) THEN 'OK' ELSE 'MISSING' END
  FROM (SELECT pg_get_functiondef(to_regprocedure('public.ga_ws_po_list(jsonb,integer,integer)')) AS def) v
UNION ALL
SELECT '8 函式形狀', '57：public.ga_ws_purchase_analysis(text,integer,integer) 含預期的 3 個替換錨點（57 替換用）', ((position($$  v_total integer;$$ in v.def) > 0) AND (position($$  SELECT jsonb_build_object('count', count(*), 'total_amount', COALESCE(sum(total_amount), 0)) INTO v_est$$ in v.def) > 0) AND (position($$'orders', v_orders, 'orders_total', v_total,$$ in v.def) > 0))::text,
       CASE WHEN position($$v_can_pay$$ in v.def) > 0 THEN 'ALREADY' WHEN (position($$  v_total integer;$$ in v.def) > 0) AND (position($$  SELECT jsonb_build_object('count', count(*), 'total_amount', COALESCE(sum(total_amount), 0)) INTO v_est$$ in v.def) > 0) AND (position($$'orders', v_orders, 'orders_total', v_total,$$ in v.def) > 0) THEN 'OK' ELSE 'MISSING' END
  FROM (SELECT pg_get_functiondef(to_regprocedure('public.ga_ws_purchase_analysis(text,integer,integer)')) AS def) v
UNION ALL
SELECT '8 函式形狀', '57：public.ga_ws_vendor_perf(text,text) 含預期的 8 個替換錨點（57 替換用）', ((position($$  v_can_po boolean;$$ in v.def) > 0) AND (position($$  v_can_po := public.ga_po_can_view(v_uid);$$ in v.def) > 0) AND (position($$    SELECT o.vendor_id, count(*) AS po_count, COALESCE(sum(o.total_amount), 0) AS po_amount$$ in v.def) > 0) AND (position($$      FROM public.ga_purchase_orders o
$$ in v.def) > 0) AND (position($$COALESCE(p.po_count, 0) AS po_count, COALESCE(p.po_amount, 0) AS po_amount$$ in v.def) > 0) AND (position($$'po_amount', CASE WHEN v_can_po THEN m.po_amount END,$$ in v.def) > 0) AND (position($$           'po_amount_total', CASE WHEN v_can_po THEN$$ in v.def) > 0) AND (position($$'can_view_po_amount', v_can_po,$$ in v.def) > 0))::text,
       CASE WHEN position($$v_can_pay$$ in v.def) > 0 THEN 'ALREADY' WHEN (position($$  v_can_po boolean;$$ in v.def) > 0) AND (position($$  v_can_po := public.ga_po_can_view(v_uid);$$ in v.def) > 0) AND (position($$    SELECT o.vendor_id, count(*) AS po_count, COALESCE(sum(o.total_amount), 0) AS po_amount$$ in v.def) > 0) AND (position($$      FROM public.ga_purchase_orders o
$$ in v.def) > 0) AND (position($$COALESCE(p.po_count, 0) AS po_count, COALESCE(p.po_amount, 0) AS po_amount$$ in v.def) > 0) AND (position($$'po_amount', CASE WHEN v_can_po THEN m.po_amount END,$$ in v.def) > 0) AND (position($$           'po_amount_total', CASE WHEN v_can_po THEN$$ in v.def) > 0) AND (position($$'can_view_po_amount', v_can_po,$$ in v.def) > 0) THEN 'OK' ELSE 'MISSING' END
  FROM (SELECT pg_get_functiondef(to_regprocedure('public.ga_ws_vendor_perf(text,text)')) AS def) v
UNION ALL
SELECT '8 函式形狀', '58：public.ga_ws_po_receipts_get(uuid) 含進貨明細庫存交易條件（58 替換用）', (position($$ri.inventory_transaction_id IS NOT NULL$$ in v.def) > 0)::text,
       CASE WHEN position('vr.voided_at' in v.def) > 0 THEN 'ALREADY' WHEN position($$ri.inventory_transaction_id IS NOT NULL$$ in v.def) > 0 THEN 'OK' ELSE 'MISSING' END
  FROM (SELECT pg_get_functiondef(to_regprocedure('public.ga_ws_po_receipts_get(uuid)')) AS def) v
UNION ALL
SELECT '8 函式形狀', '58：public.ga_ws_po_dispatch(uuid,uuid,numeric,uuid,text,uuid,jsonb,text,text) 含進貨明細庫存交易條件（58 替換用）', (position($$ri.inventory_transaction_id IS NOT NULL$$ in v.def) > 0)::text,
       CASE WHEN position('vr.voided_at' in v.def) > 0 THEN 'ALREADY' WHEN position($$ri.inventory_transaction_id IS NOT NULL$$ in v.def) > 0 THEN 'OK' ELSE 'MISSING' END
  FROM (SELECT pg_get_functiondef(to_regprocedure('public.ga_ws_po_dispatch(uuid,uuid,numeric,uuid,text,uuid,jsonb,text,text)')) AS def) v
UNION ALL
-- ================================================================ 9 目前有採購與廠商權限的角色（建議授權對象）
SELECT '9 授權對象', r.code || ' ← ' || p.code, (SELECT count(*)::text FROM public.user_roles ur WHERE ur.role_id = r.id AND ur.is_active) || ' 人', 'INFO'
  FROM public.roles r JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.is_allowed JOIN public.permissions p ON p.id = rp.permission_id
 WHERE p.code IN (SELECT code FROM need_perms) AND r.code <> 'admin'
 ORDER BY 1, 2;

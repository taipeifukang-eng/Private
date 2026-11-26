-- 00 唯讀預覽（正式區草稿；只有 SELECT，不寫任何東西，所以免附 rollback；整份可直接貼上執行）。套用「水電話費請款」草稿 01 至 04 之前先執行，把結果存檔。
-- 輸出一張表：section（區）、item（項目）、value（數字或內容）、status：OK＝正常；MISSING＝缺東西，不要套用；SHAPE_MISMATCH＝加掛位置的現行函式和 DEV 實測版本不同，不可套用；WARN＝需要你看一下；ALREADY＝已經有了；INFO＝現況。
-- 重點（上線前一定要看）：
--   A 先決條件：第 4.5 批請款單（50 至 61）、G23 水電帳單（第 6 批 45）、廠商（44、48）、附件、權限碼是否都已套用。有 MISSING 就先去套前面的批次。
--   B 水電帳單現況：筆數、金額有小數的筆數與清單（不能請款，要先修成整數）、金額 0 元的筆數、供應商名稱分組筆數（補填繳費單位的工作量）。
--   C 公用事業分類：是否已有 code=UTILITY 或名稱「公用事業」的分類（有就直接用，01 不會重複新增）。
--   D 形狀檢查：9 支函式的 11 個加掛位置，hits 必須剛好是 1。
--   E 現行定義全文：9 支函式請整份存檔，當作撤回的對照（撤回腳本依標記移除加掛文字，這份是最後的保險）。
--   F has_permission 現行語意（正式區：不檢查 roles.is_active、資料庫沒有 admin 繞過；新功能的權限判斷全用它）。
--   G 建議授權名單：目前有水電管理、請款管理、廠商檢視的角色與人（只列不授權，授權由老闆決定）。
-- 上線時間：12/8 全面切換之後（約 12/15 週）；不併入 12/8 當晚的步驟。
SELECT section, item, value, status
  FROM (
    -- A 先決條件
    SELECT 10 AS o, 'A 先決條件' AS section, x.item, ''::text AS value, CASE WHEN x.present THEN 'OK' ELSE 'MISSING' END AS status
      FROM (
        SELECT '資料表 ga_payment_requests（第 4.5 批）' AS item, to_regclass('public.ga_payment_requests') IS NOT NULL AS present
        UNION ALL SELECT '資料表 ga_payment_request_lines（第 4.5 批）', to_regclass('public.ga_payment_request_lines') IS NOT NULL
        UNION ALL SELECT '資料表 ga_payment_request_events（第 4.5 批）', to_regclass('public.ga_payment_request_events') IS NOT NULL
        UNION ALL SELECT '資料表 ga_utility_bills（G23，第 6 批 45）', to_regclass('public.ga_utility_bills') IS NOT NULL
        UNION ALL SELECT '資料表 ga_vendors（廠商，第 6 批 44、48）', to_regclass('public.ga_vendors') IS NOT NULL
        UNION ALL SELECT '資料表 ga_service_categories', to_regclass('public.ga_service_categories') IS NOT NULL
        UNION ALL SELECT '資料表 ga_workflow_settings', to_regclass('public.ga_workflow_settings') IS NOT NULL
        UNION ALL SELECT '資料表 ga_resource_attachments', to_regclass('public.ga_resource_attachments') IS NOT NULL
        UNION ALL SELECT '函式 ga_ws_pay_request_list／update／action／create（第 4.5 批 50 至 61）',
          to_regprocedure('public.ga_ws_pay_request_list(jsonb,integer,integer)') IS NOT NULL AND to_regprocedure('public.ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone)') IS NOT NULL
          AND to_regprocedure('public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)') IS NOT NULL AND to_regprocedure('public.ga_ws_pay_request_create(jsonb,text)') IS NOT NULL
        UNION ALL SELECT '函式 ga_ws_pay_export、ga_pay_request_json、ga_next_pr_no', to_regprocedure('public.ga_ws_pay_export(jsonb)') IS NOT NULL AND to_regprocedure('public.ga_pay_request_json(uuid,boolean,boolean,boolean)') IS NOT NULL AND to_regprocedure('public.ga_next_pr_no()') IS NOT NULL
        UNION ALL SELECT '函式 ga_ws_ub_save／list、ga_ub_json、ga_utility_bill_before_write（G23）',
          to_regprocedure('public.ga_ws_ub_save(uuid,jsonb,timestamp with time zone,boolean)') IS NOT NULL AND to_regprocedure('public.ga_ws_ub_list(jsonb,integer,integer)') IS NOT NULL
          AND to_regprocedure('public.ga_ub_json(uuid)') IS NOT NULL AND to_regprocedure('public.ga_utility_bill_before_write()') IS NOT NULL
        UNION ALL SELECT '函式 ga_rq_raise、ga_rq_catch、ga_pay_uuid、ga_pay_vendor_snapshot、ga_po_today',
          to_regprocedure('public.ga_rq_raise(integer,text,text,jsonb)') IS NOT NULL AND to_regprocedure('public.ga_rq_catch(text,text)') IS NOT NULL AND to_regprocedure('public.ga_pay_uuid(text,text,boolean)') IS NOT NULL
          AND to_regprocedure('public.ga_pay_vendor_snapshot(uuid)') IS NOT NULL AND to_regprocedure('public.ga_po_today()') IS NOT NULL
        UNION ALL SELECT '權限碼 utility_bill.manage／view、purchase_payment.manage／view、vendor.view 都存在', (SELECT count(*) FROM permissions WHERE code IN ('general_affairs.utility_bill.manage', 'general_affairs.utility_bill.view', 'general_affairs.purchase_payment.manage', 'general_affairs.purchase_payment.view', 'general_affairs.vendor.view')) = 5
      ) x
    UNION ALL
    -- B 水電帳單現況
    SELECT 20, 'B 水電帳單', '未刪除帳單總筆數', count(*)::text, 'INFO' FROM ga_utility_bills WHERE deleted_at IS NULL
    UNION ALL SELECT 21, 'B 水電帳單', '其中未繳（待繳）筆數', count(*)::text, 'INFO' FROM ga_utility_bills WHERE deleted_at IS NULL AND paid_at IS NULL
    UNION ALL SELECT 22, 'B 水電帳單', '金額有小數的筆數（不能請款，要先修成整數；很多的話要先決定「請款時四捨五入」的做法）', count(*)::text, CASE WHEN count(*) > 0 THEN 'WARN' ELSE 'OK' END FROM ga_utility_bills WHERE deleted_at IS NULL AND amount <> trunc(amount)
    UNION ALL SELECT 23, 'B 水電帳單', '金額為 0 的筆數（不需要請款）', count(*)::text, 'INFO' FROM ga_utility_bills WHERE deleted_at IS NULL AND amount = 0
    UNION ALL SELECT 24, 'B 水電帳單', '還沒有繳費單位的筆數（套用前全部都還沒有；套用後要補填，補填前不能請款）', count(*)::text, 'INFO' FROM ga_utility_bills WHERE deleted_at IS NULL
    UNION ALL
    SELECT 30, 'B1 小數金額帳單（最多 100 筆）', b.billing_month::text || ' ' || b.location_name || ' ' || b.expense_type || ' ' || COALESCE(b.provider_name, ''), b.amount::text, 'WARN'
      FROM (SELECT * FROM ga_utility_bills WHERE deleted_at IS NULL AND amount <> trunc(amount) ORDER BY billing_month DESC, location_name LIMIT 100) b
    UNION ALL
    SELECT 40, 'B2 供應商分組', COALESCE(NULLIF(btrim(provider_name), ''), '（帳單沒有填供應商）'), count(*)::text || ' 筆，合計 ' || sum(amount)::text || '，月份 ' || min(billing_month)::text || ' 至 ' || max(billing_month)::text, 'INFO'
      FROM ga_utility_bills WHERE deleted_at IS NULL GROUP BY COALESCE(NULLIF(btrim(provider_name), ''), '（帳單沒有填供應商）')
    UNION ALL
    -- C 公用事業分類
    SELECT 50, 'C 公用事業分類', c.code || ' / ' || c.name, c.id::text, 'ALREADY' FROM ga_service_categories c WHERE c.code = 'UTILITY' OR btrim(c.name) = '公用事業'
    UNION ALL
    SELECT 51, 'C 公用事業分類', '現在沒有現成的公用事業分類（01 會新增 code=UTILITY、名稱「公用事業」）', '', 'INFO' WHERE NOT EXISTS (SELECT 1 FROM ga_service_categories c WHERE c.code = 'UTILITY' OR btrim(c.name) = '公用事業')
    UNION ALL
    SELECT 52, 'C 公用事業分類', '設定鍵 utility_payee_category_id', COALESCE(value_text, ''), 'ALREADY' FROM ga_workflow_settings WHERE key = 'utility_payee_category_id'
    UNION ALL
    -- D 加掛位置的形狀檢查
    SELECT 60, 'D 形狀檢查', a.fn || '　' || left(a.anchor, 60), h.hits::text, CASE WHEN h.hits = 1 THEN 'OK' ELSE 'SHAPE_MISMATCH' END
      FROM (
        SELECT 'ga_utility_bill_before_write()' AS fn, $q$  IF NOT public.current_user_has_permission('general_affairs.utility_bill.manage') THEN$q$ AS anchor
        UNION ALL
        SELECT 'ga_ub_json(uuid)' AS fn, $q$  FROM public.ga_utility_bills b WHERE b.id = p_id;$q$ AS anchor
        UNION ALL
        SELECT 'ga_ws_ub_save(uuid,jsonb,timestamp with time zone,boolean)' AS fn, $q$  v_anomaly := public.ga_ub_anomaly($q$ AS anchor
        UNION ALL
        SELECT 'ga_ws_ub_list(jsonb,integer,integer)' AS fn, $q$  IF v_overdue THEN v_status := 'overdue'; END IF;$q$ AS anchor
        UNION ALL
        SELECT 'ga_ws_ub_list(jsonb,integer,integer)' AS fn, $q$OR COALESCE(b.reference_no, '') ILIKE v_pat ESCAPE '\')$q$ AS anchor
        UNION ALL
        SELECT 'ga_pay_request_json(uuid,boolean,boolean,boolean)' AS fn, $q$  RETURN v_out;$q$ AS anchor
        UNION ALL
        SELECT 'ga_ws_pay_request_list(jsonb,integer,integer)' AS fn, $q$  IF v_q IS NOT NULL THEN v_pat := '%' || public.ga_po_like_escape(v_q) || '%'; END IF;$q$ AS anchor
        UNION ALL
        SELECT 'ga_ws_pay_request_list(jsonb,integer,integer)' AS fn, $q$OR q.vendor_name_snapshot ILIKE v_pat ESCAPE '\')$q$ AS anchor
        UNION ALL
        SELECT 'ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone)' AS fn, $q$  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_id FOR UPDATE;$q$ AS anchor
        UNION ALL
        SELECT 'ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)' AS fn, $q$IF NOT EXISTS (SELECT 1 FROM public.ga_payment_request_lines WHERE pr_id = q.id) THEN RETURN public.ga_rq_err(400, 'LINES_REQUIRED'$q$ AS anchor
        UNION ALL
        SELECT 'ga_ws_pay_export(jsonb)' AS fn, $q$  v_can_vendor := public.ga_pay_can_vendor(v_uid);$q$ AS anchor
      ) a
      CROSS JOIN LATERAL (
        SELECT CASE WHEN to_regprocedure('public.' || a.fn) IS NULL THEN -1
                    ELSE (length(pg_get_functiondef(to_regprocedure('public.' || a.fn))) - length(replace(pg_get_functiondef(to_regprocedure('public.' || a.fn)), a.anchor, ''))) / length(a.anchor) END AS hits
      ) h
    UNION ALL
    -- E 現行定義全文
    SELECT 70, 'E 現行定義（請存檔）', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid), 'INFO'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('ga_utility_bill_before_write', 'ga_ub_json', 'ga_ws_ub_save', 'ga_ws_ub_list', 'ga_pay_request_json', 'ga_ws_pay_request_list', 'ga_ws_pay_request_update', 'ga_ws_pay_request_action', 'ga_ws_pay_export')
    UNION ALL
    -- F has_permission 現行語意
    SELECT 80, 'F has_permission 現行定義', 'has_permission', pg_get_functiondef(p.oid), 'INFO'
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'has_permission'
    UNION ALL
    -- G 建議授權名單（只列不授權）
    SELECT 90, 'G 角色（建議授權名單，只列不授權）', p.code || '　' || r.code || '（' || r.name || '）', (SELECT count(*) FROM user_roles ur WHERE ur.role_id = r.id AND ur.is_active)::text || ' 人', CASE WHEN r.is_active THEN 'INFO' ELSE 'WARN' END
      FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.is_allowed AND p.code IN ('general_affairs.utility_bill.manage', 'general_affairs.utility_bill.view', 'general_affairs.purchase_payment.manage', 'general_affairs.purchase_payment.view', 'general_affairs.vendor.view', 'general_affairs.vendor.manage')
    UNION ALL
    SELECT 91, 'G1 人（建議授權名單，只列不授權）', p.code || '　' || COALESCE(pr.full_name, pr.email), r.code, 'INFO'
      FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id JOIN user_roles ur ON ur.role_id = r.id AND ur.is_active JOIN profiles pr ON pr.id = ur.user_id
     WHERE rp.is_allowed AND p.code IN ('general_affairs.utility_bill.manage', 'general_affairs.purchase_payment.manage', 'general_affairs.vendor.view')
  ) z
 ORDER BY o, item;

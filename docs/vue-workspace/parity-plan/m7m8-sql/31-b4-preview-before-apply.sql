-- 31-b4-preview-before-apply.sql
-- M7/M8 第 4 批（需求單與處理單規則、採購單與核准、到貨驗入與配發、資產移轉搬單）套用 32、33、34、35 之前先看的現況檢查。
-- 唯讀（只有 SELECT），整份可直接貼上執行，不會改任何資料。
-- 每列有 section（區）、item（項目）、value（數字或內容）、status：OK＝正常；MISSING＝缺東西，不要套用；ALREADY＝已經有了（重複套用沒問題，但請確認是不是上次套的）；
-- WARN＝需要你看一下；INFO＝只是現況，給你決定上線怎麼安排。只需要看 MISSING、WARN、ALREADY；INFO 是現況數字。
-- 目前涵蓋 32、33（本檔第 1 至 8 區）；34、35 的先決條件與新增物件在它們完成後補進第 2 區。
-- 在 DEV 已套用 32、33 之後再跑：第 2 區會出現 ALREADY、第 9 區的欄位與權限碼會是 ALREADY，都是預期的；正式區尚未套用時應全部 OK。
WITH
req_tables AS (
  SELECT t AS name FROM unnest(ARRAY['ga_vendors', 'ga_service_requests', 'ga_service_request_comments', 'ga_service_request_events', 'ga_part_fulfillments',
                                      'ga_part_fulfillment_documents', 'ga_part_fulfillment_events', 'ga_purchase_reviews', 'ga_purchase_review_quotes', 'ga_parts',
                                      'ga_inventory_locations', 'ga_inventory_balances', 'ga_inventory_transactions', 'ga_equipment', 'ga_equipment_templates',
                                      'stores', 'profiles', 'permissions', 'roles', 'role_permissions', 'user_roles']) t
),
req_fns AS (
  SELECT f AS name FROM unnest(ARRAY['has_permission', 'ga_normalize_optional_text', 'ga_post_inventory_transaction', 'ga_next_purchase_order_no']) f
),
new_fns AS (
  SELECT f AS name FROM unnest(ARRAY['ga_next_po_no', 'ga_wf_num', 'ga_po_data', 'ga_po_insert', 'ga_ws_po_create', 'ga_ws_po_update', 'ga_ws_po_from_review', 'ga_ws_po_action',
                                      'ga_ws_po_get', 'ga_ws_po_list', 'ga_ws_po_price_history', 'ga_ws_po_vendor_options', 'ga_ws_po_settings_get', 'ga_ws_po_settings_set',
                                      'ga_ws_po_request_remaining', 'ga_inventory_tx_block_legacy_po_receipt']) f
),
new_tables AS (
  SELECT t AS name FROM unnest(ARRAY['ga_workflow_settings', 'ga_workflow_setting_events', 'ga_purchase_orders', 'ga_purchase_order_items', 'ga_purchase_order_events']) t
),
new_cols AS (
  SELECT * FROM (VALUES
    ('ga_part_fulfillments', 'ready_to_deliver_at'), ('ga_part_fulfillment_documents', 'voided_at'), ('ga_part_fulfillment_documents', 'void_reason'),
    ('ga_part_fulfillment_documents', 'voided_by'), ('ga_service_request_comments', 'original_body'), ('ga_service_request_events', 'proxy_for_store'),
    ('ga_service_requests', 'cancel_reason'), ('ga_service_requests', 'reopened_count'), ('ga_purchase_review_quotes', 'superseded_at')
  ) AS v(tbl, col)
),
default_wh AS (
  SELECT id, code, name FROM public.ga_inventory_locations WHERE deleted_at IS NULL AND is_active AND is_default AND location_type = 'CENTRAL_WAREHOUSE'
),
active_vendors AS (
  SELECT * FROM public.ga_vendors WHERE status = 'active'
),
waiting_reviews AS (
  -- 舊版採購評估「進入採購」且需求單還在進行中：新版上線後，這些單若在舊版按「收貨」會直接過帳（沒有對應採購單）
  SELECT r.id AS request_id, r.request_no, r.main_status
    FROM public.ga_service_requests r JOIN public.ga_purchase_reviews pr ON pr.request_id = r.id AND pr.deleted_at IS NULL AND pr.decision = 'PURCHASE'
   WHERE r.deleted_at IS NULL AND r.main_status IN ('ACCEPTED', 'IN_PROGRESS', 'WAITING_GA_REVIEW')
),
block_repair AS (
  SELECT r.id FROM public.ga_service_requests r
   WHERE r.deleted_at IS NULL AND r.request_type = 'REPAIR' AND r.intake_route = 'PURCHASE_REVIEW' AND r.main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED')
),
block_stock AS (
  SELECT r.id FROM public.ga_service_requests r
   WHERE r.deleted_at IS NULL AND r.part_id IS NULL AND r.intake_route = 'STOCK_ISSUE' AND r.main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED')
),
three_perm_roles AS (
  SELECT r.id, r.code, r.name,
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND rp.is_allowed AND p.is_active AND p.code = 'general_affairs.purchase_review.manage') AS has_review,
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND rp.is_allowed AND p.is_active AND p.code = 'general_affairs.inventory_transaction.manage') AS has_txn,
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND rp.is_allowed AND p.is_active AND p.code IN ('general_affairs.part.view', 'general_affairs.part.manage')) AS has_part
    FROM public.roles r
)
SELECT '1 先決條件' AS section, '資料表 ' || r.name AS item, to_regclass('public.' || r.name)::text AS value,
       CASE WHEN to_regclass('public.' || r.name) IS NULL THEN 'MISSING' ELSE 'OK' END AS status
  FROM req_tables r
UNION ALL
SELECT '1 先決條件', '函式 ' || r.name, (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = r.name),
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = r.name) THEN 'OK' ELSE 'MISSING' END
  FROM req_fns r
UNION ALL
SELECT '1 先決條件', 'ga_vendors 欄位 status／tax_id／payment_terms（供應商只能選 status = active；統編與付款條件下訂時做快照）',
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_vendors' AND column_name IN ('status', 'tax_id', 'payment_terms')) || ' / 3',
       CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_vendors' AND column_name IN ('status', 'tax_id', 'payment_terms')) = 3 THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT '1 先決條件', 'ga_inventory_locations 類型 CENTRAL_WAREHOUSE（預設總部倉）', (SELECT count(*)::text FROM public.ga_inventory_locations WHERE location_type = 'CENTRAL_WAREHOUSE' AND deleted_at IS NULL),
       CASE WHEN EXISTS (SELECT 1 FROM public.ga_inventory_locations WHERE location_type = 'CENTRAL_WAREHOUSE' AND deleted_at IS NULL) THEN 'OK' ELSE 'WARN' END
UNION ALL
-- 2 新增物件現況：還沒套用應該都不存在
SELECT '2 新增物件現況', '資料表 ' || n.name, to_regclass('public.' || n.name)::text, CASE WHEN to_regclass('public.' || n.name) IS NULL THEN 'OK' ELSE 'ALREADY' END FROM new_tables n
UNION ALL
SELECT '2 新增物件現況', '函式 ' || n.name, (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname = n.name),
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname = n.name) THEN 'ALREADY' ELSE 'OK' END
  FROM new_fns n
UNION ALL
SELECT '2 新增物件現況', '欄位 ' || c.tbl || '.' || c.col,
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = c.tbl AND column_name = c.col),
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = c.tbl AND column_name = c.col) THEN 'ALREADY' ELSE 'OK' END
  FROM new_cols c
UNION ALL
SELECT '2 新增物件現況', '權限碼 general_affairs.purchase_order.approve（採購核准）', (SELECT count(*)::text FROM public.permissions WHERE code = 'general_affairs.purchase_order.approve'),
       CASE WHEN EXISTS (SELECT 1 FROM public.permissions WHERE code = 'general_affairs.purchase_order.approve') THEN 'ALREADY' ELSE 'OK' END
UNION ALL
-- 3 預設總部倉（採購單收貨位置預設用它；剛好一個才會自動帶入）
SELECT '3 總部倉', '啟用中、標記為預設的中央倉庫位置數（應為 1；0 或多個時採購單要手動選收貨位置）', (SELECT count(*)::text FROM default_wh),
       CASE WHEN (SELECT count(*) FROM default_wh) = 1 THEN 'OK' ELSE 'WARN' END
UNION ALL
SELECT '3 總部倉', '預設中央倉庫：' || d.code || '（' || d.name || '）', d.id::text, 'INFO' FROM default_wh d
UNION ALL
-- 4 供應商（D8：採購單只能選已建好、合作中的供應商；統編與付款條件做快照）
SELECT '4 供應商', 'ga_vendors 筆數（依狀態）：' || status, count(*)::text, 'INFO' FROM public.ga_vendors GROUP BY status
UNION ALL
SELECT '4 供應商', '合作中但統編空白的供應商數（下訂快照的統編會是空白）', (SELECT count(*)::text FROM active_vendors WHERE tax_id IS NULL OR btrim(tax_id) = ''),
       CASE WHEN EXISTS (SELECT 1 FROM active_vendors WHERE tax_id IS NULL OR btrim(tax_id) = '') THEN 'WARN' ELSE 'OK' END
UNION ALL
SELECT '4 供應商', '合作中但付款條件空白的供應商數', (SELECT count(*)::text FROM active_vendors WHERE payment_terms IS NULL OR btrim(payment_terms) = ''), 'INFO'
UNION ALL
SELECT '4 供應商', '合作中且名稱重複的供應商組數（選單會出現兩個同名廠商）', (SELECT count(*)::text FROM (SELECT name FROM active_vendors GROUP BY name HAVING count(*) > 1) d),
       CASE WHEN EXISTS (SELECT 1 FROM active_vendors GROUP BY name HAVING count(*) > 1) THEN 'WARN' ELSE 'OK' END
UNION ALL
SELECT '4 供應商', '合作中且統編重複的供應商組數（統編不空白者）', (SELECT count(*)::text FROM (SELECT tax_id FROM active_vendors WHERE tax_id IS NOT NULL AND btrim(tax_id) <> '' GROUP BY tax_id HAVING count(*) > 1) d),
       CASE WHEN EXISTS (SELECT 1 FROM active_vendors WHERE tax_id IS NOT NULL AND btrim(tax_id) <> '' GROUP BY tax_id HAVING count(*) > 1) THEN 'WARN' ELSE 'OK' END
UNION ALL
SELECT '4 供應商', '合作中供應商總數（沒有合作中的供應商就開不了採購單：請先到舊版廠商管理頁新增）', (SELECT count(*)::text FROM active_vendors),
       CASE WHEN EXISTS (SELECT 1 FROM active_vendors) THEN 'OK' ELSE 'WARN' END
UNION ALL
-- 5 新舊並存風險：舊版採購評估與「收貨」按鈕
SELECT '5 新舊並存', '舊版評估為「進入採購」且需求單仍在進行中的單數（新版上線後請只用新版採購單；33 的觸發器只擋「評估已有新版採購單」的舊版收貨）', (SELECT count(*)::text FROM waiting_reviews),
       CASE WHEN EXISTS (SELECT 1 FROM waiting_reviews) THEN 'WARN' ELSE 'OK' END
UNION ALL
SELECT '5 新舊並存', '  其中單號：' || w.request_no || '（' || w.main_status || '）', w.request_id::text, 'INFO' FROM waiting_reviews w
UNION ALL
SELECT '5 新舊並存', '料件處理單狀態「採購中」或「等待到貨」的進行中筆數', (SELECT count(*)::text FROM public.ga_part_fulfillments WHERE deleted_at IS NULL AND status IN ('PURCHASING', 'WAITING_ARRIVAL')), 'INFO'
UNION ALL
SELECT '5 新舊並存', '以舊版收貨（參考單據 GA_PURCHASE_REVIEW）過帳的庫存流水筆數（歷史）', (SELECT count(*)::text FROM public.ga_inventory_transactions WHERE reference_type = 'GA_PURCHASE_REVIEW'), 'INFO'
UNION ALL
SELECT '5 新舊並存', '庫存流水表上已有的觸發器數（33 會新增 1 個：trg_ga_inventory_transactions_block_legacy_po_receipt）', (SELECT count(*)::text FROM pg_trigger WHERE tgrelid = 'public.ga_inventory_transactions'::regclass AND NOT tgisinternal), 'INFO'
UNION ALL
-- 6 需求單規則（D4，之後的階段實作）會碰到的進行中單
SELECT '6 需求單規則', '進行中的維修單卻走了「採購評估」（D4 之後受理時會擋；既有的不會被動）', (SELECT count(*)::text FROM block_repair),
       CASE WHEN EXISTS (SELECT 1 FROM block_repair) THEN 'WARN' ELSE 'OK' END
UNION ALL
SELECT '6 需求單規則', '進行中、沒有指定料件卻走了「庫存出庫」的需求單（D4 之後受理時會擋；既有的不會被動）', (SELECT count(*)::text FROM block_stock),
       CASE WHEN EXISTS (SELECT 1 FROM block_stock) THEN 'WARN' ELSE 'OK' END
UNION ALL
SELECT '6 需求單規則', '各狀態需求單筆數：' || main_status, count(*)::text, 'INFO' FROM public.ga_service_requests WHERE deleted_at IS NULL GROUP BY main_status
UNION ALL
SELECT '6 需求單規則', '待門市確認超過 7 天的需求單數（D5 逾期標示的預設天數；只標示不自動結案）',
       (SELECT count(*)::text FROM public.ga_service_requests WHERE deleted_at IS NULL AND main_status = 'WAITING_STORE_CONFIRMATION' AND updated_at < now() - interval '7 days'), 'INFO'
UNION ALL
-- 7 權限：誰能開採購單（三個權限）、誰會被指派核准
SELECT '7 權限', '角色 ' || t.code || '（' || t.name || '）有採購單三個權限（可開單、下訂）', (SELECT count(*)::text FROM public.user_roles ur WHERE ur.role_id = t.id AND ur.is_active = true AND (ur.expires_at IS NULL OR ur.expires_at > now())) || ' 人', 'INFO'
  FROM three_perm_roles t WHERE t.has_review AND t.has_txn AND t.has_part
UNION ALL
SELECT '7 權限', '角色 ' || t.code || '（' || t.name || '）只有部分採購權限（採購評估管理／庫存交易管理／料件查看），開不了採購單', (SELECT count(*)::text FROM public.user_roles ur WHERE ur.role_id = t.id AND ur.is_active = true AND (ur.expires_at IS NULL OR ur.expires_at > now())) || ' 人',
       'WARN'
  FROM three_perm_roles t WHERE (t.has_review::int + t.has_txn::int + t.has_part::int) IN (1, 2) AND (t.has_review OR t.has_txn)
UNION ALL
SELECT '7 權限', '已勾選「採購核准」的角色數（套用 33 後預設 0；請到角色權限頁指派，至少兩位核准人或讓核准人不開單）',
       (SELECT count(*)::text FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id WHERE p.code = 'general_affairs.purchase_order.approve' AND rp.is_allowed), 'INFO'
UNION ALL
SELECT '7 權限', '採購相關權限碼是否都存在且啟用（purchase_review.view／manage、inventory_transaction.manage、part.view、vendor.view／manage，應為 6 個）',
       (SELECT count(*)::text FROM public.permissions WHERE is_active AND code IN ('general_affairs.purchase_review.view', 'general_affairs.purchase_review.manage', 'general_affairs.inventory_transaction.manage',
          'general_affairs.part.view', 'general_affairs.vendor.view', 'general_affairs.vendor.manage')),
       CASE WHEN (SELECT count(*) FROM public.permissions WHERE is_active AND code IN ('general_affairs.purchase_review.view', 'general_affairs.purchase_review.manage', 'general_affairs.inventory_transaction.manage',
          'general_affairs.part.view', 'general_affairs.vendor.view', 'general_affairs.vendor.manage')) = 6 THEN 'OK' ELSE 'MISSING' END
UNION ALL
-- 8 函式 md5（給 DEV 與正式區 pg_get_functiondef 比對；DEV 的 md5 在 34、35 完成後一併補進 README）
SELECT '8 函式 md5', p.proname || '（比對用）', md5(pg_get_functiondef(p.oid)), 'INFO'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('ga_post_inventory_transaction', 'has_permission', 'ga_next_purchase_order_no')
UNION ALL
-- 9 第 4 批 C（34）預告：料件型號對應、設備來源連結欄位現況（目前只是 INFO）
SELECT '9 34 預告', '欄位 ga_parts.equipment_template_id（D14 料件對應設備型號；34 新增）', (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_parts' AND column_name = 'equipment_template_id'), 'INFO'
UNION ALL
SELECT '9 34 預告', '欄位 ga_equipment.purchase_amount／purchased_at／warranty_end_date（既有；設備購價與保固沿用，34 會再加來源連結與保固起算日）',
       (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_equipment' AND column_name IN ('purchase_amount', 'purchased_at', 'warranty_end_date')) || ' / 3', 'INFO'
UNION ALL
SELECT '9 34 預告', '設備資產編號唯一索引 uq_ga_equipment_asset_code_active（舊版防重複規則；配發建立設備沿用）', (SELECT count(*)::text FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_ga_equipment_asset_code_active'),
       CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_ga_equipment_asset_code_active') THEN 'OK' ELSE 'WARN' END
UNION ALL
-- 10 第 4 批 A（32）預告：G14 至 G17 規則會碰到的現況
SELECT '10 32 預告', '待門市確認的需求單數（32 會補上「待確認起算時間」，用更新時間當起算；超過逾期天數預設 7 天會標示逾期未確認）',
       (SELECT count(*)::text FROM public.ga_service_requests WHERE deleted_at IS NULL AND main_status = 'WAITING_STORE_CONFIRMATION'), 'INFO'
UNION ALL
SELECT '10 32 預告', '料件處理單中已達需求量、尚未送門市確認的筆數（32 套用後它們會顯示「待交付」）',
       (SELECT count(*)::text FROM public.ga_part_fulfillments WHERE deleted_at IS NULL AND status IN ('STOCK_ISSUE', 'TRANSFER', 'PURCHASING', 'WAITING_ARRIVAL') AND COALESCE(requested_quantity, 0) > 0 AND fulfilled_quantity >= requested_quantity), 'INFO'
UNION ALL
SELECT '10 32 預告', '會被新規則擋到的進行中維修單（類型維修卻分流到採購評估，D4：受理時才擋，已受理的不受影響，只列出供人工處理）',
       (SELECT count(*)::text FROM public.ga_service_requests WHERE deleted_at IS NULL AND request_type = 'REPAIR' AND intake_route = 'PURCHASE_REVIEW' AND main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED')),
       CASE WHEN EXISTS (SELECT 1 FROM public.ga_service_requests WHERE deleted_at IS NULL AND request_type = 'REPAIR' AND intake_route = 'PURCHASE_REVIEW' AND main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED')) THEN 'WARN' ELSE 'OK' END
UNION ALL
SELECT '10 32 預告', '會被覆蓋的第 3 批函式 ga_inv_tr_sync_fulfillment 是否存在（32 覆蓋它：調撥全收後成為待交付；撤回檔會還原原版）',
       (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_inv_tr_sync_fulfillment'),
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_inv_tr_sync_fulfillment') THEN 'OK' ELSE 'MISSING' END
UNION ALL
SELECT '10 32 預告', 'ga_inv_tr_sync_fulfillment 目前版本 md5（與 DEV 第 3 批版本比對，撤回 32 時用得上）', md5(pg_get_functiondef(p.oid)), 'INFO'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_inv_tr_sync_fulfillment'
UNION ALL
SELECT '10 32 預告', '設備指向需求單的外鍵數（34 刻意不新增外鍵，避免舊版需求單 API 的 equipment 嵌入查詢出現關聯不明確；現況與 34 套用後都應為 0）',
       (SELECT count(*)::text FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid = 'public.ga_equipment'::regclass AND c.confrelid = 'public.ga_service_requests'::regclass),
       CASE WHEN (SELECT count(*) FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid = 'public.ga_equipment'::regclass AND c.confrelid = 'public.ga_service_requests'::regclass) = 0 THEN 'OK' ELSE 'WARN' END
ORDER BY 1, 2;

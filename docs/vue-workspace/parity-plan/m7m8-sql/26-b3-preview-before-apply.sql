-- 26-b3-preview-before-apply.sql
-- M7/M8 第 3 批（庫存位置與料件設定、餘額與流水與過帳、調撥；含 C13 分類停用後可修改）套用 27、28、29、30 之前先看的現況檢查。
-- 唯讀（只有 SELECT），整份可直接貼上執行，不會改任何資料。
-- 每列有 section（區）、item（項目）、value（數字或內容）、status：OK＝正常；MISSING＝缺東西，不要套用；ALREADY＝已經有了（重複套用沒問題，但請確認是不是上次套的）；
-- WARN＝需要你看一下（新規則會擋到的既有資料、權限缺口）；INFO＝只是現況，給你決定上線怎麼安排。
-- 只需要看 MISSING、WARN、ALREADY；INFO 是現況數字。
-- 在 DEV 已套用 27、30 之後再跑：第 2 區會出現 ALREADY、第 5 區兩個驗證函式的 md5 會與「套用前」不同（WARN），都是預期的；正式區尚未套用時應全部 OK。
-- 第 6 區：只有記帳管理或只有調撥管理的角色（DEV 的 dev_* 臨時角色與 manager 角色沒有任何人使用）；正式區若出現有人數的角色，上線前要決定補哪一個權限（調撥要兩個都有）。
WITH
req_tables AS (
  SELECT t AS name FROM unnest(ARRAY['ga_inventory_locations', 'ga_inventory_location_parts', 'ga_inventory_balances', 'ga_inventory_transactions',
                                      'ga_inventory_transfers', 'ga_inventory_transfer_items', 'ga_parts', 'ga_equipment', 'ga_facilities',
                                      'ga_equipment_categories', 'ga_facility_categories', 'store_managers', 'stores']) t
),
req_fns AS (
  SELECT f AS name FROM unnest(ARRAY['has_permission', 'current_user_has_permission', 'ga_normalize_optional_text', 'ga_inventory_location_is_visible',
                                      'ga_validate_equipment', 'ga_validate_facility', 'ga_validate_inventory_location', 'ga_validate_inventory_location_part',
                                      'ga_post_inventory_transaction', 'ga_is_active_facility_category', 'ga_category_has_active_path']) f
),
new_objs AS (
  SELECT o AS name FROM unnest(ARRAY['ga_ws_inv_location_impact', 'ga_ws_inv_location_counts', 'ga_ws_inv_save_location', 'ga_ws_inv_delete_location',
                                      'ga_ws_inv_add_location_parts', 'ga_ws_inv_update_location_part', 'ga_ws_inv_remove_location_part',
                                      'ga_inv_location_has_history', 'ga_inv_location_impact_json', 'ga_inv_setting_impact_json', 'ga_inv_jsonb_key_count',
                                      'ga_inventory_locations_guard', 'ga_parts_block_deactivate_with_stock',
                                      'ga_inv_map_error', 'ga_ws_inv_post', 'ga_ws_inv_set_holding', 'ga_ws_inv_balance_page',
                                      'ga_inv_tr_err', 'ga_inv_tr_perm_error', 'ga_inv_tr_sync_fulfillment', 'ga_inv_tr_data', 'ga_ws_inv_transfer_create', 'ga_ws_inv_transfer_action', 'ga_ws_inv_transfer_store_report', 'ga_ws_inv_transfer_set_overdue_days']) o
),
open_transfers AS (
  SELECT t.* FROM public.ga_inventory_transfers t WHERE t.deleted_at IS NULL AND t.status IN ('REQUESTED', 'SOURCE_CONFIRMED', 'IN_TRANSIT')
),
stuck AS (
  SELECT DISTINCT t.id FROM open_transfers t
    JOIN public.ga_inventory_transfer_items i ON i.transfer_id = t.id
    JOIN public.ga_inventory_locations d ON d.id = t.destination_location_id
   WHERE t.status IN ('SOURCE_CONFIRMED', 'IN_TRANSIT')
     AND (d.is_active = false OR d.deleted_at IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM public.ga_inventory_location_parts lp WHERE lp.location_id = d.id AND lp.part_id = i.part_id AND lp.is_active AND lp.deleted_at IS NULL))
),
stock_inactive_locations AS (
  SELECT DISTINCT l.id FROM public.ga_inventory_locations l JOIN public.ga_inventory_balances b ON b.location_id = l.id AND b.quantity_base <> 0
   WHERE l.is_active = false AND l.deleted_at IS NULL
),
stock_inactive_parts AS (
  SELECT DISTINCT p.id FROM public.ga_parts p JOIN public.ga_inventory_balances b ON b.part_id = p.id AND b.quantity_base <> 0
   WHERE p.is_active = false AND p.deleted_at IS NULL
),
stock_inactive_settings AS (
  SELECT lp.id FROM public.ga_inventory_location_parts lp JOIN public.ga_inventory_balances b ON b.location_id = lp.location_id AND b.part_id = lp.part_id AND b.quantity_base <> 0
   WHERE lp.is_active = false AND lp.deleted_at IS NULL
),
one_perm AS (
  SELECT r.id, r.code, r.name,
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND rp.is_allowed AND p.is_active AND p.code = 'general_affairs.inventory_transaction.manage') AS has_txn,
         EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id AND rp.is_allowed AND p.is_active AND p.code = 'general_affairs.inventory_transfer.manage') AS has_transfer
    FROM public.roles r
),
mgr_no_roster AS (
  SELECT DISTINCT ur.user_id FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
   WHERE r.code IN ('store_manager', 'store_manager_role') AND ur.is_active AND NOT EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = ur.user_id)
)
SELECT '1 先決條件' AS section, '資料表 ' || r.name AS item, to_regclass('public.' || r.name)::text AS value,
       CASE WHEN to_regclass('public.' || r.name) IS NULL THEN 'MISSING' ELSE 'OK' END AS status
  FROM req_tables r
UNION ALL
SELECT '1 先決條件', '函式 ' || r.name, (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = r.name),
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = r.name) THEN 'OK' ELSE 'MISSING' END
  FROM req_fns r
UNION ALL
-- 2 新增物件現況：還沒套用應該都不存在
SELECT '2 新增物件現況', n.name, (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname = n.name),
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace WHERE ns.nspname = 'public' AND p.proname = n.name) THEN 'ALREADY' ELSE 'OK' END
  FROM new_objs n
UNION ALL
SELECT '2 新增物件現況', 'ga_inventory_transfer_events／ga_inventory_transfer_settings（29 建立；有就代表 29 已套過）', COALESCE(to_regclass('public.ga_inventory_transfer_events')::text, '') || ' ' || COALESCE(to_regclass('public.ga_inventory_transfer_settings')::text, ''), 'INFO'
UNION ALL
SELECT '2 新增物件現況', 'ga_m7m8_function_backups（第 2 批 22 或本批 30 建立；有就代表已備份過函式）', to_regclass('public.ga_m7m8_function_backups')::text, 'INFO'
UNION ALL
-- 3 庫存相關資料筆數（決定要不要做期初匯入、新規則會不會碰到既有資料）
SELECT '3 資料筆數', t, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', t), false, true, '')))[1]::text, 'INFO'
  FROM unnest(ARRAY['ga_inventory_locations', 'ga_inventory_location_parts', 'ga_inventory_balances', 'ga_inventory_transactions', 'ga_inventory_transfers',
                    'ga_inventory_transfer_items', 'ga_inventory_holding_allocations', 'ga_inventory_holding_events']) t
 WHERE to_regclass('public.' || t) IS NOT NULL
UNION ALL
SELECT '3 資料筆數', '持有狀態資料表 ' || t || '（第 3 批 G12 持有狀態要用，沒有就要補套）', to_regclass('public.' || t)::text,
       CASE WHEN to_regclass('public.' || t) IS NULL THEN 'WARN' ELSE 'OK' END
  FROM unnest(ARRAY['ga_inventory_holding_allocations', 'ga_inventory_holding_events']) t
UNION ALL
-- 4 新規則（C2、C3）會碰到的既有資料
SELECT '4 新規則影響', '進行中的調撥單（待處理、已交出、運送中；這些位置之後不能停用或刪除）', (SELECT count(*)::text FROM open_transfers),
       CASE WHEN EXISTS (SELECT 1 FROM open_transfers) THEN 'INFO' ELSE 'OK' END
UNION ALL
SELECT '4 新規則影響', '已交出或運送中，但目的位置已停用或沒有該料件啟用設定的調撥單（收貨會失敗＝卡單）', (SELECT count(*)::text FROM stuck),
       CASE WHEN EXISTS (SELECT 1 FROM stuck) THEN 'WARN' ELSE 'OK' END
UNION ALL
SELECT '4 新規則影響', '已停用位置但仍有庫存的位置數（C2：既有的不會被動，新版停用時才會先顯示庫存項數）', (SELECT count(*)::text FROM stock_inactive_locations),
       CASE WHEN EXISTS (SELECT 1 FROM stock_inactive_locations) THEN 'WARN' ELSE 'OK' END
UNION ALL
SELECT '4 新規則影響', '已停用料件但仍有庫存的料件數（C2：之後不能停用有庫存的料件；既有的不會被動）', (SELECT count(*)::text FROM stock_inactive_parts),
       CASE WHEN EXISTS (SELECT 1 FROM stock_inactive_parts) THEN 'WARN' ELSE 'OK' END
UNION ALL
SELECT '4 新規則影響', '已停用的位置料件設定但仍有庫存的筆數', (SELECT count(*)::text FROM stock_inactive_settings),
       CASE WHEN EXISTS (SELECT 1 FROM stock_inactive_settings) THEN 'WARN' ELSE 'OK' END
UNION ALL
SELECT '4 新規則影響', '已有交易或餘額的位置數（C3：這些位置之後鎖定類型、門市、代碼）',
       (SELECT count(*)::text FROM public.ga_inventory_locations l WHERE l.deleted_at IS NULL
          AND (EXISTS (SELECT 1 FROM public.ga_inventory_transactions x WHERE x.location_id = l.id) OR EXISTS (SELECT 1 FROM public.ga_inventory_balances x WHERE x.location_id = l.id))), 'INFO'
UNION ALL
-- 5 函式內容比對：C13（30）會重新定義這兩個驗證函式，必須與 DEV 驗證時相同，否則 30 會自己中止
SELECT '5 函式 md5', p.proname || '（要等於 DEV：' || CASE p.proname WHEN 'ga_validate_equipment' THEN '6e28a9343e7bf878f1359d5b61676113' ELSE '4531585395b254147c7f094235a0a559' END || '）',
       md5(pg_get_functiondef(p.oid)),
       CASE WHEN md5(pg_get_functiondef(p.oid)) = CASE p.proname WHEN 'ga_validate_equipment' THEN '6e28a9343e7bf878f1359d5b61676113' ELSE '4531585395b254147c7f094235a0a559' END THEN 'OK' ELSE 'WARN' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('ga_validate_equipment', 'ga_validate_facility') AND pg_get_function_identity_arguments(p.oid) = ''
UNION ALL
SELECT '5 函式 md5', p.proname || '（給 28／29 與日後比對用）', md5(pg_get_functiondef(p.oid)), 'INFO'
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('ga_post_inventory_transaction', 'ga_validate_inventory_location', 'ga_validate_inventory_location_part',
                                              'ga_soft_delete_inventory_location', 'ga_soft_delete_inventory_location_part', 'has_permission')
UNION ALL
-- 6 權限缺口（Q13：調撥要「調撥管理＋記帳管理」兩個都有）：只有其中一個的角色
SELECT '6 權限缺口', '角色 ' || o.code || '（' || o.name || '）只有' || CASE WHEN o.has_txn THEN '記帳管理、沒有調撥管理' ELSE '調撥管理、沒有記帳管理' END,
       (SELECT count(*)::text FROM public.user_roles ur WHERE ur.role_id = o.id AND ur.is_active = true AND (ur.expires_at IS NULL OR ur.expires_at > now())) || ' 人', 'WARN'
  FROM one_perm o
 WHERE o.has_txn <> o.has_transfer
UNION ALL
SELECT '6 權限缺口', '庫存相關權限碼是否都存在且啟用（應為 7 個）',
       (SELECT count(*)::text FROM public.permissions WHERE is_active AND code IN ('general_affairs.inventory_balance.view', 'general_affairs.inventory_location.view', 'general_affairs.inventory_location.manage',
          'general_affairs.inventory_transaction.view', 'general_affairs.inventory_transaction.manage', 'general_affairs.inventory_transfer.view', 'general_affairs.inventory_transfer.manage')),
       CASE WHEN (SELECT count(*) FROM public.permissions WHERE is_active AND code IN ('general_affairs.inventory_balance.view', 'general_affairs.inventory_location.view', 'general_affairs.inventory_location.manage',
          'general_affairs.inventory_transaction.view', 'general_affairs.inventory_transaction.manage', 'general_affairs.inventory_transfer.view', 'general_affairs.inventory_transfer.manage')) = 7 THEN 'OK' ELSE 'MISSING' END
UNION ALL
-- 7 門市名單（C12：店長、督導、區經理都靠 store_managers 名單看自己門市）
SELECT '7 門市名單', '掛店長角色（store_manager）但沒有任何門市名單身分的帳號數（這些人看不到任何門市庫存）', (SELECT count(*)::text FROM mgr_no_roster),
       CASE WHEN EXISTS (SELECT 1 FROM mgr_no_roster) THEN 'WARN' ELSE 'OK' END
UNION ALL
SELECT '7 門市名單', '門市名單筆數：' || role_type, count(*)::text, 'INFO' FROM public.store_managers GROUP BY role_type
UNION ALL
-- 8 C13：分類已停用／已刪除／祖先路徑失效的分類底下的設備與設施筆數＝新規則放寬後，這些資產才能不換分類就修改
SELECT '8 C13 分類停用', '分類失效的設備數（未刪除）', (SELECT count(*)::text FROM public.ga_equipment e WHERE e.deleted_at IS NULL AND NOT public.ga_category_has_active_path('equipment', e.category_id)), 'INFO'
UNION ALL
SELECT '8 C13 分類停用', '分類失效的設施數（未刪除）', (SELECT count(*)::text FROM public.ga_facilities f WHERE f.deleted_at IS NULL AND NOT public.ga_is_active_facility_category(f.category_id)), 'INFO'
ORDER BY 1, 2;

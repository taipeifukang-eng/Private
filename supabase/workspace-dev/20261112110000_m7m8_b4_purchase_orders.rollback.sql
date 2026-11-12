-- 還原 20261112110000_m7m8_b4_purchase_orders.sql：移除第 4 批 B 新增的採購單資料表、函式、觸發器與權限碼。
-- 會刪除：全部採購單、品項、事件紀錄（資料表直接刪除，不經過不可改刪觸發器）；採購核准權限碼（要先確認沒有任何角色勾選，否則中止）。
-- 還原後新版採購單頁無法使用；舊版畫面（含舊版收貨）恢復原行為。要先還原後面的 20261112120000（到貨驗入與配發會參照這些表）。
-- 還原前請先備份：匯出 ga_purchase_orders、ga_purchase_order_items、ga_purchase_order_events。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id WHERE p.code = 'general_affairs.purchase_order.approve') THEN
    RAISE EXCEPTION '已有角色勾選「採購核准」權限，請先到角色權限頁取消勾選再還原';
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_ga_inventory_transactions_block_legacy_po_receipt ON public.ga_inventory_transactions;
DROP FUNCTION IF EXISTS public.ga_inventory_tx_block_legacy_po_receipt();
DROP FUNCTION IF EXISTS public.ga_ws_po_request_remaining(uuid, uuid);
DROP FUNCTION IF EXISTS public.ga_ws_po_settings_set(jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_po_settings_get();
DROP FUNCTION IF EXISTS public.ga_ws_po_vendor_options(text, integer, integer);
DROP FUNCTION IF EXISTS public.ga_ws_po_price_history(uuid, integer);
DROP FUNCTION IF EXISTS public.ga_ws_po_list(jsonb, integer, integer);
DROP FUNCTION IF EXISTS public.ga_ws_po_get(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_po_action(uuid, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.ga_ws_po_from_review(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_po_update(uuid, jsonb, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_po_create(jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.ga_po_insert(uuid, jsonb, jsonb, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.ga_po_data(uuid);
DROP FUNCTION IF EXISTS public.ga_po_header_apply(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_po_check_ready(uuid);
DROP FUNCTION IF EXISTS public.ga_po_check_location(uuid);
DROP FUNCTION IF EXISTS public.ga_po_check_vendor(uuid);
DROP FUNCTION IF EXISTS public.ga_po_default_location();
DROP FUNCTION IF EXISTS public.ga_po_refresh_totals(uuid);
DROP FUNCTION IF EXISTS public.ga_po_items_apply(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_po_check_request_limit(uuid, uuid);
DROP FUNCTION IF EXISTS public.ga_po_request_committed(uuid, uuid);
DROP FUNCTION IF EXISTS public.ga_po_request_requested_base(uuid);
DROP FUNCTION IF EXISTS public.ga_next_po_no();
DROP FUNCTION IF EXISTS public.ga_po_event(uuid, text, text, text, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.ga_po_status_label(text);
DROP FUNCTION IF EXISTS public.ga_po_perm_error(uuid);
DROP FUNCTION IF EXISTS public.ga_po_can_vendor(uuid);
DROP FUNCTION IF EXISTS public.ga_po_can_view(uuid);
DROP FUNCTION IF EXISTS public.ga_po_today();
DROP FUNCTION IF EXISTS public.ga_wf_num(text, numeric);
DROP FUNCTION IF EXISTS public.ga_po_like_escape(text);
DROP FUNCTION IF EXISTS public.ga_po_fmt(numeric);
DROP FUNCTION IF EXISTS public.ga_po_catch(text, text);
DROP FUNCTION IF EXISTS public.ga_po_raise(integer, text, text, jsonb);
DROP FUNCTION IF EXISTS public.ga_po_err(integer, text, text, jsonb);
DROP TABLE IF EXISTS public.ga_purchase_order_events;
DROP TABLE IF EXISTS public.ga_purchase_order_items;
DROP TABLE IF EXISTS public.ga_purchase_orders;
DROP FUNCTION IF EXISTS public.ga_po_events_immutable();
DROP FUNCTION IF EXISTS public.ga_po_touch();
DELETE FROM public.permissions WHERE code = 'general_affairs.purchase_order.approve';
NOTIFY pgrst, 'reload schema';

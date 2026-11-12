-- 還原 20261112100000_m7m8_b4_request_rules.sql：移除第 4 批 A 新增的資料表與欄位。
-- 會刪除：流程設定與變更紀錄（採購核准門檻、稅率等設定會回到「沒有設定」）、處理單待交付時間、單據作廢紀錄、留言原文、事件代按標記、需求單取消原因與重新開啟次數、報價作廢標記。
-- 需求單、處理單、單據、留言、事件、報價本身不動。要先還原 20261112110000（採購單函式會讀設定表）。
-- 第二段（G14 至 G17）先還原：觸發器、函式、待確認起算欄位，並把第 3 批調撥同步函式還原成原版（調撥全收後自動跳到「等門市確認」）。
DO $$
BEGIN
  IF to_regclass('public.ga_purchase_orders') IS NOT NULL THEN DROP TRIGGER IF EXISTS trg_ga_purchase_orders_ful_sync ON public.ga_purchase_orders; END IF;
  IF to_regclass('public.ga_purchase_order_items') IS NOT NULL THEN DROP TRIGGER IF EXISTS trg_ga_purchase_order_items_ful_sync ON public.ga_purchase_order_items; END IF;
END $$;
DROP TRIGGER IF EXISTS trg_ga_service_requests_waiting ON public.ga_service_requests;
DROP TRIGGER IF EXISTS trg_ga_part_fulfillments_ready ON public.ga_part_fulfillments;
DROP FUNCTION IF EXISTS public.ga_ws_req_create(jsonb, text);
DROP FUNCTION IF EXISTS public.ga_ws_req_accept(uuid, timestamptz, text, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.ga_ws_req_transition(uuid, text, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.ga_ws_req_store_action(uuid, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_req_comment(uuid, text, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.ga_ws_req_settings_set(integer, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_req_stock_issue(uuid, uuid, uuid, numeric, text, text, text, text, text);
DROP FUNCTION IF EXISTS public.ga_ws_req_purchase_review(uuid, jsonb, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_ful_create(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_ful_decision(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_ful_exception(uuid, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_ful_void_document(uuid, text);
DROP FUNCTION IF EXISTS public.ga_ws_ful_deliver(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ful_sync_po(uuid);
DROP FUNCTION IF EXISTS public.ga_ful_po_trg();
DROP FUNCTION IF EXISTS public.ga_ful_recompute(uuid);
DROP FUNCTION IF EXISTS public.ga_ful_ready_trg();
DROP FUNCTION IF EXISTS public.ga_rq_waiting_trg();
DROP FUNCTION IF EXISTS public.ga_rq_docs(uuid);
DROP FUNCTION IF EXISTS public.ga_rq_is_store_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.ga_rq_event(uuid, text, text, text, text, text, text, jsonb, uuid, boolean);
DROP FUNCTION IF EXISTS public.ga_rq_catch(text, text);
DROP FUNCTION IF EXISTS public.ga_rq_raise(integer, text, text, jsonb);
DROP FUNCTION IF EXISTS public.ga_rq_err(integer, text, text, jsonb);
DROP INDEX IF EXISTS public.idx_ga_service_requests_waiting_confirm;
ALTER TABLE public.ga_service_requests DROP COLUMN IF EXISTS waiting_confirm_since;
CREATE OR REPLACE FUNCTION public.ga_inv_tr_sync_fulfillment(p_transfer_id uuid, p_status text, p_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_doc record;
  v_ful record;
  v_recv numeric;
  v_req numeric;
  v_state text;
  v_step text;
BEGIN
  SELECT d.id, d.fulfillment_id INTO v_doc FROM public.ga_part_fulfillment_documents d WHERE d.document_type = 'TRANSFER' AND d.document_id = p_transfer_id;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.ga_part_fulfillment_documents SET status = p_status WHERE id = v_doc.id;
  SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE id = v_doc.fulfillment_id FOR UPDATE;
  IF NOT FOUND OR v_ful.status NOT IN ('PENDING_DECISION', 'TRANSFER', 'EXCEPTION') THEN RETURN; END IF;
  SELECT COALESCE(sum(quantity), 0) INTO v_recv FROM public.ga_part_fulfillment_documents
   WHERE fulfillment_id = v_doc.fulfillment_id AND document_type = 'TRANSFER' AND status = 'RECEIVED';
  v_req := COALESCE(v_ful.requested_quantity, 0);
  IF p_status = 'RECEIVED' THEN
    IF v_req > 0 AND v_recv >= v_req THEN v_state := 'WAITING_STORE_CONFIRMATION'; v_step := '調撥已全數收貨，等待門市確認';
    ELSE v_state := 'TRANSFER'; v_step := '已調撥收貨 ' || v_recv::text || ' / ' || v_req::text || '，繼續處理剩餘數量'; END IF;
  ELSIF p_status = 'CANCELED' THEN
    -- 同一張需求單還有其他調撥單進行中時，取消其中一張不應把處理單標成異常。
    IF EXISTS (SELECT 1 FROM public.ga_part_fulfillment_documents d2
                WHERE d2.fulfillment_id = v_doc.fulfillment_id AND d2.document_type = 'TRANSFER' AND d2.id <> v_doc.id
                  AND COALESCE(d2.status, '') NOT IN ('CANCELED', 'RECEIVED')) THEN
      v_state := 'TRANSFER'; v_step := '有一張調撥已取消，其他調撥單仍在進行中';
    ELSE
      v_state := 'EXCEPTION'; v_step := '調撥已取消，請重新決定處理方式';
    END IF;
  ELSIF p_status = 'IN_TRANSIT' THEN v_state := 'TRANSFER'; v_step := '調撥運送中';
  ELSIF p_status = 'SOURCE_CONFIRMED' THEN v_state := 'TRANSFER'; v_step := '來源已交出，等待運送';
  ELSE v_state := 'TRANSFER'; v_step := '等待來源確認'; END IF;
  UPDATE public.ga_part_fulfillments
     SET status = v_state, current_step = v_step, updated_by = p_uid,
         fulfilled_quantity = CASE WHEN p_status = 'RECEIVED' THEN v_recv ELSE fulfilled_quantity END
   WHERE id = v_doc.fulfillment_id;
END;
$$;
DROP TABLE IF EXISTS public.ga_workflow_setting_events;
DROP TABLE IF EXISTS public.ga_workflow_settings;
ALTER TABLE public.ga_part_fulfillments DROP COLUMN IF EXISTS ready_to_deliver_at;
ALTER TABLE public.ga_part_fulfillment_documents DROP COLUMN IF EXISTS voided_at, DROP COLUMN IF EXISTS void_reason, DROP COLUMN IF EXISTS voided_by;
ALTER TABLE public.ga_service_request_comments DROP COLUMN IF EXISTS original_body;
ALTER TABLE public.ga_service_request_events DROP COLUMN IF EXISTS proxy_for_store;
ALTER TABLE public.ga_service_requests DROP CONSTRAINT IF EXISTS ga_service_requests_reopened_count_check;
ALTER TABLE public.ga_service_requests DROP COLUMN IF EXISTS cancel_reason, DROP COLUMN IF EXISTS reopened_count;
ALTER TABLE public.ga_purchase_review_quotes DROP COLUMN IF EXISTS superseded_at;
NOTIFY pgrst, 'reload schema';

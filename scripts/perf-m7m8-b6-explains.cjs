// perf-m7m8-b6-dev.cjs 的 EXPLAIN (ANALYZE, BUFFERS) 清單：各函式內最重的內層查詢（與 DEV 20261118*_m7m8_b6_*.sql 內的查詢相同）。
// 以資料庫內身分（模擬總務帳號的 auth.uid()）執行，只讀。
module.exports = {
  "徽章-逾期帳單計數": `SELECT count(*) FROM public.ga_utility_bills WHERE public.ga_ub_is_overdue(paid_at, due_date, deleted_at)`,
  "徽章-待受理需求單計數": `SELECT count(*) FROM public.ga_service_requests WHERE deleted_at IS NULL AND public.ga_att_request_intake(main_status)`,
  "徽章-合約到期計數": `SELECT count(*) FROM public.ga_vendors WHERE public.ga_vd_contract_due(status, contract_required, contract_end_date)`,
  "徽章-逾期調撥計數": `SELECT count(*) FROM public.ga_inventory_transfers t WHERE t.deleted_at IS NULL AND public.ga_att_transfer_overdue(t.status, t.source_confirmed_at, 3) AND public.ga_inventory_transfer_is_visible(t.id)`,
  "徽章-採購單逾期計數": `SELECT count(*) FROM public.ga_purchase_orders WHERE public.ga_att_po_overdue(status, expected_delivery_date)`,
  "徽章-採購單選單計數": `SELECT count(*) FROM public.ga_purchase_orders WHERE public.ga_att_po(status, expected_delivery_date, true)`,
  "徽章-待核准採購單計數": `SELECT count(*) FROM public.ga_purchase_orders WHERE status = 'PENDING_APPROVAL'`,
  "徽章-工單退回計數": `SELECT count(*) FROM public.maintenance_requests WHERE public.ga_wo_focus(status, progress_stage) = 'store_rejected'`,
  "徽章-貼標待複核計數": `SELECT public.ga_ws_onboarding_list(ARRAY['PENDING_GA_REVIEW'], NULL, NULL, NULL, 1, 0) -> 'data' ->> 'total'`,
  "首頁-逾期帳單前5筆": `SELECT b.id FROM public.ga_utility_bills b WHERE public.ga_ub_is_overdue(b.paid_at, b.due_date, b.deleted_at) ORDER BY b.due_date, b.id LIMIT 5`,
  "首頁-未結需求單與等回覆計數": `SELECT count(*) FROM public.ga_service_requests WHERE deleted_at IS NULL AND main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED')`,
  "首頁-進行中工單計數": `SELECT count(*) FROM public.maintenance_requests WHERE status <> 'COMPLETED'`,
  "首頁-未結採購單計數": `SELECT count(*) FROM public.ga_purchase_orders WHERE status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED')`,
  "首頁-待繳帳單合計": `SELECT count(*), COALESCE(sum(amount), 0) FROM public.ga_utility_bills WHERE deleted_at IS NULL AND paid_at IS NULL`,
  "首頁-庫存提醒": `WITH inv AS (
      SELECT b.id, b.location_id, b.part_id, b.quantity_base, l.name AS location_name, l.allow_negative_stock, p.name AS part_name, lp.safety_stock_qty, lp.reorder_point_qty,
             CASE WHEN lp.safety_stock_qty IS NOT NULL AND b.quantity_base < lp.safety_stock_qty THEN 'red'
                  WHEN lp.reorder_point_qty IS NOT NULL AND b.quantity_base < lp.reorder_point_qty THEN 'yellow' END AS level
        FROM public.ga_inventory_balances b
        JOIN public.ga_inventory_locations l ON l.id = b.location_id AND l.deleted_at IS NULL AND public.ga_inventory_balance_is_visible(l.id)
        LEFT JOIN public.ga_parts p ON p.id = b.part_id
        LEFT JOIN LATERAL (SELECT x.safety_stock_qty, x.reorder_point_qty FROM public.ga_inventory_location_parts x
                            WHERE x.location_id = b.location_id AND x.part_id = b.part_id AND x.deleted_at IS NULL AND x.is_active ORDER BY x.updated_at DESC LIMIT 1) lp ON true
    )
    SELECT (SELECT count(*) FROM inv WHERE quantity_base < 0 AND NOT allow_negative_stock), (SELECT count(*) FROM inv WHERE level = 'red' AND NOT (quantity_base < 0 AND allow_negative_stock)),
           (SELECT count(*) FROM inv WHERE level = 'yellow' AND NOT (quantity_base < 0 AND allow_negative_stock))`,
  "績效-工單彙總(區間內)": `SELECT m.vendor_id, count(*) FROM public.maintenance_requests m WHERE m.reported_at >= timestamptz '2038-01-01 00:00+08' AND m.reported_at < timestamptz '2039-01-01 00:00+08' GROUP BY m.vendor_id`,
  "績效-未指定廠商與總數": `SELECT (SELECT count(*) FROM public.maintenance_requests WHERE reported_at >= timestamptz '2038-01-01 00:00+08' AND reported_at < timestamptz '2039-01-01 00:00+08' AND vendor_id IS NULL),
           (SELECT count(*) FROM public.maintenance_requests WHERE reported_at >= timestamptz '2038-01-01 00:00+08' AND reported_at < timestamptz '2039-01-01 00:00+08')`,
  "績效-採購單彙總(區間內)": `SELECT o.vendor_id, count(*), sum(o.total_amount) FROM public.ga_purchase_orders o WHERE o.status IN ('ORDERED','PARTIALLY_RECEIVED','RECEIVED','CLOSED')
           AND o.ordered_at >= timestamptz '2038-01-01 00:00+08' AND o.ordered_at < timestamptz '2039-01-01 00:00+08' AND o.vendor_id IS NOT NULL GROUP BY o.vendor_id`,
  "分析-當月確定採購單": `SELECT o.id, COALESCE((SELECT sum(i.received_qty * i.unit_price) FROM public.ga_purchase_order_items i WHERE i.po_id = o.id), 0)
      FROM public.ga_purchase_orders o LEFT JOIN public.ga_vendors v ON v.id = o.vendor_id LEFT JOIN public.ga_service_requests r ON r.id = o.source_request_id
      LEFT JOIN public.stores st ON st.id = COALESCE(r.store_id, (SELECT i.target_store_id FROM public.ga_purchase_order_items i WHERE i.po_id = o.id AND i.target_store_id IS NOT NULL ORDER BY i.line_no LIMIT 1))
     WHERE o.status IN ('ORDERED','PARTIALLY_RECEIVED','RECEIVED','CLOSED') AND o.ordered_at >= timestamptz '2038-06-01 00:00+08' AND o.ordered_at < timestamptz '2038-07-01 00:00+08'`,
  "分析-預估採購單": `SELECT count(*), COALESCE(sum(total_amount), 0) FROM public.ga_purchase_orders WHERE status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED') AND created_at >= timestamptz '2038-06-01 00:00+08' AND created_at < timestamptz '2038-07-01 00:00+08'`,
  "分析-舊採購評估": `SELECT count(*) FROM public.ga_purchase_reviews r WHERE r.decision = 'PURCHASE' AND r.deleted_at IS NULL AND r.created_at >= timestamptz '2038-06-01 00:00+08' AND r.created_at < timestamptz '2038-07-01 00:00+08'
     AND NOT EXISTS (SELECT 1 FROM public.ga_purchase_orders o WHERE o.purchase_review_id = r.id)`,
  "水電-月份篩選彙總": `SELECT count(*), COALESCE(sum(amount), 0) FROM public.ga_utility_bills b WHERE b.deleted_at IS NULL AND b.billing_month = date '2038-06-01'`,
  "水電-無篩選彙總": `SELECT count(*), COALESCE(sum(amount), 0), count(*) FILTER (WHERE paid_at IS NOT NULL) FROM public.ga_utility_bills b WHERE b.deleted_at IS NULL`,
  "水電-無篩選分頁": `SELECT id FROM public.ga_utility_bills b WHERE b.deleted_at IS NULL ORDER BY billing_month DESC, due_date ASC NULLS LAST, created_at DESC, id LIMIT 20 OFFSET 0`,
  "水電-全域待繳統計": `SELECT public.ga_ub_pending_stats()`,
  "廠商-統計": `SELECT count(*), count(*) FILTER (WHERE status = 'active'), count(*) FILTER (WHERE public.ga_vd_contract_due(status, contract_required, contract_end_date)) FROM public.ga_vendors`,
  "廠商-名稱排序分頁": `SELECT id FROM public.ga_vendors v ORDER BY v.name, v.id LIMIT 20 OFFSET 0`,
};

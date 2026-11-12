// G17 料件處理中心 API（/api/workspace/general-affairs/part-fulfillments/**）。
// 讀取：用使用者自己的登入身分查處理單（RLS：料件處理查看或管理）；寫入全走資料庫函式（ga_ws_ful_*，鎖列、版本檢查、同交易同步需求單）。
// Q16：沒有採購評估權限者看不到採購單金額與供應商。Q18：待交付、送門市確認、異常時逐筆作廢單據後重選、改決策時舊採購單標已取消。
import { NextRequest } from "next/server";
import { adminClient } from "../server";
import { dbCan } from "./access";
import { FULFILLMENT_STATUSES, fulfillmentAbilities, fulfillmentLabel, isReadyToDeliver, maskPurchaseDoc } from "./request-rules";
import { PR } from "./requests";
import { FILTERS_BOOL, isUuid, orIlike, pagingMeta, parsePaging } from "./rules";
import { GaError, body, dbError, must, respond, rpc, type Context } from "./server";

export const FUL = { view: "general_affairs.part_fulfillment.view", manage: "general_affairs.part_fulfillment.manage" } as const;
const COLUMNS = "id,fulfillment_no,request_id,status,requested_quantity,fulfilled_quantity,unit,current_step,notes,ready_to_deliver_at,created_at,updated_at";
const SELECT = `${COLUMNS},request:ga_service_requests(id,request_no,title,description,main_status,store_id,part_id,desired_quantity,desired_unit,store:stores(id,store_code,store_name,short_name),part:ga_parts(id,part_code,name,base_unit)),documents:ga_part_fulfillment_documents(id,document_type,document_id,document_no,quantity,status,created_at,voided_at,void_reason),events:ga_part_fulfillment_events(id,event_type,title,description,created_at)`;

export async function fulfillmentScope(ctx: Context) {
  const p = ctx.permissions;
  const manage = dbCan(p, FUL.manage);
  const stock = dbCan(p, PR.txn) && dbCan(p, "general_affairs.part.view", "general_affairs.part.manage");
  return {
    manage, read: manage || dbCan(p, FUL.view),
    stockIssue: stock, transfer: dbCan(p, "general_affairs.inventory_transfer.manage") && stock,
    purchase: dbCan(p, PR.manage) && stock, purchaseView: dbCan(p, PR.view, PR.manage, PR.approve),
  };
}
type Scope = Awaited<ReturnType<typeof fulfillmentScope>>;
const requireRead = (s: Scope) => { if (!s.read) throw new GaError(403, "沒有料件處理查看權限"); };
const expectedOf = (b: Record<string, any>) => {
  const v = String(b.expected_updated_at ?? "").trim();
  if (!v) throw new GaError(400, "缺少版本資訊（expected_updated_at），請重新載入畫面");
  return v;
};

export async function fulfillmentsApi(ctx: Context, request: NextRequest, rest: string[]) {
  const m = request.method;
  const [a, b, c, d] = rest;
  if (!a) {
    if (m === "GET") return list(ctx, new URL(request.url));
    if (m === "POST") return create(ctx, request);
  }
  if (a === "documents" && b && c && m === "GET") return documentDetail(ctx, b, c);
  if (a && isUuid(a)) {
    if (!b && m === "GET") return one(ctx, a);
    if (b === "decision" && m === "POST") return decision(ctx, request, a);
    if (b === "deliver" && m === "POST") return deliver(ctx, request, a);
    if (b === "exception" && m === "POST") return exception(ctx, request, a);
    if (b === "documents" && c && isUuid(c) && d === "void" && m === "POST") return voidDoc(ctx, request, a, c);
  }
  throw new GaError(404, "找不到這個功能");
}

function shape(row: any, s: Scope) {
  const documents = ((row.documents as any[]) || []).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
  const events = ((row.events as any[]) || []).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
  return {
    ...row, documents, events,
    is_ready_to_deliver: isReadyToDeliver(row), status_label: fulfillmentLabel(row),
    abilities: fulfillmentAbilities({ manage: s.manage, stockIssue: s.stockIssue, transfer: s.transfer, purchase: s.purchase }, row),
  };
}

async function list(ctx: Context, url: URL) {
  const s = await fulfillmentScope(ctx);
  requireRead(s);
  const p = url.searchParams;
  const { page, pageSize, from, to } = parsePaging(p, { pageSize: 20, max: 100 });
  const status = (p.get("status") || "").trim().toUpperCase();
  const ready = FILTERS_BOOL(p.get("ready")) === true;
  if (status && !FULFILLMENT_STATUSES.includes(status)) throw new GaError(400, "狀態篩選錯誤");
  const requestId = (p.get("requestId") || "").trim();
  if (requestId && !isUuid(requestId)) throw new GaError(400, "需求單格式錯誤");
  const id = (p.get("fulfillmentId") || "").trim();
  if (id && !isUuid(id)) throw new GaError(400, "處理單格式錯誤");
  const search = (p.get("search") || "").trim();
  const db: any = ctx.auth;
  let searchIds: string[] | null = null;
  if (search) {
    const found = ((await must(db.from("ga_service_requests").select("id").is("deleted_at", null).or(orIlike(["request_no", "title"], search)).limit(500))) as any[]) || [];
    searchIds = found.map((r) => r.id);
  }
  const base = (q: any) => {
    let x = q.is("deleted_at", null);
    if (searchIds) x = x.in("request_id", searchIds.length ? searchIds : ["00000000-0000-0000-0000-000000000000"]);
    if (requestId) x = x.eq("request_id", requestId);
    if (id) x = x.eq("id", id);
    return x;
  };
  let q = base(db.from("ga_part_fulfillments").select(SELECT, { count: "exact" }));
  if (status) q = q.eq("status", status);
  if (ready) q = q.not("ready_to_deliver_at", "is", null).not("status", "in", "(WAITING_STORE_CONFIRMATION,COMPLETED,CANCELED,EXCEPTION,PENDING_DECISION)");
  const countOf = (extra: (q: any) => any) => extra(base(db.from("ga_part_fulfillments").select("id", { count: "exact", head: true }))).then((r: any) => { if (r.error) throw dbError(r.error); return r.count || 0; });
  const [res, ...counts] = await Promise.all([
    q.order("updated_at", { ascending: false }).order("id").range(from, to),
    countOf((x) => x),
    ...FULFILLMENT_STATUSES.map((st) => countOf((x) => x.eq("status", st))),
    countOf((x) => x.not("ready_to_deliver_at", "is", null).not("status", "in", "(WAITING_STORE_CONFIRMATION,COMPLETED,CANCELED,EXCEPTION,PENDING_DECISION)")),
  ]);
  if ((res as any).error) throw dbError((res as any).error);
  const stats: Record<string, number> = { all: counts[0] as number };
  FULFILLMENT_STATUSES.forEach((st, i) => { stats[st] = counts[i + 1] as number; });
  stats.ready = counts[FULFILLMENT_STATUSES.length + 1] as number;
  const rows = (((res as any).data as any[]) || []).map((r) => shape(r, s));
  return respond({
    data: rows, total: (res as any).count || 0, meta: pagingMeta(page, pageSize, (res as any).count || 0), stats,
    capabilities: { manage: s.manage, stockIssue: s.manage && s.stockIssue, transfer: s.manage && s.transfer, purchase: s.manage && s.purchase, purchaseView: s.purchaseView, purchaseReceipt: false },
  });
}

async function one(ctx: Context, id: string) {
  const s = await fulfillmentScope(ctx);
  requireRead(s);
  const row = (await must((ctx.auth as any).from("ga_part_fulfillments").select(SELECT).eq("id", id).is("deleted_at", null).maybeSingle())) as any;
  if (!row) throw new GaError(404, "找不到料件處理單");
  return respond({ data: shape(row, s) });
}

async function create(ctx: Context, request: NextRequest) {
  const b = await body(request);
  const requestId = String(b.requestId ?? b.request_id ?? "").trim();
  if (!isUuid(requestId)) throw new GaError(400, "缺少需求單");
  const r = await rpc(ctx, "ga_ws_ful_create", { p_request_id: requestId });
  return respond({ data: r.data, existing: !!(r as any).existing }, r.status === 201 ? 201 : 200);
}
async function decision(ctx: Context, request: NextRequest, id: string) {
  const b = await body(request);
  const r = await rpc(ctx, "ga_ws_ful_decision", { p_id: id, p_decision: b.decision ?? null, p_expected_updated_at: expectedOf(b) });
  return respond({ data: r.data });
}
async function deliver(ctx: Context, request: NextRequest, id: string) {
  const b = await body(request);
  const r = await rpc(ctx, "ga_ws_ful_deliver", { p_id: id, p_expected_updated_at: expectedOf(b) });
  return respond({ data: r.data });
}
async function exception(ctx: Context, request: NextRequest, id: string) {
  const b = await body(request);
  const r = await rpc(ctx, "ga_ws_ful_exception", { p_id: id, p_type: b.type ?? null, p_note: b.note ?? null, p_expected_updated_at: expectedOf(b) });
  return respond({ data: r.data });
}
async function voidDoc(ctx: Context, request: NextRequest, _id: string, docId: string) {
  const b = await body(request);
  const r = await rpc(ctx, "ga_ws_ful_void_document", { p_doc_id: docId, p_reason: b.reason ?? null });
  return respond({ data: r.data });
}

// 單據明細：出庫單、調撥單（用使用者身分讀，RLS 決定）；採購單走採購單資料（含金額與供應商，需採購評估權限），沒有權限只回單號與狀態。
async function documentDetail(ctx: Context, type: string, id: string) {
  const s = await fulfillmentScope(ctx);
  requireRead(s);
  const t = type.toUpperCase();
  if (!isUuid(id)) throw new GaError(400, "單據格式錯誤");
  const db: any = ctx.auth;
  let data: any = null;
  if (t === "STOCK_ISSUE") {
    data = await must(db.from("ga_inventory_transactions").select("id,transaction_no,transaction_type,quantity_input,input_unit_type,quantity_base,reason,notes,occurred_at,part:ga_parts(id,part_code,name),location:ga_inventory_locations(id,code,name)").eq("id", id).maybeSingle());
  } else if (t === "TRANSFER") {
    data = await must(db.from("ga_inventory_transfers").select("id,transfer_no,status,reason,shipped_at,received_at,canceled_at,cancel_reason,created_at").eq("id", id).maybeSingle());
  } else if (t === "PURCHASE") {
    const admin: any = adminClient();
    const po = (await must(admin.from("ga_purchase_orders").select("id,po_no,status,expected_delivery_date,subtotal,tax_amount,total_amount,vendor_id,vendor_name_snapshot,created_at,items:ga_purchase_order_items(line_no,item_name,quantity,unit,unit_price,line_amount,received_qty)").eq("id", id).maybeSingle())) as any;
    if (po) {
      if (s.purchaseView && po.vendor_id) {
        const v = (await must(admin.from("ga_vendors").select("name").eq("id", po.vendor_id).maybeSingle())) as any;
        po.vendor_name = po.vendor_name_snapshot || v?.name || null;
      }
      data = maskPurchaseDoc({ ...po, kind: "PURCHASE_ORDER" }, s.purchaseView);
    } else {
      // 舊版評估採購單（上線前建立的單）。
      const rev = (await must(db.from("ga_purchase_reviews").select("id,purchase_no,decision,vendor_name,approved_quantity,approved_unit,estimated_amount,quoted_amount,negotiated_amount,final_amount,expected_delivery_date").eq("id", id).maybeSingle())) as any;
      if (rev) data = maskPurchaseDoc({ ...rev, kind: "PURCHASE_REVIEW" }, s.purchaseView);
    }
  } else {
    throw new GaError(400, "不支援的單據類型");
  }
  if (!data) throw new GaError(404, "找不到單據");
  return respond({ data });
}

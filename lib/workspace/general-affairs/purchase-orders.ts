// G25 採購單 API（/api/workspace/general-affairs/purchase-orders/**）。
// 讀取與寫入全走資料庫函式（ga_ws_po_*，SECURITY DEFINER、用登入者身分判斷權限）；三張採購表登入者不能直接讀寫，
// 才能由資料庫依廠商權限遮蔽統編與付款條件（D8）。這裡負責：Origin（runGa）、輸入白名單驗證（400）、版本檢查必填（STALE 409 由資料庫回）、
// 分頁上限 100 與精確筆數、abilities（兩權限缺哪個講清楚、核准人限制，與資料庫同一套規則）、選擇器（位置、料件、型號、門市，只回公開欄位）。
// 權限（資料庫語意，無管理員後備）：開單、編輯、送核准、撤回、下訂、取消、短收結案、結案、到貨驗入、配發＝採購評估管理＋庫存交易管理＋料件查看；
//   核准、駁回、待簽核清單、調整門檻＝採購核准；看單＝採購評估檢視／管理或採購核准；統編與付款條件另需廠商檢視／管理。
import { NextRequest } from "next/server";
import { adminClient } from "../server";
import { dbCan } from "./access";
import { type PoWho, canViewPo, maskVendorBilling, normalizePage, poAbilities, validateActionPayload, validateCreatePayload, validateHeader, validateItems, validateSettingsPayload } from "./purchase-order-rules";
import { validateDispatchPayload, validateReceiptPayload, validateReceiptVoidPayload } from "./purchase-receipt-rules";
import { paymentAbilities } from "./payment-rules";
import { PR } from "./requests";
import { isUuid, orIlike, pagingMeta, parsePaging } from "./rules";
import { GaError, body, dbError, respond, rpc, validated, type Context } from "./server";

const VENDOR = ["general_affairs.vendor.view", "general_affairs.vendor.manage"] as const;
const PART_VIEW = ["general_affairs.part.view", "general_affairs.part.manage"] as const;

export function poWho(ctx: Context): PoWho {
  const p = ctx.permissions;
  return {
    reviewManage: dbCan(p, PR.manage), transactionManage: dbCan(p, PR.txn), partView: dbCan(p, ...PART_VIEW),
    approve: dbCan(p, PR.approve), vendorView: dbCan(p, ...VENDOR), reviewView: dbCan(p, PR.view), userId: ctx.user.id,
  };
}
function requireView(who: PoWho) {
  if (!canViewPo(who)) throw new GaError(403, "沒有查看採購單的權限（需要採購評估檢視、採購評估管理或採購核准）");
}
const expectedOf = (b: Record<string, any>) => {
  const v = String(b.expected_updated_at ?? "").trim();
  if (!v) throw new GaError(400, "缺少版本資訊（expected_updated_at），請重新載入畫面");
  if (Number.isNaN(Date.parse(v))) throw new GaError(400, "版本資訊格式錯誤，請重新載入畫面");
  return v;
};
const idOf = (v: string) => {
  if (!isUuid(v)) throw new GaError(400, "採購單 id 格式錯誤");
  return v;
};

export async function purchaseOrdersApi(ctx: Context, request: NextRequest, rest: string[]) {
  const m = request.method;
  const [a, b] = rest;
  if (!a) {
    if (m === "GET") return list(ctx, new URL(request.url), false);
    if (m === "POST") return create(ctx, request);
  }
  if (a === "approvals" && !b && m === "GET") return list(ctx, new URL(request.url), true);
  if (a === "price-history" && !b && m === "GET") return priceHistory(ctx, new URL(request.url));
  if (a === "vendor-options" && !b && m === "GET") return vendorOptions(ctx, new URL(request.url));
  if (a === "options" && !b && m === "GET") return options(ctx, new URL(request.url));
  if (a === "settings" && !b) {
    if (m === "GET") return getSettings(ctx);
    if (m === "PATCH") return patchSettings(ctx, request);
  }
  if (a === "from-review" && !b && m === "POST") return fromReview(ctx, request);
  if (a && !["approvals", "price-history", "vendor-options", "options", "settings", "from-review"].includes(a)) {
    const id = idOf(a);
    if (!b) {
      if (m === "GET") return detail(ctx, id);
      if (m === "PATCH") return update(ctx, request, id);
    }
    if (b === "actions" && m === "POST") return act(ctx, request, id);
    // 第 4.5 批：採購單「發票與請款」分頁摘要、進貨單憑證登錄。
    if (b === "payment-summary" && m === "GET") return paymentSummary(ctx, id);
    if (b === "receipts" && rest[2] && rest[3] === "voucher" && m === "PATCH") return voucher(ctx, request, id, rest[2]);
    // 第 4.5 批 P6：作廢進貨（沖回庫存、扣回驗入量、重算採購單狀態；原因必填）。
    if (b === "receipts" && rest[2] && rest[3] === "void" && !rest[4] && m === "POST") return receiptVoid(ctx, request, id, rest[2]);
    if (b === "receipts") {
      if (m === "GET") return receiptsOf(ctx, id);
      if (m === "POST") return receive(ctx, request, id);
    }
    if (b === "dispatches") {
      if (m === "GET") return receiptsOf(ctx, id);
      if (m === "POST") return dispatch(ctx, request, id);
    }
  }
  throw new GaError(404, "找不到這個功能");
}

/** 單張採購單的畫面資料：abilities 依目前登入者與單據狀態算（與資料庫規則相同）；統編與付款條件沒有廠商權限時再遮一次（雙重保險）。 */
function shape(po: any, who: PoWho) {
  const receivedTotal = ((po.items as any[]) || []).reduce((s, i) => s + Number(i.received_qty || 0), 0);
  const abilities = poAbilities(who, { status: po.status, created_by: po.created_by, submitted_by: po.submitted_by, received_qty_total: receivedTotal });
  const masked = maskVendorBilling(po, who.vendorView);
  return { ...masked, received_qty_total: receivedTotal, abilities };
}

async function list(ctx: Context, url: URL, approvals: boolean) {
  const who = poWho(ctx);
  requireView(who);
  if (approvals && !who.approve) throw new GaError(403, "待簽核清單只有持「採購核准」權限的人可以看");
  const p = url.searchParams;
  const { page, pageSize } = parsePaging(p, { pageSize: 20, max: 100 });
  const filters: Record<string, unknown> = {};
  const statuses = (p.get("status") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (statuses.length) filters.statuses = statuses;
  const q = (p.get("q") || p.get("search") || "").trim().slice(0, 100);
  if (q) filters.q = q;
  for (const [param, key] of [["vendorId", "vendor_id"], ["requestId", "request_id"]] as const) {
    const v = (p.get(param) || "").trim();
    if (v) {
      if (!isUuid(v)) throw new GaError(400, "篩選條件格式錯誤");
      filters[key] = v;
    }
  }
  if (p.get("mine") === "true") filters.mine = true;
  if (p.get("overdue") === "true") filters.overdue = true;
  // 待我處理（V9）：待核准（有核准權限才算）與逾期未到貨的聯集，與徽章同一組述詞（ga_att_po）。
  if (p.get("attention") === "1" || p.get("attention") === "true") filters.attention = true;
  // 第 4.5 批：待請款採購單（驗入含稅額 − 有效請款累計 > 尾差；只有請款檢視／管理權限者有結果，與首頁與導覽徽章同一個述詞 ga_pay_unclaimed_po_ids）。
  if (p.get("payUnclaimed") === "1" || p.get("payUnclaimed") === "true") filters.pay_unclaimed = true;
  if (approvals || p.get("view") === "approvals") {
    if (!who.approve) throw new GaError(403, "待簽核清單只有持「採購核准」權限的人可以看");
    filters.approvals = true;
  }
  const r = await rpc(ctx, "ga_ws_po_list", { p_filters: filters, p_page: page, p_page_size: pageSize });
  const total = Number(r.total) || 0;
  return respond({
    data: r.data, total, meta: pagingMeta(page, pageSize, total), stats: r.stats,
    capabilities: { write: who.reviewManage && who.transactionManage && who.partView, approve: who.approve, vendorBilling: who.vendorView, problem: poAbilities(who, { status: "DRAFT" }).problem },
  });
}

async function detail(ctx: Context, id: string) {
  const who = poWho(ctx);
  requireView(who);
  const r = await rpc(ctx, "ga_ws_po_get", { p_id: id });
  const rc = await rpc(ctx, "ga_ws_po_receipts_get", { p_po_id: id });
  return respond({ data: shape(r.data, who), receiving: rc.data });
}

/** 採購單的發票與請款摘要（進貨憑證狀態、已連發票、累計驗入含稅、已請款、已付款、尚可請款額）；需請款檢視＋採購評估檢視（資料庫判斷）。 */
async function paymentSummary(ctx: Context, id: string) {
  const ab = paymentAbilities(ctx.permissions);
  if (!ab.canView) throw new GaError(403, "沒有查看請款資料的權限（需要請款檢視或管理權限）");
  const r = await rpc(ctx, "ga_ws_pay_po_summary", { p_po_id: id });
  // can_manage 在資料庫回傳的最外層：併進 data，畫面只看 data.can_manage。
  const canManage = ab.canManage && !!(r as any).can_manage;
  return respond({ data: { ...r.data, can_manage: canManage }, permissions: { ...ab, canManage } });
}

/** 登錄進貨單憑證：免開發票／僅收據（必填說明）或改回尚未登錄；已連發票者由發票決定（資料庫 409 VOUCHER_LINKED）。 */
async function voucher(ctx: Context, request: NextRequest, poId: string, receiptId: string) {
  const ab = paymentAbilities(ctx.permissions);
  if (!ab.canManage) throw new GaError(403, "沒有登錄進貨憑證的權限（需要請款管理權限）");
  if (!isUuid(receiptId)) throw new GaError(400, "進貨單 id 格式錯誤");
  const b = await body(request);
  const status = String(b.status ?? "").trim().toUpperCase();
  if (status !== "NONE" && status !== "NO_INVOICE") throw new GaError(400, "憑證狀態只能是 NONE（尚未登錄）或 NO_INVOICE（免開發票／僅收據）");
  const note = String(b.note ?? "").trim();
  if (note.length > 200) throw new GaError(400, "憑證說明不可超過 200 個字");
  if (status === "NO_INVOICE" && !note) throw new GaError(400, "請填寫沒有發票的原因（例如僅有送貨單、對方免開發票）");
  const expected = expectedOf(b);
  // 進貨單必須屬於網址上的採購單（避免用 A 單網址改 B 單的進貨）。
  const owner = await (adminClient() as any).from("ga_purchase_receipts").select("id").eq("id", receiptId).eq("po_id", poId).maybeSingle();
  if (owner.error) throw dbError(owner.error);
  if (!owner.data) throw new GaError(404, "找不到這張進貨單（或不屬於這張採購單）");
  const r = await rpc(ctx, "ga_ws_pay_voucher_set", { p_receipt_id: receiptId, p_status: status, p_note: note || null, p_expected_updated_at: expected });
  return respond({ data: r.data });
}

/** 作廢進貨：權限同到貨（採購評估管理＋庫存交易管理＋料件查看，資料庫再判斷一次）；進貨單必須屬於網址上的採購單（資料庫以兩個 id 一起查）。 */
async function receiptVoid(ctx: Context, request: NextRequest, poId: string, receiptId: string) {
  const who = poWho(ctx);
  const problem = poAbilities(who, { status: "ORDERED" }).problem;
  if (problem) throw new GaError(403, problem);
  if (!isUuid(receiptId)) throw new GaError(400, "進貨單 id 格式錯誤");
  const b = await body(request);
  const v = validated(() => validateReceiptVoidPayload(b));
  const r = await rpc(ctx, "ga_ws_po_receipt_void", { p_po_id: poId, p_receipt_id: receiptId, p_reason: v.reason, p_key: v.idempotency_key, p_expected_updated_at: v.expected_updated_at });
  const fresh = await rpc(ctx, "ga_ws_po_get", { p_id: poId });
  const rc = await rpc(ctx, "ga_ws_po_receipts_get", { p_po_id: poId });
  return respond({ data: r.data, replay: !!(r as any).idempotent_replay, order: shape(fresh.data, who), receiving: rc.data });
}

async function receiptsOf(ctx: Context, id: string) {
  const who = poWho(ctx);
  requireView(who);
  const rc = await rpc(ctx, "ga_ws_po_receipts_get", { p_po_id: id });
  return respond({ data: rc.data });
}

async function create(ctx: Context, request: NextRequest) {
  const who = poWho(ctx);
  const problem = poAbilities(who, { status: "DRAFT" }).problem;
  if (problem) throw new GaError(403, problem);
  const b = await body(request);
  const v = validated(() => validateCreatePayload(b));
  const r = await rpc(ctx, "ga_ws_po_create", { p_header: v.header, p_items: v.items, p_create_key: v.idempotency_key });
  return respond({ data: shape(r.data, who), replay: !!r.replay }, r.status === 201 ? 201 : 200);
}

async function update(ctx: Context, request: NextRequest, id: string) {
  const who = poWho(ctx);
  const problem = poAbilities(who, { status: "DRAFT" }).problem;
  if (problem) throw new GaError(403, problem);
  const b = await body(request);
  for (const k of Object.keys(b)) if (!["header", "items", "expected_updated_at"].includes(k)) throw new GaError(400, `不支援的欄位：${k}`);
  const expected = expectedOf(b);
  const header = validated(() => validateHeader(b.header ?? {}));
  const items = b.items === undefined ? null : validated(() => validateItems(b.items));
  const r = await rpc(ctx, "ga_ws_po_update", { p_id: id, p_header: header, p_items: items, p_expected_updated_at: expected });
  return respond({ data: shape(r.data, who) });
}

async function act(ctx: Context, request: NextRequest, id: string) {
  const who = poWho(ctx);
  requireView(who);
  const b = await body(request);
  const v = validated(() => validateActionPayload(b));
  // 駁回、撤回核准、短收結案、取消（已下訂）要原因：這裡只先擋「一定要原因」的動作，其餘（取消在草稿可不填）由資料庫依目前狀態判斷。
  if (["reject", "revoke_approval", "short_close"].includes(v.action) && !v.note) {
    throw new GaError(400, v.action === "reject" ? "駁回必須填寫原因" : v.action === "revoke_approval" ? "撤回核准必須填寫原因" : "短收結案必須填寫原因");
  }
  const r = await rpc(ctx, "ga_ws_po_action", { p_id: id, p_action: v.action, p_expected_updated_at: v.expected_updated_at, p_note: v.note });
  return respond({ data: shape(r.data, who) });
}

async function receive(ctx: Context, request: NextRequest, id: string) {
  const b = await body(request);
  const v = validated(() => validateReceiptPayload(b));
  const r = await rpc(ctx, "ga_ws_po_receive", { p_po_id: id, p_header: v.header, p_lines: v.lines, p_key: v.idempotency_key });
  const who = poWho(ctx);
  const fresh = await rpc(ctx, "ga_ws_po_get", { p_id: id });
  const rc = await rpc(ctx, "ga_ws_po_receipts_get", { p_po_id: id });
  return respond({ data: r.data, replay: !!(r as any).idempotent_replay || !!r.replay, order: shape(fresh.data, who), receiving: rc.data }, r.status === 201 ? 201 : 200);
}

async function dispatch(ctx: Context, request: NextRequest, id: string) {
  const b = await body(request);
  const v = validated(() => validateDispatchPayload(b));
  // 配發的品項必須屬於這張採購單：資料庫函式以品項找單，所以要在呼叫前先核對，避免用 A 單網址配發 B 單的品項（配發一旦成功就已出庫建設備）。
  const problem = poAbilities(poWho(ctx), { status: "ORDERED" }).problem;
  if (problem) throw new GaError(403, problem);
  const owner = await (adminClient() as any).from("ga_purchase_order_items").select("id").eq("id", v.po_item_id).eq("po_id", id).maybeSingle();
  if (owner.error) throw dbError(owner.error);
  if (!owner.data) throw new GaError(400, "這個品項不屬於這張採購單");
  const r = await rpc(ctx, "ga_ws_po_dispatch", {
    p_po_item_id: v.po_item_id, p_store_id: v.store_id, p_quantity: v.quantity, p_template_id: v.equipment_template_id, p_template_reason: v.template_change_reason,
    p_source_location_id: v.source_location_id, p_serials: v.serials, p_notes: v.notes, p_key: v.idempotency_key,
  });
  const who = poWho(ctx);
  const fresh = await rpc(ctx, "ga_ws_po_get", { p_id: id });
  const rc = await rpc(ctx, "ga_ws_po_receipts_get", { p_po_id: id });
  return respond({ data: r.data, replay: !!(r as any).idempotent_replay || !!r.replay, order: shape(fresh.data, who), receiving: rc.data }, r.status === 201 ? 201 : 200);
}

async function fromReview(ctx: Context, request: NextRequest) {
  const who = poWho(ctx);
  const problem = poAbilities(who, { status: "DRAFT" }).problem;
  if (problem) throw new GaError(403, problem);
  const b = await body(request);
  const reviewId = String(b.reviewId ?? b.review_id ?? "").trim();
  if (!isUuid(reviewId)) throw new GaError(400, "缺少採購評估");
  const r = await rpc(ctx, "ga_ws_po_from_review", { p_review_id: reviewId });
  return respond({ data: r.data?.id ? shape(r.data, who) : r.data, existing: !!(r as any).existing }, r.status === 201 ? 201 : 200);
}

async function priceHistory(ctx: Context, url: URL) {
  requireView(poWho(ctx));
  const partId = (url.searchParams.get("partId") || "").trim();
  if (!isUuid(partId)) throw new GaError(400, "請指定料件");
  const r = await rpc(ctx, "ga_ws_po_price_history", { p_part_id: partId, p_limit: null });
  return respond({ data: r.data, limit: r.limit });
}

async function vendorOptions(ctx: Context, url: URL) {
  requireView(poWho(ctx));
  const { page, pageSize } = parsePaging(url.searchParams, { pageSize: 20, max: 100 });
  const q = (url.searchParams.get("search") || url.searchParams.get("q") || "").trim().slice(0, 100);
  const r = await rpc(ctx, "ga_ws_po_vendor_options", { p_q: q || null, p_page: page, p_page_size: pageSize });
  return respond({ data: r.data, total: r.total, meta: pagingMeta(page, pageSize, Number(r.total) || 0), billingVisible: !!r.billing_visible });
}

async function getSettings(ctx: Context) {
  requireView(poWho(ctx));
  const r = await rpc(ctx, "ga_ws_po_settings_get", {});
  return respond({ data: r.data });
}
async function patchSettings(ctx: Context, request: NextRequest) {
  const who = poWho(ctx);
  requireView(who);
  if (!who.approve) throw new GaError(403, "只有持「採購核准」權限的人可以調整核准門檻與稅率");
  const b = await body(request);
  const v = validated(() => validateSettingsPayload(b));
  const r = await rpc(ctx, "ga_ws_po_settings_set", { p_values: v.values, p_expected_updated_at: v.expected_updated_at });
  return respond({ data: r.data });
}

/** 選擇器（位置、料件、設備型號、門市）：只回公開欄位；採購單可看者可用。每頁最多 100，回精確筆數。 */
async function options(ctx: Context, url: URL) {
  requireView(poWho(ctx));
  const p = url.searchParams;
  const type = p.get("type") || "";
  const { page, pageSize, from, to } = parsePaging(p, { pageSize: 20, max: 100 });
  // LIKE 萬用字元（% 與 _）跳脫成字面字元，避免搜尋「%」比對到全部。
  const search = (p.get("search") || "").trim().replace(/[%_]/g, (c) => "\\" + c);
  const admin: any = adminClient();
  const done = (res: any) => {
    if (res.error) throw dbError(res.error);
    return respond({ data: res.data || [], total: res.count || 0, meta: pagingMeta(page, pageSize, res.count || 0) });
  };
  if (type === "location") {
    let q = admin.from("ga_inventory_locations").select("id,code,name,location_type,store_id,is_default", { count: "exact" }).eq("is_active", true).is("deleted_at", null);
    if (search) q = q.or(orIlike(["code", "name"], search));
    return done(await q.order("is_default", { ascending: false }).order("code").range(from, to));
  }
  if (type === "part") {
    let q = admin.from("ga_parts").select("id,name,part_code,brand,model,specification,base_unit,purchase_unit,purchase_to_base_rate,equipment_template_id", { count: "exact" }).eq("is_active", true).is("deleted_at", null);
    if (search) q = q.or(orIlike(["name", "part_code", "barcode", "brand", "model", "specification"], search));
    const res = await q.order("name").order("id").range(from, to);
    if (res.error) throw dbError(res.error);
    const tplIds = Array.from(new Set(((res.data as any[]) || []).map((r) => r.equipment_template_id).filter(Boolean)));
    const tpls = new Map<string, any>();
    if (tplIds.length) {
      const t = await admin.from("ga_equipment_templates").select("id,name,is_active").in("id", tplIds);
      if (t.error) throw dbError(t.error);
      for (const r of t.data || []) tpls.set(r.id, r);
    }
    return respond({
      data: ((res.data as any[]) || []).map((r) => ({ ...r, equipment_template: r.equipment_template_id ? tpls.get(r.equipment_template_id) || null : null })),
      total: res.count || 0, meta: pagingMeta(page, pageSize, res.count || 0),
    });
  }
  if (type === "template") {
    let q = admin.from("ga_equipment_templates").select("id,name,brand,model,is_active", { count: "exact" }).eq("is_active", true).is("deleted_at", null);
    if (search) q = q.or(orIlike(["name", "brand", "model"], search));
    return done(await q.order("name").order("id").range(from, to));
  }
  if (type === "store") {
    let q = admin.from("stores").select("id,store_code,store_name,short_name", { count: "exact" }).eq("is_active", true);
    if (search) q = q.or(orIlike(["store_code", "store_name", "short_name"], search));
    return done(await q.order("store_code").range(from, to));
  }
  throw new GaError(400, "選擇器類型錯誤（location、part、template、store）");
}

export { normalizePage };

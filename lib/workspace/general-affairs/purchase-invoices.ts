// 第 4.5 批 進貨發票 API（/api/workspace/general-affairs/purchase-invoices/**）。
// 讀取與寫入全走資料庫函式 ga_ws_pay_invoice_*（SECURITY DEFINER、has_permission 語意、同交易、鎖列、版本檢查、同廠商同號碼唯一）；發票資料表登入者不能直接讀寫。
// 權限（資料庫語意，profiles.role = admin 不放行）：清單、詳情、可連結進貨單、設定＝請款檢視或管理；新增、編輯、作廢＝請款管理。
//   賣方統編屬廠商機密：沒有廠商檢視／管理權限者回 null 並標記 seller_tax_masked（資料庫函式遮蔽，本檔再以 maskInvoice 做第二道保險）。
// 共通：非 GET 檢查 Origin（runGa）、未登入 401、新增帶 idempotency_key（同識別同內容回原結果）、編輯與作廢帶 expected_updated_at（缺少 400、不符 409 STALE）、
//   pageSize ≤ 100 回 {data,total}、無 DELETE（作廢用 POST :id/actions {action:"void", reason}）。
import { NextRequest } from "next/server";
import { maskInvoice, paymentAbilities, parseInvoiceFilters, validateInvoicePayload } from "./payment-rules";
import { isUuid, pagingMeta, parsePaging } from "./rules";
import { parseExpectedUpdatedAt } from "./vendor-rules";
import { GaError, body, respond, rpc, validated, type Context } from "./server";

const abilitiesOf = (ctx: Context) => paymentAbilities(ctx.permissions);
const idOf = (v: string | undefined) => {
  if (!isUuid(v)) throw new GaError(400, "發票 id 格式錯誤");
  return v as string;
};
function needView(ctx: Context) {
  const ab = abilitiesOf(ctx);
  if (!ab.canView) throw new GaError(403, "沒有查看發票的權限（需要請款檢視或管理權限）");
  return ab;
}
function needManage(ctx: Context, what: string) {
  const ab = abilitiesOf(ctx);
  if (!ab.canManage) throw new GaError(403, `沒有${what}的權限（需要請款管理權限）`);
  return ab;
}
const keyOf = (raw: unknown) => {
  const k = String(raw ?? "").trim();
  if (!k || k.length > 64) throw new GaError(400, "缺少防重複識別碼（idempotency_key），請重新整理畫面後再送出");
  return k;
};

export async function purchaseInvoicesApi(ctx: Context, request: NextRequest, rest: string[]) {
  const m = request.method;
  const [a, b] = rest;
  if (!a) {
    if (m === "GET") return list(ctx, new URL(request.url));
    if (m === "POST") return save(ctx, request, null);
    throw new GaError(405, "不支援的操作");
  }
  if (a === "meta") {
    if (m !== "GET") throw new GaError(405, "不支援的操作");
    return meta(ctx);
  }
  if (a === "receipt-options") {
    if (m !== "GET") throw new GaError(405, "不支援的操作");
    return receiptOptions(ctx, new URL(request.url));
  }
  const id = idOf(a);
  if (!b) {
    if (m === "GET") return detail(ctx, id);
    if (m === "PATCH") return save(ctx, request, id);
    throw new GaError(405, "不支援的操作（發票不能刪除，請用「作廢」並填寫原因）");
  }
  if (b === "actions" && m === "POST") return action(ctx, request, id);
  throw new GaError(404, "找不到這個功能");
}

/** 畫面用：目前登入者的請款能力，加尾差與買受人設定（只有請款檢視者拿得到）。 */
async function meta(ctx: Context) {
  const ab = needView(ctx);
  const r = await rpc(ctx, "ga_ws_pay_settings_get", {});
  const s = r.data || {};
  return respond({
    permissions: ab,
    settings: { tolerance_amount: Number(s.tolerance_amount ?? 5), buyer_title: s.buyer_title ?? null, buyer_tax_id: s.buyer_tax_id ?? null, updated_at: s.updated_at ?? null },
  });
}

async function list(ctx: Context, url: URL) {
  const ab = needView(ctx);
  const filters = validated(() => parseInvoiceFilters(url.searchParams));
  const { page, pageSize } = parsePaging(url.searchParams, { pageSize: 20, max: 100 });
  const r = await rpc(ctx, "ga_ws_pay_invoice_list", { p_filters: filters, p_page: page, p_page_size: pageSize });
  const d = r.data || {};
  const total = Number(d.total) || 0;
  return respond({
    data: ((d.rows as any[]) || []).map((row) => maskInvoice(row, ab.vendorVisible)),
    total, meta: pagingMeta(page, pageSize, total), summary: d.summary ?? { count: total, total_amount: 0 }, permissions: ab,
  });
}

async function detail(ctx: Context, id: string) {
  const ab = needView(ctx);
  const r = await rpc(ctx, "ga_ws_pay_invoice_get", { p_id: id });
  return respond({ data: maskInvoice(r.data || {}, ab.vendorVisible), permissions: { ...ab, canManage: ab.canManage && !!(r as any).can_manage } });
}

async function save(ctx: Context, request: NextRequest, id: string | null) {
  const ab = needManage(ctx, id ? "編輯發票" : "新增發票");
  const b = await body(request);
  const { expected_updated_at, idempotency_key, ...rawPayload } = b;
  for (const k of Object.keys(rawPayload)) {
    if (!INVOICE_KEYS.has(k)) throw new GaError(400, `不支援的欄位：${k}`);
  }
  const payload = validated(() => validateInvoicePayload(rawPayload, { create: id === null }));
  if (id === null) {
    const r = await rpc(ctx, "ga_ws_pay_invoice_save", { p_id: null, p_payload: payload, p_key: keyOf(idempotency_key), p_expected_updated_at: null });
    return respond({ data: maskInvoice(r.data, ab.vendorVisible), warnings: r.warnings ?? [], replay: !!r.replay }, r.status === 201 ? 201 : 200);
  }
  const expected = validated(() => parseExpectedUpdatedAt(expected_updated_at));
  const r = await rpc(ctx, "ga_ws_pay_invoice_save", { p_id: id, p_payload: payload, p_key: null, p_expected_updated_at: expected });
  return respond({ data: maskInvoice(r.data, ab.vendorVisible), warnings: r.warnings ?? [] });
}
const INVOICE_KEYS = new Set([
  "invoice_type", "invoice_no", "invoice_date", "vendor_id", "seller_tax_id", "buyer_tax_id", "amount_untaxed", "tax_amount", "amount_total",
  "diff_reason", "tax_mismatch_reason", "no_image_reason", "notes", "receipts",
]);

async function action(ctx: Context, request: NextRequest, id: string) {
  const ab = needManage(ctx, "作廢發票");
  const b = await body(request);
  if (String(b.action ?? "").trim() !== "void") throw new GaError(400, "不支援的動作（目前只有 void）");
  const reason = String(b.reason ?? "").trim();
  if (!reason) throw new GaError(400, "請填寫作廢原因");
  if (reason.length > 200) throw new GaError(400, "作廢原因不可超過 200 個字");
  const expected = validated(() => parseExpectedUpdatedAt(b.expected_updated_at));
  const r = await rpc(ctx, "ga_ws_pay_invoice_void", { p_id: id, p_reason: reason, p_key: keyOf(b.idempotency_key), p_expected_updated_at: expected });
  return respond({ data: maskInvoice(r.data, ab.vendorVisible), replay: !!r.replay });
}

/** 發票編輯頁挑選要連結的進貨單（含已連發票、含稅額）：需請款檢視，並需採購評估檢視（資料庫 PO_VIEW_REQUIRED）。 */
async function receiptOptions(ctx: Context, url: URL) {
  const ab = needView(ctx);
  const p = url.searchParams;
  const { page, pageSize } = parsePaging(p, { pageSize: 20, max: 100 });
  const filters: Record<string, unknown> = { only_claimable: false };
  for (const [param, key] of [["vendorId", "vendor_id"], ["poId", "po_id"]] as const) {
    const v = (p.get(param) || "").trim();
    if (v) {
      if (!isUuid(v)) throw new GaError(400, "篩選條件格式錯誤");
      filters[key] = v;
    }
  }
  const q = (p.get("q") || p.get("search") || "").trim().slice(0, 100);
  if (q) filters.search = q;
  const r = await rpc(ctx, "ga_ws_pay_receipt_candidates", { p_filters: filters, p_page: page, p_page_size: pageSize });
  const d = r.data || {};
  const total = Number(d.total) || 0;
  return respond({ data: d.rows ?? [], total, meta: pagingMeta(page, pageSize, total), permissions: ab });
}

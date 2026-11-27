// G23 水電網費 API（/api/workspace/general-affairs/utility-bills/**）。
// 讀取與寫入全走資料庫函式 ga_ws_ub_*（SECURITY DEFINER、has_permission 語意、同交易、鎖列、版本檢查）；繞開觸發器對 service_role 的 AUTH_REQUIRED（用使用者自己的登入身分呼叫），不直接讀寫資料表。
// 權限：列表、詳情、報表、門市清單＝水電網費檢視或管理；新增、編輯、標記已繳、改回待繳、刪除、異常檢查＝水電話網費管理。店長與其他人 403（資料庫 RLS 也已移除店長直讀）。
// 共通：非 GET 檢查 Origin（runGa）、未登入 401、更新帶 expected_updated_at（缺少 400、不符 409 STALE）、pageSize ≤ 100 回 {data,total}、無 DELETE（刪除用 POST :id/delete 並必填原因）。
// V6：已繳帳單改金額、識別欄位或刪除需 confirm_paid_change:true，否則回 409 PAID_CHANGE_CONFIRM_REQUIRED 附原值；改回待繳需 confirm:true（409 UNPAY_CONFIRM_REQUIRED 附原繳費日期）。
// V7：儲存時回 anomaly／warnings（金額異常只提醒，仍已儲存）；anomaly-check 供表單送出前預先檢查。V8：標記已繳預設台北今天、不可未來、不可早於帳單月份前 1 個月。
import { NextRequest } from "next/server";
import { parseExpectedUpdatedAt } from "./vendor-rules";
import { UTILITY_BILL_MANAGE_LABEL, parseReportParams, parseUtilityFilters, pickBillPayload, utilityBillAbilities } from "./utility-bill-rules";
import { parseMatrixYear } from "./utility-report-matrix";
import { isUuid, pagingMeta, parsePaging } from "./rules";
import { parseUtilityBillExtraFilters, pickPayeeField, validateSetPayee } from "./utility-payment-rules";
import { scanTokenCreate, scanTokenRevoke } from "./utility-scan";
import { GaError, body, respond, rpc, validated, type Context } from "./server";

const abilitiesOf = (ctx: Context) => utilityBillAbilities(ctx.permissions);
const idOf = (v: string | undefined) => {
  if (!isUuid(v)) throw new GaError(400, "帳單 id 格式錯誤");
  return v as string;
};
const needView = (ctx: Context) => {
  const ab = abilitiesOf(ctx);
  if (!ab.canView) throw new GaError(403, "沒有查看水電網費的權限");
  return ab;
};
const needManage = (ctx: Context, what: string) => {
  const ab = abilitiesOf(ctx);
  if (!ab.canManage) throw new GaError(403, `沒有${what}的權限（需要${UTILITY_BILL_MANAGE_LABEL}權限）`);
  return ab;
};
/** 選填的版本資訊：有帶就驗格式，沒帶交給資料庫函式判斷（冪等操作可以不帶）。 */
const optExpected = (raw: unknown) => (raw === undefined || raw === null || raw === "" ? null : validated(() => parseExpectedUpdatedAt(raw)));

export async function utilityBillsApi(ctx: Context, request: NextRequest, rest: string[]) {
  const m = request.method;
  const [a, b] = rest;
  if (!a) {
    if (m === "GET") return list(ctx, new URL(request.url));
    if (m === "POST") return save(ctx, request, null);
    throw new GaError(405, "不支援的操作");
  }
  if (a === "payees") {
    if (m !== "GET") throw new GaError(405, "不支援的操作");
    return payees(ctx);
  }
  if (a === "set-payee") {
    if (m !== "POST") throw new GaError(405, "不支援的操作");
    return setPayee(ctx, request);
  }
  if (a === "meta") {
    if (m !== "GET") throw new GaError(405, "不支援的操作");
    return meta(ctx);
  }
  if (a === "report") {
    if (m !== "GET") throw new GaError(405, "不支援的操作");
    return report(ctx, new URL(request.url));
  }
  if (a === "report-monthly") {
    if (m !== "GET") throw new GaError(405, "不支援的操作");
    return reportMonthly(ctx, new URL(request.url));
  }
  if (a === "anomaly-check") {
    if (m !== "POST") throw new GaError(405, "不支援的操作");
    return anomalyCheck(ctx, request);
  }
  const id = idOf(a);
  if (!b) {
    if (m === "GET") return detail(ctx, id);
    if (m === "PATCH") return save(ctx, request, id);
    throw new GaError(405, "不支援的操作（刪除請用 POST …/delete 並填寫原因）");
  }
  if (m !== "POST") throw new GaError(405, "不支援的操作");
  if (b === "pay") return pay(ctx, request, id);
  if (b === "unpay") return unpay(ctx, request, id);
  if (b === "delete") return remove(ctx, request, id);
  if (b === "scan-token") return scanTokenCreate(ctx, request, id);
  if (b === "scan-token-revoke") return scanTokenRevoke(ctx, id);
  throw new GaError(404, "找不到這個功能");
}

async function list(ctx: Context, url: URL) {
  const ab = needView(ctx);
  const filters = validated(() => ({ ...parseUtilityFilters(url.searchParams), ...parseUtilityBillExtraFilters(url.searchParams) }));
  const { page, pageSize } = parsePaging(url.searchParams, { pageSize: 20, max: 100 });
  const r = await rpc(ctx, "ga_ws_ub_list", { p_filters: filters, p_page: page, p_page_size: pageSize });
  const d = r.data || {};
  return respond({ data: d.rows ?? [], total: d.total ?? 0, meta: pagingMeta(page, pageSize, d.total ?? 0), summary: d.summary ?? {}, global: d.global ?? {}, deleted_view: !!d.deleted_view, permissions: ab });
}

/** G46 繳費單位下拉：公用事業分類且合作中的廠商，只回 id 與名稱（不含統編與銀行）。需水電網費檢視或管理。 */
async function payees(ctx: Context) {
  const ab = needView(ctx);
  const r = await rpc(ctx, "ga_ws_ub_payees", {});
  return respond({ data: r.data ?? [], category_id: r.category_id ?? null, permissions: ab });
}

/** G46 批次補填繳費單位：只填空白，已有繳費單位與已刪除的跳過並回報；一次最多 200 筆。需水電話網費管理。 */
async function setPayee(ctx: Context, request: NextRequest) {
  needManage(ctx, "補填繳費單位");
  const b = await body(request);
  const payload = validated(() => validateSetPayee(b));
  const r = await rpc(ctx, "ga_ws_ub_set_payee", { p_ids: payload.ids, p_vendor: payload.vendor_id });
  return respond({ data: r.data });
}

async function meta(ctx: Context) {
  const ab = needView(ctx);
  const r = await rpc(ctx, "ga_ws_ub_stores", {});
  return respond({ stores: r.data ?? [], today: r.today, permissions: ab });
}

async function detail(ctx: Context, id: string) {
  const ab = needView(ctx);
  const r = await rpc(ctx, "ga_ws_ub_get", { p_id: id });
  return respond({ data: r.data, permissions: ab });
}

async function report(ctx: Context, url: URL) {
  needView(ctx);
  const q = validated(() => parseReportParams(url.searchParams));
  const r = await rpc(ctx, "ga_ws_ub_report", { p_mode: q.mode, p_year: q.year, p_period: q.period });
  return respond({ data: r.data });
}

async function reportMonthly(ctx: Context, url: URL) {
  needView(ctx);
  const year = validated(() => parseMatrixYear(url.searchParams));
  const r = await rpc(ctx, "ga_ws_ub_year_matrix", { p_year: year });
  return respond({ data: r.data });
}

async function anomalyCheck(ctx: Context, request: NextRequest) {
  needManage(ctx, "新增或編輯帳單");
  const b = await body(request);
  const excludeId = b.exclude_id ? idOf(String(b.exclude_id)) : null;
  const r = await rpc(ctx, "ga_ws_ub_anomaly", { p_payload: pickBillPayload(b), p_exclude_id: excludeId });
  return respond({ data: r.data });
}

async function save(ctx: Context, request: NextRequest, id: string | null) {
  needManage(ctx, "新增或編輯帳單");
  const b = await body(request);
  const expected = id ? validated(() => parseExpectedUpdatedAt(b.expected_updated_at)) : null;
  const payload = { ...pickBillPayload(b), ...validated(() => pickPayeeField(b)) };
  const r = await rpc(ctx, "ga_ws_ub_save", { p_id: id, p_payload: payload, p_expected_updated_at: expected, p_confirm_paid_change: b.confirm_paid_change === true });
  return respond({ data: r.data, anomaly: r.anomaly ?? null, warnings: r.warnings ?? [] }, id ? 200 : 201);
}

async function pay(ctx: Context, request: NextRequest, id: string) {
  needManage(ctx, "標記繳費");
  const b = await body(request);
  const paidAt = b.paid_at === undefined || b.paid_at === null || b.paid_at === "" ? null : String(b.paid_at);
  const r = await rpc(ctx, "ga_ws_ub_pay", { p_id: id, p_paid_at: paidAt, p_expected_updated_at: optExpected(b.expected_updated_at) });
  return respond({ data: r.data, noop: !!r.noop });
}

async function unpay(ctx: Context, request: NextRequest, id: string) {
  needManage(ctx, "改回待繳");
  const b = await body(request);
  const r = await rpc(ctx, "ga_ws_ub_unpay", { p_id: id, p_confirm: b.confirm === true, p_expected_updated_at: optExpected(b.expected_updated_at) });
  return respond({ data: r.data, noop: !!r.noop });
}

async function remove(ctx: Context, request: NextRequest, id: string) {
  needManage(ctx, "刪除帳單");
  const b = await body(request);
  const reason = typeof b.reason === "string" ? b.reason : "";
  const r = await rpc(ctx, "ga_ws_ub_delete", { p_id: id, p_reason: reason, p_confirm_paid_change: b.confirm_paid_change === true, p_expected_updated_at: optExpected(b.expected_updated_at) });
  return respond({ data: r.data, noop: !!r.noop });
}

// 第 4.5 批 請款單 API（/api/workspace/general-affairs/payment-requests/** 與 payment-settings）。
// 讀寫全走資料庫函式 ga_ws_pay_request_*／ga_ws_pay_export／ga_ws_pay_settings_*（SECURITY DEFINER、has_permission 語意、鎖列、版本檢查、不可改刪的操作紀錄）。
// 權限（資料庫語意，profiles.role = admin 不放行）：清單、詳情、候選進貨、匯出、設定讀取＝請款檢視或管理；建立、修改草稿、送出、退回、標已付款、作廢、備註、重抓帳號、設定修改＝請款管理。
//   沒有核准流程、沒有 approve／pay 權限碼（P3、P4）；申請人可自己標已付款，每個動作都寫入操作紀錄（誰、何時）。
//   廠商統編與銀行帳號屬帳務機密：沒有廠商檢視／管理權限者回空（資料庫函式遮蔽，本檔再以 maskRequest 做第二道保險）。
// 共通：非 GET 檢查 Origin（runGa）、未登入 401、建立與動作帶 idempotency_key、修改與動作帶 expected_updated_at（缺少 400、不符 409 STALE）、無 DELETE。
import { NextRequest } from "next/server";
import {
  buildUtilityExportCsv, maskUtilityRequest, parseCandidateParams, parseSourceParam, utilityExportFileName, utilityPaymentAbilities, validateUtilityCreatePayload, validateUtilityUpdatePayload,
} from "./utility-payment-rules";
import {
  buildExportCsv, exportFileName, isPrAction, maskRequest, parseExportStatuses, parseRequestFilters, validateActionPayload, validateCreatePayload, validateSettings, validateUpdatePayload,
  MONTH_RE,
} from "./payment-request-rules";
import { isUuid, pagingMeta, parsePaging } from "./rules";
import { parseExpectedUpdatedAt } from "./vendor-rules";
import { GaError, body, respond, rpc, validated, type Context } from "./server";

// G46：請款能力加上水電話費請款的判斷（建立與送出需請款管理＋水電網費管理；明細需水電檢視），欄位是原本能力的超集合。
const abilitiesOf = (ctx: Context) => utilityPaymentAbilities(ctx.permissions);
const shape = (row: any, ab: ReturnType<typeof abilitiesOf>) => maskUtilityRequest(maskRequest(row, ab.vendorVisible), ab.billsVisible);
function needView(ctx: Context, what = "查看請款單") {
  const ab = abilitiesOf(ctx);
  if (!ab.canView) throw new GaError(403, `沒有${what}的權限（需要請款檢視或管理權限）`);
  return ab;
}
/** 建立、修改草稿、送出水電話費請款單：請款管理加水電網費管理，缺一不可（資料庫函式與觸發器再檢查一次）。 */
function needUtilityManage(ctx: Context, what: string) {
  const ab = needManage(ctx, what);
  if (!ab.billManage) throw new GaError(403, `沒有${what}的權限（需要水電網費管理權限）`);
  return ab;
}
function needManage(ctx: Context, what: string) {
  const ab = abilitiesOf(ctx);
  if (!ab.canManage) throw new GaError(403, `沒有${what}的權限（需要請款管理權限）`);
  return ab;
}
const idOf = (v: string | undefined) => {
  if (!isUuid(v)) throw new GaError(400, "請款單 id 格式錯誤");
  return v as string;
};
const keyOf = (raw: unknown) => {
  const k = String(raw ?? "").trim();
  if (!k || k.length > 64) throw new GaError(400, "缺少防重複識別碼（idempotency_key），請重新整理畫面後再送出");
  return k;
};

export async function paymentRequestsApi(ctx: Context, request: NextRequest, rest: string[]) {
  const m = request.method;
  const [a, b] = rest;
  if (!a) {
    if (m === "GET") return list(ctx, new URL(request.url));
    if (m === "POST") return create(ctx, request);
    throw new GaError(405, "不支援的操作");
  }
  if (a === "utility-candidates" && !b) {
    if (m !== "GET") throw new GaError(405, "不支援的操作");
    return utilityCandidates(ctx, new URL(request.url));
  }
  if (a === "candidates" && !b) {
    if (m !== "GET") throw new GaError(405, "不支援的操作");
    return candidates(ctx, new URL(request.url));
  }
  if (a === "export" && !b) {
    if (m !== "GET") throw new GaError(405, "不支援的操作");
    return exportCsv(ctx, new URL(request.url));
  }
  const id = idOf(a);
  if (!b) {
    if (m === "GET") return detail(ctx, id);
    if (m === "PATCH") return update(ctx, request, id);
    throw new GaError(405, "不支援的操作（請款單不能刪除，請用「作廢」）");
  }
  if (b === "actions" && m === "POST") return action(ctx, request, id);
  throw new GaError(404, "找不到這個功能");
}

async function list(ctx: Context, url: URL) {
  const ab = needView(ctx);
  const filters = validated(() => parseRequestFilters(url.searchParams));
  const { page, pageSize } = parsePaging(url.searchParams, { pageSize: 20, max: 100 });
  const r = await rpc(ctx, "ga_ws_pay_request_list", { p_filters: filters, p_page: page, p_page_size: pageSize });
  const d = r.data || {};
  const total = Number(d.total) || 0;
  return respond({
    data: ((d.rows as any[]) || []).map((row) => shape(row, ab)),
    total, meta: pagingMeta(page, pageSize, total), summary: d.summary ?? {}, global: r.global ?? {}, permissions: ab,
  });
}

async function detail(ctx: Context, id: string) {
  const ab = needView(ctx);
  const r = await rpc(ctx, "ga_ws_pay_request_get", { p_id: id });
  return respond({ data: shape(r.data || {}, ab), buyer: r.buyer ?? {}, permissions: { ...ab, canManage: ab.canManage && r.can_manage !== false } });
}

/** 可請款的進貨與尚可請款額（建立頁挑選用）。需請款檢視，並需採購評估檢視（資料庫 PO_VIEW_REQUIRED）。 */
async function candidates(ctx: Context, url: URL) {
  const ab = needView(ctx, "查看可請款進貨");
  const p = url.searchParams;
  const { page, pageSize } = parsePaging(p, { pageSize: 20, max: 100 });
  const filters: Record<string, unknown> = { only_claimable: true };
  for (const [param, key] of [["vendorId", "vendor_id"], ["poId", "po_id"]] as const) {
    const v = (p.get(param) || "").trim();
    if (v) {
      if (!isUuid(v)) throw new GaError(400, "篩選條件格式錯誤");
      filters[key] = v;
    }
  }
  const q = (p.get("q") || "").trim().slice(0, 100);
  if (q) filters.search = q;
  const r = await rpc(ctx, "ga_ws_pay_receipt_candidates", { p_filters: filters, p_page: page, p_page_size: pageSize });
  const d = r.data || {};
  const total = Number(d.total) || 0;
  return respond({ data: d.rows ?? [], total, meta: pagingMeta(page, pageSize, total), permissions: ab });
}

/** 水電話費請款單的候選：沒指定繳費單位＝各單位該月張數與可請款金額；指定單位＝該單位該月全部帳單，每張標可請款或不可請款原因。需請款檢視，帳單明細另需水電檢視（資料庫判斷）。 */
async function utilityCandidates(ctx: Context, url: URL) {
  const ab = needView(ctx, "查看可請款帳單");
  const filters = validated(() => parseCandidateParams(url.searchParams));
  const r = await rpc(ctx, "ga_ws_pay_ub_candidates", { p_filters: filters });
  return respond({ data: r.data ?? {}, permissions: ab });
}

async function create(ctx: Context, request: NextRequest) {
  const b = await body(request);
  const { idempotency_key, source: rawSource, ...raw } = b;
  const source = String(rawSource ?? "PURCHASE").trim().toUpperCase();
  if (source !== "PURCHASE" && source !== "UTILITY") throw new GaError(400, "來源只能是採購（PURCHASE）或水電話費（UTILITY）");
  if (source === "UTILITY") {
    const ab = needUtilityManage(ctx, "建立水電話費請款單");
    const payload = validated(() => validateUtilityCreatePayload(raw));
    const r = await rpc(ctx, "ga_ws_pay_ub_create", { p_payload: payload, p_key: keyOf(idempotency_key) });
    return respond({ data: shape(r.data, ab), replay: !!r.replay }, r.status === 201 ? 201 : 200);
  }
  const ab = needManage(ctx, "建立請款單");
  const payload = validated(() => validateCreatePayload(raw));
  const r = await rpc(ctx, "ga_ws_pay_request_create", { p_payload: payload, p_key: keyOf(idempotency_key) });
  return respond({ data: shape(r.data, ab), replay: !!r.replay }, r.status === 201 ? 201 : 200);
}

async function update(ctx: Context, request: NextRequest, id: string) {
  const b = await body(request);
  const { expected_updated_at, ...raw } = b;
  // 水電話費請款單的修改欄位（bill_ids、refresh、auto_mark_paid）與採購的 lines 不能混用；資料庫依請款單來源分流，來源不符回 SOURCE_MISMATCH。
  const utilityKeys = ["bill_ids", "refresh", "auto_mark_paid"].filter((k) => k in raw);
  if (utilityKeys.length && "lines" in raw) throw new GaError(400, "不能同時修改採購明細（lines）與水電帳單（bill_ids）");
  const ab = utilityKeys.length ? needUtilityManage(ctx, "修改水電話費請款單") : needManage(ctx, "修改請款單");
  const expected = validated(() => parseExpectedUpdatedAt(expected_updated_at));
  const payload = validated(() => (utilityKeys.length ? validateUtilityUpdatePayload(raw) : validateUpdatePayload(raw)));
  const r = await rpc(ctx, "ga_ws_pay_request_update", { p_id: id, p_payload: payload, p_expected_updated_at: expected });
  return respond({ data: shape(r.data, ab) });
}

async function action(ctx: Context, request: NextRequest, id: string) {
  const ab = needManage(ctx, "操作請款單");
  const b = await body(request);
  const { action: act, expected_updated_at, idempotency_key, ...raw } = b;
  const name = String(act ?? "").trim().toLowerCase();
  if (!isPrAction(name)) throw new GaError(400, "不支援的操作（submit、return、mark_paid、void、note、refresh_bank）");
  // 狀態相關的必填原因（作廢）由資料庫判斷；這裡只驗格式與長度。void 沒填原因時交給資料庫依當時狀態決定。
  const payload = validated(() => validateActionPayload(name, null, raw));
  const expected = validated(() => parseExpectedUpdatedAt(expected_updated_at));
  const r = await rpc(ctx, "ga_ws_pay_request_action", { p_id: id, p_action: name, p_payload: payload, p_key: keyOf(idempotency_key), p_expected_updated_at: expected });
  return respond({ data: shape(r.data, ab), replay: !!r.replay });
}

const EXPORT_MAX_ROWS = 5000;
/** 對帳匯出：vendor_id（可省略）、month=YYYY-MM（必填，以請款單建立日的台北月份）；狀態預設只含已送出與已付款，includeDraft=1、includeVoid=1 加入草稿與已作廢，status 指定單一狀態時只匯出該狀態。UTF-8 含 BOM，上限 5000 筆（資料庫對每個狀態各自判斷，多個狀態合併後 API 再套一次總上限，超過回 400）。 */
async function exportCsv(ctx: Context, url: URL) {
  needView(ctx, "匯出對帳資料");
  const p = url.searchParams;
  const month = (p.get("month") || "").trim();
  if (!month) throw new GaError(400, "請選擇要匯出的月份（YYYY-MM）");
  if (!MONTH_RE.test(month)) throw new GaError(400, "月份格式要是 YYYY-MM");
  const filters: Record<string, unknown> = { month };
  const vendor = (p.get("vendorId") || p.get("vendor_id") || "").trim();
  if (vendor) {
    if (!isUuid(vendor)) throw new GaError(400, "廠商篩選格式錯誤");
    filters.vendor_id = vendor;
  }
  const source = validated(() => parseSourceParam(p.get("source")));
  const statuses = validated(() => parseExportStatuses(p));
  // 資料庫匯出函式一次只收一個狀態：每個狀態各呼叫一次，再依建立時間與單號合併（同一張請款單只在同一個狀態裡，明細順序不變）。
  const rows: any[] = [];
  let secret = false;
  for (const st of statuses) {
    const r = await rpc(ctx, "ga_ws_pay_export", { p_filters: { ...filters, status: st, ...(source === "UTILITY" ? { source } : {}) } });
    const d = r.data || {};
    rows.push(...((d.rows as any[]) || []));
    secret = secret || !!d.include_vendor_secret;
  }
  // 資料庫的 5000 筆上限是每次呼叫各自計算；多個狀態合併後再套一次總上限。
  if (rows.length > EXPORT_MAX_ROWS) throw new GaError(400, `符合條件的明細有 ${rows.length} 筆，超過一次匯出的上限 ${EXPORT_MAX_ROWS.toLocaleString("en-US")} 筆，請縮小範圍（例如指定廠商或狀態）`);
  if (statuses.length > 1) rows.sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)) || String(x.pr_no).localeCompare(String(y.pr_no)));
  // 水電話費請款單的對帳欄位與採購不同（門市、費用類型、電號／水號／用戶號碼…），分開匯出；未指定來源時維持原本的採購對帳。
  const utility = source === "UTILITY";
  const csv = utility ? buildUtilityExportCsv(rows, secret) : buildExportCsv(rows, secret);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(utility ? utilityExportFileName(month) : exportFileName(month))}`,
      "Cache-Control": "no-store",
      "X-Export-Rows": String(rows.length),
    },
  });
}

// ---------------------------------------------------------------- payment-settings
export async function paymentSettingsApi(ctx: Context, request: NextRequest, rest: string[]) {
  if (rest.length) throw new GaError(404, "找不到這個功能");
  const m = request.method;
  if (m === "GET") {
    const ab = needView(ctx, "查看請款設定");
    const r = await rpc(ctx, "ga_ws_pay_settings_get", {});
    const s = r.data || {};
    return respond({ data: s, permissions: ab });
  }
  if (m === "PUT") {
    needManage(ctx, "調整請款設定");
    const b = await body(request);
    const { expected_updated_at, ...raw } = b;
    const expected = validated(() => parseExpectedUpdatedAt(expected_updated_at));
    const values = validated(() => validateSettings(raw));
    const r = await rpc(ctx, "ga_ws_pay_settings_set", { p_values: values, p_expected_updated_at: expected });
    return respond({ data: r.data });
  }
  throw new GaError(405, "不支援的操作");
}

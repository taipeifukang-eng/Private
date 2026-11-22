// G21 廠商資料 API（/api/workspace/general-affairs/vendors/** 與 vendor-options）。
// 讀取與寫入全走資料庫函式 ga_ws_vendor_*（SECURITY DEFINER、has_permission 語意、同交易、鎖列、版本檢查、統編唯一）；ga_vendors 資料表的 RLS 只留廠商檢視／管理，這裡不直接讀表。
// 權限：列表與詳情（含統編與帳務機密欄位）＝廠商檢視或管理；新增、編輯、停用＝廠商管理；只有分類、區域或合作紀錄權限者看不到廠商（403）。
//   vendor-options（工單、需求單採購評估頁下拉）＝廠商檢視／管理、工單更新／管理、採購評估檢視／管理、需求單管理、採購單查看；統編與付款條件只給廠商檢視／管理。
// 共通：非 GET 檢查 Origin（runGa）、未登入 401、寫入帶 expected_updated_at（缺少 400、不符 409 STALE）、pageSize ≤ 100 回 {data,total}、無 DELETE（不合作改停用）。
// V1：八個帳務機密欄位由資料庫函式遮蔽；本檔再以 maskVendor 做第二道保險。
import { NextRequest } from "next/server";
import { vendorAbilities, maskVendor, maskVendorOption, parseExpectedUpdatedAt, parseIdList, parseVendorFilters, VENDOR_STATUSES } from "./vendor-rules";
import { isUuid, pagingMeta, parsePaging } from "./rules";
import { GaError, body, respond, rpc, validated, type Context } from "./server";

const abilitiesOf = (ctx: Context) => vendorAbilities(ctx.permissions);
const idOf = (v: string | undefined) => {
  if (!isUuid(v)) throw new GaError(400, "廠商 id 格式錯誤");
  return v as string;
};

export async function vendorsApi(ctx: Context, request: NextRequest, rest: string[]) {
  const m = request.method;
  const [a, b] = rest;
  if (!a) {
    if (m === "GET") return list(ctx, new URL(request.url));
    if (m === "POST") return save(ctx, request, null);
    throw new GaError(405, "不支援的操作");
  }
  const id = idOf(a);
  if (!b) {
    if (m === "GET") return detail(ctx, id);
    if (m === "PATCH") return save(ctx, request, id);
    throw new GaError(405, "不支援的操作（廠商不能刪除，不合作請改為停用）");
  }
  if (b === "status" && m === "POST") return setStatus(ctx, request, id);
  if (b === "bank-log" && m === "GET") return bankLog(ctx, new URL(request.url), id);
  throw new GaError(404, "找不到這個功能");
}

async function list(ctx: Context, url: URL) {
  const ab = abilitiesOf(ctx);
  if (!ab.canView) throw new GaError(403, "沒有查看廠商資料的權限");
  const filters = validated(() => parseVendorFilters(url.searchParams));
  const { page, pageSize } = parsePaging(url.searchParams, { pageSize: 20, max: 100 });
  const r = await rpc(ctx, "ga_ws_vendor_list", { p_filters: filters, p_page: page, p_page_size: pageSize });
  const d = r.data || {};
  const rows = ((d.rows as any[]) || []).map((row) => maskVendor(row, ab.billingVisible));
  return respond({ data: rows, total: d.total ?? 0, meta: pagingMeta(page, pageSize, d.total ?? 0), stats: d.stats ?? {}, permissions: ab });
}

/** 驗收追加 F6：廠商銀行欄位修改歷程。只有廠商檢視／管理（與銀行欄位可見規則相同）；資料庫函式 ga_ws_vendor_bank_log 再判斷一次（403）。 */
async function bankLog(ctx: Context, url: URL, id: string) {
  const ab = abilitiesOf(ctx);
  if (!ab.billingVisible) throw new GaError(403, "沒有查看廠商銀行資料修改歷程的權限（需要廠商檢視或管理權限）");
  const { page, pageSize } = parsePaging(url.searchParams, { pageSize: 20, max: 100 });
  const r = await rpc(ctx, "ga_ws_vendor_bank_log", { p_vendor_id: id, p_page: page, p_page_size: pageSize });
  const d = r.data || {};
  const total = Number(d.total) || 0;
  return respond({ data: d.rows ?? [], total, meta: pagingMeta(page, pageSize, total), permissions: ab });
}

async function detail(ctx: Context, id: string) {
  const ab = abilitiesOf(ctx);
  if (!ab.canView) throw new GaError(403, "沒有查看廠商資料的權限");
  const r = await rpc(ctx, "ga_ws_vendor_get", { p_id: id });
  return respond({ data: maskVendor(r.data || {}, ab.billingVisible), permissions: ab });
}

async function save(ctx: Context, request: NextRequest, id: string | null) {
  const ab = abilitiesOf(ctx);
  if (!ab.canManage) throw new GaError(403, "沒有新增或編輯廠商的權限（需要廠商管理權限）");
  const b = await body(request);
  const { expected_updated_at, ...payload } = b;
  const expected = id ? validated(() => parseExpectedUpdatedAt(expected_updated_at)) : null;
  if (id === null && !String(payload.name ?? "").trim()) throw new GaError(400, "請填寫廠商名稱");
  const r = await rpc(ctx, "ga_ws_vendor_save", { p_id: id, p_payload: payload, p_expected_updated_at: expected });
  return respond({ data: r.data, warnings: r.warnings ?? [] }, id ? 200 : 201);
}

async function setStatus(ctx: Context, request: NextRequest, id: string) {
  const ab = abilitiesOf(ctx);
  if (!ab.canManage) throw new GaError(403, "沒有變更廠商狀態的權限（需要廠商管理權限）");
  const b = await body(request);
  if (!(VENDOR_STATUSES as readonly string[]).includes(String(b.status))) throw new GaError(400, "狀態只能是合作中（active）、暫停（paused）或停用（inactive）");
  const expected = validated(() => parseExpectedUpdatedAt(b.expected_updated_at));
  const r = await rpc(ctx, "ga_ws_vendor_set_status", { p_id: id, p_status: b.status, p_expected_updated_at: expected });
  return respond({ data: r.data, warnings: r.warnings ?? [] });
}

/** 廠商下拉（工單、需求單採購評估頁）：預設只列合作中；includeIds 讓已選但暫停／停用的廠商仍顯示。 */
export async function vendorOptionsApi(ctx: Context, request: NextRequest) {
  if (request.method !== "GET") throw new GaError(405, "不支援的操作");
  const url = new URL(request.url);
  const ab = abilitiesOf(ctx);
  if (!ab.canOptions) throw new GaError(403, "沒有查看廠商選項的權限");
  const { page, pageSize } = parsePaging(url.searchParams, { pageSize: 50, max: 100 });
  const includeIds = validated(() => parseIdList(url.searchParams.get("includeIds")));
  const q = (url.searchParams.get("q") || "").trim().slice(0, 100);
  // onlyIds=1：只回 includeIds 指定的那幾家（工單詳情顯示目前綁定的廠商名稱與狀態用；含已暫停、停用），不受分頁影響。
  if (url.searchParams.get("onlyIds") === "1") {
    if (!includeIds.length) return respond({ data: [], total: 0, meta: pagingMeta(1, pageSize, 0), billing_visible: false });
    const found: any[] = [];
    let billing = false;
    for (let p = 1; p <= 5 && found.length < includeIds.length; p += 1) {
      const r = await rpc(ctx, "ga_ws_vendor_options", { p_q: null, p_page: p, p_page_size: 100, p_include_ids: includeIds });
      billing = !!r.billing_visible;
      found.push(...((r.data as any[]) || []).filter((row) => includeIds.includes(row.id)));
      if (p * 100 >= (r.total ?? 0)) break;
    }
    return respond({ data: found.map((row) => maskVendorOption(row, billing)), total: found.length, meta: pagingMeta(1, pageSize, found.length), billing_visible: billing });
  }
  const r = await rpc(ctx, "ga_ws_vendor_options", { p_q: q || null, p_page: page, p_page_size: pageSize, p_include_ids: includeIds.length ? includeIds : null });
  const billing = !!r.billing_visible;
  return respond({ data: ((r.data as any[]) || []).map((row) => maskVendorOption(row, billing)), total: r.total ?? 0, meta: pagingMeta(page, pageSize, r.total ?? 0), billing_visible: billing });
}

/** 給伺服端其他模組（需求單採購評估頁）取全部合作中廠商選項（分頁讀完，上限 500）。 */
export async function fetchVendorOptions(ctx: Context, opts: { includeIds?: string[] } = {}) {
  const out: any[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const r = await rpc(ctx, "ga_ws_vendor_options", { p_q: null, p_page: page, p_page_size: 100, p_include_ids: opts.includeIds?.length ? opts.includeIds : null });
    out.push(...((r.data as any[]) || []));
    if (out.length >= (r.total ?? 0)) break;
  }
  return out;
}

// G20 服務區域 API（/api/workspace/general-affairs/service-regions/**）。全走資料庫函式 ga_ws_svc_region_*（SECURITY DEFINER、has_permission 語意）。
// 權限：看＝服務區域檢視／管理（持廠商檢視／管理者也可唯讀啟用區域，供廠商表單下拉）；新增與編輯＝服務區域管理。沒有 DELETE（區域不可刪除，停用或封存後仍顯示名稱）。
// 規則：代碼轉大寫、唯一、建立後鎖定；上層不可形成循環；寫入帶 expected_updated_at（缺少 400、不符 409 STALE）；pageSize ≤ 100（options=1 一次回全部供下拉與樹狀，縣市行政區約 400 筆）。
import { NextRequest } from "next/server";
import { parseExpectedUpdatedAt, parseTreeFilters } from "./vendor-rules";
import { isUuid, pagingMeta, parsePaging } from "./rules";
import { GaError, body, respond, rpc, validated, type Context } from "./server";

const idOf = (v: string | undefined) => {
  if (!isUuid(v)) throw new GaError(400, "服務區域 id 格式錯誤");
  return v as string;
};

export async function serviceRegionsApi(ctx: Context, request: NextRequest, rest: string[]) {
  const m = request.method;
  const [a, b] = rest;
  if (b) throw new GaError(404, "找不到這個功能");
  if (!a) {
    if (m === "GET") return list(ctx, new URL(request.url));
    if (m === "POST") return save(ctx, request, null);
    throw new GaError(405, "不支援的操作");
  }
  const id = idOf(a);
  if (m === "GET") return detail(ctx, id);
  if (m === "PATCH") return save(ctx, request, id);
  throw new GaError(405, "不支援的操作（服務區域不能刪除，不用的請改為停用）");
}

async function list(ctx: Context, url: URL) {
  const filters = validated(() => parseTreeFilters(url.searchParams, "region"));
  const { page, pageSize } = parsePaging(url.searchParams, { pageSize: 50, max: 100 });
  const r = await rpc(ctx, "ga_ws_svc_region_list", { p_filters: filters, p_page: page, p_page_size: pageSize });
  const d = r.data || {};
  return respond({ data: d.rows ?? [], total: d.total ?? 0, meta: pagingMeta(d.page ?? page, d.page_size ?? pageSize, d.total ?? 0), permissions: { manage: !!d.can_manage } });
}

async function detail(ctx: Context, id: string) {
  const r = await rpc(ctx, "ga_ws_svc_region_get", { p_id: id });
  return respond({ data: r.data, permissions: { manage: !!r.can_manage } });
}

async function save(ctx: Context, request: NextRequest, id: string | null) {
  const b = await body(request);
  const { expected_updated_at, ...payload } = b;
  const expected = id ? validated(() => parseExpectedUpdatedAt(expected_updated_at)) : null;
  const r = await rpc(ctx, "ga_ws_svc_region_save", { p_id: id, p_payload: payload, p_expected_updated_at: expected });
  return respond({ data: r.data }, id ? 200 : 201);
}

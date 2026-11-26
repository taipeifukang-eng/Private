// G4 同仁代墊 API：同仁匯款帳戶、挑選代墊同仁、我的代墊款。
//   GET  /payee-accounts/own            我的匯款帳戶（任何登入者，只回自己的；完整帳戶只給本人）
//   PUT  /payee-accounts/own            登錄或修改我的匯款帳戶（任何登入者，只能改自己的）
//   GET  /payee-accounts/:profileId     查看同仁的匯款帳戶（請款管理加廠商帳務檢視）
//   PUT  /payee-accounts/:profileId     代同仁登錄匯款帳戶（請款管理加廠商帳務檢視；事件記為「代登錄」，不含帳號本文）
//   GET  /payee-options?q=&page=        挑選代墊同仁（請款管理）：在職同仁、是否已登錄帳戶，不含帳戶內容
//   GET  /my-reimbursements?page=       我的代墊款（任何登入者）：付款對象是自己、已送出以後的請款單，不含廠商帳戶與統編
// 全走資料庫函式（SECURITY DEFINER、has_permission 語意）；帳號本文只在回應給有權限者，事件表只記哪些欄位變了與末四碼。
import { NextRequest } from "next/server";
import { pickMyReimbursement, validatePayoutAccountPayload } from "./payee-rules";
import { isUuid, pagingMeta, parsePaging } from "./rules";
import { GaError, body, respond, rpc, validated, type Context } from "./server";

export async function payeeAccountsApi(ctx: Context, request: NextRequest, rest: string[]) {
  const m = request.method;
  const [a, b] = rest;
  if (!a || b) throw new GaError(404, "找不到這個功能");
  if (a === "own") {
    if (m === "GET") {
      const r = await rpc(ctx, "ga_ws_payout_account_get_own", {});
      return respond({ data: r.data ?? {} });
    }
    if (m === "PUT") {
      const raw = await body(request);
      const payload = validated(() => validatePayoutAccountPayload(raw, false));
      const r = await rpc(ctx, "ga_ws_payout_account_set_own", { p_payload: payload });
      return respond({ data: r.data ?? {} });
    }
    throw new GaError(405, "不支援的操作");
  }
  if (!isUuid(a)) throw new GaError(400, "同仁 id 格式錯誤");
  if (m === "GET") {
    const r = await rpc(ctx, "ga_ws_payout_account_get_for", { p_profile: a });
    return respond({ data: r.data ?? {} });
  }
  if (m === "PUT") {
    const raw = await body(request);
    const payload = validated(() => validatePayoutAccountPayload(raw, false));
    const r = await rpc(ctx, "ga_ws_payout_account_set_for", { p_profile: a, p_payload: payload });
    return respond({ data: r.data ?? {} });
  }
  throw new GaError(405, "不支援的操作");
}

export async function payeeOptionsApi(ctx: Context, request: NextRequest, rest: string[]) {
  if (rest.length) throw new GaError(404, "找不到這個功能");
  if (request.method !== "GET") throw new GaError(405, "不支援的操作");
  const url = new URL(request.url);
  const { page } = parsePaging(url.searchParams, { pageSize: 20, max: 20 });
  const q = (url.searchParams.get("q") || "").trim().slice(0, 50);
  const r = await rpc(ctx, "ga_ws_pay_employee_options", { p_q: q || null, p_page: page });
  const d = r.data || {};
  const total = Number(d.total) || 0;
  return respond({ data: d.rows ?? [], total, meta: pagingMeta(page, 20, total) });
}

export async function myReimbursementsApi(ctx: Context, request: NextRequest, rest: string[]) {
  if (rest.length) throw new GaError(404, "找不到這個功能");
  if (request.method !== "GET") throw new GaError(405, "不支援的操作");
  const { page, pageSize } = parsePaging(new URL(request.url).searchParams, { pageSize: 20, max: 50 });
  const r = await rpc(ctx, "ga_ws_pay_my_reimbursements", { p_page: page, p_page_size: pageSize });
  const d = r.data || {};
  const total = Number(d.total) || 0;
  return respond({ data: ((d.rows as any[]) || []).map(pickMyReimbursement), total, meta: pagingMeta(page, pageSize, total) });
}

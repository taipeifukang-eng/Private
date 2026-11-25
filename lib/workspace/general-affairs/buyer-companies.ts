// G11 買受人公司 API（/api/workspace/general-affairs/buyer-companies/**）。
// 讀寫全走資料庫函式 ga_ws_buyer_company_*（SECURITY DEFINER、has_permission 語意、固定識別、版本檢查、不可改刪的事件紀錄）。
// 權限：清單＝請款檢視／管理或採購檢視／管理（下拉選單需要）；新增、修改、停用、改預設＝請款管理（與請款設定相同）。無 DELETE（公司被單據引用，只能停用）。
//   GET    /buyer-companies                列表（含停用，附使用次數）
//   POST   /buyer-companies                新增或修改（有 id 是修改，帶 expected_updated_at；帶 idempotency_key）
//   POST   /buyer-companies/:id/default    設為預設
//   POST   /buyer-companies/:id/deactivate 停用（預設公司要先改指定其他公司）
import { NextRequest } from "next/server";
import { validateBuyerCompanyPayload } from "./buyer-company-rules";
import { isUuid } from "./rules";
import { parseExpectedUpdatedAt } from "./vendor-rules";
import { GaError, body, respond, rpc, validated, type Context } from "./server";

const canView = (ctx: Context) => ctx.has("general_affairs.purchase_payment.view", "general_affairs.purchase_payment.manage", "general_affairs.purchase_review.view", "general_affairs.purchase_review.manage", "general_affairs.purchase_order.approve");
const canManage = (ctx: Context) => ctx.has("general_affairs.purchase_payment.manage");
const needManage = (ctx: Context, what: string) => {
  if (!canManage(ctx)) throw new GaError(403, `沒有${what}的權限（需要請款管理權限）`);
};
const idOf = (v: string | undefined) => {
  if (!isUuid(v)) throw new GaError(400, "公司 id 格式錯誤");
  return v as string;
};

export async function buyerCompaniesApi(ctx: Context, request: NextRequest, rest: string[]) {
  const m = request.method;
  const [a, b] = rest;
  if (!a) {
    if (m === "GET") {
      if (!canView(ctx)) throw new GaError(403, "沒有查看買受人公司的權限");
      const r = await rpc(ctx, "ga_ws_buyer_company_list", {});
      return respond({ data: r.data?.rows ?? [], updated_at: r.data?.updated_at ?? null, permissions: { canEdit: !!r.data?.can_edit } });
    }
    if (m === "POST") {
      needManage(ctx, "調整買受人公司");
      const raw = await body(request);
      const { idempotency_key, expected_updated_at, ...rest2 } = raw;
      const key = String(idempotency_key ?? "").trim();
      if (!key || key.length > 64) throw new GaError(400, "缺少防重複識別碼（idempotency_key），請重新整理畫面後再送出");
      const payload = validated(() => validateBuyerCompanyPayload(rest2));
      const expected = payload.id ? validated(() => parseExpectedUpdatedAt(expected_updated_at)) : null;
      const r = await rpc(ctx, "ga_ws_buyer_company_save", { p_payload: payload, p_key: key, p_expected_updated_at: expected });
      return respond({ data: r.data?.rows ?? [], id: r.data?.id ?? null, updated_at: r.data?.updated_at ?? null, replay: !!r.replay }, r.status === 201 ? 201 : 200);
    }
    throw new GaError(405, "不支援的操作");
  }
  const id = idOf(a);
  if (b === "default" && m === "POST") {
    needManage(ctx, "調整買受人公司");
    const r = await rpc(ctx, "ga_ws_buyer_company_set_default", { p_id: id });
    return respond({ data: r.data?.rows ?? [], updated_at: r.data?.updated_at ?? null });
  }
  if (b === "deactivate" && m === "POST") {
    needManage(ctx, "停用買受人公司");
    const r = await rpc(ctx, "ga_ws_buyer_company_deactivate", { p_id: id });
    return respond({ data: r.data?.rows ?? [], updated_at: r.data?.updated_at ?? null });
  }
  throw new GaError(b ? 404 : 405, b ? "找不到這個功能" : "不支援的操作（公司被單據引用，不能刪除，請用「停用」）");
}

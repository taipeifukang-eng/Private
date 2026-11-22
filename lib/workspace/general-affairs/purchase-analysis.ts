// G22 採購分析 API（/api/workspace/general-affairs/purchase-analysis?yearMonth=YYYY-MM&page=&pageSize=）。
// 權限：採購評估檢視或管理（資料庫語意；不再因需求單權限放行）。資料庫函式 ga_ws_purchase_analysis 以採購單為主：確定金額（已下訂起）與預估（草稿、待核准、已核准、舊採購評估）分開，
// 月份依下訂日（台北），伺服端完整彙總（不受 500 筆上限影響），廠商以快照名稱為準；orders 為該月確定採購單的分頁清單。
import { NextRequest } from "next/server";
import { dbCan } from "./access";
import { parseAnalysisMonth } from "./home-rules";
import { VD } from "./vendor-rules";
import { pagingMeta, parsePaging } from "./rules";
import { GaError, respond, rpc, validated, type Context } from "./server";

export async function purchaseAnalysisApi(ctx: Context, request: NextRequest, rest: string[]) {
  if (rest.length) throw new GaError(404, "找不到這個功能");
  if (request.method !== "GET") throw new GaError(405, "不支援的操作");
  if (!dbCan(ctx.permissions, VD.reviewView, VD.reviewManage)) throw new GaError(403, "沒有採購分析的查看權限（需要採購評估檢視或管理）");
  const url = new URL(request.url);
  const month = validated(() => parseAnalysisMonth(url.searchParams));
  const { page, pageSize } = parsePaging(url.searchParams, { pageSize: 20, max: 100 });
  const r = await rpc(ctx, "ga_ws_purchase_analysis", { p_year_month: month, p_page: page, p_page_size: pageSize });
  const d = r.data || {};
  return respond({ data: d, meta: pagingMeta(page, pageSize, d.orders_total ?? 0) });
}

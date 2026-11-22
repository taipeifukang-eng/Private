// G22 廠商績效 API（/api/workspace/general-affairs/vendor-stats）。
// 權限：合作紀錄檢視（cooperation_record.view，資料庫語意）；回應只有廠商名稱與統計，沒有任何帳務機密欄位（V1）。評價不顯示（V5）。
// 資料庫函式 ga_ws_vendor_perf：預設近 12 個月、可選區間（最長 36 個月）；完成數＝COMPLETED 且 STORE_CONFIRMED，強制結案與未記完成方式另計；資料不足由畫面顯示「資料累積中」。
import { NextRequest } from "next/server";
import { dbCan } from "./access";
import { parsePerfRange } from "./home-rules";
import { VD } from "./vendor-rules";
import { GaError, respond, rpc, validated, type Context } from "./server";

export async function vendorStatsApi(ctx: Context, request: NextRequest, rest: string[]) {
  if (rest.length) throw new GaError(404, "找不到這個功能");
  if (request.method !== "GET") throw new GaError(405, "不支援的操作");
  if (!dbCan(ctx.permissions, VD.coopView)) throw new GaError(403, "沒有查看合作紀錄的權限");
  const range = validated(() => parsePerfRange(new URL(request.url).searchParams));
  const r = await rpc(ctx, "ga_ws_vendor_perf", { p_from: range.from, p_to: range.to });
  return respond({ data: r.data });
}

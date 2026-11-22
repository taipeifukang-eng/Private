// G24 總務首頁與導覽徽章 API（/api/workspace/general-affairs/home/summary、home/badges）。
// 一支資料庫函式只回呼叫者有權看的項目（has_permission 語意，沒有管理員後備）；同權限者共同看，店長只算自己門市；沒有權限的項目鍵不會出現。
// 進入條件：任何一個總務入口旗標為 true（服務中心入口，或只持採購核准等單項權限也看得到採購單頁與導覽）；完全沒有總務入口的人 403。徽章只回數字（單一 RPC，給導覽每 5 分鐘輕量更新）；首頁另含前 5 筆、KPI、庫存提醒。
import { NextRequest } from "next/server";
import { dbCan, gaFlags, isStoreManagerRole } from "./access";
import { isRosterMember, isStoreMember } from "./members";
import { GaError, respond, rpc, type Context } from "./server";

async function needCenter(ctx: Context) {
  const flags = gaFlags(ctx.has, isStoreManagerRole(ctx.roleCodes), await isStoreMember(ctx), await isRosterMember(ctx), (...codes) => dbCan(ctx.permissions, ...codes));
  if (!Object.values(flags).some(Boolean)) throw new GaError(403, "沒有總務服務中心的權限");
}

export async function homeApi(ctx: Context, request: NextRequest, rest: string[]) {
  const [a, b] = rest;
  if (b || (a !== "summary" && a !== "badges")) throw new GaError(404, "找不到這個功能");
  if (request.method !== "GET") throw new GaError(405, "不支援的操作");
  await needCenter(ctx);
  if (a === "badges") {
    const r = await rpc(ctx, "ga_ws_home_badges", {});
    return respond({ data: r.data });
  }
  const r = await rpc(ctx, "ga_ws_home_summary", {});
  return respond({ data: r.data });
}

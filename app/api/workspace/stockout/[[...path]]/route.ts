import { NextRequest } from "next/server";
import { deleteReport, deleteResponse, getHistory, getResponses, listReports, saveResponse, submitReport } from "@/lib/workspace/stockout";
import { checkOrigin, context, failed, WorkspaceError } from "@/lib/workspace/server";

export const dynamic = "force-dynamic";

// 商品部缺貨回報（M6 W29）。路徑：
//   GET    /                    回報清單（?tab=&store_id=&q=&status=&month=&date_range=&page=&pageSize=）
//   POST   /                    新增回報（門市範圍檢查；近 7 天重複回 409，帶 confirm_duplicate:true 才送出）
//   DELETE /:id                 刪除回報
//   GET    /responses           商品部回覆（?product_codes=）
//   POST   /respond             商品部回覆（upsert 加歷程，同一交易）
//   DELETE /responses/:code     刪除目前回覆
//   GET    /history             回覆歷程（?product_code=&page=&pageSize=）
async function run(r: NextRequest, path: string[], method: string) {
  try {
    const ctx = await context({ profile: false });
    if (method !== "GET") checkOrigin(r);
    const url = new URL(r.url);
    if (path.length === 0) {
      if (method === "GET") return await listReports(ctx, url.searchParams);
      if (method === "POST") return await submitReport(ctx, r);
    }
    if (path.length === 1 && method === "GET") {
      if (path[0] === "responses") return await getResponses(ctx, url.searchParams);
      if (path[0] === "history") return await getHistory(ctx, url.searchParams);
    }
    if (path.length === 1 && path[0] === "respond" && method === "POST") return await saveResponse(ctx, r);
    if (path.length === 1 && method === "DELETE") return await deleteReport(ctx, path[0]);
    if (path.length === 2 && path[0] === "responses" && method === "DELETE") return await deleteResponse(ctx, decodeURIComponent(path[1]));
    throw new WorkspaceError(404, "找不到此操作");
  } catch (e) {
    return failed(e);
  }
}
type C = { params: { path?: string[] } };
export const GET = (r: NextRequest, c: C) => run(r, c.params.path || [], "GET");
export const POST = (r: NextRequest, c: C) => run(r, c.params.path || [], "POST");
export const DELETE = (r: NextRequest, c: C) => run(r, c.params.path || [], "DELETE");

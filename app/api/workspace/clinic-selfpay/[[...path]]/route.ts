import { NextRequest } from "next/server";
import {
  closeMonth,
  deleteBatch,
  getBatch,
  getPermissions,
  getStores,
  importBatch,
  importPrices,
  listBatches,
  listMappings,
  priceHistory,
} from "@/lib/workspace/clinic-selfpay";
import { checkOrigin, context, failed, WorkspaceError } from "@/lib/workspace/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// 診所自費藥毛利（M6 W30）。路徑（皆需登入；寫入類檢查 Origin）：
//   GET    permissions                  目前帳號能做什麼（計算器、主檔管理、刪批次）
//   GET    stores                       可操作的門市
//   GET    batches?store_id=&year_month= 匯入批次清單（最多 100 筆）
//   POST   batches/import               匯入診所檔 + 截圖（表單：store_id、year_month、file、screenshots；confirm_period、confirm_duplicate 為確認旗標）
//   GET    batches/:id                  批次明細（成本、毛利、截圖簽名網址 60 分鐘）
//   DELETE batches/:id                  刪除批次（先刪截圖檔再刪資料）
//   GET    mappings?store_id=&year_month= DPOS 對應主檔
//   POST   mappings/close               關帳 / 開帳（切換）
//   GET    mappings/history?store_id=&health_insurance_code= 歷史會員價與成本
//   POST   prices/import                匯入月價格檔
async function run(r: NextRequest, path: string[], method: string) {
  try {
    const ctx = await context({ profile: false });
    if (method !== "GET") checkOrigin(r);
    const params = new URL(r.url).searchParams;
    const [a, b] = path;
    if (method === "GET" && path.length === 1) {
      if (a === "permissions") return await getPermissions(ctx);
      if (a === "stores") return await getStores(ctx);
      if (a === "batches") return await listBatches(ctx, params);
      if (a === "mappings") return await listMappings(ctx, params);
    }
    if (a === "batches" && path.length === 2) {
      if (method === "POST" && b === "import") return await importBatch(ctx, r);
      if (method === "GET") return await getBatch(ctx, b);
      if (method === "DELETE") return await deleteBatch(ctx, b);
    }
    if (a === "mappings" && path.length === 2) {
      if (method === "POST" && b === "close") return await closeMonth(ctx, r);
      if (method === "GET" && b === "history") return await priceHistory(ctx, params);
    }
    if (a === "prices" && b === "import" && path.length === 2 && method === "POST") return await importPrices(ctx, r);
    throw new WorkspaceError(404, "找不到此操作");
  } catch (e) {
    return failed(e);
  }
}
type C = { params: { path?: string[] } };
export const GET = (r: NextRequest, c: C) => run(r, c.params.path || [], "GET");
export const POST = (r: NextRequest, c: C) => run(r, c.params.path || [], "POST");
export const DELETE = (r: NextRequest, c: C) => run(r, c.params.path || [], "DELETE");

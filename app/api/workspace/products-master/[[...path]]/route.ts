import { NextRequest } from "next/server";
import {
  commitImport,
  createProduct,
  editProduct,
  listProducts,
  previewImport,
  searchProducts,
  setActive,
} from "@/lib/workspace/products-master";
import { checkOrigin, context, failed, WorkspaceError } from "@/lib/workspace/server";

export const dynamic = "force-dynamic";

// 商品主檔（M6 W27/W28）。路徑：
//   GET  /                      清單（管理權限）        ?page=&q=&include_inactive=1
//   GET  /search?q=             商品搜尋（登入即可）
//   POST /                      新增單筆
//   PATCH /:id                  編輯名稱、單位（編號不可改）
//   POST /:id/deactivate|reactivate
//   POST /import/preview        Excel 匯入預覽（不寫入）
//   POST /import                Excel 匯入確認（500 筆一批寫入）
async function run(r: NextRequest, path: string[], method: string) {
  try {
    const ctx = await context({ profile: false });
    if (method !== "GET") checkOrigin(r);
    const url = new URL(r.url);
    if (path.length === 0) {
      if (method === "GET") return await listProducts(ctx, url.searchParams);
      if (method === "POST") return await createProduct(ctx, r);
    }
    if (path.length === 1 && path[0] === "search" && method === "GET") return await searchProducts(ctx, url.searchParams.get("q"));
    if (path[0] === "import" && method === "POST") {
      if (path.length === 1) return await commitImport(ctx, r);
      if (path.length === 2 && path[1] === "preview") return await previewImport(ctx, r);
    }
    if (path.length === 1 && method === "PATCH") return await editProduct(ctx, r, path[0]);
    if (path.length === 2 && method === "POST") {
      if (path[1] === "deactivate") return await setActive(ctx, path[0], false);
      if (path[1] === "reactivate") return await setActive(ctx, path[0], true);
    }
    throw new WorkspaceError(404, "找不到此操作");
  } catch (e) {
    return failed(e);
  }
}
type C = { params: { path?: string[] } };
export const GET = (r: NextRequest, c: C) => run(r, c.params.path || [], "GET");
export const POST = (r: NextRequest, c: C) => run(r, c.params.path || [], "POST");
export const PATCH = (r: NextRequest, c: C) => run(r, c.params.path || [], "PATCH");

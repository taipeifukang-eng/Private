import { NextRequest } from "next/server";
import {
  addFollowup,
  addRecord,
  createCase,
  createPlan,
  deleteCase,
  deleteFollowup,
  deletePlan,
  deleteRecord,
  editRecord,
  getCase,
  getOptions,
  getPlan,
  getTimeline,
  listCases,
  listCategories,
  listFollowups,
  listPlans,
  listRecords,
  todayWorkspace,
  updateCase,
  updatePlan,
} from "@/lib/workspace/supervisor-log";
import { checkOrigin, context, failed, WorkspaceError } from "@/lib/workspace/server";

export const dynamic = "force-dynamic";

// 督導管理日誌（M6 W32）。路徑（皆需登入；寫入類檢查 Origin）：
//   GET    cases                              案件清單（E1 可見範圍；?page=&pageSize=&sortBy=&sortOrder=&status=&targetType=&storeId=&search=）
//   POST   cases                              建立案件
//   GET    cases/:id                          案件詳情（紀錄、追蹤、事件、時間線；?deleted=1 只有管理者）
//   PATCH  cases/:id                          修改案件（E2）
//   DELETE cases/:id                          軟刪除案件（body.deletion_reason）
//   GET    cases/:id/records | POST           紀錄清單 | 新增紀錄
//   PATCH  cases/:id/records/:rid             修改紀錄（E2）
//   DELETE cases/:id/records/:rid             軟刪除紀錄（body.deletion_reason）
//   GET    cases/:id/followups | POST         追蹤清單 | 新增追蹤
//   DELETE cases/:id/followups/:fid           軟刪除追蹤（body.deletion_reason）
//   GET    cases/:id/timeline                 案件時間線
//   GET    today?date=                        今日工作台（E3）
//   GET    daily-plans | POST                 每日計畫清單 | 建立
//   GET|PATCH|DELETE daily-plans/:id          每日計畫詳情 | 修改 | 軟刪除（body.deletion_reason）
//   GET    options?store_id=&q= | categories  選項與分類
async function run(r: NextRequest, path: string[], method: string) {
  try {
    const ctx = await context({ profile: false });
    if (method !== "GET") checkOrigin(r);
    const params = new URL(r.url).searchParams;
    const [a, b, c, d] = path;
    if (a === "cases") {
      if (path.length === 1) {
        if (method === "GET") return await listCases(ctx, params);
        if (method === "POST") return await createCase(ctx, r);
      }
      if (path.length === 2) {
        if (method === "GET") return await getCase(ctx, b, params);
        if (method === "PATCH") return await updateCase(ctx, r, b);
        if (method === "DELETE") return await deleteCase(ctx, r, b);
      }
      if (path.length === 3 && c === "records") {
        if (method === "GET") return await listRecords(ctx, b);
        if (method === "POST") return await addRecord(ctx, r, b);
      }
      if (path.length === 4 && c === "records") {
        if (method === "PATCH") return await editRecord(ctx, r, b, d);
        if (method === "DELETE") return await deleteRecord(ctx, r, b, d);
      }
      if (path.length === 3 && c === "followups") {
        if (method === "GET") return await listFollowups(ctx, b);
        if (method === "POST") return await addFollowup(ctx, r, b);
      }
      if (path.length === 4 && c === "followups" && method === "DELETE") return await deleteFollowup(ctx, r, b, d);
      if (path.length === 3 && c === "timeline" && method === "GET") return await getTimeline(ctx, b);
    }
    if (a === "today" && path.length === 1 && method === "GET") return await todayWorkspace(ctx, params);
    if (a === "daily-plans") {
      if (path.length === 1) {
        if (method === "GET") return await listPlans(ctx, params);
        if (method === "POST") return await createPlan(ctx, r);
      }
      if (path.length === 2) {
        if (method === "GET") return await getPlan(ctx, b);
        if (method === "PATCH") return await updatePlan(ctx, r, b);
        if (method === "DELETE") return await deletePlan(ctx, r, b);
      }
    }
    if (a === "options" && path.length === 1 && method === "GET") return await getOptions(ctx, params);
    if (a === "categories" && path.length === 1 && method === "GET") return await listCategories(ctx);
    throw new WorkspaceError(404, "找不到此操作");
  } catch (e) {
    return failed(e);
  }
}
type C = { params: { path?: string[] } };
export const GET = (r: NextRequest, c: C) => run(r, c.params.path || [], "GET");
export const POST = (r: NextRequest, c: C) => run(r, c.params.path || [], "POST");
export const PATCH = (r: NextRequest, c: C) => run(r, c.params.path || [], "PATCH");
export const DELETE = (r: NextRequest, c: C) => run(r, c.params.path || [], "DELETE");

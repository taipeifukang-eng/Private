// G09 維修紀錄 API（Q11）：改讀新版需求單（報修類）與其工單，完整分頁；範圍與「看不到處理人」由資料庫函式判斷。
//   GET /asset-maintenance/history  逐筆（需求單 + 工單）
//   GET /asset-maintenance/summary  每台設備／設施修過幾次、未結案幾張、最近報修時間
// 舊版只讀 maintenance_requests 前 100 筆再在瀏覽器過濾；新版搜尋、篩選、分頁都在資料庫，並回精確筆數。
import { NextRequest } from "next/server";
import { adminClient } from "../server";
import { dbCan, GA } from "./access";
import { isUuid } from "./rules";
import { GaError, respond, rpc, type Context } from "./server";

const TYPES: Record<string, "EQUIPMENT" | "FACILITY"> = { equipment: "EQUIPMENT", facility: "FACILITY", facilities: "FACILITY", EQUIPMENT: "EQUIPMENT", FACILITY: "FACILITY" };
const MAIN_STATUSES = ["OPEN", "CLOSED", "PENDING_INTAKE", "WAITING_STORE_SUPPLEMENT", "WAITING_GA_REVIEW", "ACCEPTED", "IN_PROGRESS", "WAITING_STORE_CONFIRMATION", "COMPLETED", "REJECTED", "CANCELED"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function typeOf(value: string | null, required: boolean) {
  const raw = (value || "").trim();
  if (!raw) {
    if (required) throw new GaError(400, "請指定資產類型（equipment 或 facility）");
    return null;
  }
  const t = TYPES[raw];
  if (!t) throw new GaError(400, "資產類型錯誤");
  return t;
}

function uuidParam(p: URLSearchParams, key: string, label: string) {
  const v = (p.get(key) || "").trim();
  if (!v) return null;
  if (!isUuid(v)) throw new GaError(400, `${label} 格式錯誤`);
  return v;
}

function paging(p: URLSearchParams) {
  const pageSize = Math.min(100, Math.max(1, Math.floor(Number(p.get("pageSize") || 20)) || 20));
  const page = Math.max(1, Math.floor(Number(p.get("page") || 1)) || 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const meta = (page: number, pageSize: number, total: number) => ({ page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });

// 與資料庫函式 ga_ws_history_scope 同一組「看全部」權限；再多一層：只持有另一類資產權限的人，不能改用 type 參數看這一類的全部紀錄。
const WIDE = ["general_affairs.request.view_all", "general_affairs.request.manage", "general_affairs.maintenance_request.view_all", "general_affairs.work_order.view_all"];
const TYPE_PERMS = { EQUIPMENT: [GA.equipmentView, GA.equipmentManage], FACILITY: [GA.facilityView, GA.facilityManage] };

/** 回傳是否看全部（含處理人姓名）；沒有任何範圍就 403。 */
async function scopeOf(ctx: Context, type: "EQUIPMENT" | "FACILITY" | null) {
  const typed = type ? dbCan(ctx.permissions, ...TYPE_PERMS[type], ...WIDE) : dbCan(ctx.permissions, ...TYPE_PERMS.EQUIPMENT, ...TYPE_PERMS.FACILITY, ...WIDE);
  if (typed) return true;
  const { data, error } = await (adminClient() as any).from("store_managers").select("id").eq("user_id", ctx.user.id).limit(1);
  if (error || !(data || []).length) throw new GaError(403, "沒有查看維修紀錄的權限");
  return false;
}

export async function maintenanceApi(ctx: Context, request: NextRequest, rest: string[]) {
  if (request.method !== "GET") throw new GaError(405, "不支援的操作");
  const [head] = rest;
  const p = new URL(request.url).searchParams;
  const { page, pageSize, offset } = paging(p);
  const search = (p.get("q") || p.get("search") || "").trim().slice(0, 100) || null;
  const storeId = uuidParam(p, "storeId", "門市 id");
  if (head === "history") {
    const type = typeOf(p.get("type"), false);
    const seeAll = await scopeOf(ctx, type);
    const status = (p.get("status") || "").trim();
    if (status && !MAIN_STATUSES.includes(status)) throw new GaError(400, "狀態參數錯誤");
    const from = (p.get("from") || "").trim();
    const to = (p.get("to") || "").trim();
    if ((from && !DATE.test(from)) || (to && !DATE.test(to))) throw new GaError(400, "日期格式必須是 YYYY-MM-DD");
    const r = await rpc(ctx, "ga_ws_asset_maintenance_history", {
      p_type: type, p_asset_id: uuidParam(p, "assetId", "資產 id"), p_store_id: storeId, p_status: status || null, p_search: search,
      p_from: from || null, p_to: to || null, p_limit: pageSize, p_offset: offset,
    });
    const total = Number(r.data.total || 0);
    return respond({ data: r.data.rows || [], total, meta: meta(page, pageSize, total), permissions: { seeAll, seeAssignee: seeAll } });
  }
  if (head === "summary") {
    const type = typeOf(p.get("type"), true);
    const seeAll = await scopeOf(ctx, type);
    const r = await rpc(ctx, "ga_ws_asset_repair_summary", { p_type: type, p_store_id: storeId, p_search: search, p_limit: pageSize, p_offset: offset });
    const total = Number(r.data.total || 0);
    return respond({ data: r.data.rows || [], total, meta: meta(page, pageSize, total), permissions: { seeAll, seeAssignee: seeAll } });
  }
  throw new GaError(404, "找不到這個功能");
}

// G01 共用選擇器 API：門市／地點。舊版「只載入前 N 筆」造成挑不到、搜不到，改為伺服端搜尋與分頁。
import { NextRequest } from "next/server";
import { adminClient } from "../server";
import { dbCan, GA_CENTER_CODES } from "./access";
import { orIlike, pagingMeta, parsePaging, FILTERS_BOOL } from "./rules";
import { GaError, dbError, must, respond, type Context } from "./server";

const INVENTORY_CODES = [
  "general_affairs.inventory_balance.view",
  "general_affairs.inventory_location.view",
  "general_affairs.inventory_location.manage",
  "general_affairs.inventory_transaction.view",
  "general_affairs.inventory_transaction.manage",
  "general_affairs.inventory_transfer.view",
  "general_affairs.inventory_transfer.manage",
];

export async function sitesApi(ctx: Context, request: NextRequest) {
  if (request.method !== "GET") throw new GaError(405, "不支援的操作");
  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "store";
  const { page, pageSize, from, to } = parsePaging(url.searchParams, { pageSize: 30, max: 100 });
  const search = (url.searchParams.get("search") || "").trim();
  const active = FILTERS_BOOL(url.searchParams.get("active"));
  if (type === "location") {
    if (!dbCan(ctx.permissions, ...INVENTORY_CODES)) throw new GaError(403, "沒有庫存位置查看權限");
    let q = (ctx.auth as any).from("ga_inventory_locations").select("id,code,name,location_type,store_id,is_active", { count: "exact" }).is("deleted_at", null);
    if (search) q = q.or(orIlike(["code", "name"], search));
    if (active !== null) q = q.eq("is_active", active);
    const res = await q.order("code").order("id").range(from, to);
    if (res.error) throw dbError(res.error);
    return respond({ data: res.data || [], meta: pagingMeta(page, pageSize, res.count || 0) });
  }
  if (type !== "store") throw new GaError(400, "選擇器類型錯誤");
  const scope = url.searchParams.get("scope") === "mine" ? "mine" : "all";
  const admin: any = adminClient();
  let q = admin.from("stores").select("id,store_code,store_name,short_name,is_active", { count: "exact" });
  if (scope === "mine") {
    // 只看自己被指派管理的門市（店長建立需求單等情境）。
    const mine = ((await must(admin.from("store_managers").select("store_id").eq("user_id", ctx.user.id))) as any[]) || [];
    const ids = Array.from(new Set(mine.map((r) => r.store_id)));
    if (!ids.length) return respond({ data: [], meta: pagingMeta(page, pageSize, 0) });
    q = q.in("id", ids);
  } else if (!dbCan(ctx.permissions, ...GA_CENTER_CODES) && !ctx.roleCodes.has("store_manager") && !ctx.roleCodes.has("store_manager_role")) {
    throw new GaError(403, "沒有查看據點的權限");
  }
  if (search) q = q.or(orIlike(["store_code", "store_name", "short_name"], search));
  q = q.eq("is_active", active === null ? true : active);
  const res = await q.order("store_code").range(from, to);
  if (res.error) throw dbError(res.error);
  return respond({ data: res.data || [], meta: pagingMeta(page, pageSize, res.count || 0) });
}

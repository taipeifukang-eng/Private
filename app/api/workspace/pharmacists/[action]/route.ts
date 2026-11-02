import { NextRequest } from "next/server";
import * as route0 from "@/app/api/pharmacist-annual-master/sync/route";
import * as route1 from "@/app/api/pharmacist-annual-master/lock/route";
import * as route2 from "@/app/api/pharmacist-annual-master/manual-add/route";
import * as route3 from "@/app/api/pharmacist-snapshot-lock/route";
import * as route4 from "@/app/api/pharmacist-monthly-snapshot/manual-add/route";
import * as route5 from "@/app/api/pharmacist-profiles/route";
import * as route6 from "@/app/api/pharmacist-annual-fees/route";
import * as route7 from "@/app/api/pharmacist-annual-fees/upload/route";
import * as route8 from "@/app/api/monthly-staff-by-store/search/route";
import {
  context,
  checkOrigin,
  failed,
  respond,
  requireCapability,
  WorkspaceError,
} from "@/lib/workspace/server";
import { hasPermission } from "@/lib/permissions/check";
import { pharmacistOverview } from "@/lib/workspace/pharmacist-overview";
export const dynamic = "force-dynamic";
const handlers: Record<string, any> = {
  master: route0,
  "annual-lock": route1,
  "annual-manual": route2,
  "month-lock": route3,
  "monthly-manual": route4,
  profiles: route5,
  fees: route6,
  proof: route7,
  search: route8,
};
async function run(r: NextRequest, key: string, method: string) {
  try {
    const ctx = await context();
    requireCapability(ctx, ["pharmacist.management.view"]);
    if (method !== "GET") checkOrigin(r);
    if (key === "overview" && method === "POST") {
      const month = r.nextUrl.searchParams.get("year_month") || "";
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
        throw new WorkspaceError(400, "月份格式不正確");
      return respond(
        await pharmacistOverview({
          year_month: month,
          zone: r.nextUrl.searchParams.get("zone") || "all",
        }),
      );
    }
    if (["master", "annual-manual", "annual-lock", "profiles"].includes(key)) {
      if (
        !(await hasPermission(ctx.user.id, "pharmacist.management.master.view"))
      )
        throw new WorkspaceError(403, "沒有藥師主檔查看權限");
      if (
        !["master"].includes(key) &&
        method !== "GET" &&
        !(await hasPermission(ctx.user.id, "pharmacist.management.master.edit"))
      )
        throw new WorkspaceError(403, "沒有藥師主檔編輯權限");
    }
    if (key === "monthly-manual" && method === "POST") {
      const body = await r.clone().json();
      const { data, error } = await ctx.admin
        .from("pharmacist_snapshot_locks")
        .select("year_month")
        .eq("year_month", body.year_month)
        .maybeSingle();
      if (error) throw error;
      if (data) throw new WorkspaceError(409, "此月份已關帳，請先解除關帳");
    }
    // Legacy annual GET reconciles snapshots; expose as a same-origin POST.
    const action = key === "master" && method === "POST" ? "GET" : method;
    if (key === "master" && method !== "POST")
      throw new WorkspaceError(405, "請使用同步查詢");
    if (!handlers[key]?.[action]) throw new WorkspaceError(404, "找不到此操作");
    return await handlers[key][action](r);
  } catch (e) {
    return failed(e);
  }
}
type C = { params: { action: string } };
export const GET = (r: NextRequest, c: C) => run(r, c.params.action, "GET");
export const POST = (r: NextRequest, c: C) => run(r, c.params.action, "POST");
export const PATCH = (r: NextRequest, c: C) => run(r, c.params.action, "PATCH");
export const DELETE = (r: NextRequest, c: C) =>
  run(r, c.params.action, "DELETE");

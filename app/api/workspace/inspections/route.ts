import { inspectionCoverage } from "@/lib/workspace/inspection-coverage";
import {
  checked,
  context,
  failed,
  inspectionScope,
  respond,
  uuid,
  WorkspaceError,
} from "@/lib/workspace/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const ctx = await context();
    const scope = await inspectionScope(ctx);
    const p = new URL(request.url).searchParams;
    const month = p.get("month") || "";
    const store = p.get("store") || "";
    const type = p.get("type") || "supervisor";
    const page = Number(p.get("page") || 1);
    const overview = p.get("overview") === "true";
    if (
      !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) ||
      (store && !uuid(store)) ||
      !["supervisor", "manager"].includes(type) ||
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10000
    )
      throw new WorkspaceError(400, "查詢條件不正確");
    if (type === "manager" && !ctx.has("inspection.manager_tab"))
      throw new WorkspaceError(403, "沒有經理巡店查看權限");
    if (!scope.all && !scope.own && !scope.assigned.length)
      return respond({ records: [], total: 0 });
    const [year, m] = month.split("-").map(Number);
    const end = new Date(Date.UTC(year, m, 1)).toISOString().slice(0, 10);
    let query = ctx.admin
      .from("inspection_masters")
      .select(
        "id,inspection_no,store_id,inspector_id,inspection_date,status,total_score,max_possible_score,score_percentage,inspection_type,grade",
        { count: "exact" },
      )
      .gte("inspection_date", `${month}-01`)
      .lt("inspection_date", end);
    if (!scope.all) {
      const conditions = [];
      if (scope.own) conditions.push(`inspector_id.eq.${ctx.user.id}`);
      if (scope.assigned.length)
        conditions.push(`store_id.in.(${scope.assigned.join(",")})`);
      query = query.or(conditions.join(","));
    }
    if (store) query = query.eq("store_id", store);
    query =
      type === "manager"
        ? query.eq("inspection_type", type)
        : query.or("inspection_type.eq.supervisor,inspection_type.is.null");
    const result = await query
      .order("inspection_date", { ascending: false })
      .order("id")
      .range((page - 1) * 20, page * 20 - 1);
    let records = checked(result) || [];
    if (overview) {
      records = [];
      for (let offset = 0; ; offset += 500) {
        const batch =
          checked(
            await query
              .order("inspection_date", { ascending: false })
              .order("id")
              .range(offset, offset + 499),
          ) || [];
        records.push(...batch);
        if (batch.length < 500) break;
      }
    }
    const storeIds = Array.from(new Set(records.map((r) => r.store_id)));
    const inspectorIds = Array.from(
      new Set(records.map((r) => r.inspector_id).filter(Boolean)),
    );
    const stores = storeIds.length
      ? checked(
          await ctx.admin
            .from("stores")
            .select("id,store_name,store_code,short_name,source_store_id")
            .in("id", storeIds),
        )
      : [];
    const people = inspectorIds.length
      ? checked(
          await ctx.admin
            .from("profiles")
            .select("id,full_name")
            .in("id", inspectorIds),
        )
      : [];
    let coverage: unknown = null;
    if (overview && ctx.has("inspection.view_store_status")) {
      const profile = checked(
        await ctx.auth
          .from("profiles")
          .select("role")
          .eq("id", ctx.user.id)
          .maybeSingle(),
      );
      let assignedQuery = ctx.auth
        .from("stores")
        .select("id,store_name,store_code,short_name,source_store_id")
        .eq("is_active", true)
        .order("store_code");
      if (!ctx.isAdmin && profile?.role !== "admin") {
        const assignments =
          checked(
            await ctx.auth
              .from("store_managers")
              .select("store_id")
              .eq("user_id", ctx.user.id),
          ) || [];
        assignedQuery = assignedQuery.in(
          "id",
          assignments.map((s) => s.store_id),
        );
      }
      if (store) assignedQuery = assignedQuery.eq("id", store);
      const assigned = checked(await assignedQuery) || [];
      // Lineage is used internally only; unrelated stores are never returned.
      const lineage =
        checked(await ctx.admin.from("stores").select("id,source_store_id")) ||
        [];
      coverage = inspectionCoverage(
        assigned,
        records.map((r) => ({
          ...r,
          store: stores?.find((s) => s.id === r.store_id),
        })),
        lineage,
      );
    }
    return respond({
      records: records.map((r) => ({
        ...r,
        store: stores?.find((s) => s.id === r.store_id),
        inspector:
          people?.find((u) => u.id === r.inspector_id)?.full_name || "未指定",
      })),
      total: result.count || 0,
      coverage,
      canExport: ctx.has("inspection.export"),
    });
  } catch (error) {
    return failed(error);
  }
}

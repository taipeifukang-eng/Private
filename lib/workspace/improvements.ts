import { checked, type Context, WorkspaceError } from "./server";
export const IMPROVEMENT_CODES = [
  "inspection.improvement.view_all",
  "inspection.improvement.view_own",
  "inspection.improvement.view_own_store",
  "inspection.improvement.manage",
  "inspection.improvement.submit",
];
export async function improvementAccess(ctx: Context) {
  const profile = checked(
    await ctx.admin
      .from("profiles")
      .select("role")
      .eq("id", ctx.user.id)
      .maybeSingle(),
  );
  const admin = ctx.isAdmin || profile?.role === "admin";
  const all =
    admin ||
    ctx.has("inspection.improvement.view_all") ||
    (ctx.has("inspection.view_all") &&
      ctx.has(
        "role.permission.assign",
        "role.role.view",
        "user.user.view",
        "user.user.manage",
      ));
  const scoped =
    ctx.has(...IMPROVEMENT_CODES) ||
    ["supervisor", "manager", "area_manager"].includes(profile?.role || "");
  if (!all && !scoped) throw new WorkspaceError(403, "沒有改善追蹤查看權限");
  const assigned =
    checked(
      await ctx.admin
        .from("store_managers")
        .select("store_id")
        .eq("user_id", ctx.user.id),
    ) || [];
  return { all, admin, stores: assigned.map((r) => r.store_id as string) };
}
export async function improvementRecord(ctx: Context, id: string) {
  const access = await improvementAccess(ctx);
  const row = checked(
    await ctx.admin
      .from("inspection_improvements")
      .select("*")
      .eq("id", id)
      .maybeSingle(),
  );
  if (!row) throw new WorkspaceError(404, "找不到改善項目");
  const master = checked(
    await ctx.admin
      .from("inspection_masters")
      .select("id,inspection_date,inspector_id,inspection_type")
      .eq("id", row.inspection_id)
      .maybeSingle(),
  );
  if (
    !access.all &&
    !access.stores.includes(row.store_id) &&
    master?.inspector_id !== ctx.user.id
  )
    throw new WorkspaceError(404, "找不到可查看的改善項目");
  const canSubmit =
    access.admin ||
    access.stores.includes(row.store_id) ||
    ctx.has("inspection.improvement.submit");
  return { row, master, canSubmit };
}
export { improvementToday } from "./improvement-rules";

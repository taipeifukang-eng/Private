import {
  checked,
  context,
  requireCapability,
  WorkspaceError,
  type Context,
} from "./server";
export const moduleCodes = {
  monthly: ["monthly.status.view_all", "monthly.status.view_own"],
  performance: ["performance.view", "performance.edit"],
  inventory: [
    "inventory.manage",
    "inventory.inventory.access",
    "inventory.inventory.view",
    "inventory.result_analysis.view_own",
  ],
};
export async function moduleContext(module: keyof typeof moduleCodes) {
  const ctx = await context();
  if (process.env.WORKSPACE_USE_EXISTING_SESSION !== "true")
    throw new WorkspaceError(503, "請使用原測試站的新版工作台");
  requireCapability(ctx, moduleCodes[module]);
  return ctx;
}
export async function moduleStores(
  ctx: Context,
  module: "monthly" | "performance",
  options: { includeInactive?: boolean } = {},
) {
  // includeInactive 只給月結「已停止門市歷史」唯讀使用；預設行為不變（只含有效門市）。
  let q = ctx.auth
    .from("stores")
    .select(
      (options.includeInactive
        ? "id,store_code,store_name,short_name,is_active"
        : "id,store_code,store_name,short_name") as "id,store_code,store_name,short_name",
    )
    .order("store_code");
  if (!options.includeInactive) q = q.eq("is_active", true);
  if (module === "monthly" && !ctx.has("monthly.status.view_all")) {
    const assigned =
      checked(
        await ctx.auth
          .from("store_managers")
          .select("store_id")
          .eq("user_id", ctx.user.id),
      ) || [];
    if (!assigned.length) return [];
    q = q.in(
      "id",
      assigned.map((s) => s.store_id),
    );
  }
  if (module === "performance" && !ctx.isAdmin) {
    const profile = checked(
      await ctx.auth
        .from("profiles")
        .select("role")
        .eq("id", ctx.user.id)
        .maybeSingle(),
    );
    if (profile?.role !== "supervisor") {
      const assigned =
        checked(
          await ctx.auth
            .from("store_managers")
            .select("store_id")
            .eq("user_id", ctx.user.id),
        ) || [];
      if (!assigned.length) return [];
      q = q.in(
        "id",
        assigned.map((s) => s.store_id),
      );
    }
  }
  // Performance retains authenticated RLS instead of using service-role reads.
  return checked(await q) || [];
}
export function monthValue(value: unknown) {
  if (typeof value !== "string" || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(value))
    throw new WorkspaceError(400, "請選擇有效年月");
  return value;
}
export async function requireStore(
  ctx: Context,
  module: "monthly" | "performance",
  id: string,
  options: { includeInactive?: boolean } = {},
) {
  const stores = await moduleStores(ctx, module, options);
  if (!stores.some((s) => s.id === id))
    throw new WorkspaceError(403, "沒有此門市操作權限");
}

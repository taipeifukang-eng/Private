import {
  checked,
  context,
  requireCapability,
  sessionClient,
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
type StorePrefetch = {
  stores: { data: any[] | null; error: unknown };
  assigned: { data: { store_id: string }[] | null; error: unknown };
};
// 每月人員狀態：與 user_roles 並行先取好所有門市（含停止）與使用者的店長指派；
// 之後 moduleStores／isAssignedTo 直接在記憶體依權限過濾，結果與逐步查詢相同（見 moduleStores）。
async function prefetchMonthlyStores({ auth, userId }: { auth: ReturnType<typeof sessionClient>; userId: string }): Promise<StorePrefetch> {
  const [stores, assigned] = await Promise.all([
    auth.from("stores").select("id,store_code,store_name,short_name,is_active").order("store_code"),
    auth.from("store_managers").select("store_id").eq("user_id", userId),
  ]);
  return { stores: stores as any, assigned: assigned as any };
}
export async function moduleContext(
  module: keyof typeof moduleCodes,
  options: { profile?: boolean; prefetchStores?: boolean } = {},
) {
  const ctx = await context<StorePrefetch | undefined>({
    profile: options.profile,
    prefetch:
      options.prefetchStores && module === "monthly"
        ? prefetchMonthlyStores
        : undefined,
  });
  if (process.env.WORKSPACE_USE_EXISTING_SESSION !== "true")
    throw new WorkspaceError(503, "請使用原測試站的新版工作台");
  requireCapability(ctx, moduleCodes[module]);
  return ctx;
}
// 該使用者是否被指派到這間門市（等同查 store_managers user_id + store_id）；有預取就不再查。
export async function isAssignedTo(ctx: Context, store: string) {
  const pre = ctx.prefetched as StorePrefetch | undefined;
  if (pre) {
    const rows = checked(pre.assigned as any) as { store_id: string }[] | null;
    return !!rows?.some((r) => r.store_id === store);
  }
  const assigned = checked(
    await ctx.auth.from("store_managers").select("id").eq("user_id", ctx.user.id).eq("store_id", store),
  ) as unknown[] | null;
  return !!assigned?.length;
}
export async function moduleStores(
  ctx: Context,
  module: "monthly" | "performance",
  options: { includeInactive?: boolean } = {},
) {
  const pre = module === "monthly" ? (ctx.prefetched as StorePrefetch | undefined) : undefined;
  if (pre) {
    // 預取版：與下方查詢逐項相同（排序 store_code、有效門市只留 is_active=true 且欄位不含 is_active、無 view_all 時只留指派門市）。
    let list = (checked(pre.stores as any) || []) as any[];
    if (!options.includeInactive) list = list.filter((r) => r.is_active === true).map(({ is_active: _drop, ...rest }) => rest);
    if (!ctx.has("monthly.status.view_all")) {
      const assigned = (checked(pre.assigned as any) || []) as { store_id: string }[];
      if (!assigned.length) return [];
      const ids = new Set(assigned.map((s) => s.store_id));
      list = list.filter((r) => ids.has(r.id));
    }
    return list as { id: string; store_code: string; store_name: string; short_name: string }[];
  }
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

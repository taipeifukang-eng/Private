import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { resolveAccess } from "./permission-semantics";
import { listScopeFor } from "./inspection-list";

const DEV_REF = "mjpdfpxqttbhzeimmtqr";
export class WorkspaceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assertWorkspace() {
  const ref = new URL(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "http://invalid",
  ).hostname.split(".")[0];
  if (
    process.env.WORKSPACE_DEV_ENABLED !== "true" ||
    ref !== DEV_REF ||
    process.env.EXPECTED_SUPABASE_PROJECT_REF !== DEV_REF
  ) {
    throw new WorkspaceError(503, "測試工作台未啟用或資料庫設定不符");
  }
  for (const [name, role] of [
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon"],
    ["SUPABASE_SERVICE_ROLE_KEY", "service_role"],
  ]) {
    try {
      const claims = JSON.parse(
        Buffer.from(
          (process.env[name] || "").split(".")[1],
          "base64url",
        ).toString(),
      );
      if (claims.ref !== DEV_REF || claims.role !== role)
        throw new Error("mismatch");
    } catch {
      throw new WorkspaceError(503, "測試資料庫金鑰設定不符");
    }
  }
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== (process.env.WORKSPACE_ORIGIN || "http://localhost:5173")) {
    throw new WorkspaceError(403, "請從測試工作台操作");
  }
}
export function sessionClient() {
  assertWorkspace();
  const jar = cookies();
  const integrated = process.env.WORKSPACE_USE_EXISTING_SESSION === "true";
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        ...(integrated ? {} : { name: "fk-vue-dev-auth" }),
        path: integrated ? "/" : "/api/workspace",
        httpOnly: !integrated,
        sameSite: "lax",
        secure: process.env.WORKSPACE_ORIGIN?.startsWith("https:") || false,
      },
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (
          items: { name: string; value: string; options: CookieOptions }[],
        ) =>
          items.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          ),
      },
    },
  );
}
export function adminClient() {
  assertWorkspace();
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error)
    throw new WorkspaceError(503, "資料讀取或寫入失敗，請稍後重試");
  return result.data;
}
const one = (value: any) => (Array.isArray(value) ? value[0] : value);
export const INSPECTION_CODES = [
  "inspection.view_all",
  "inspection.view_store",
  "inspection.view_own",
];
// 活動管理頁（/admin/activity-management 對應的 Vue 頁）的進入碼；不含 view_own，
// 否則全員預設角色持 view_own 時會看到管理頁入口（舊版這些人只有「活動檢視」入口）。
export const CAMPAIGN_PAGE_CODES = [
  "activity.campaign.view_all",
  "activity.campaign.view",
  "activity.campaign.edit",
  "activity.manage",
  "activity.store_detail.edit", "activity.equipment_trip.edit", "activity.checklist.edit", "activity.support_request.edit", "activity.support_assign.edit", "activity.staff_overview.view", "activity.marketing.publish", "activity.merchandise.publish",
];
// 活動 API 的權限閘門：另含 view_own（店長／督導的查看權）。可見範圍一律由 lib/campaign-access.ts 決定。
export const CAMPAIGN_READ_CODES = [
  "activity.campaign.view_own",
  "activity.campaign.view_all",
  "activity.campaign.view",
  "activity.campaign.edit",
  "activity.manage",
  "activity.store_detail.edit", "activity.equipment_trip.edit", "activity.checklist.edit", "activity.support_request.edit", "activity.support_assign.edit", "activity.staff_overview.view", "activity.marketing.publish", "activity.merchandise.publish",
];
export const CAMPAIGN_EDIT_CODES = [
  "activity.campaign.edit",
  "activity.manage",
];
export type ContextOptions<T = undefined> = {
  // 預設 true；只有 session 路由需要 profile.full_name，其餘路由傳 false 不回傳 profile（role 仍會查，供 isAdmin 判斷）。
  profile?: boolean;
  // 在 getUser 之後與 user_roles／profiles 並行執行的額外查詢（例如名冊頁的門市清單），結果放在 ctx.prefetched。
  prefetch?: (env: { auth: ReturnType<typeof sessionClient>; admin: ReturnType<typeof adminClient>; userId: string }) => Promise<T>;
};
export async function context<T = undefined>(options: ContextOptions<T> = {}) {
  const auth = sessionClient();
  const {
    data: { user },
    error,
  } = await auth.auth.getUser();
  if (error || !user) throw new WorkspaceError(401, "登入已過期，請重新登入");
  const admin = adminClient();
  // getUser 之後三個查詢互不相依，並行送出（原本是 user_roles 再 profiles 序列執行）。
  const [assignmentsResult, profileResult, prefetched] = await Promise.all([
    admin
      .from("user_roles")
      .select(
        "is_active,expires_at,role:roles(code,role_permissions(is_allowed,permission:permissions(code,is_active)))",
      )
      .eq("user_id", user.id)
      .eq("is_active", true),
    // 一律查 profiles（含 role）：isAdmin 的 profiles.role==='admin' 保底要用；與其他兩個查詢並行，不增加等待時間。
    admin.from("profiles").select("id,full_name,role").eq("id", user.id).maybeSingle(),
    options.prefetch
      ? options.prefetch({ auth, admin, userId: user.id })
      : Promise.resolve(undefined as T),
  ]);
  const assignments = checked(assignmentsResult);
  // 舊版 isAdminLikeUser 的 profiles.role==='admin' 保底需要 profiles.role；查詢失敗時與舊版一樣視為非 admin。
  const profileRole = (profileResult as any)?.data?.role ?? null;
  const { permissions, roleCodes, isAdmin, has } = resolveAccess(
    assignments as any,
    profileRole,
  );
  const profile =
    options.profile === false || !profileResult ? null : checked(profileResult);
  return { auth, admin, user, profile, permissions, roleCodes, isAdmin, has, prefetched };
}
export type Context = Awaited<ReturnType<typeof context<any>>>;
export function requireCapability(ctx: Context, codes: string[]) {
  if (!ctx.has(...codes)) throw new WorkspaceError(403, "沒有此功能的操作權限");
}
// M4 Q3：可見範圍照舊版（RLS p1f_inspection_masters_read）取聯集，純函式見 lib/workspace/inspection-list.ts。
export async function inspectionScope(ctx: Context) {
  requireCapability(ctx, INSPECTION_CODES);
  if (ctx.has("inspection.view_all"))
    return listScopeFor(ctx.has, []);
  const rows = ctx.has("inspection.view_store") || ctx.has("inspection.view_own")
    ? checked(
        await ctx.admin
          .from("store_managers")
          .select("store_id")
          .eq("user_id", ctx.user.id),
      )
    : [];
  return listScopeFor(
    ctx.has,
    (rows || []).map((r) => r.store_id as string),
  );
}
export async function inspectionStores(ctx: Context) {
  const scope = await inspectionScope(ctx);
  const ids = new Set(scope.assigned);
  if (scope.own) {
    const rows = checked(
      await ctx.admin
        .from("inspection_masters")
        .select("store_id")
        .eq("inspector_id", ctx.user.id),
    );
    for (const row of rows || []) ids.add(row.store_id);
  }
  if (!scope.all && !ids.size) return [];
  let query = ctx.admin
    .from("stores")
    .select("id,store_code,store_name,short_name")
    .eq("is_active", true)
    .order("store_code");
  if (!scope.all) query = query.in("id", Array.from(ids));
  return checked(await query) || [];
}
export function respond(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export function failed(error: unknown) {
  return respond(
    {
      error:
        error instanceof WorkspaceError
          ? error.message
          : "服務暫時無法使用，請重試",
    },
    error instanceof WorkspaceError ? error.status : 500,
  );
}
export const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v,
  );

// WP5：app/layout.tsx 用的伺服端載入器。閘門關閉時完全不碰資料庫（舊版行為不變）。
// 失敗一律視為「沒有新版連結」，不讓舊版版面壞掉。
import { adminClient } from "./server";
import { activeFallbacks } from "./page-fallbacks";
import { resolveAccess } from "./permission-semantics";
import { evaluateGate } from "./site-gate";
import { resolveMenuTargets, type MenuTargets } from "./legacy-menu";

const TTL_MS = 30_000; // 備援集合與管理員判斷的記憶體快取；符合 m9-fallback-spec.md 的 60 秒承諾。
let fallbackCache: { at: number; kinds: string[] } | null = null;
const adminCache = new Map<string, { at: number; isAdmin: boolean }>();

export function __resetLegacyMenuCache() {
  fallbackCache = null;
  adminCache.clear();
}

async function cachedFallbackKinds(admin: ReturnType<typeof adminClient>, now: number): Promise<string[]> {
  if (fallbackCache && now - fallbackCache.at < TTL_MS) return fallbackCache.kinds;
  const kinds = (await activeFallbacks(admin)).map((f) => f.kind);
  fallbackCache = { at: now, kinds };
  return kinds;
}

async function cachedIsAdmin(admin: ReturnType<typeof adminClient>, userId: string, now: number): Promise<boolean> {
  const hit = adminCache.get(userId);
  if (hit && now - hit.at < TTL_MS) return hit.isAdmin;
  const [roles, profile] = await Promise.all([
    admin
      .from("user_roles")
      .select("is_active,expires_at,role:roles(code,role_permissions(is_allowed,permission:permissions(code,is_active)))")
      .eq("user_id", userId)
      .eq("is_active", true),
    admin.from("profiles").select("role").eq("id", userId).maybeSingle(),
  ]);
  if ((roles as any).error) throw new Error("roles");
  const { isAdmin } = resolveAccess((roles as any).data, (profile as any)?.data?.role ?? null, now);
  if (adminCache.size > 500) adminCache.clear();
  adminCache.set(userId, { at: now, isAdmin });
  return isAdmin;
}

export async function loadMenuTargets(userId: string, now: number = Date.now()): Promise<MenuTargets> {
  const closed: MenuTargets = { enabled: false, links: {} };
  try {
    const gate = evaluateGate(process.env);
    if (!gate.open) return closed;
    const admin = adminClient();
    const isAdmin = gate.audience === "admin_only" ? await cachedIsAdmin(admin, userId, now) : false;
    if (gate.audience === "admin_only" && !isAdmin) return closed;
    const fallbackKinds = await cachedFallbackKinds(admin, now);
    return resolveMenuTargets({ isAdmin, env: process.env, fallbackKinds });
  } catch {
    return closed;
  }
}

// M9 F01S N2：逐頁「回舊版」備援開關（伺服端）。
// 快取策略（明確）：session 每次請求都直接讀資料庫（force-dynamic、Cache-Control: no-store），伺服端沒有任何快取；
// 前端每 60 秒、視窗取得焦點、開啟選單時重新讀取 session。因此開關生效的最長延遲 = 前端輪詢間隔 60 秒，且不需要重新部署。
// 備援表不存在或讀取失敗時一律視為「沒有任何頁面切回舊版」，不讓 session 失敗（備援是保險，不能反過來讓工作台壞掉）。
import { FALLBACK_SWITCHABLE_KINDS, isFallbackSwitchable, legacyRouteFor } from "./legacy-routes";
import { adminClient, checkOrigin, respond, WorkspaceError, type Context } from "./server";

export const FALLBACK_TABLE = "workspace_page_fallbacks";
export const FALLBACK_EVENTS = "workspace_page_fallback_events";
export const REASON_MAX = 200;

export type FallbackEntry = { kind: string; reason: string | null; updatedAt: string | null };

/** session 用：目前切回舊版的頁面。任何錯誤都回空陣列。 */
export async function activeFallbacks(admin: ReturnType<typeof adminClient>): Promise<FallbackEntry[]> {
  try {
    const { data, error } = await admin.from(FALLBACK_TABLE).select("kind,reason,updated_at").eq("use_legacy", true);
    if (error || !data) return [];
    return data
      .filter((r: any) => isFallbackSwitchable(r.kind))
      .map((r: any) => ({ kind: r.kind as string, reason: (r.reason as string) ?? null, updatedAt: (r.updated_at as string) ?? null }));
  } catch {
    return [];
  }
}

function requireSystemAdmin(ctx: Context) {
  if (!ctx.isAdmin) throw new WorkspaceError(403, "只有系統管理員可以設定頁面回舊版");
}

/** 管理頁清單：所有可切換的頁面（kind、舊版路由）與目前狀態、最後一次修改者與時間、原因。 */
export async function listFallbacks(ctx: Context) {
  requireSystemAdmin(ctx);
  const { data, error } = await ctx.admin.from(FALLBACK_TABLE).select("kind,use_legacy,reason,updated_by,updated_at");
  if (error) throw new WorkspaceError(503, "頁面回舊版設定尚未啟用（資料表不存在或無法讀取）");
  const rows = new Map((data || []).map((r: any) => [r.kind as string, r]));
  const ids = Array.from(new Set((data || []).map((r: any) => r.updated_by).filter(Boolean)));
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await ctx.admin.from("profiles").select("id,full_name").in("id", ids as string[]);
    for (const p of profiles || []) names.set(p.id as string, (p.full_name as string) || "");
  }
  return respond({
    items: FALLBACK_SWITCHABLE_KINDS.map((kind) => {
      const r: any = rows.get(kind);
      return {
        kind,
        legacyRoute: legacyRouteFor(kind),
        useLegacy: !!r?.use_legacy,
        reason: r?.reason ?? null,
        updatedAt: r?.updated_at ?? null,
        updatedByName: r?.updated_by ? names.get(r.updated_by) || "（已刪除的使用者）" : null,
      };
    }),
    reasonMax: REASON_MAX,
  });
}

/** PUT { kind, useLegacy, reason? }：切換單一頁面。 */
export async function setFallback(ctx: Context, request: Request) {
  requireSystemAdmin(ctx);
  checkOrigin(request);
  const body = (await request.json().catch(() => null)) as { kind?: unknown; useLegacy?: unknown; reason?: unknown } | null;
  const kind = typeof body?.kind === "string" ? body.kind : "";
  if (!isFallbackSwitchable(kind)) throw new WorkspaceError(400, "這個頁面不能切回舊版（沒有舊版對應頁面，或不是選單頁面）");
  if (typeof body?.useLegacy !== "boolean") throw new WorkspaceError(400, "請指定要切回舊版或改回新版");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length > REASON_MAX) throw new WorkspaceError(400, `原因最多 ${REASON_MAX} 字`);
  if (body.useLegacy && !reason) throw new WorkspaceError(400, "切回舊版前請填寫原因（之後才知道為什麼切）");
  const { data, error } = await ctx.admin.rpc("workspace_set_page_fallback", {
    p_kind: kind,
    p_use_legacy: body.useLegacy,
    p_reason: reason || null,
    p_actor: ctx.user.id,
  });
  if (error) throw new WorkspaceError(503, "儲存失敗，請稍後重試（備援開關資料表可能尚未建立）");
  return respond({ success: true, item: data });
}

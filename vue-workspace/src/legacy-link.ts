// M9 F01S：「回舊版」連結與備援開關的前端共用小工具（純函式，Vitest 可直接測）。
import { legacyRouteFor } from "../../lib/workspace/legacy-routes";

/** 舊版網址：整合模式（3002）與工作台同網域；獨立預覽模式（5173）指向 3002。 */
export function legacyUrl(integrated: boolean | undefined, href: string): string {
  return integrated ? href : "http://localhost:3002" + href;
}

/** kind 對應的舊版完整網址；沒有舊版對應回傳 null（此時不顯示「回舊版」）。 */
export function legacyUrlForKind(kind: string, integrated: boolean | undefined): string | null {
  const route = legacyRouteFor(kind);
  return route ? legacyUrl(integrated, route) : null;
}

export type PageFallback = { kind: string; reason: string | null; updatedAt: string | null };

/** M9 N2：這個 kind 是否已被切回舊版；是的話回傳舊版網址與原因，否則 null（沒有舊版對應的頁面永遠是 null）。 */
export function fallbackFor(
  kind: string,
  fallbacks: readonly PageFallback[] | undefined,
  integrated: boolean | undefined,
): { href: string; reason: string | null } | null {
  const hit = fallbacks?.find((f) => f.kind === kind);
  if (!hit) return null;
  const href = legacyUrlForKind(kind, integrated);
  return href ? { href, reason: hit.reason } : null;
}

// WP6：新版「尚未開放／暫時關閉」畫面的判斷（純函式，Vitest 可直接測）。
export type SiteNoticeKind = "closed" | "not-open";
export const SITE_NOTICE_EVENT = "workspace-site-notice";
export const SITE_NOTICE_TEXT: Record<SiteNoticeKind, { title: string; body: string }> = {
  closed: { title: "新版暫時關閉", body: "新版作業台目前暫時關閉，請先使用舊版作業。" },
  "not-open": { title: "新版尚未開放", body: "新版作業台目前尚未對您開放，請先使用舊版作業。" },
};

const CLOSED_MESSAGES = ["新版暫時關閉", "新版工作台設定不符"];

/** 從 API 回應判斷是否為「整站關閉（503）」或「尚未開放（403 NOT_OPEN_YET）」。其他錯誤回 null。 */
export function siteNoticeFor(status: number, data: unknown): SiteNoticeKind | null {
  const error = (data as { error?: unknown } | null | undefined)?.error;
  // 503 也會用在一般的資料讀寫失敗，只有整站關閉的兩句固定訊息才算「暫時關閉」，避免誤蓋整頁。
  if (status === 503) return typeof error === "string" && CLOSED_MESSAGES.some((m) => error.startsWith(m)) ? "closed" : null;
  if (status === 403 && error === "NOT_OPEN_YET") return "not-open";
  return null;
}

/** session 回應是否表示「尚未開放」（200 加 open:false）。 */
export function sessionNotOpen(data: { open?: boolean } | null | undefined): boolean {
  return !!data && data.open === false;
}

/** 僅管理員可用的提示：audience 為 admin_only 且目前使用者是管理員。 */
export function showAdminOnlyBanner(
  siteState: { audience?: string } | undefined,
  isAdmin: boolean | undefined,
): boolean {
  return siteState?.audience === "admin_only" && isAdmin === true;
}

/** 舊版首頁網址：整合模式與工作台同網域，獨立預覽（integrated 明確為 false）指向 3002。 */
export function legacyHomeHref(integrated: boolean | undefined): string {
  return integrated === false ? "http://localhost:3002/" : "/";
}

// QR 標籤網址規則（Q9，使用者 2026-11-09 確認）：純函式，無相依，伺服端與單元測試共用。
// 標籤上的網址由伺服端環境變數 NEXT_PUBLIC_SITE_URL 決定（專案既有慣例，忘記密碼信也用它），
// 任何環境、任何情況都不得退回瀏覽器目前網址（否則在測試站印出的標籤會帶著測試網域，貼到實體設備上就失效）。

/** 設定或格式錯誤（伺服端 qr.ts 轉成帶狀態碼的 API 錯誤）。 */
export class QrUrlError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const QR_SITE_ENV = "NEXT_PUBLIC_SITE_URL";
/** 永久掃描路徑：token 沿用不重發，舊標籤與新標籤網址完全相同。 */
export const SCAN_PATH_PREFIX = "/general-affairs/assets/scan/";
/** 單次列印張數上限。 */
export const QR_LABEL_LIMIT = 300;
/** 測試用資料庫專案代碼（非機密）。不是這個代碼的環境一律視為正式。 */
const DEV_REF = "mjpdfpxqttbhzeimmtqr";
const TOKEN_RE = /^[a-z0-9]{24,64}$/;
const BASE_RE = /^https?:\/\/[^/\s?#]+$/i;

type Env = Record<string, string | undefined>;

/** 讀取 QR 網址網域：trim、去結尾斜線；缺值或格式不符（含路徑、非 http）就丟 500，白話說明該找誰設定。 */
export function getQrBaseUrl(env: Env = process.env): string {
  const raw = String(env[QR_SITE_ENV] ?? "").trim().replace(/\/+$/, "");
  if (!raw) {
    throw new QrUrlError(500, `QR 網址網域尚未設定：請系統管理員在主機環境設定 ${QR_SITE_ENV}（例如 https://正式網域），設定前不能列印標籤。`);
  }
  if (!BASE_RE.test(raw)) {
    throw new QrUrlError(500, `QR 網址網域格式不正確：${QR_SITE_ENV} 必須是 http:// 或 https:// 開頭的網域，不含路徑（例如 https://正式網域）。`);
  }
  return raw;
}

/** 是否為正式環境：Vercel 的 production，或資料庫專案不是測試用那一個。其餘（測試、本機）印出的標籤加「測試」浮水印。 */
export function isProductionRuntime(env: Env = process.env): boolean {
  if (env.VERCEL_ENV === "production") return true;
  let ref = "";
  try {
    ref = new URL(String(env.NEXT_PUBLIC_SUPABASE_URL || "")).hostname.split(".")[0];
  } catch {
    ref = "";
  }
  return ref !== DEV_REF;
}

export function isValidQrToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

/** 標籤上的永久網址。 */
export function qrUrlFor(token: string, env: Env = process.env): string {
  if (!isValidQrToken(token)) throw new QrUrlError(400, "QR Code 格式錯誤");
  return `${getQrBaseUrl(env)}${SCAN_PATH_PREFIX}${token}`;
}

/** 永久網址轉到新版頁面的旗標：只有明確設為 true 才轉（預設舊版 Next 頁面完全不動）。 */
export function scanRedirectEnabled(env: Env = process.env): boolean {
  return String(env.WORKSPACE_SCAN_REDIRECT ?? "").trim().toLowerCase() === "true";
}

/** 新版掃描頁網址（hash 路由，未登入時由工作台先登入再開同一頁）。 */
export function workspaceScanTarget(token: string): string {
  return `/workspace/index.html#/open/ga-asset-scan/${encodeURIComponent(token)}`;
}

// --------------------------------------------------------------------------- 標籤資料的純規則（排除、警告、上限）
export type LabelCandidate = { id: string; name: string; code: string | null; status: string; deleted_at?: string | null; qr_token: string | null; qr_token_revoked_at?: string | null };
export type LabelExcluded = { id: string; name: string; reason: "SCRAPPED" | "RETIRED" | "REVOKED" | "DELETED" | "NO_TOKEN"; message: string };

/** 能不能印：已刪除、QR 已作廢（含報廢設備、退役設施自動作廢）、沒有 token 都排除並說明原因。 */
export function labelExclusion(type: "EQUIPMENT" | "FACILITY", row: LabelCandidate): LabelExcluded | null {
  const base = { id: row.id, name: row.name };
  if (row.deleted_at) return { ...base, reason: "DELETED", message: "已刪除，QR 已作廢" };
  if (type === "EQUIPMENT" && row.status === "SCRAPPED") return { ...base, reason: "SCRAPPED", message: "已報廢，QR 已作廢" };
  if (type === "FACILITY" && row.status === "RETIRED") return { ...base, reason: "RETIRED", message: "已退役，QR 已作廢" };
  if (row.qr_token_revoked_at) return { ...base, reason: "REVOKED", message: "QR 已作廢" };
  if (!row.qr_token) return { ...base, reason: "NO_TOKEN", message: "沒有 QR 代碼" };
  return null;
}

/** 單次上限：回傳要印的那些與是否被截斷。 */
export function applyLabelLimit<T>(items: T[], limit = QR_LABEL_LIMIT) {
  return { items: items.slice(0, limit), truncated: items.length > limit };
}

/** 標籤上的「測試」浮水印：非正式環境一律加。 */
export function labelWatermark(env: Env = process.env): boolean {
  return !isProductionRuntime(env);
}

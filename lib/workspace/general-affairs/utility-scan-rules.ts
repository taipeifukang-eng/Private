// 水電帳單「手機掃 QR 拍照上傳」的純規則（伺服端、前端、單元測試共用）。無任何相依（產生權杖與雜湊用 Node crypto，放在 utility-scan.ts）。
// 型別檢查（根目錄 tsconfig，target 較低）：不對 Set／Map 做展開或 for-of。
//
// 權杖規則：
//   - 32 位元組隨機（43 字元 base64url）；只在產生時給發出者一次，資料庫只存 SHA-256 雜湊（64 位十六進位）。
//   - 15 分鐘有效、一次性綁定一張帳單與發出者、最多 10 張；只能上傳到這張帳單的 BILL_DOCUMENT，不能讀取或刪除任何檔案。
//   - 帳單被請款單鎖定（已送出／已付款）或已刪除時拒絕。

export const SCAN_TOKEN_TTL_MINUTES = 15;
export const SCAN_TOKEN_MAX_FILES = 10;
export const SCAN_PURPOSE = "BILL_DOCUMENT";
export const SCAN_RESOURCE_TYPE = "UTILITY_BILL";
/** 手機上傳頁在 Vue 工作台的 hash 路由（公開頁，不需登入）。 */
export const SCAN_PAGE_PATH = "/workspace/index.html#/bill-scan/";
/** 公開上傳 API（不需登入，只認權杖）。 */
export const SCAN_API_PATH = "/api/workspace/bill-scan-upload";
export const SCAN_TOKEN_HEADER = "x-scan-token";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

export function isScanToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}
export function isScanHash(value: unknown): value is string {
  return typeof value === "string" && HASH_RE.test(value);
}

/** QR 網址網域：WORKSPACE_ORIGIN（逗號清單）裡若有「使用者目前所在的網域」就用它，否則用清單第一個，清單沒設就用請求自己的網域。 */
export function scanBaseUrl(env: Record<string, string | undefined>, requestOrigin: string): string {
  const clean = (v: string) => v.trim().replace(/\/+$/, "");
  const list = String(env.WORKSPACE_ORIGIN || "").split(",").map(clean).filter(Boolean);
  const here = clean(requestOrigin);
  if (here && list.indexOf(here) >= 0) return here;
  if (list.length) return list[0];
  return here;
}
export function scanUrl(base: string, token: string): string {
  return base.replace(/\/+$/, "") + SCAN_PAGE_PATH + token;
}

export type ScanCode = "INVALID" | "BILL_LOCKED" | "FULL";
/** 資料庫函式回傳的代碼 -> 給手機端看的白話訊息。無效、過期、已作廢、不存在一律同一句，不洩漏差別。 */
export function scanMessage(code: string | undefined, fallback = "上傳失敗，請稍後重試"): string {
  if (code === "INVALID") return "這個上傳連結無效或已過期，請回到電腦重新產生 QR";
  if (code === "BILL_LOCKED") return "這筆帳單已鎖定（已在送出或已付款的請款單內），無法上傳";
  if (code === "FULL") return `這個連結已達上傳上限（${SCAN_TOKEN_MAX_FILES} 張），請回到電腦重新產生 QR`;
  return fallback;
}

/** 檔案內容檢查（公開上傳路由不能只信瀏覽器宣稱的類型）：看檔頭判斷是不是真的 JPEG／PNG／WebP／PDF／HEIC。 */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf";
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (/^(heic|heix|hevc|hevx|heim|heis)$/.test(brand)) return "image/heic";
    if (/^(mif1|msf1)$/.test(brand)) return "image/heif";
  }
  return null;
}
/** 偵測到的實際格式 -> 固定副檔名（公開上傳路由不採用使用者檔名的副檔名）。 */
export function extensionOfMime(mime: string | null): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic") return "heic";
  if (mime === "image/heif") return "heif";
  return "jpg";
}
/** 顯示用檔名：去掉控制字元與雙向文字（RTL）覆寫字元，頭尾空白。 */
export function cleanFileName(name: string | null | undefined): string {
  return String(name ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim();
}
/** 宣稱的類型與檔頭一致（HEIC／HEIF 兩種標記互通）。 */
export function mimeMatches(claimed: string, sniffed: string | null): boolean {
  if (!sniffed) return false;
  const norm = (m: string) => (m === "image/heif" ? "image/heic" : m);
  return norm(claimed) === norm(sniffed);
}

// ---- 簡易流量限制（每個伺服器實例各自計；正式區另建議在 Vercel Firewall 對 /api/workspace/bill-scan-upload 設 Rate Limit）----
export type Limiter = { hit: (key: string) => { ok: boolean; retryAfterSec: number }; blocked: (key: string) => { ok: boolean; retryAfterSec: number }; reset: (key: string) => void };
export function createLimiter(opts: { limit: number; windowMs: number; now?: () => number; maxKeys?: number }): Limiter {
  const now = opts.now || (() => Date.now());
  const maxKeys = opts.maxKeys || 5000;
  let table: Record<string, { count: number; resetAt: number }> = {};
  let keys = 0;
  return {
    hit(key) {
      const t = now();
      const cur = table[key];
      if (!cur || cur.resetAt <= t) {
        if (!cur) {
          if (keys >= maxKeys) {
            table = {};
            keys = 0;
          }
          keys += 1;
        }
        table[key] = { count: 1, resetAt: t + opts.windowMs };
        return { ok: true, retryAfterSec: 0 };
      }
      cur.count += 1;
      if (cur.count > opts.limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - t) / 1000)) };
      return { ok: true, retryAfterSec: 0 };
    },
    /** 只看不計：這個 key 目前是不是已超過上限。 */
    blocked(key) {
      const t = now();
      const cur = table[key];
      if (cur && cur.resetAt > t && cur.count > opts.limit) return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - t) / 1000)) };
      return { ok: true, retryAfterSec: 0 };
    },
    reset(key) {
      if (table[key]) {
        delete table[key];
        keys -= 1;
      }
    },
  };
}
/** 請求者 IP（Vercel 的 x-forwarded-for 第一段）；取不到就歸在同一個桶。 */
export function clientKey(forwardedFor: string | null | undefined): string {
  const first = String(forwardedFor || "").split(",")[0].trim();
  return first.slice(0, 64) || "unknown";
}

// 公開頁路由策略（D14，T03）：Next 保留原路徑，轉址到 Vue 工作台的 hash 路由。
// 例如 QR 標籤上已印的 /general-affairs/assets/scan/{token} 永久有效，之後可轉到 /workspace/index.html#/scan/{token}。
//
// 機制：
//   1. 在 WORKSPACE_PUBLIC_REDIRECTS 登錄「Next 原路徑樣式 -> Vue hash 路由樣式」。
//   2. middleware.ts 對符合的請求回 307 到 /workspace/index.html#/<route>（僅 DEV 工作台環境啟用）。
//   3. Vue 端在 vue-workspace/src/workspace-pages.ts 的 WORKSPACE_PUBLIC_PAGES 登錄對應頁面。
// 已登錄：示範路由 /public-demo/:token，以及 M5 W22 的登入、註冊、忘記密碼、重設密碼。
// 掃描頁等其他公開頁在各自工作項完成並驗證後才加入，加入前原 Next 頁面維持不變。
// 此檔不得 import 任何模組（middleware 與 Vitest 皆會直接引用）。

export type PublicRedirect = {
  /** Next 原路徑樣式，以 :name 表示單一路徑段。 */
  legacy: string;
  /** Vue hash 路由樣式（不含 #），參數名稱需與 legacy 相同。 */
  hash: string;
  /** 轉址時要帶進 hash 的查詢參數名稱（例如登入的 redirect）；其他參數一律丟棄。 */
  query?: readonly string[];
};

export const WORKSPACE_PUBLIC_REDIRECTS: readonly PublicRedirect[] = [
  { legacy: "/public-demo/:token", hash: "/public-demo/:token" },
  // M5 W22：登入、註冊、忘記密碼、重設密碼（保留原網址，已寄出的信與書籤不失效）。
  // redirect：登入後回原頁（Vue 端再用 safeRedirectPath 檢查）；error：重設連結失敗時 /auth/callback 帶回的標記。
  { legacy: "/login", hash: "/login", query: ["redirect"] },
  { legacy: "/register", hash: "/register" },
  { legacy: "/forgot-password", hash: "/forgot-password" },
  { legacy: "/reset-password", hash: "/reset-password", query: ["error"] },
];

// 直接指向 index.html：Next 會把 /workspace/ 正規化成 /workspace，相對資源路徑（base ./）可能失效。
export const WORKSPACE_ENTRY = "/workspace/index.html";

// 參數只允許安全字元，避免把任意內容帶進 hash。
const PARAM_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const want = pattern.split("/");
  const got = pathname.replace(/\/+$/, "").split("/");
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(":")) {
      if (!PARAM_PATTERN.test(got[i])) return null;
      params[want[i].slice(1)] = got[i];
    } else if (want[i] !== got[i]) return null;
  }
  return params;
}

// 只帶登錄過的參數；值長度上限 512，避免把任意長內容塞進 hash。
function carryQuery(names: readonly string[] | undefined, search: string): string {
  if (!names?.length || !search) return "";
  const source = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const name of names) {
    const value = source.get(name);
    if (value !== null && value.length <= 512) out.set(name, value);
  }
  const text = out.toString();
  return text ? `?${text}` : "";
}

/**
 * 回傳應轉址的目標（含 hash，例如 /workspace/index.html#/public-demo/abc），不符合任何登錄則回 null。
 * 純函式；不讀環境變數，是否啟用由呼叫端（middleware）決定。
 */
export function resolveWorkspacePublicRedirect(
  pathname: string,
  redirects: readonly PublicRedirect[] = WORKSPACE_PUBLIC_REDIRECTS,
  search = "",
): string | null {
  for (const r of redirects) {
    const params = matchPattern(r.legacy, pathname);
    if (!params) continue;
    const route = r.hash.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) =>
      encodeURIComponent(params[name] ?? ""),
    );
    return `${WORKSPACE_ENTRY}#${route}${carryQuery(r.query, search)}`;
  }
  return null;
}

// 公開頁路由策略（D14，T03）：Next 保留原路徑，轉址到 Vue 工作台的 hash 路由。
// 例如 QR 標籤上已印的 /general-affairs/assets/scan/{token} 永久有效，之後可轉到 /workspace/index.html#/scan/{token}。
//
// 機制：
//   1. 在 WORKSPACE_PUBLIC_REDIRECTS 登錄「Next 原路徑樣式 -> Vue hash 路由樣式」。
//   2. middleware.ts 對符合的請求回 307 到 /workspace/index.html#/<route>（僅 DEV 工作台環境啟用）。
//   3. Vue 端在 vue-workspace/src/workspace-pages.ts 的 WORKSPACE_PUBLIC_PAGES 登錄對應頁面。
// 目前只登錄示範路由 /public-demo/:token；正式頁面（掃描頁、註冊／忘記密碼／重設密碼）
// 在各自工作項完成並驗證後才加入，加入前原 Next 頁面維持不變。
// 此檔不得 import 任何模組（middleware 與 Vitest 皆會直接引用）。

export type PublicRedirect = {
  /** Next 原路徑樣式，以 :name 表示單一路徑段。 */
  legacy: string;
  /** Vue hash 路由樣式（不含 #），參數名稱需與 legacy 相同。 */
  hash: string;
};

export const WORKSPACE_PUBLIC_REDIRECTS: readonly PublicRedirect[] = [
  { legacy: "/public-demo/:token", hash: "/public-demo/:token" },
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

/**
 * 回傳應轉址的目標（含 hash，例如 /workspace/index.html#/public-demo/abc），不符合任何登錄則回 null。
 * 純函式；不讀環境變數，是否啟用由呼叫端（middleware）決定。
 */
export function resolveWorkspacePublicRedirect(
  pathname: string,
  redirects: readonly PublicRedirect[] = WORKSPACE_PUBLIC_REDIRECTS,
): string | null {
  for (const r of redirects) {
    const params = matchPattern(r.legacy, pathname);
    if (!params) continue;
    const route = r.hash.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) =>
      encodeURIComponent(params[name] ?? ""),
    );
    return `${WORKSPACE_ENTRY}#${route}`;
  }
  return null;
}

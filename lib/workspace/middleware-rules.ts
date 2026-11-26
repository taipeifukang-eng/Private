// 中介層規則（純函式，不依賴 Next）：何時把公開頁／舊頁轉到新版，以及哪些路徑不可被快取。
import { DEV_REF } from './site-gate';

type Env = Record<string, string | undefined>;

/** 轉址只在 DEV 工作台網址，或明確開啟 WORKSPACE_PUBLIC_REDIRECT_ENABLED=true 時啟用；正式區預設不轉址。 */
export function publicRedirectEnabled(env: Env): boolean {
  const url = (env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  let ref = '';
  try {
    ref = new URL(url).hostname.split('.')[0] || '';
  } catch {
    ref = '';
  }
  // 總開關明確關閉（WORKSPACE_ENABLED 或舊別名設成 true 以外的值）時一律不轉址，舊版登入頁與舊頁維持原樣。
  const enabled = env.WORKSPACE_ENABLED ?? env.WORKSPACE_DEV_ENABLED;
  if (enabled !== undefined && enabled !== 'true') return false;
  if (ref === DEV_REF) return true;
  return env.WORKSPACE_PUBLIC_REDIRECT_ENABLED === 'true';
}

const NO_STORE_PATHS = ['/workspace', '/workspace/', '/workspace/index.html'];

/** 工作台入口頁一律不快取（與環境無關），確保重新部署後立刻取到新的雜湊檔名。 */
export function workspaceEntryNoStore(pathname: string): boolean {
  return NO_STORE_PATHS.includes(pathname);
}

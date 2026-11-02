import fs from 'node:fs';
import path from 'node:path';
import { request as playwrightRequest, type APIRequestContext, type Browser, type BrowserContext } from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getAccount } = require('./credentials.cjs') as {
  getAccount: (key: string) => { email: string; password: string; userId?: string };
};

export const TEST_ORIGIN = 'http://localhost:3002';
const AUTH_DIR = path.resolve(__dirname, '..', 'reports', '.auth');
// 登入狀態快取有效期（Supabase access token 預設 1 小時，保守取 30 分鐘）。
const MAX_AGE_MS = 30 * 60 * 1000;

export function storageStatePath(role: string): string {
  if (!/^[a-z0-9_]+$/i.test(role)) throw new Error(`不合法的角色 key：${role}`);
  return path.join(AUTH_DIR, `${role}.json`);
}

async function login(role: string): Promise<string> {
  const { email, password } = getAccount(role);
  const file = storageStatePath(role);
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
  try {
    const res = await ctx.post('/api/workspace/login', { data: { email, password } });
    if (!res.ok()) throw new Error(`角色 ${role} 登入失敗（HTTP ${res.status()}）`);
    await ctx.storageState({ path: file });
  } finally {
    await ctx.dispose();
  }
  return file;
}

/**
 * 取得角色的 Playwright storageState 檔案路徑。快取在 tests/reports/.auth/<role>.json（gitignored），
 * 過期（30 分鐘）或 force 時重新登入。role 是 role-matrix.json 的 account key（例如 admin、store_manager）。
 */
export async function storageStateFor(role: string, opts: { force?: boolean } = {}): Promise<string> {
  const file = storageStatePath(role);
  if (!opts.force && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < MAX_AGE_MS) return file;
  return login(role);
}

/** 建立已登入該角色的 APIRequestContext（Origin 已帶好，可直接呼叫寫入 API）。 */
export async function apiAs(role: string, opts: { force?: boolean } = {}): Promise<APIRequestContext> {
  const state = await storageStateFor(role, opts);
  return playwrightRequest.newContext({
    baseURL: TEST_ORIGIN,
    storageState: state,
    extraHTTPHeaders: { Origin: TEST_ORIGIN },
  });
}

/** 建立已登入該角色的瀏覽器 context：`const ctx = await loginAs(browser, 'store_manager')`。 */
export async function loginAs(browser: Browser, role: string, opts: { force?: boolean } = {}): Promise<BrowserContext> {
  const state = await storageStateFor(role, opts);
  return browser.newContext({ baseURL: TEST_ORIGIN, storageState: state });
}

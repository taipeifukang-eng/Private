import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { expect, test, request as pwRequest } from '@playwright/test';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, cleanupM5Users, assertAuthMailMock } from '../support/m5-fixtures';
import { createAuthUser } from '../support/m5-org-fixtures';
import { TEST_ORIGIN } from '../support/auth';
import {
  FORGOT_PASSWORD_NOTICE,
  resetRedirectUrl,
  safeInternalPath,
  safeRedirectPath,
  validateNewPassword,
  validateRegister,
} from '../../lib/workspace/auth-public';

// W22 對等層：舊版（登入／註冊／忘記密碼／重設密碼頁面原始碼、signIn／signUp 伺服器動作、/auth/callback）與新版同輸入、同輸出。
// 舊版是 Next 頁面與伺服器動作，沒有可呼叫的 API：規則逐字移植並與原始碼比對（原始碼改了就失敗），行為差異才列入 allowlist。
// 與舊版不同的行為列在 tests/parity/allowlist.json（approvedBy 為 user (2026-11-08 survey/m5 Qn)；不需決策項目為 assumptions）。
// 資料：m5p-test-w22-par-* 帳號；只刪自己建立的資料；信件 mock（D17），不寄任何信。

const nodeRequire = createRequire(path.join(__dirname, 'W22.public-auth.spec.ts'));
const map = loadMap('public-auth');
const rec = new ParityRecorder('public-auth');
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const uniq = () => Math.random().toString(36).slice(2, 8);

test.beforeAll(async () => {
  await assertAuthMailMock(TEST_ORIGIN);
  expect(await cleanupM5Users(), '清除上次殘留').toEqual([]);
});
test.afterAll(async () => {
  expect(await cleanupM5Users(), '清除帳號').toEqual([]);
});

// ---- 舊版規則（逐字移植；beforeAll 之外的第一個測試會與原始碼比對）----
const legacyRedirect = (p: string | null) => (p?.startsWith('/') && !p.startsWith('//') ? p : '/');
function legacyRegister(password: string, confirmPassword: string): string | null {
  if (password !== confirmPassword) return '密碼不一致';
  if (password.length < 6) return '密碼至少需要 6 個字元';
  return null;
}
function legacyReset(newPassword: string, confirmPassword: string): string | null {
  if (newPassword.length < 6) return '密碼長度至少需要 6 個字元';
  if (newPassword !== confirmPassword) return '兩次輸入的密碼不一致';
  return null;
}

test('移植的舊版規則與原始碼一致（原始碼被改動時這裡先失敗，提醒重新比對）', () => {
  const login = read('app/login/page.tsx');
  expect(login).toContain("redirectPath?.startsWith('/') && !redirectPath.startsWith('//')");
  const reg = read('app/register/page.tsx');
  expect(reg).toContain("formData.password !== formData.confirmPassword");
  expect(reg).toContain("setError('密碼不一致')");
  expect(reg).toContain('formData.password.length < 6');
  expect(reg).toContain("setError('密碼至少需要 6 個字元')");
  expect(reg.indexOf('密碼不一致')).toBeLessThan(reg.indexOf('密碼至少需要 6 個字元')); // 先比對一致、再看長度
  const reset = read('app/reset-password/page.tsx');
  expect(reset).toContain('passwords.newPassword.length < 6');
  expect(reset).toContain("message: '密碼長度至少需要 6 個字元'");
  expect(reset).toContain("message: '兩次輸入的密碼不一致'");
  expect(reset.indexOf('密碼長度至少需要 6 個字元')).toBeLessThan(reset.indexOf('兩次輸入的密碼不一致'));
});

test('登入後回原頁：同一批輸入，舊版判斷 vs 新版 safeRedirectPath（新版更嚴格，不會更寬鬆）', () => {
  const e = entry('login-redirect-rule');
  const inputs = [
    '/', '/activity-view/abc', '/general-affairs/assets/scan/AB-12_x', '/admin/users?tab=1', '/x#y',
    '', 'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'evil.example',
    '/%2F%2Fevil.example', '/%5Cevil.example', '/a\nb', '/login', '/login?redirect=/x', '/register', '/forgot-password', '/reset-password',
  ];
  const diffs: Diff[] = [];
  for (const input of inputs) {
    const legacy = legacyRedirect(input);
    const native = safeRedirectPath(input) ?? '/';
    if (legacy !== native) diffs.push({ kind: 'changed', key: `redirect#${JSON.stringify(input)}`, legacy, native });
    // 不可更寬鬆：新版放行（非首頁）的，舊版一定也是同一個結果
    if (native !== '/') expect(legacy, input).toBe(native);
  }
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'ui-extract', title: '登入後回原頁規則', legacy: { endpoint: 'app/login/page.tsx' }, native: { endpoint: 'safeRedirectPath' }, compared: { inputs: inputs.length }, diffs }),
  );
  // 至少有幾個明確的外部網址被新版擋下，確認比對有效
  expect(diffs.length).toBeGreaterThanOrEqual(4);
});

test('Q16 註冊密碼規則：舊版驗證 vs 新版 validateRegister（含檢查順序與提示文字）', () => {
  const e = entry('register-validation');
  const pairs: [string, string][] = [['', ''], ['1', '1'], ['12345', '12345'], ['123456', '123456'], ['1234567', '1234567'], ['123456', '1234567'], ['123', '456'], ['abcdef', 'ABCDEF'], ['密碼密碼密碼密碼', '密碼密碼密碼密碼'], ['a'.repeat(72), 'a'.repeat(72)]];
  const diffs: Diff[] = [];
  for (const [password, confirmPassword] of pairs) {
    const legacy = legacyRegister(password, confirmPassword);
    const native = validateRegister({ fullName: '王小明', email: 'a@b.co', password, confirmPassword });
    if (legacy !== native) diffs.push({ kind: 'changed', key: `register#${password.length}/${confirmPassword.length}`, legacy, native });
  }
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'ui-extract', title: '註冊密碼規則', legacy: { endpoint: 'app/register/page.tsx' }, native: { endpoint: 'validateRegister' }, compared: { cases: pairs.length }, diffs }),
  );
  expect(diffs).toEqual([]);
});

test('Q16 重設密碼規則：舊版驗證 vs 新版 validateNewPassword(reset)', () => {
  const e = entry('reset-validation');
  const pairs: [string, string][] = [['', ''], ['12345', '12345'], ['123456', '123456'], ['123456', '1234567'], ['123', '456'], ['Abcdef1!', 'Abcdef1!'], ['a'.repeat(72), 'a'.repeat(72)]];
  const diffs: Diff[] = [];
  for (const [a, b] of pairs) {
    const legacy = legacyReset(a, b);
    const native = validateNewPassword(a, b, 'reset');
    if (legacy !== native) diffs.push({ kind: 'changed', key: `reset#${a.length}/${b.length}`, legacy, native });
  }
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'ui-extract', title: '重設密碼規則', legacy: { endpoint: 'app/reset-password/page.tsx' }, native: { endpoint: 'validateNewPassword' }, compared: { cases: pairs.length }, diffs }),
  );
  expect(diffs).toEqual([]);
});

test('登入失敗訊息：舊版直接顯示 Supabase 原文，新版中文白話（同一組錯誤密碼實際呼叫）', async () => {
  const e = entry('login-error-text');
  const user = await createAuthUser(`w22-par-login-${uniq()}`);
  const guard = nodeRequire('../support/env-guard.cjs') as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
  const { env } = guard.assertDevEnvironment({ root: ROOT });
  const { createClient } = nodeRequire('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => any };
  // 舊版 signIn 就是 supabase.auth.signInWithPassword，失敗時回傳 error.message
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const legacy = await anon.auth.signInWithPassword({ email: user.email, password: 'definitely-wrong-1' });
  expect(legacy.error).toBeTruthy();
  const api = await pwRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
  const res = await api.post('/api/workspace/login', { data: { email: user.email, password: 'definitely-wrong-1' } });
  const nativeText = (await res.json()).error as string;
  await api.dispose();
  const diffs: Diff[] = [];
  if (legacy.error.message !== nativeText) diffs.push({ kind: 'changed', key: 'login-error-text', legacy: legacy.error.message, native: nativeText });
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'api-read', title: '登入失敗訊息', legacy: { endpoint: 'supabase signInWithPassword' }, native: { endpoint: 'POST /api/workspace/login', status: res.status() }, compared: { cases: 1 }, diffs }),
  );
  expect(res.status()).toBe(401);
  expect(nativeText).not.toMatch(/[A-Za-z]{4,}/);
});

test('忘記密碼：舊版一律說已發送且失敗時顯示英文原文；新版已註冊與未註冊回應相同，文字固定', async () => {
  const e = entry('forgot-password-text');
  const actions = read('app/auth/actions.ts');
  const page = read('app/forgot-password/page.tsx');
  const legacyHasRawError = actions.includes('error: error.message') && page.includes("result.error || '發送失敗，請稍後再試'");
  const legacySaysSent = page.includes('郵件已發送！') && actions.includes("message: '密碼重置郵件已發送，請檢查您的信箱'");
  expect(legacyHasRawError).toBe(true);
  expect(legacySaysSent).toBe(true);
  const known = await createAuthUser(`w22-par-known-${uniq()}`);
  const api = await pwRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
  const a = await api.post('/api/workspace/auth/forgot-password', { data: { email: known.email } });
  const b = await api.post('/api/workspace/auth/forgot-password', { data: { email: `m5p-test-w22-par-none-${uniq()}@example.test` } });
  const [ta, tb] = [await a.text(), await b.text()];
  await api.dispose();
  const diffs: Diff[] = [];
  if (a.status() !== b.status() || ta !== tb) diffs.push({ kind: 'status', key: 'forgot-known-vs-unknown', legacy: 'n/a', native: `${a.status()}/${b.status()}`, detail: '已註冊與未註冊的回應不同（不允許）' });
  expect(JSON.parse(ta).message).toBe(FORGOT_PASSWORD_NOTICE);
  // 舊版文字行為：失敗顯示英文原文、成功宣稱已發送；新版固定文字
  diffs.push({ kind: 'changed', key: 'forgot-error-text', legacy: 'Supabase error.message（英文原文）', native: '固定中文提示，不透露帳號是否存在' });
  diffs.push({ kind: 'changed', key: 'forgot-success-text', legacy: '郵件已發送！', native: FORGOT_PASSWORD_NOTICE });
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'ui-extract', title: '忘記密碼提示', legacy: { endpoint: 'app/forgot-password/page.tsx' }, native: { endpoint: 'POST /api/workspace/auth/forgot-password', status: a.status() }, compared: { cases: 3 }, diffs }),
  );
});

test('重設信連結的網站網址：舊版缺設定退回 localhost:3000，新版直接報錯', () => {
  const e = entry('forgot-site-url');
  const actions = read('app/auth/actions.ts');
  expect(actions).toContain("process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'");
  const legacy = (site: string | undefined) => `${site || 'http://localhost:3000'}/auth/callback?next=/reset-password`;
  const diffs: Diff[] = [];
  for (const site of ['https://app.example.com', 'http://localhost:3002', undefined, '']) {
    const l = legacy(site);
    let n: string;
    try {
      n = resetRedirectUrl(site);
    } catch {
      n = '(報錯)';
    }
    if (l !== n) diffs.push({ kind: 'changed', key: `site-url#${site === undefined ? 'undefined' : JSON.stringify(site)}`, legacy: l, native: n });
  }
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'ui-extract', title: '重設信連結網站網址', legacy: { endpoint: 'requestPasswordReset' }, native: { endpoint: 'resetRedirectUrl' }, compared: { cases: 4 }, diffs }),
  );
  expect(diffs.map((d) => d.key)).toEqual(['site-url#undefined', 'site-url#""']);
});

test('D14 原網址：舊版直接顯示頁面（200），新版 307 轉到 Vue 公開頁；登入頁保留 redirect', async () => {
  const e = entry('public-url-redirects');
  const urls: [string, string][] = [
    ['/login', 'app/login/page.tsx'],
    ['/register', 'app/register/page.tsx'],
    ['/forgot-password', 'app/forgot-password/page.tsx'],
    ['/reset-password', 'app/reset-password/page.tsx'],
  ];
  const api = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  const diffs: Diff[] = [];
  for (const [url, legacyFile] of urls) {
    expect(fs.existsSync(path.join(ROOT, legacyFile)), legacyFile).toBe(true); // 舊頁檔案仍在（舊站直接 200）
    const r = await api.get(url, { maxRedirects: 0 });
    const loc = r.headers().location || '';
    diffs.push({ kind: 'status', key: url, legacy: 200, native: r.status(), detail: loc ? `轉到 ${new URL(loc).pathname}${new URL(loc).hash}` : '未轉址' });
    expect(r.status(), url).toBe(307);
    expect(new URL(loc).hash, url).toBe(`#${url}`);
  }
  const withRedirect = await api.get('/login?redirect=%2Factivity-view%2Fabc', { maxRedirects: 0 });
  expect(new URL(withRedirect.headers().location).hash).toBe('#/login?redirect=%2Factivity-view%2Fabc');
  await api.dispose();
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'navigation', title: '公開頁原網址', legacy: { endpoint: '舊版頁面（200）' }, native: { endpoint: '307 -> /workspace/index.html#/…' }, compared: { urls: urls.length }, diffs }),
  );
});

test('登入頁功能點：忘記密碼與註冊連結兩邊都有；門市數量動態訊息與返回首頁連結只在舊版', () => {
  const e = entry('login-page-features');
  const legacySrc = read('app/login/page.tsx');
  const nativeSrc = read('vue-workspace/src/components/LoginForm.vue') + read('vue-workspace/src/components/PublicShell.vue');
  const features: [string, boolean, boolean][] = [
    ['forgot-password-link', legacySrc.includes('href="/forgot-password"'), nativeSrc.includes('href="#/forgot-password"')],
    ['register-link', legacySrc.includes('href="/register"'), nativeSrc.includes('href="#/register"')],
    ['back-home-link', legacySrc.includes('返回首頁'), nativeSrc.includes('返回首頁')],
    ['store-count-line', legacySrc.includes('正在同步'), nativeSrc.includes('正在同步')],
    ['test-environment-text', /測試環境|測試工作區/.test(legacySrc), /測試環境|測試工作區/.test(nativeSrc)],
  ];
  const diffs: Diff[] = [];
  for (const [key, l, n] of features) {
    if (l && !n) diffs.push({ kind: 'only-legacy', key });
    if (!l && n) diffs.push({ kind: 'only-native', key });
  }
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'ui-extract', title: '登入頁功能點', legacy: { endpoint: 'app/login/page.tsx' }, native: { endpoint: 'LoginForm.vue' }, compared: { features: features.length }, diffs }),
  );
  // 兩邊都必須有的功能點不可缺
  for (const key of ['forgot-password-link', 'register-link']) expect(diffs.map((d) => d.key)).not.toContain(key);
  expect(features.find((f) => f[0] === 'test-environment-text')![2]).toBe(false);
});

test('Q15 新註冊者的人員資料：新版註冊 API vs 舊版 signUp 同樣的建立路徑，逐欄相同，且都沒有角色', async () => {
  const e = entry('register-no-role');
  const db = adminDb();
  const tag = uniq();
  const nativeEmail = `m5p-test-w22-par-new-${tag}@example.test`;
  const legacyEmail = `m5p-test-w22-par-old-${tag}@example.test`;
  const password = `Aa1-${uniq()}${uniq()}`;
  const api = await pwRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
  const r = await api.post('/api/workspace/auth/register', { data: { fullName: 'W22 對等', email: nativeEmail, password, confirmPassword: password } });
  await api.dispose();
  expect(r.status()).toBe(200);
  // 注意：測試站走 mock 分支，這裡只比對「人員資料觸發」結果；真實 signUp／重設信分支的呼叫內容由 tests/unit/W22/auth-public.test.ts（signUpReal、requestResetReal）驗證。
  // 舊版 signUp 等同於在 auth 建立一個帶 full_name 的使用者，人員資料由資料庫觸發建立（這裡用 admin 建立相同的使用者）
  const created = await db.auth.admin.createUser({ email: legacyEmail, password, email_confirm: true, user_metadata: { full_name: 'W22 對等' } });
  expect(created.error).toBeNull();
  const rowOf = async (email: string) => (await db.from('profiles').select('*').eq('email', email).single()).data as Record<string, unknown>;
  const [n, l] = [await rowOf(nativeEmail), await rowOf(legacyEmail)];
  const skip = (k: string) => k === 'id' || k === 'email' || /(_at|_date)$/.test(k);
  const diffs: Diff[] = [];
  for (const k of Object.keys({ ...l, ...n }).filter((k) => !skip(k))) {
    if (JSON.stringify(l[k]) !== JSON.stringify(n[k])) diffs.push({ kind: 'changed', key: `profile#${k}`, legacy: l[k], native: n[k] });
  }
  for (const [label, row] of [['native', n], ['legacy', l]] as const) {
    const roles = (await db.from('user_roles').select('id').eq('user_id', row.id as string)).data || [];
    if (roles.length) diffs.push({ kind: 'count', key: `${label}-roles`, legacy: 0, native: roles.length });
  }
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'write-readback', title: '新註冊者人員資料', legacy: { endpoint: 'auth 建立使用者（舊版 signUp 同路徑）' }, native: { endpoint: 'POST /api/workspace/auth/register' }, compared: { columns: Object.keys(n).length }, diffs }),
  );
  expect(diffs).toEqual([]);
});

test('Q15 沒有角色的帳號登入後：舊版沒有任何說明，新版 session 回報待開通', async () => {
  const e = entry('pending-activation-page');
  const user = await createAuthUser(`w22-par-pending-${uniq()}`);
  const api = await pwRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
  expect((await api.post('/api/workspace/login', { data: { email: user.email, password: user.password } })).status()).toBe(200);
  const session = await (await api.get('/api/workspace/session')).json();
  await api.dispose();
  const legacyHas = ['app/page.tsx', 'app/dashboard/page.tsx', 'app/layout.tsx'].some((f) => fs.existsSync(path.join(ROOT, f)) && /待管理員|待開通/.test(read(f)));
  const diffs: Diff[] = [];
  if (session.pendingActivation === true && !legacyHas) diffs.push({ kind: 'only-native', key: 'pending-activation-page', native: '帳號待管理員開通' });
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'ui-extract', title: '待開通說明頁', legacy: { endpoint: '舊版首頁（無提示）' }, native: { endpoint: 'GET /api/workspace/session', status: 200 }, compared: { users: 1 }, diffs }),
  );
  expect(session.pendingActivation).toBe(true);
});

test('註冊成功提示與重設成功後的登入狀態：和舊版不同的地方', () => {
  const regLegacy = read('app/register/page.tsx');
  expect(regLegacy).toContain("alert('✅ 註冊成功！請登入。')");
  assertNoUnlistedDiffs(
    rec.record({
      entry: entry('register-success-text').id,
      mechanism: 'ui-extract',
      title: '註冊成功提示',
      legacy: { endpoint: 'app/register/page.tsx' },
      native: { endpoint: 'register route' },
      compared: { texts: 1 },
      diffs: [{ kind: 'changed', key: 'register-success-text', legacy: '✅ 註冊成功！請登入。（alert）', native: '註冊完成…需管理員開通角色（頁面內提示）' }],
    }),
  );
  const resetLegacy = read('app/reset-password/page.tsx');
  const resetNative = read('vue-workspace/src/pages/ResetPassword.vue');
  expect(resetLegacy).not.toMatch(/signOut/);
  expect(resetNative).toContain('api("logout"');
  assertNoUnlistedDiffs(
    rec.record({
      entry: entry('reset-session-after-success').id,
      mechanism: 'ui-extract',
      title: '重設成功後的登入狀態',
      legacy: { endpoint: 'app/reset-password/page.tsx' },
      native: { endpoint: 'ResetPassword.vue' },
      compared: { flows: 1 },
      diffs: [{ kind: 'changed', key: 'reset-clears-session', legacy: '保留重設用的登入狀態', native: '先登出再轉登入頁' }],
    }),
  );
});

test('/auth/callback：next 參數導向與失敗訊息（舊版可導去外部網站、網址帶英文原文）', async () => {
  const e = entry('callback-guard');
  // 舊版 app/auth/callback/route.ts 的凍結副本（W22 改動前，commit 0e34b032）：該檔本身已被 W22 修改，所以不能再從檔案讀。
  const LEGACY_CALLBACK = [
    "const next = requestUrl.searchParams.get('next') || '/reset-password';",
    'new URL(`/reset-password?error=${encodeURIComponent(error.message)}`, requestUrl.origin)',
    'return NextResponse.redirect(new URL(next, requestUrl.origin));',
  ];
  expect(LEGACY_CALLBACK).toHaveLength(3);
  const current = read('app/auth/callback/route.ts');
  expect(current).toContain('safeInternalPath'); // 新版已改；舊版行為以上方凍結副本重現
  const origin = 'http://localhost:3002';
  const diffs: Diff[] = [];
  for (const next of ['/reset-password', '/somewhere', '//evil.example/x', 'https://evil.example/x', '/\\evil.example']) {
    const legacy = new URL(next, origin).href;
    const native = new URL(safeInternalPath(next) || '/reset-password', origin).href;
    if (legacy !== native) diffs.push({ kind: 'changed', key: `callback-next#${next}`, legacy, native });
  }
  // 實際呼叫：換取失敗時只帶固定中文
  const api = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  const res = await api.get('/auth/callback?code=bogus-code&next=%2F%2Fevil.example', { maxRedirects: 0 });
  const loc = new URL(res.headers().location);
  await api.dispose();
  expect(loc.origin).toBe(origin);
  const nativeError = decodeURIComponent(loc.searchParams.get('error') || '');
  diffs.push({ kind: 'changed', key: 'callback-error-text', legacy: 'Supabase error.message（英文原文）', native: nativeError });
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'ui-extract', title: '/auth/callback', legacy: { endpoint: 'app/auth/callback/route.ts' }, native: { endpoint: 'GET /auth/callback', status: res.status() }, compared: { cases: 5 }, diffs }),
  );
  expect(nativeError).toBe('重設連結已失效或已使用過，請重新申請');
});

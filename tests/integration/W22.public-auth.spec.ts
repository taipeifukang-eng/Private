import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { adminDb, cleanupM5Users, assertAuthMailMock } from '../support/m5-fixtures';
import { createAuthUser, createPlainRole, grantRole } from '../support/m5-org-fixtures';
import { TEST_ORIGIN } from '../support/auth';

// W22 整合層：登入、註冊、忘記密碼、重設密碼的 API（Q15 保留公開註冊、Q16 最短 6 字元、忘記密碼一律同一句話）。
// 信件一律 mock（D17）：測試站以 WORKSPACE_AUTH_MAIL_MOCK=true 啟動，m5p-test-*@example.test 不寄任何信。
// 資料：m5p-test-w22-* 帳號（密碼隨機、只在記憶體）與 m5p_test_w22plain 角色；結束時只刪自己建立的資料。

const mail = (tag: string) => `m5p-test-w22-${tag}@example.test`;
const pw = () => `${Math.random().toString(36).slice(2, 10)}Aa1`;
let plainRole: { id: string; code: string; name: string };

/** 帶 Origin 的匿名 client（公開頁的瀏覽器就是這樣呼叫）。 */
async function anon(): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
}
async function loginAs(email: string, password: string) {
  const c = await anon();
  const r = await c.post('/api/workspace/login', { data: { email, password } });
  return { client: c, status: r.status() };
}
const post = (c: APIRequestContext, path: string, data: unknown) => c.post(`/api/workspace/auth/${path}`, { data });

test.beforeAll(async () => {
  await assertAuthMailMock(TEST_ORIGIN);
  test.setTimeout(120_000);
  const left = await cleanupM5Users();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  plainRole = await createPlainRole('w22plain');
});
test.afterAll(async () => {
  expect(await cleanupM5Users(), '清除帳號與角色').toEqual([]);
});

test('註冊欄位驗證：訊息為中文，且不會建立任何帳號', async () => {
  const c = await anon();
  const base = { fullName: '測試', email: mail('invalid'), password: 'abcdef', confirmPassword: 'abcdef' };
  const cases: [Record<string, unknown>, string][] = [
    [{ ...base, fullName: '' }, '請輸入姓名'],
    [{ ...base, email: 'not-an-email' }, '請輸入有效的電子郵件'],
    [{ ...base, password: '12345', confirmPassword: '12345' }, '密碼至少需要 6 個字元'],
    [{ ...base, confirmPassword: 'abcdeg' }, '密碼不一致'],
    [{ ...base, password: 'a'.repeat(73), confirmPassword: 'a'.repeat(73) }, '最多'],
  ];
  for (const [data, text] of cases) {
    const r = await post(c, 'register', data);
    expect(r.status(), text).toBe(400);
    expect((await r.json()).error).toContain(text);
  }
  const { data } = await adminDb().from('profiles').select('id').eq('email', mail('invalid'));
  expect(data || []).toEqual([]);
  await c.dispose();
});

test('Q16 密碼最短 6 字元：5 字元被擋、剛好 6 字元可以註冊並登入', async () => {
  const c = await anon();
  const email = mail('six');
  const five = await post(c, 'register', { fullName: 'W22 six', email, password: 'abcde', confirmPassword: 'abcde' });
  expect(five.status()).toBe(400);
  const six = await post(c, 'register', { fullName: 'W22 six', email, password: 'abcdef', confirmPassword: 'abcdef' });
  expect(six.status()).toBe(200);
  expect((await six.json()).success).toBe(true);
  const l = await loginAs(email, 'abcdef');
  expect(l.status).toBe(200);
  await l.client.dispose();
  await c.dispose();
});

test('Q15 新註冊者：有帳號與人員資料、預設沒有任何角色；session 回報待開通，開通後恢復', async () => {
  const c = await anon();
  const email = mail('pending');
  const password = pw();
  const r = await post(c, 'register', { fullName: 'W22 待開通', email, password, confirmPassword: password });
  expect(r.status()).toBe(200);
  const db = adminDb();
  const prof = (await db.from('profiles').select('id,email,full_name,role').eq('email', email).single()).data;
  expect(prof, '建立了人員資料').toBeTruthy();
  expect(prof.full_name).toBe('W22 待開通');
  const roles = (await db.from('user_roles').select('id').eq('user_id', prof.id)).data || [];
  expect(roles, '沒有任何角色指派').toEqual([]);
  expect(prof.role).not.toBe('admin');

  const l = await loginAs(email, password);
  expect(l.status).toBe(200);
  const s1 = await (await l.client.get('/api/workspace/session')).json();
  expect(s1.pendingActivation).toBe(true);
  expect(s1.permissions).toEqual([]);

  await grantRole(prof.id, plainRole.id);
  const s2 = await (await l.client.get('/api/workspace/session')).json();
  expect(s2.pendingActivation).toBe(false);

  // 指派被停用後又回到待開通
  await db.from('user_roles').update({ is_active: false }).eq('user_id', prof.id);
  const s3 = await (await l.client.get('/api/workspace/session')).json();
  expect(s3.pendingActivation).toBe(true);
  await l.client.dispose();
  await c.dispose();
});

test('Q15 舊式身分為管理員的帳號不是待開通；使用者管理的待開通判定與 session 一致', async () => {
  const admin = await createAuthUser('w22-admin', { profileRole: 'admin' });
  const l = await loginAs(admin.email, admin.password);
  expect(l.status).toBe(200);
  expect((await (await l.client.get('/api/workspace/session')).json()).pendingActivation).toBe(false);
  await l.client.dispose();
});

test('重複註冊：回中文提示（409），不會建立第二個帳號', async () => {
  const c = await anon();
  const email = mail('dup');
  const password = pw();
  expect((await post(c, 'register', { fullName: 'W22 dup', email, password, confirmPassword: password })).status()).toBe(200);
  const again = await post(c, 'register', { fullName: 'W22 dup2', email, password, confirmPassword: password });
  expect(again.status()).toBe(409);
  const text = (await again.json()).error as string;
  expect(text).toContain('已經註冊');
  expect(text).not.toMatch(/[A-Za-z]{4,}/);
  const { data } = await adminDb().from('profiles').select('id').eq('email', email);
  expect(data).toHaveLength(1);
  await c.dispose();
});

test('公開 POST 一律要求 Origin（跨站送出被擋）', async () => {
  const noOrigin = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  const evil = await pwRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: 'https://evil.example' } });
  for (const c of [noOrigin, evil]) {
    for (const [path, data] of [
      ['register', { fullName: 'x', email: mail('origin'), password: 'abcdef', confirmPassword: 'abcdef' }],
      ['forgot-password', { email: mail('origin') }],
      ['reset-password', { password: 'abcdef', confirmPassword: 'abcdef' }],
    ] as const) {
      const r = await post(c, path, data);
      expect(r.status(), path).toBe(403);
    }
  }
  const { data } = await adminDb().from('profiles').select('id').eq('email', mail('origin'));
  expect(data || []).toEqual([]);
  await noOrigin.dispose();
  await evil.dispose();
});

test('忘記密碼：已註冊與未註冊的信箱回應完全相同（不透露帳號是否存在）；格式錯誤才回 400', async () => {
  const known = await createAuthUser('w22-known');
  const c = await anon();
  const a = await post(c, 'forgot-password', { email: known.email });
  const b = await post(c, 'forgot-password', { email: mail('nobody-here') });
  expect(a.status()).toBe(200);
  expect(b.status()).toBe(a.status());
  expect(await b.text()).toBe(await a.text());
  expect((await a.json()).message).toContain('若此信箱已註冊');
  for (const bad of ['', 'abc', 'a@b', 123]) {
    const r = await post(c, 'forgot-password', { email: bad });
    expect(r.status(), String(bad)).toBe(400);
  }
  await c.dispose();
});

test('重設密碼：沒有登入狀態（連結失效）回 401 中文；有登入狀態時 Q16 規則與成功後舊密碼失效', async () => {
  const c = await anon();
  expect((await (await c.get('/api/workspace/auth/reset-password')).json()).valid).toBe(false);
  const none = await post(c, 'reset-password', { password: 'abcdef', confirmPassword: 'abcdef' });
  expect(none.status()).toBe(401);
  expect((await none.json()).error).toContain('已失效');
  await c.dispose();

  const user = await createAuthUser('w22-reset');
  const l = await loginAs(user.email, user.password);
  expect(l.status).toBe(200);
  const s = l.client;
  expect((await (await s.get('/api/workspace/auth/reset-password')).json()).valid).toBe(true);
  const short = await post(s, 'reset-password', { password: '12345', confirmPassword: '12345' });
  expect(short.status()).toBe(400);
  expect((await short.json()).error).toBe('密碼長度至少需要 6 個字元');
  const mismatch = await post(s, 'reset-password', { password: 'abcdef', confirmPassword: 'abcdeg' });
  expect(mismatch.status()).toBe(400);
  expect((await mismatch.json()).error).toBe('兩次輸入的密碼不一致');

  const fresh = pw();
  const ok = await post(s, 'reset-password', { password: fresh, confirmPassword: fresh });
  expect(ok.status()).toBe(200);
  await s.dispose();
  expect((await loginAs(user.email, user.password)).status, '舊密碼失效').toBe(401);
  const again = await loginAs(user.email, fresh);
  expect(again.status, '新密碼可登入').toBe(200);
  await again.client.dispose();
});

test('登入錯誤訊息是中文，帳號不存在與密碼錯誤的訊息相同', async () => {
  const user = await createAuthUser('w22-wrong');
  const a = await anon();
  const wrong = await a.post('/api/workspace/login', { data: { email: user.email, password: 'definitely-wrong-1' } });
  const none = await a.post('/api/workspace/login', { data: { email: mail('no-such-user'), password: 'definitely-wrong-1' } });
  expect(wrong.status()).toBe(401);
  expect(none.status()).toBe(401);
  const [x, y] = [(await wrong.json()).error as string, (await none.json()).error as string];
  expect(x).toBe(y);
  expect(x).toContain('帳號或密碼不正確');
  await a.dispose();
});

test('/auth/callback：沒有 code 回登入頁；換取失敗回重設頁並只帶固定中文；next 不能導去外部網站', async () => {
  const c = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  const none = await c.get('/auth/callback', { maxRedirects: 0 });
  expect(none.status()).toBe(307);
  expect(new URL(none.headers().location).pathname).toBe('/login');
  for (const next of ['//evil.example', 'https://evil.example', '/\\evil.example']) {
    const r = await c.get(`/auth/callback?code=bogus-code&next=${encodeURIComponent(next)}`, { maxRedirects: 0 });
    expect(r.status(), next).toBe(307);
    const loc = new URL(r.headers().location);
    expect(loc.origin, next).toBe(TEST_ORIGIN);
    expect(loc.pathname).toBe('/reset-password');
    expect(decodeURIComponent(loc.searchParams.get('error') || '')).toBe('重設連結已失效或已使用過，請重新申請');
  }
  await c.dispose();
});

test('D14：四個原網址轉到新版公開頁，登入頁保留 redirect、其他參數丟棄', async () => {
  const c = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  const target = async (p: string) => {
    const r = await c.get(p, { maxRedirects: 0 });
    expect(r.status(), p).toBe(307);
    return new URL(r.headers().location).pathname + new URL(r.headers().location).hash + new URL(r.headers().location).search;
  };
  expect(await target('/register')).toBe('/workspace/index.html#/register');
  expect(await target('/forgot-password')).toBe('/workspace/index.html#/forgot-password');
  expect(await target('/reset-password')).toBe('/workspace/index.html#/reset-password');
  expect(await target('/login')).toBe('/workspace/index.html#/login');
  expect(await target('/login?redirect=%2Fgeneral-affairs%2Fassets%2Fscan%2Fabc&x=1')).toBe('/workspace/index.html#/login?redirect=%2Fgeneral-affairs%2Fassets%2Fscan%2Fabc');
  await c.dispose();
});

test('未登入呼叫 session 回 401（登入面板停在登入頁）', async () => {
  const c = await anon();
  expect((await c.get('/api/workspace/session')).status()).toBe(401);
  await c.dispose();
});

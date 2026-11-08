import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { resolveWorkspacePublicRedirect, WORKSPACE_PUBLIC_REDIRECTS } from '@/lib/workspace/public-routes';
import { MIN_PASSWORD_LENGTH } from '@/lib/workspace/auth-public';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('W22 D14：原網址轉址到 Vue 公開頁', () => {
  it('四個公開頁都登錄，原路徑不變', () => {
    const legacy = WORKSPACE_PUBLIC_REDIRECTS.map((r) => r.legacy);
    for (const p of ['/login', '/register', '/forgot-password', '/reset-password']) expect(legacy).toContain(p);
  });
  it('轉址目標是 hash 路由', () => {
    expect(resolveWorkspacePublicRedirect('/register')).toBe('/workspace/index.html#/register');
    expect(resolveWorkspacePublicRedirect('/forgot-password')).toBe('/workspace/index.html#/forgot-password');
    expect(resolveWorkspacePublicRedirect('/reset-password')).toBe('/workspace/index.html#/reset-password');
    expect(resolveWorkspacePublicRedirect('/login')).toBe('/workspace/index.html#/login');
    expect(resolveWorkspacePublicRedirect('/login/')).toBe('/workspace/index.html#/login');
  });
  it('登入頁帶 redirect（QR 掃描情境），其他參數丟棄', () => {
    const t = resolveWorkspacePublicRedirect('/login', undefined, '?redirect=%2Fgeneral-affairs%2Fassets%2Fscan%2Fabc&x=1&utm=2');
    expect(t).toBe('/workspace/index.html#/login?redirect=%2Fgeneral-affairs%2Fassets%2Fscan%2Fabc');
  });
  it('重設頁只帶 error；註冊與忘記密碼不帶任何參數', () => {
    expect(resolveWorkspacePublicRedirect('/reset-password', undefined, '?error=abc&redirect=/x')).toBe('/workspace/index.html#/reset-password?error=abc');
    expect(resolveWorkspacePublicRedirect('/register', undefined, '?redirect=/x&error=1')).toBe('/workspace/index.html#/register');
    expect(resolveWorkspacePublicRedirect('/forgot-password', undefined, '?email=a@b.co')).toBe('/workspace/index.html#/forgot-password');
  });
  it('參數過長不帶；沒有參數不加問號', () => {
    expect(resolveWorkspacePublicRedirect('/login', undefined, '?redirect=' + '/a'.repeat(300))).toBe('/workspace/index.html#/login');
    expect(resolveWorkspacePublicRedirect('/login', undefined, '')).toBe('/workspace/index.html#/login');
  });
  it('/auth/callback 與 /logout 之類不轉址（重設信連結路徑維持不變）', () => {
    for (const p of ['/auth/callback', '/logout', '/loginx']) expect(resolveWorkspacePublicRedirect(p), p).toBeNull();
  });
  it('middleware 把查詢字串傳進轉址，且仍限 DEV 工作台環境', () => {
    const m = read('middleware.ts');
    expect(m).toContain('request.nextUrl.search');
    expect(m).toMatch(/if \(isDevWorkspace\) \{[\s\S]*resolveWorkspacePublicRedirect/);
  });
});

describe('W22 公開頁與登入面板結構', () => {
  const login = read('vue-workspace/src/components/LoginForm.vue');
  const shell = read('vue-workspace/src/components/PublicShell.vue');
  const app = read('vue-workspace/src/App.vue');
  it('登入面板：忘記密碼連結、註冊連結（Q15 取代原「不放註冊連結」）', () => {
    expect(login).toContain('href="#/forgot-password"');
    expect(login).toContain('href="#/register"');
    expect(login).toContain('忘記密碼');
    expect(login).toContain('立即註冊');
  });
  it('登入面板不放門市數量，也不再寫「測試環境／測試工作區」', () => {
    for (const text of [login, shell]) {
      expect(text).not.toMatch(/測試環境|測試工作區|測試區|與正式資料分離|間門市/);
    }
  });
  it('工作台未登入畫面改用共用登入面板（不再各寫一份）', () => {
    expect(app).toContain('<LoginForm');
    expect(app).not.toMatch(/測試環境|登入測試工作區/);
  });
  it('登入頁取 redirect 時只走 safeRedirectPath', () => {
    const page = read('vue-workspace/src/pages/Login.vue');
    expect(page).toContain('safeRedirectPath(route.query.redirect)');
    expect(page).not.toMatch(/location\.(assign|href)\s*\(?\s*=?\s*route\.query/);
  });
  it('註冊與重設頁的密碼長度來自共用常數（Q16 = 6）', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(6);
    expect(read('vue-workspace/src/pages/Register.vue')).toContain('MIN_PASSWORD_LENGTH');
    expect(read('vue-workspace/src/pages/ResetPassword.vue')).toContain('MIN_PASSWORD_LENGTH');
  });
  it('重設頁只顯示固定的失效文字，不顯示網址上的任意內容', () => {
    const page = read('vue-workspace/src/pages/ResetPassword.vue');
    expect(page).toContain('RESET_LINK_ERROR_TEXT');
    expect(page).not.toContain('{{ route.query');
    expect(page).not.toContain('v-html');
  });
  it('待開通說明頁：App.vue 依 session.pendingActivation 顯示，並有重新檢查與登出', () => {
    expect(app).toContain('session.data.pendingActivation');
    const pending = read('vue-workspace/src/components/PendingActivation.vue');
    expect(pending).toContain('PENDING_ACTIVATION_TITLE');
    expect(pending).toContain('重新檢查');
    expect(pending).toContain('登出');
  });
  it('四個公開頁都在 Vue 註冊表', () => {
    const pages = read('vue-workspace/src/workspace-pages.ts');
    for (const p of ['/login', '/register', '/forgot-password', '/reset-password']) expect(pages).toContain(`path: "${p}"`);
  });
});

describe('W22 伺服端結構', () => {
  it('重設信連結缺網站網址直接報錯，不再退回 localhost', () => {
    const route = read('app/api/workspace/auth/forgot-password/route.ts');
    expect(route).toContain('resetRedirectUrl(process.env.NEXT_PUBLIC_SITE_URL)');
    expect(route).not.toContain('localhost:3000');
  });
  it('callback：next 只允許站內路徑，失敗只帶固定文字', () => {
    const cb = read('app/auth/callback/route.ts');
    expect(cb).toContain('safeInternalPath');
    expect(cb).toContain('RESET_LINK_ERROR_TEXT');
    expect(cb).not.toContain('error.message)}');
  });
  it('公開 POST 路由都檢查 Origin 且在 DEV 工作台守衛內', () => {
    for (const r of ['register', 'forgot-password', 'reset-password']) {
      const src = read(`app/api/workspace/auth/${r}/route.ts`);
      expect(src, r).toContain('checkOrigin(request)');
      expect(src, r).toMatch(/assertWorkspace\(\)|sessionClient\(\)/);
    }
  });
  it('註冊路由不寫角色（新註冊者預設沒有任何角色，Q15）', () => {
    const src = read('app/api/workspace/auth/register/route.ts');
    const code = src.replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/user_roles|role_id|\.from\(|\.insert\(/);
  });
  it('信件 mock 只在測試站啟動器開旗標，程式預設不開', () => {
    expect(read('tests/support/start-test-server.cjs')).toContain("WORKSPACE_AUTH_MAIL_MOCK = 'true'");
    expect(read('app/api/workspace/auth/register/route.ts')).toContain('mailMockActive(process.env.WORKSPACE_AUTH_MAIL_MOCK');
  });
  it('session 路由回傳 pendingActivation；舊版 route handler 沒被改動 RBAC', () => {
    expect(read('app/api/workspace/session/route.ts')).toContain('pendingActivation: isPendingAccount(ctx)');
  });
});

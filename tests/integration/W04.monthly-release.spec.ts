import { expect, test } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';

// W04 整合層：版更頁沒有專屬 API，整合點是 /api/workspace/session。
// 每個角色（登入即可看）：capabilities.monthlyRelease 為 true、選單不含版更入口（規格 E，改由首頁卡片）；
// 未登入 401；工作台前端已打包此頁；舊頁 /monthly-release 對登入者與未登入者都回 200（舊版沒有登入檢查）。

const ROLES = ['admin', 'navigation', 'ops_manager', 'ops_assistant', 'supervisor', 'store_manager', 'pharmacist', 'employee', 'denied', 'monthly_view', 'performance_edit'];

for (const role of ROLES) {
  test(`session：${role} 可看版更頁`, async () => {
    const api = await apiAs(role);
    try {
      const res = await api.get('/api/workspace/session');
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.capabilities.monthlyRelease).toBe(true);
      // 規格 E：選單不放此入口，由工作台首頁卡片進入。
      const items = (body.navigation as Array<{ items: Array<{ href: string }> }>).flatMap((g) => g.items);
      expect(items.some((i) => i.href === '/monthly-release'), '選單不含版更入口').toBe(false);
    } finally {
      await api.dispose();
    }
  });
}

test('未登入：session 401', async ({ request }) => {
  const res = await request.get(`${TEST_ORIGIN}/api/workspace/session`);
  expect(res.status()).toBe(401);
});

test('舊頁 /monthly-release：登入者 200 且含 3 月公告；舊版未登入也能看（新版需登入，見 allowlist w04-login-required）', async ({ request }) => {
  const api = await apiAs('denied');
  try {
    const res = await api.get('/monthly-release');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('2026年3月 系統版更公告');
  } finally {
    await api.dispose();
  }
  // 舊頁沒有任何登入檢查（middleware 不擋、頁面是靜態內容），未登入照樣回 200 並含公告全文。
  const anon = await request.get(`${TEST_ORIGIN}/monthly-release`, { maxRedirects: 0 });
  expect(anon.status()).toBe(200);
  expect(await anon.text()).toContain('2026年3月 系統版更公告');
});

test('工作台前端已打包此頁（public/workspace 內含版更內文）', async ({ request }) => {
  const html = await (await request.get(`${TEST_ORIGIN}/workspace/index.html`)).text();
  const scripts = Array.from(html.matchAll(/src="([^"]+\.js)"/g), (m) => m[1]);
  expect(scripts.length).toBeGreaterThan(0);
  let found = false;
  for (const src of scripts) {
    const js = await (await request.get(new URL(src, `${TEST_ORIGIN}/workspace/`).toString())).text();
    if (js.includes('2026年3月 系統版更公告')) found = true;
  }
  expect(found).toBe(true);
});

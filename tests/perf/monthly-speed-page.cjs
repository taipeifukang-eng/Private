'use strict';
/**
 * 整頁時間：以 Playwright 開「每月人員狀態」，從點選單項目起算，到所有區塊出現且「載入」狀態消失為止。
 * 同時記錄這段時間內打了哪些 /api/workspace/monthly* 請求。
 *   node tests/perf/monthly-speed-page.cjs [--base http://localhost:3002] [--accounts store_manager,supervisor,admin] [--reps 5]
 * 預設門市／月份就是頁面一開始選的（名冊 API 回傳的預設門市，月份為頁面預設月份）。
 */
const { chromium, request } = require('@playwright/test');
const { getAccount } = require('../support/credentials.cjs');

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : def;
};
const BASE = opt('base', 'http://localhost:3002');
const ACCOUNTS = opt('accounts', 'store_manager,supervisor,admin').split(',');
const REPS = Number(opt('reps', '5'));
const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function storageFor(key) {
  const { email, password } = getAccount(key);
  for (let i = 0; i < 6; i += 1) {
    const c = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
    const l = await c.post('/api/workspace/login', { data: { email, password } });
    if (l.ok()) {
      const state = await c.storageState();
      await c.dispose();
      return state;
    }
    await c.dispose();
    await sleep(1500 * (i + 1));
  }
  throw new Error('login failed ' + key);
}

(async () => {
  const browser = await chromium.launch();
  const results = {};
  for (const key of ACCOUNTS) {
    const state = await storageFor(key);
    const runs = [];
    for (let i = 0; i < REPS; i += 1) {
      const ctx = await browser.newContext({ baseURL: BASE, storageState: state, viewport: { width: 1920, height: 1080 } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });
      const calls = [];
      let t0 = 0;
      page.on('response', (r) => {
        if (t0 && /\/api\/workspace\/monthly/.test(r.url())) calls.push(`${r.request().method()} ${new URL(r.url()).pathname.replace('/api/workspace/', '')}${new URL(r.url()).searchParams.get('op') ? '?op=' + new URL(r.url()).searchParams.get('op') : ''} @${Math.round(performance.now() - t0)}ms`);
      });
      await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
      await page.waitForSelector('.menu-toggle');
      await page.click('.menu-toggle');
      const item = page.locator('.workspace-menu button.catalog-item[title="每月人員狀態"]');
      await item.waitFor();
      t0 = performance.now();
      await item.click();
      await page.getByRole('heading', { name: '每月人員狀態', exact: true }).waitFor();
      // 需等到名冊請求真的送出並完成，避免在請求尚未開始前就誤判「沒有載入狀態」。
      await page.waitForResponse((r) => /\/api\/workspace\/monthly(\?|$)/.test(r.url()) && r.request().method() === 'GET' && !r.url().includes('op='), { timeout: 60_000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 60_000, polling: 'raf' });
      // 再確認連續 300ms 沒有新的載入狀態（MonthlyTools 在名冊回來後才可能出現載入）。
      await sleep(300);
      await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 60_000, polling: 'raf' });
      const total = Math.round(performance.now() - t0 - 300);
      const stats = await page.locator('.monthly-stats').count();
      runs.push({ total, calls: calls.slice(), stats, errors });
      await ctx.close();
    }
    results[key] = runs;
    console.log(key.padEnd(14), 'median', median(runs.map((r) => r.total)) + 'ms', 'all', runs.map((r) => r.total).join('/'), '| stats blocks', runs[0].stats, '| calls', runs[0].calls.join(' ; '), runs.some((r) => r.errors.length) ? '| console errors: ' + runs.flatMap((r) => r.errors).slice(0, 3).join(' | ') : '');
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

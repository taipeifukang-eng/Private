import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { apiAs, loginAs } from '../support/auth';
import {
  assertNoUnlistedDiffs,
  compareApiRead,
  compareTables,
  extractTableFromPage,
  loadMap,
  ParityRecorder,
  type ColumnSpec,
  type LegacyApiSource,
  type NativeApiSource,
} from '../support/parity';

// M0 樣本頁「關係會員」對等層：同資料、同角色，舊 API 與 workspace API 讀取比對、舊頁與新頁表格比對、導覽入口可見性。
// 只讀取。結果寫入 tests/reports/<runId>/parity-report.json。

type Account = { key: string; kind: string; permissions: string[] | 'ALL' };
const accounts = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'role-matrix.json'), 'utf8')) as { accounts: Account[] }).accounts;

const map = loadMap('relationships');
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const recorder = new ParityRecorder('relationships');
const LEGACY_HREF = '/store/relationship-members';
const ANY = ['relationship_member.view', 'relationship_member.edit', 'relationship_member.delete', 'relationship_member.approve'];

for (const account of accounts) {
  test(`關係會員 API 對等 ${account.key}`, async () => {
    const api = await apiAs(account.key);
    try {
      for (const id of ['members-list', 'sales-list']) {
        const e = entry(id);
        const result = await compareApiRead({
          recorder,
          entry: id,
          title: e.description || id,
          role: account.key,
          legacyApi: api,
          legacy: e.legacy.api as LegacyApiSource,
          native: e.native.api as NativeApiSource,
          rules: e.normalize,
          compareKey: e.compareKey,
        });
        assertNoUnlistedDiffs(result);
        expect(['pass', 'allowed']).toContain(result.status);
      }
    } finally {
      await api.dispose();
    }
  });

  test(`關係會員 導覽入口對等 ${account.key}`, async () => {
    const api = await apiAs(account.key);
    try {
      const permRes = await api.get('/api/permissions/user');
      expect(permRes.status()).toBe(200);
      const permissions = ((await permRes.json()).permissions || []) as string[];
      // 舊版規則：任一 relationship_member 權限即可進入。
      const legacyVisible = ANY.some((c) => permissions.includes(c));
      const session = await (await api.get('/api/workspace/session')).json();
      const nativeHrefs: string[] = session.navigation.flatMap((g: { items: { href: string }[] }) => g.items.map((i) => i.href));
      const nativeVisible = nativeHrefs.includes(LEGACY_HREF);
      const diffs =
        legacyVisible === nativeVisible
          ? []
          : [
              {
                kind: (legacyVisible ? 'only-legacy' : 'only-native') as 'only-legacy' | 'only-native',
                key: LEGACY_HREF,
                legacy: legacyVisible,
                native: nativeVisible,
                detail: `舊版${legacyVisible ? '可' : '不可'}進入，新版導覽${nativeVisible ? '有' : '沒有'}入口`,
              },
            ];
      const result = recorder.record({
        entry: 'nav-entry',
        mechanism: 'navigation',
        role: account.key,
        title: '關係會員入口可見性：舊權限規則 vs 新版 session navigation',
        legacy: { endpoint: '/api/permissions/user 任一 relationship_member.* 權限' },
        native: { endpoint: '/api/workspace/session navigation' },
        compared: { legacyVisible, nativeVisible },
        diffs,
      });
      assertNoUnlistedDiffs(result);
      expect(['pass', 'allowed']).toContain(result.status);
    } finally {
      await api.dispose();
    }
  });
}

const columns = entry('members-table').columns as ColumnSpec[];
const emptyMarks = new Set(['待填寫', '尚未填寫', '-', '—']);
const clean = (v: string) => (emptyMarks.has(v.trim()) ? '' : v.trim());
const cleanRow = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, clean(String(v ?? ''))]));

async function nativeRows(page: Page): Promise<Record<string, string>[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.relationship-page table tbody tr'))
      .filter((tr) => tr.querySelectorAll('td').length >= 5)
      .map((tr) => {
        const td = Array.from(tr.querySelectorAll('td'));
        const t = (el: Node | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
        return {
          姓名: t(td[0].querySelector('strong')),
          電話: t(td[0].querySelector('small')),
          關係: t(td[1]),
          填表人: t(td[3].firstChild),
          會員編號: t(td[2]),
        };
      }),
  );
}

test('關係會員 舊頁與新頁表格對等（admin）', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const legacyPage = await ctx.newPage();
    await legacyPage.goto('/store/relationship-members', { waitUntil: 'networkidle' });
    await legacyPage.waitForSelector('table thead th');
    await legacyPage.waitForFunction(() => !document.querySelector('table tbody .animate-spin'), undefined, { timeout: 30_000 });
    const legacyRaw = await extractTableFromPage(legacyPage, { rowSelector: 'table:first-of-type tbody tr', headerSelector: 'table:first-of-type thead th' });
    const legacyRows = legacyRaw.filter((r) => r['電話'] !== undefined && r['姓名'] && !/沒有|查無|尚無/.test(r['姓名']));

    const nativePage = await ctx.newPage();
    await nativePage.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await nativePage.click('.menu-toggle');
    await nativePage.locator('.workspace-menu button.catalog-item[title="關係會員"]').click();
    await expect(nativePage.getByRole('heading', { name: '關係會員', exact: true })).toBeVisible();
    await nativePage.waitForFunction(() => !/載入中/.test(document.querySelector('.toolbar span')?.textContent || ''));

    const result = compareTables({
      recorder,
      entry: 'members-table',
      title: '舊頁表格 vs 新頁表格（逐欄）',
      role: 'admin',
      legacySource: '/store/relationship-members table',
      nativeSource: '/workspace 關係會員 table',
      legacyRows: legacyRows.map(cleanRow),
      nativeRows: (await nativeRows(nativePage)).map(cleanRow),
      columns,
      key: ['name', 'phone', 'number'],
    });
    assertNoUnlistedDiffs(result);
    expect(['pass', 'allowed']).toContain(result.status);
  } finally {
    await ctx.close();
  }
});

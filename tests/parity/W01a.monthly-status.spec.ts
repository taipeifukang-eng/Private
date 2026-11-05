import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import {
  assertNoUnlistedDiffs,
  compareApiRead,
  compareSideEffects,
  compareTables,
  loadMap,
  ParityRecorder,
  readRowsAsServiceRole,
  type ColumnSpec,
  type LegacyApiSource,
  type NativeApiSource,
} from '../support/parity';
import { addManual, ensureSummary, readMonth, registerFixtureRows, saveRow, staffCode, testStoreIds } from '../support/w01a-fixtures';

// W01a 對等層：同角色、同月份，舊 /monthly-status 與新「每月人員狀態」的總覽（統計卡片、門市頁籤）、名冊、業績明細，
// 以及兩項已知的行為差異（已送審可否刪除、送審前檢查的呈現）。結果寫入 tests/reports/<runId>/parity-report.json。
// 資料只用 ZT 測試門市與保留月份 2099-07（草稿）、2099-08（已送審）。

const map = loadMap('monthly-status');
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const recorder = new ParityRecorder('monthly-status');
const M_DRAFT = '2099-07';
const M_SUBMITTED = '2099-08';
const ROLES_UI = ['admin', 'store_manager', 'supervisor', 'ops_manager'];
const ROLES_ROSTER = ['admin', 'store_manager', 'supervisor'];

const col = (canonical: string, type: ColumnSpec['type'] = 'string'): ColumnSpec => ({ canonical, legacy: canonical, type });
const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

let admin: APIRequestContext;
let zt01 = '';
let zt02 = '';
const codes = { n: '', p: '', b: '', d1: '', d2: '', t: '' };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  admin = await apiAs('admin');
  const stores = await testStoreIds(admin, M_DRAFT);
  zt01 = stores.ZT01;
  zt02 = stores.ZT02;
  codes.n = staffCode('N');
  codes.p = staffCode('P');
  codes.b = staffCode('B');
  codes.d1 = staffCode('1');
  codes.d2 = staffCode('2');
  codes.t = staffCode('T');
  for (const month of [M_DRAFT, M_SUBMITTED]) {
    await addManual(admin, zt01, month, { name: 'PAR 專員', code: codes.n });
    await addManual(admin, zt01, month, { name: 'PAR 兼職', code: codes.p, position: '兼職專員', employment_type: 'part_time', work_hours: 0, work_days: 0 });
    await addManual(admin, zt01, month, { name: 'PAR 新人', code: codes.b, position: '新人', newbie_level: '一階新人' });
    if (month === M_SUBMITTED) {
      await addManual(admin, zt01, month, { name: 'PAR 刪一', code: codes.d1 });
      await addManual(admin, zt01, month, { name: 'PAR 刪二', code: codes.d2 });
    }
    await addManual(admin, zt02, month, { name: 'PAR 二店', code: codes.t });
    await ensureSummary(admin, zt01, month);
    await ensureSummary(admin, zt02, month);
    const { body } = await readMonth(admin, zt01, month);
    const rec = (code: string) => body.records.find((r: any) => r.employee_code === code);
    await saveRow(admin, zt01, month, rec(codes.n), { has_manager_bonus: true, is_pharmacist: true, extra_tasks: ['長照外務'], extra_task_external_hours: 5 });
    // 新人到職在月份前 2 個月、目前一階 -> 應該過二階段
    await saveRow(admin, zt01, month, rec(codes.b), { start_date: month === M_DRAFT ? '2099-05-01' : '2099-06-01', newbie_level: '一階新人' });
    await registerFixtureRows(zt01, month);
    await registerFixtureRows(zt02, month);
  }
  // 2099-07：ZT02 送審（頁籤狀態有「已提交」與「填寫中」兩種）；2099-08：兩間都送審
  expect((await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: zt02, month: M_DRAFT, skipChecks: true } })).status()).toBe(200);
  for (const store of [zt01, zt02]) {
    expect((await admin.post('/api/workspace/monthly', { data: { action: 'submit', store, month: M_SUBMITTED, skipChecks: true } })).status()).toBe(200);
  }
});

test.afterAll(async () => {
  await admin?.dispose();
});

// ---------------------------------------------------------------------------
// 擷取：舊頁（React）與新頁（Vue）
// ---------------------------------------------------------------------------

async function openLegacy(page: Page, month: string, store?: string) {
  await page.goto(`/monthly-status?year_month=${month}${store ? `&store_id=${store}` : ''}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('.animate-spin'), undefined, { timeout: 30_000 });
  await page.waitForTimeout(800);
}

async function openNative(page: Page, month: string, storeLabel?: string) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="每月人員狀態"]').click();
  await expect(page.getByRole('heading', { name: '每月人員狀態', exact: true })).toBeVisible();
  await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
  if (storeLabel) await page.getByLabel('門市', { exact: true }).selectOption({ label: storeLabel });
  await page.getByLabel('月份').fill(month);
  await page.getByRole('button', { name: '查詢人員' }).click();
  await page.waitForFunction(() => !document.querySelector('[role=status]'), undefined, { timeout: 30_000 });
}

const LEGACY_STATUS: Record<string, string> = { 已確認: 'confirmed', 已提交: 'submitted', 填寫中: 'in_progress', 待填寫: 'pending' };

async function legacyStats(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('p.text-3xl')).map((p) => ({
      card: (p.previousElementSibling?.textContent || '').trim(),
      value: (p.textContent || '').trim(),
    })),
  );
}
async function nativeStats(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.monthly-stats .stat-card')).map((c) => ({
      card: (c.querySelector('span')?.textContent || '').trim(),
      value: (c.querySelector('strong')?.textContent || '').trim(),
    })),
  );
}
async function legacyTabs(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('div.overflow-x-auto > button')).map((b) => {
      const spans = Array.from(b.querySelectorAll('span'));
      return { store: (spans[0]?.textContent || '').trim(), status: (spans[spans.length - 1]?.textContent || '').trim() };
    }),
  );
}
async function nativeTabs(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.store-tabs [role=tab]')).map((b) => ({
      store: (b.querySelector('span')?.textContent || '').trim(),
      status: (b.querySelector('em')?.textContent || '').trim(),
    })),
  );
}

const NUM = (s: string) => {
  const t = s.replace(/[$,%\s]/g, '');
  return /^[-—]*$/.test(t) || t === '?' ? '' : t;
};

async function legacyRoster(page: Page) {
  return page.evaluate(() => {
    const text = (el: Node | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const rows = Array.from(document.querySelectorAll('tbody tr')).filter((tr) => tr.querySelector('div[title="點擊查看異動歷程"]'));
    return rows.map((tr) => {
      const td = Array.from(tr.children) as HTMLElement[];
      const nameDiv = td[0].querySelector('div[title="點擊查看異動歷程"]')!;
      const name = Array.from(nameDiv.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join('')
        .trim();
      const perf = td.length >= 14;
      const buttons = Array.from(td[td.length - 1].querySelectorAll('button')).map((b) => text(b));
      return {
        code: text(td[0].querySelector('.text-sm.text-gray-500')),
        name,
        manual: text(nameDiv).includes('手動新增'),
        position: text(td[1]),
        employment: text(td[2]).includes('兼職') ? '兼職' : '正職',
        pharmacist: text(td[2]).includes('藥師'),
        start: text(td[3]),
        monthlyStatus: text(td[4]),
        workload: text(td[5]),
        tags: Array.from(td[6].querySelectorAll('div > span')).map((s) => text(s)),
        perf,
        bonus: perf ? text(td[7]) : '',
        block: perf ? text(td[8]) : '',
        tx: perf ? text(td[9]) : '',
        sales: perf ? text(td[10]) : '',
        gp: perf ? text(td[11]) : '',
        rate: perf ? text(td[12]) : '',
        canEdit: buttons.includes('編輯'),
        canDelete: buttons.some((b) => b.includes('刪除')),
      };
    });
  });
}

async function nativeRoster(page: Page) {
  return page.evaluate(() => {
    const text = (el: Node | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('tr[data-staff]')).map((tr) => {
      const td = Array.from(tr.children) as HTMLElement[];
      const perf = td.length >= 13;
      const buttons = Array.from(td[td.length - 1].querySelectorAll('button')).map((b) => text(b));
      const gpTexts = perf ? Array.from(td[10].childNodes).filter((n) => n.nodeType === 3).map((n) => text(n)).filter(Boolean) : [];
      return {
        code: (tr as HTMLElement).dataset.staff || '',
        name: text(td[0].querySelector('strong')),
        manual: !!td[0].querySelector('.manual-tag'),
        position: text(td[1]),
        employment: text(td[2]).includes('兼職') ? '兼職' : '正職',
        pharmacist: text(td[2]).includes('藥師'),
        start: (text(td[2]).match(/\d{4}-\d{2}-\d{2}/) || [''])[0],
        monthlyStatus: text(td[3]),
        workload: text(td[4]),
        tags: Array.from(td[5].querySelectorAll('.tag')).map((s) => text(s)),
        perf,
        bonus: perf ? text(td[6]) : '',
        block: perf ? text(td[7]) : '',
        tx: perf ? text(td[8]) : '',
        sales: perf ? text(td[9]) : '',
        gp: gpTexts[0] || '',
        rate: gpTexts[1] || '',
        canEdit: buttons.includes('編輯'),
        canDelete: buttons.includes('刪除'),
      };
    });
  });
}

type RawRow = Awaited<ReturnType<typeof legacyRoster>>[number];
function canonicalRoster(r: RawRow) {
  const levelMatch = r.position.match(/[（(]([^）)]*)[）)]/);
  return {
    code: r.code,
    name: norm(r.name),
    position: norm(r.position.replace(/[（(][^）)]*[）)]/, '')),
    level: levelMatch ? levelMatch[1] : '',
    employment: r.employment,
    pharmacist: r.pharmacist ? 'Y' : 'N',
    start: r.start.replace(/\//g, '-').replace(/^[-—]$/, ''),
    monthlyStatus: norm(r.monthlyStatus),
    workload: norm(r.workload),
    tags: [...r.tags].map(norm).sort().join('|'),
    manual: r.manual ? 'Y' : 'N',
    bonus: NUM(r.bonus),
    block: r.block.replace(/區塊|\s/g, '').replace('?', '').replace(/^[-—]$/, ''),
    tx: NUM(r.tx),
    sales: NUM(r.sales),
    gp: NUM(r.gp),
    rate: NUM(r.rate),
    canEdit: r.canEdit ? 'Y' : 'N',
    canDelete: r.canDelete ? 'Y' : 'N',
  };
}
const ROSTER_COLUMNS: ColumnSpec[] = ['code', 'name', 'position', 'level', 'employment', 'pharmacist', 'start', 'monthlyStatus', 'workload', 'tags', 'manual', 'bonus', 'block', 'tx', 'sales', 'gp', 'rate', 'canEdit', 'canDelete'].map((c) => col(c));

// ---------------------------------------------------------------------------
// 1. 總覽：統計卡片與門市頁籤
// ---------------------------------------------------------------------------

for (const role of ROLES_UI) {
  test(`統計卡片與門市頁籤對等 ${role}`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await loginAs(browser, role);
    try {
      for (const month of [M_DRAFT, M_SUBMITTED]) {
        const legacy = await ctx.newPage();
        await openLegacy(legacy, month);
        const native = await ctx.newPage();
        await openNative(native, month);

        const stats = compareTables({
          recorder,
          entry: 'stats-cards',
          title: `統計卡片 ${month}`,
          role,
          legacySource: entry('stats-cards').legacy.ui!.route,
          nativeSource: entry('stats-cards').native.source!,
          legacyRows: await legacyStats(legacy),
          nativeRows: await nativeStats(native),
          columns: [col('card'), col('value', 'number')],
          key: 'card',
        });
        assertNoUnlistedDiffs(stats);
        expect(['pass', 'allowed', 'pending-approval']).toContain(stats.status);

        const tabs = compareTables({
          recorder,
          entry: 'store-tabs',
          title: `門市頁籤 ${month}`,
          role,
          legacySource: entry('store-tabs').legacy.ui!.route,
          nativeSource: entry('store-tabs').native.source!,
          legacyRows: await legacyTabs(legacy),
          nativeRows: await nativeTabs(native),
          columns: [col('store'), col('status')],
          key: 'store',
        });
        assertNoUnlistedDiffs(tabs);
        expect(['pass', 'allowed', 'pending-approval']).toContain(tabs.status);
        await legacy.close();
        await native.close();
      }
    } finally {
      await ctx.close();
    }
  });
}

// ---------------------------------------------------------------------------
// 2. 名冊（草稿與已送審）
// ---------------------------------------------------------------------------

for (const role of ROLES_ROSTER) {
  for (const [id, month] of [['roster-draft', M_DRAFT], ['roster-submitted', M_SUBMITTED]] as const) {
    test(`名冊對等 ${id} ${role}`, async ({ browser }) => {
      test.setTimeout(150_000);
      const ctx = await loginAs(browser, role);
      try {
        const legacy = await ctx.newPage();
        await openLegacy(legacy, month, zt01);
        await expect(legacy.locator('div[title="點擊查看異動歷程"]').first()).toBeVisible({ timeout: 30_000 });
        const native = await ctx.newPage();
        await openNative(native, month, 'ZT01 ZT 測試門市 01');
        await expect(native.locator('tr[data-staff]').first()).toBeVisible({ timeout: 30_000 });

        const rawLegacy = await legacyRoster(legacy);
        const legacyRows = (rawLegacy).filter((r) => r.code.startsWith('FKF9')).map(canonicalRoster);
        const nativeRows = (await nativeRoster(native)).filter((r) => r.code.startsWith('FKF9')).map(canonicalRoster);
        expect(legacyRows.length, '舊頁名冊列數').toBeGreaterThan(0);
        const result = compareTables({
          recorder,
          entry: id,
          title: `${month} ZT01 名冊逐欄`,
          role,
          legacySource: entry(id).legacy.ui!.route,
          nativeSource: entry(id).native.source!,
          legacyRows,
          nativeRows,
          columns: ROSTER_COLUMNS,
          key: 'code',
        });
        assertNoUnlistedDiffs(result);
        expect(['pass', 'allowed', 'pending-approval']).toContain(result.status);
      } finally {
        await ctx.close();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// 3. 各門市業績明細 API
// ---------------------------------------------------------------------------

for (const role of ['admin', 'store_manager', 'supervisor', 'monthly_edit']) {
  test(`業績明細 API 對等 ${role}`, async () => {
    const api = await apiAs(role);
    try {
      const rows = await readRowsAsServiceRole('monthly_staff_status', { eq: { store_id: zt01, year_month: M_DRAFT, employee_code: codes.n }, select: 'id' });
      const id = String(rows[0].id);
      const e = entry('staff-details');
      const result = await compareApiRead({
        recorder,
        entry: 'staff-details',
        title: e.description || 'staff-details',
        role,
        legacyApi: api,
        legacy: { ...(e.legacy.api as LegacyApiSource), query: { staff_status_id: id } },
        native: { ...(e.native.api as NativeApiSource), query: { op: 'staffDetails', id, month: M_DRAFT } },
      });
      assertNoUnlistedDiffs(result);
      expect(['pass', 'allowed', 'pending-approval']).toContain(result.status);
    } finally {
      await api.dispose();
    }
  });
}

// ---------------------------------------------------------------------------
// 4. 行為差異：已送審人員的刪除（W01a-q1）
// ---------------------------------------------------------------------------

test('已送審人員刪除：舊版可刪、新版 409（W01a-q1）', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    // 舊版：用舊頁按「刪除」並接受 confirm / alert
    const legacy = await ctx.newPage();
    legacy.on('dialog', (d) => void d.accept());
    await openLegacy(legacy, M_SUBMITTED, zt01);
    const row = legacy.locator('tr', { hasText: codes.d1 });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole('button', { name: /刪除/ }).click();
    await expect(legacy.locator('tr', { hasText: codes.d1 })).toHaveCount(0, { timeout: 20_000 });
    const legacyLeft = await readRowsAsServiceRole('monthly_staff_status', { eq: { store_id: zt01, year_month: M_SUBMITTED, employee_code: codes.d1 }, select: 'id' });

    // 新版：同樣狀態的另一列
    const { body } = await readMonth(admin, zt01, M_SUBMITTED);
    const target = body.records.find((r: any) => r.employee_code === codes.d2);
    const res = await admin.post('/api/workspace/monthly', { data: { action: 'delete', store: zt01, month: M_SUBMITTED, id: target.id } });
    const nativeLeft = await readRowsAsServiceRole('monthly_staff_status', { eq: { store_id: zt01, year_month: M_SUBMITTED, employee_code: codes.d2 }, select: 'id' });

    const result = compareSideEffects({
      recorder,
      entry: 'delete-submitted',
      title: '已送審人員刪除後是否仍存在（舊版 UI 刪除 vs 新版 API）',
      role: 'admin',
      legacyAction: '舊頁按刪除（deleteMonthlyStatusRecord）',
      nativeAction: `POST /api/workspace/monthly action=delete（HTTP ${res.status()}）`,
      tables: [
        {
          table: 'monthly_staff_status',
          key: 'step',
          legacyRows: [{ step: 'after-delete', exists: legacyLeft.length > 0 }],
          nativeRows: [{ step: 'after-delete', exists: nativeLeft.length > 0 }],
        },
      ],
    });
    assertNoUnlistedDiffs(result);
    expect(res.status()).toBe(409);
    expect(['pass', 'allowed', 'pending-approval']).toContain(result.status);
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------
// 5. 送審前檢查：同一份判斷規則（W01a-q2）
// ---------------------------------------------------------------------------

test('送審前檢查：舊版兩段確認 vs 新版同一視窗，列出的人員一致', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const legacy = await ctx.newPage();
    const messages: string[] = [];
    legacy.on('dialog', (d) => {
      messages.push(d.message());
      // 第一段「確定要提交」接受；之後的新人詢問與最後確認一律按取消，不會真的送審。
      if (d.message().startsWith('確定要提交')) void d.accept();
      else if (d.type() === 'alert') void d.accept();
      else void d.dismiss();
    });
    await openLegacy(legacy, M_DRAFT, zt01);
    await expect(legacy.getByRole('button', { name: /送出審核/ })).toBeVisible({ timeout: 30_000 });
    await legacy.getByRole('button', { name: /送出審核/ }).click();
    await legacy.waitForTimeout(3000);
    const legacyWho: Record<string, unknown>[] = [];
    for (const m of messages) {
      if (m.includes('尚未填寫本月工作時數')) {
        for (const line of m.split('\n')) {
          const hit = line.match(/^(FKF9\S+) /);
          if (hit) legacyWho.push({ who: `part:${hit[1]}`, suggested: '' });
        }
      }
      const newbie = m.match(/^(FKF9\S+) .*\n到職日.*\n.*\n建議：(.+)\n/);
      if (newbie) legacyWho.push({ who: `newbie:${newbie[1]}`, suggested: newbie[2].trim() });
    }
    const draftRows = await readRowsAsServiceRole('monthly_staff_status', { eq: { store_id: zt01, year_month: M_DRAFT }, select: 'status' });
    expect(draftRows.every((r) => r.status === 'draft'), '舊頁不應真的送審').toBe(true);

    const res = await admin.get('/api/workspace/monthly', { params: { op: 'precheck', month: M_DRAFT, store: zt01 } });
    const { report } = await res.json();
    const nativeWho: Record<string, unknown>[] = [
      ...report.partTimeMissingHours.map((p: any) => ({ who: `part:${p.employee_code}`, suggested: '' })),
      ...report.newbiesNeedCheck.map((n: any) => ({ who: `newbie:${n.employee_code}`, suggested: n.suggested_action })),
    ];
    const result = compareSideEffects({
      recorder,
      entry: 'presubmit-check',
      title: '送審前檢查列出的人員與建議（舊版 confirm 訊息 vs 新版 precheck）',
      role: 'admin',
      legacyAction: '舊頁按送出審核並讀取 confirm 訊息（不送出）',
      nativeAction: 'GET /api/workspace/monthly?op=precheck',
      tables: [{ table: 'presubmit', key: 'who', legacyRows: legacyWho, nativeRows: nativeWho }],
    });
    assertNoUnlistedDiffs(result);
    expect(legacyWho.length, '舊版應列出兼職與新人').toBeGreaterThanOrEqual(2);
    expect(['pass', 'allowed', 'pending-approval']).toContain(result.status);
  } finally {
    await ctx.close();
  }
});

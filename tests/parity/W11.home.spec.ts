import { expect, test, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { adminDb, addSectionAssignment, createTemplate, deleteRunTemplates, dropAutoAssignments, DEPT, logSteps, runIdOrThrow, sectionOf, templateSections, userId } from '../support/m3-fixtures';
import { p02Code, purgeP02, registerP02, seedMaster } from '../support/p02-fixtures';
import { seedBonusAs, seedTransfers, storeIds } from '../support/w11-fixtures';
import { taipeiDate } from '../../lib/workspace/home-rules';

// W11 / W12 對等層（M3 C）：舊版 app/page.tsx 的畫面擷取（用同一個角色登入）對新版 GET /api/workspace/home。
// 與舊版不同且使用者已核可的差異登記在 tests/parity/allowlist.json（approvedBy "user (2026-11-07 survey/m3 Q…)"）：
//  Q12 獎金月份標註月結尚未確認；Q13 督導只數可確認的調店（只有確認權限的帳號 DEV 沒有，由整合測試以替身驗證）；
//  Q14 我的任務未完成優先；Q15 問候副標題拿掉、新增快捷入口。
// 其餘（Q11）壽星、年費、執照、新人入職、調店待確認數（管理員）、獎金欄位與合計一律要與舊版逐筆相同。

const map = loadMap('home');
const recorder = new ParityRecorder('home');
const find = (id: string) => map.entries.find((e) => e.id === id)!;
const amount = (n: number) => Number(n || 0).toLocaleString('zh-TW');
const lines = (xs: string[]) => xs.join('\n');

function record(id: string, title: string, role: string, legacy: object, native: object) {
  const e = find(id);
  assertNoUnlistedDiffs(
    recorder.record({
      entry: id,
      mechanism: 'ui-extract',
      role,
      title,
      legacy: { endpoint: e.legacy.ui!.route },
      native: { endpoint: `GET ${e.native.api!.path}` },
      compared: { facts: Object.keys(legacy).length },
      diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
    }),
  );
}

test.afterAll(async () => {
  await deleteRunTemplates();
});

/** 擷取舊版首頁（server component 輸出的畫面）。 */
async function legacyFacts(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const txt = (el: Element | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const h2Card = (title: string) => {
      const h = Array.from(document.querySelectorAll('h2')).find((x) => (x.textContent || '').includes(title));
      return h ? (h.closest('div.bg-white, div.rounded-2xl') as HTMLElement | null) : null;
    };
    const h1 = document.querySelector('h1');
    const cards: string[] = [];
    const order = document.querySelector('.max-w-7xl');
    // 卡片出現順序（依 DOM 順序）
    const marks: [string, () => boolean][] = [
      ['transfer-confirm', () => !!document.querySelector('a[href*="transfer_requests"]')],
      ['monthly-release', () => !!document.querySelector('a[href="/monthly-release"]')],
      ['bonus', () => !!h2Card('我的每月獎金明細')],
      ['onboarding', () => !!h2Card('本月新人入職公告')],
      ['tasks', () => !!h2Card('我的任務')],
      ['birthdays', () => !!h2Card('本月壽星')],
      ['annual-fee', () => !!h2Card('常年會費未繳提醒')],
      ['license', () => !!h2Card('執照更新日提醒')],
    ];
    const positionOf = (key: string) => {
      const el =
        key === 'transfer-confirm' ? document.querySelector('a[href*="transfer_requests"]')
        : key === 'monthly-release' ? document.querySelector('a[href="/monthly-release"]')
        : h2Card({ bonus: '我的每月獎金明細', onboarding: '本月新人入職公告', tasks: '我的任務', birthdays: '本月壽星', 'annual-fee': '常年會費未繳提醒', license: '執照更新日提醒' }[key]!);
      return el ? el.getBoundingClientRect().top + window.scrollY : Infinity;
    };
    for (const [k, present] of marks) if (present()) cards.push(k);
    cards.sort((a, b) => positionOf(a) - positionOf(b) || marks.findIndex((m) => m[0] === a) - marks.findIndex((m) => m[0] === b));
    void order;

    const transferText = txt(document.querySelector('a[href*="transfer_requests"] span.rounded-full'));
    const bonus = h2Card('我的每月獎金明細');
    const bonusMonths = bonus
      ? Array.from(bonus.querySelectorAll('details.border-violet-100')).map((d) => {
          const spans = d.querySelectorAll('summary > span');
          const items = Array.from(d.querySelectorAll('div.grid > div')).map((row) => {
            const parts = row.querySelectorAll(':scope > span');
            const valueNode = parts[1];
            const own = Array.from(valueNode?.childNodes || []).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
            return `${txt(parts[0])}:${own}`;
          });
          return `${txt(spans[0])}|${txt(spans[1]).replace('合計 ', '')}|${items.join(',')}`;
        })
      : [];
    const onboarding = h2Card('本月新人入職公告');
    const onboardingRows = onboarding
      ? Array.from(onboarding.querySelectorAll('div.divide-emerald-100 > div')).map((r) => {
          const s = r.querySelectorAll(':scope > span');
          const nameSpan = s[2];
          const code = txt(nameSpan?.querySelector('span'));
          const name = Array.from(nameSpan?.childNodes || []).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
          return [txt(s[0]), txt(s[1]), name, code, txt(s[3])].join('|');
        })
      : [];
    const tasks = h2Card('我的任務');
    const taskRows = tasks ? Array.from(tasks.querySelectorAll('a[href^="/assignment/"]')).map((a) => `${txt(a.querySelector('h3'))}|${txt(a.querySelector('p')).replace('狀態: ', '')}`) : [];
    const birthdays = h2Card('本月壽星');
    const birthdayRows = birthdays ? Array.from(birthdays.querySelectorAll('div.divide-y > div')).map((r) => Array.from(r.querySelectorAll(':scope > span')).map((s) => txt(s)).join('|')) : [];
    const annual = h2Card('常年會費未繳提醒');
    const annualRows = annual
      ? Array.from(annual.querySelectorAll('div.divide-amber-100 > div')).map((r) => [...Array.from(r.querySelectorAll('.grid > span')).map((s) => txt(s)), txt(r.querySelector('p'))].join('|'))
      : [];
    const license = h2Card('執照更新日提醒');
    const licenseRows = license
      ? Array.from(license.querySelectorAll('[class*="hover:bg-sky-50/60"]')).map((r) => {
          const zoneEl = r.closest('div.overflow-hidden')?.querySelector('div.bg-sky-100');
          const zone = zoneEl ? txt(zoneEl).replace(/\s*（\d+ 人）$/, '') : '';
          return [zone, ...Array.from(r.querySelectorAll('.grid > span')).map((s) => txt(s)), txt(r.querySelector('p'))].join('|');
        })
      : [];
    return {
      name: txt(h1).replace(/^歡迎回來,\s*/, ''),
      subtitle: txt(h1?.nextElementSibling),
      cards,
      quickEntries: '',
      transferText,
      bonusMonths,
      onboardingRows,
      taskRows,
      birthdayRows,
      annualRows,
      licenseRows,
    };
  });
}

function nativeFacts(d: any) {
  const zoneOf = (r: any) => (d.flags.licenseGroupByZone ? r.supervisor_zone : '');
  return {
    name: d.name as string,
    transferText: d.transfer.show ? `${d.transfer.pendingCount} 待確認` : '',
    bonusMonths: (d.bonus.months as any[]).map((m) => `${m.yearMonth.replace('-', '/')}|${amount(m.total)}|${m.items.map((i: any) => `${i.label}:${amount(i.amount)}`).join(',')}`),
    onboardingRows: (d.onboarding.rows as any[]).map((r) => [r.movement_date.replace(/-/g, '/'), r.store_code ? `${r.store_code} - ${r.store_name || '-'}` : r.store_name || '-', r.employee_name, r.employee_code, r.onboarding_is_pharmacist ? '藥師' : '一般人員'].join('|')),
    birthdayRows: (d.birthdays.rows as any[]).map((r) => [r.employee_code, r.employee_name, `${parseInt(r.birthday.split('-')[1], 10)}/${parseInt(r.birthday.split('-')[2], 10)}`].join('|')),
    annualRows: d.annualFee.visible ? (d.annualFee.rows as any[]).map((r) => [r.employee_code, r.employee_name, r.association_city, r.store_name || '-', r.reason].join('|')) : [],
    licenseRows: d.license.visible ? (d.license.rows as any[]).map((r) => [zoneOf(r), r.employee_code, r.employee_name, r.license_renewal_date.replace(/-/g, '/'), r.store_name || '-', r.reason].join('|')) : [],
  };
}

const ROLES = ['admin', 'ops_manager', 'supervisor', 'store_manager', 'acting_manager', 'employee', 'ops_assistant'];

test.describe('首頁讀取對等（逐角色）', () => {
  test.describe.configure({ mode: 'serial' });
  const codes = () => [p02Code('FKF', 81), p02Code('FKF', 82), p02Code('FKF', 83)];
  let cleanup: (() => Promise<void>)[] = [];
  test.beforeAll(async () => {
    runIdOrThrow();
    const st = await storeIds();
    await purgeP02(codes());
    const t = taipeiDate();
    const mm = String(t.month).padStart(2, '0');
    const db = adminDb();
    const [a, b, c] = codes();
    await seedMaster(a, '對等測試壽星甲', st.ZT01);
    await seedMaster(b, '對等測試壽星乙', st.ZT02);
    await seedMaster(c, '對等測試壽星丙', st.ZT04);
    for (const [code, day] of [[a, '21'], [b, '04'], [c, '09']]) {
      const u = await db.from('store_employees').update({ birthday: `1990-${mm}-${day}` }).eq('employee_code', code);
      if (u.error) throw new Error(u.error.message);
    }
    for (const [code, store, date] of [[a, st.ZT01, `${t.yearMonth}-02`], [b, st.ZT02, t.monthEnd], [c, st.ZT04, `${t.yearMonth}-02`]] as const) {
      const ins = await db.from('employee_movement_history').insert({ employee_code: code, employee_name: `對等測試${code}`, store_id: store, movement_type: 'onboarding', movement_date: date, onboarding_is_pharmacist: code === b });
      if (ins.error) throw new Error(ins.error.message);
    }
    await registerP02(codes());
    cleanup.push(async () => purgeP02(codes()));
    cleanup.push(await seedTransfers([{ from: st.ZT01, to: st.ZT04 }]));
  });
  test.afterAll(async () => {
    for (const fn of cleanup.reverse()) await fn();
  });

  for (const role of ROLES) {
    test(`角色 ${role}：壽星、新人入職、年費、執照、調店待確認數、獎金與舊版一致`, async ({ browser }) => {
      test.setTimeout(180_000);
      const ctx = await loginAs(browser, role);
      const api = await apiAs(role);
      try {
        const page = await ctx.newPage();
        const legacy = await legacyFacts(page);
        const d = await (await api.get('/api/workspace/home')).json();
        const native = nativeFacts(d);
        record(
          'home-read',
          `首頁各卡片資料（${role}）`,
          role,
          {
            name: legacy.name,
            transferText: legacy.transferText,
            bonusMonths: lines(legacy.bonusMonths.map((m) => m)),
            onboardingRows: lines(legacy.onboardingRows),
            birthdayRows: lines(legacy.birthdayRows),
            annualRows: lines(legacy.annualRows),
            licenseRows: lines(legacy.licenseRows),
            hasBirthdayCard: legacy.cards.includes('birthdays'),
          },
          {
            name: native.name,
            transferText: native.transferText,
            bonusMonths: lines(native.bonusMonths),
            onboardingRows: lines(native.onboardingRows),
            birthdayRows: lines(native.birthdayRows),
            annualRows: lines(native.annualRows),
            licenseRows: lines(native.licenseRows),
            hasBirthdayCard: d.birthdays.visible as boolean,
          },
        );
        // 版面（Q15）：卡片出現順序相同；副標題與快捷入口是核可差異
        const nativeCards = [
          d.transfer.show ? 'transfer-confirm' : null,
          'monthly-release',
          d.bonus.visible ? 'bonus' : null,
          d.onboarding.rows.length ? 'onboarding' : null,
          'tasks',
          d.birthdays.visible ? 'birthdays' : null,
          d.annualFee.visible && d.annualFee.rows.length ? 'annual-fee' : null,
          d.license.visible && d.license.rows.length ? 'license' : null,
        ].filter(Boolean) as string[];
        record('home-layout', `首頁版面（${role}）`, role, { cardOrder: lines(legacy.cards), greetingSubtitle: legacy.subtitle, quickEntries: legacy.quickEntries }, { cardOrder: lines(nativeCards), greetingSubtitle: '', quickEntries: '巡店、活動、版更' });
      } finally {
        await ctx.close();
        await api.dispose();
      }
    });
  }
});

test('每月獎金明細：欄位、金額、合計、零金額與同月兩間門市加總一致；新版另標月結尚未確認（Q12 已核可的差異）', async ({ browser }) => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const st = await storeIds();
  const cleanup = await seedBonusAs('ops_assistant', 
    [
      { yearMonth: '2038-03', store: st.ZT05, amounts: { group_bonus: 1000, talent_bonus: 250.5, transport_fee: -100 } },
      { yearMonth: '2038-02', store: st.ZT05, amounts: { group_bonus: 700, other_bonus: 50 }, note: '加班' },
      { yearMonth: '2038-02', store: st.VW001, amounts: { meal_allowance: 30, other_bonus: 20 }, note: '加班' },
      { yearMonth: '2038-01', store: st.ZT05, amounts: { group_bonus: 0 } },
    ],
    [{ yearMonth: '2038-03', store: st.ZT05 }],
  );
  const ctx = await loginAs(browser, 'ops_assistant');
  const api = await apiAs('ops_assistant');
  try {
    const page = await ctx.newPage();
    const legacy = await legacyFacts(page);
    const d = await (await api.get('/api/workspace/home')).json();
    const native = nativeFacts(d);
    expect(legacy.bonusMonths.length, '舊版有看到測試獎金').toBeGreaterThanOrEqual(2);
    const unconfirmed = (d.bonus.months as any[]).filter((m) => !m.confirmed).map((m) => m.yearMonth);
    record('home-bonus', '獎金月份、金額、合計', 'ops_assistant', { bonusMonths: lines(legacy.bonusMonths), unconfirmedMonths: '' }, { bonusMonths: lines(native.bonusMonths), unconfirmedMonths: unconfirmed.join(',') });
    expect(unconfirmed).toContain('2038-02');
    expect(unconfirmed).not.toContain('2038-03');
  } finally {
    await ctx.close();
    await api.dispose();
    await cleanup();
  }
});

test('首頁我的任務：舊版依建立時間顯示最新三筆，新版未完成優先（Q14 已核可的差異）', async ({ browser }) => {
  test.setTimeout(300_000);
  runIdOrThrow();
  const admin = await apiAs('admin');
  const ops = userId('ops_assistant');
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const make = async (tag: string, complete: boolean) => {
    const t = await createTemplate(admin, tag, [sectionOf({ department: DEPT, users: [ops] })]);
    await dropAutoAssignments(t);
    const [sec] = await templateSections(t.id);
    const a = await addSectionAssignment(t.id, sec.id, [ops], complete ? { status: 'completed' } : {});
    if (complete) await logSteps(a, sec.steps.map((s) => s.id), ops);
    await sleep(40);
    return { id: a, title: t.form.title };
  };
  const doneOld = await make('parity-home-done-old', true);
  const openOld = await make('parity-home-open-old', false);
  const doneNew = await make('parity-home-done-new', true);
  const openNew = await make('parity-home-open-new', false);
  const ours = [doneOld, openOld, doneNew, openNew].map((x) => x.title);
  const ctx = await loginAs(browser, 'ops_assistant');
  const api = await apiAs('ops_assistant');
  try {
    const page = await ctx.newPage();
    const legacy = await legacyFacts(page);
    const d = await (await api.get('/api/workspace/home')).json();
    const label: Record<string, string> = { pending: '待處理', in_progress: '進行中', completed: '已完成' };
    const nativeRows = (d.tasks.rows as any[]).map((r) => `${r.title}|${label[r.status]}`);
    const mine = (rows: string[]) => rows.filter((r) => ours.some((t) => r.startsWith(`${t}|`)));
    const legacyMine = mine(legacy.taskRows),
      nativeMine = mine(nativeRows);
    expect(legacy.taskRows.length).toBeLessThanOrEqual(3);
    // 各自只比對本測試建立的任務；資料與狀態文字要一致，只有順序（Q14）不同
    const byTitle = (rows: string[]) => [...rows].sort();
    record('home-tasks', '首頁我的任務', 'ops_assistant', { taskStatuses: lines(byTitle(legacyMine).filter((r) => nativeMine.includes(r))), homeTasks: lines(legacy.taskRows) }, { taskStatuses: lines(byTitle(nativeMine).filter((r) => legacyMine.includes(r))), homeTasks: lines(nativeRows) });
    expect(nativeRows[0].startsWith(`${openNew.title}|`)).toBe(true);
  } finally {
    await ctx.close();
    await api.dispose();
    await admin.dispose();
  }
});

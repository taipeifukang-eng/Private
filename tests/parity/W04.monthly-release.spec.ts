import { expect, test } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs, type Diff } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { MONTHLY_RELEASES } from '../../lib/workspace/monthly-release';
import { openNativeRelease, readLegacyRelease, readNativeRelease } from '../support/w04-ui';

// W04 對等層：舊 /monthly-release 與新「每月版更內容」。
// 逐期、逐段落比對畫面文字（標籤、標題、摘要、月份、段落標題、樣式、段落文字、條列文字）、預設展開狀態與月份清單；
// 並確認舊頁每個角色都開得起來（登入即可看），新版對所有角色開放。
// 與舊版不同的行為列在 tests/parity/allowlist.json（approvedBy 為 null，待使用者核可）。

const map = loadMap('monthly-release');
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const recorder = new ParityRecorder('monthly-release');

const ROLES = ['admin', 'ops_manager', 'supervisor', 'store_manager', 'employee', 'denied'];

test('逐期文字對等 admin：標籤、標題、摘要、段落、條列、預設展開', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const legacyPage = await ctx.newPage();
    const nativePage = await ctx.newPage();
    await legacyPage.goto('/monthly-release', { waitUntil: 'networkidle' });
    await legacyPage.waitForSelector('details[id]');
    await nativePage.setViewportSize({ width: 1440, height: 900 });
    await openNativeRelease(nativePage);
    const l = await readLegacyRelease(legacyPage);
    const n = await readNativeRelease(nativePage);

    // 逐期（每期一筆比對結果，期別以 slug 對齊）。
    expect(l.releases.length, '舊版期數').toBe(MONTHLY_RELEASES.length);
    for (const legacyRelease of l.releases) {
      const nativeRelease = n.releases.find((r) => r.slug === legacyRelease.slug);
      const result = recorder.record({
        entry: entry('release-text').id,
        mechanism: 'ui-extract',
        role: 'admin',
        title: `${legacyRelease.slug} 期：標籤、標題、摘要、月份、段落與條列文字`,
        legacy: { endpoint: '/monthly-release details#' + legacyRelease.slug },
        native: { endpoint: '每月版更內容 [data-release=' + legacyRelease.slug + ']' },
        compared: { sections: legacyRelease.sections.length, items: legacyRelease.sections.reduce((s, x) => s + x.items.length + x.paragraphs.length, 0) },
        diffs: nativeRelease
          ? valueDiffsToDiffs(diffNormalized(legacyRelease, nativeRelease))
          : [{ kind: 'only-legacy', key: legacyRelease.slug } as Diff],
      });
      assertNoUnlistedDiffs(result);
    }
    // 新版不能多出舊版沒有的期別。
    const extra = n.releases.filter((r) => !l.releases.some((x) => x.slug === r.slug)).map((r): Diff => ({ kind: 'only-native', key: r.slug }));
    assertNoUnlistedDiffs(
      recorder.record({
        entry: entry('release-text').id,
        mechanism: 'ui-extract',
        role: 'admin',
        title: '新版多出的期別',
        legacy: { endpoint: '/monthly-release' },
        native: { endpoint: '每月版更內容' },
        compared: { legacy: l.releases.length, native: n.releases.length },
        diffs: extra,
      }),
    );
    // 空洞檢查：確實比到了內容，且最新一期展開、有三個段落。
    expect(l.releases[0].open).toBe(true);
    expect(l.releases[0].sections.map((s) => s.style)).toEqual(['list', 'highlight', 'cards']);
    expect(l.releases[0].sections.flatMap((s) => s.items)).toHaveLength(9);

    // 月份清單區塊。
    const index = recorder.record({
      entry: entry('release-index').id,
      mechanism: 'ui-extract',
      role: 'admin',
      title: '頁面標題與月份清單（說明文字、期數、每期卡片與「最新」標記）',
      legacy: { endpoint: '/monthly-release 月份清單' },
      native: { endpoint: '每月版更內容 [data-release-index]' },
      compared: { cards: l.index.cards.length },
      diffs: valueDiffsToDiffs(diffNormalized(l.index, n.index)),
    });
    assertNoUnlistedDiffs(index);
    expect(l.index.cards).toHaveLength(MONTHLY_RELEASES.length);

    // 返回首頁連結：舊版有、新版沒有（列白名單）。
    const nativeBackHome = await nativePage.locator('a:has-text("返回首頁")').count();
    const back = recorder.record({
      entry: entry('back-home').id,
      mechanism: 'ui-extract',
      role: 'admin',
      title: '「返回首頁」連結',
      legacy: { endpoint: '/monthly-release a[href="/"]' },
      native: { endpoint: '每月版更內容' },
      compared: { legacy: l.backHome.length, native: nativeBackHome },
      diffs: [
        ...l.backHome.filter((t) => t.includes('返回首頁')).map((t): Diff => ({ kind: 'only-legacy', key: 'back-home', detail: t })),
        ...(nativeBackHome ? [{ kind: 'only-native', key: 'back-home' } as Diff] : []),
      ],
    });
    assertNoUnlistedDiffs(back);
    expect(l.backHome.some((t) => t.includes('返回首頁')), '舊版確實有返回首頁連結').toBe(true);
  } finally {
    await ctx.close();
  }
});

for (const role of ROLES) {
  test(`存取對等 ${role}：舊頁可開、新版 capability 為 true`, async ({ browser }) => {
    test.setTimeout(120_000);
    const api = await apiAs(role);
    let session: any;
    let legacyStatus = 0;
    let legacyHasContent = false;
    try {
      session = await (await api.get('/api/workspace/session')).json();
      const res = await api.get('/monthly-release');
      legacyStatus = res.status();
      legacyHasContent = (await res.text()).includes('2026年3月 系統版更公告');
    } finally {
      await api.dispose();
    }
    const diffs: Diff[] = [];
    if (legacyStatus !== 200 || !legacyHasContent) diffs.push({ kind: 'only-native', key: 'access', detail: `舊頁 ${legacyStatus}，新版可開` });
    if (session.capabilities.monthlyRelease !== true) diffs.push({ kind: 'only-legacy', key: 'access', detail: '舊頁可開，新版不可開' });
    const result = recorder.record({
      entry: entry('access-login-only').id,
      mechanism: 'ui-extract',
      role,
      title: '登入即可看：舊頁 200 且有內容 vs 新版 capabilities.monthlyRelease',
      legacy: { endpoint: '/monthly-release', status: legacyStatus },
      native: { endpoint: '/api/workspace/session', status: String(session.capabilities.monthlyRelease) },
      compared: { legacyStatus, legacyHasContent, native: session.capabilities.monthlyRelease },
      diffs,
    });
    assertNoUnlistedDiffs(result);
    expect(legacyStatus).toBe(200);
  });
}

test('未登入存取：舊頁可看、新版 session 401（列白名單 w04-login-required）', async ({ request }) => {
  const legacy = await request.get('/monthly-release', { maxRedirects: 0 });
  const legacyOpen = legacy.status() === 200 && (await legacy.text()).includes('2026年3月 系統版更公告');
  const native = await request.get('/api/workspace/session');
  const diffs: Diff[] = [];
  if (legacyOpen && native.status() === 401) diffs.push({ kind: 'only-legacy', key: 'anonymous-access', detail: '舊版未登入可看，新版需登入' });
  if (!legacyOpen && native.status() === 200) diffs.push({ kind: 'only-native', key: 'anonymous-access' });
  assertNoUnlistedDiffs(
    recorder.record({
      entry: entry('access-anonymous').id,
      mechanism: 'ui-extract',
      title: '未登入存取：舊頁內容 vs 新版 session',
      legacy: { endpoint: '/monthly-release', status: legacy.status() },
      native: { endpoint: '/api/workspace/session', status: native.status() },
      compared: { legacyOpen, nativeStatus: native.status() },
      diffs,
    }),
  );
  expect(native.status()).toBe(401);
});

/**
 * 對等測試 navigation（T02）：第一個使用新框架的 parity 測試。
 *
 * 取代並擴充 scripts/test-workspace-permissions-parity.py 的「同一角色、舊 API 與新 API 結果一致」概念，
 * 對 role-matrix.json 的每個帳號做兩件事：
 *   1. [api-read]    舊 /api/permissions/user vs 新 /api/workspace/session 的有效權限碼集合。
 *   2. [navigation]  舊 Navbar 規則（權限碼 -> 入口）求值 vs 新 session navigation 的入口集合。
 * 結果寫入 tests/reports/<runId>/parity-report.json；未列白名單的差異使該帳號的測試失敗，
 * 已列入白名單但 approvedBy 為 null 者標為「待核可」。
 *
 * 只讀取，不寫入任何資料。
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { apiAs, loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, compareApiRead, loadMap, ParityRecorder, type LegacyApiSource, type NativeApiSource } from '../support/parity';
import { compareNavigation, compareNavItems, legacyNavItems, nativeNavItems, navDataFromMap, type LegacyNavFacts } from '../support/parity-nav';
import {
  dedupeItems,
  diffDesktopVsMobile,
  diffNativeDomVsSession,
  diffRulesVsDom,
  extractLegacyNavDom,
  extractNativeNavDom,
  nativeDomToItems,
} from '../support/parity-nav-dom';

type Account = { key: string; kind: string; roleCode: string; systemRoles?: string[] };
const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'role-matrix.json'), 'utf8')) as {
  accounts: Account[];
};

const map = loadMap('navigation');
const permEntry = map.entries.find((e) => e.id === 'effective-permissions')!;
const navEntry = map.entries.find((e) => e.id === 'nav-visibility')!;
const recorder = new ParityRecorder('navigation');
const rulesEntry = map.entries.find((e) => e.id === 'nav-rules-vs-dom')!;
const mobileEntry = map.entries.find((e) => e.id === 'nav-legacy-mobile-vs-desktop')!;
const domSessionEntry = map.entries.find((e) => e.id === 'nav-native-dom-vs-session')!;
const navData = navDataFromMap(map);

for (const account of fixture.accounts) {
  test(`導覽對等 ${account.key}`, async ({ browser }) => {
    test.setTimeout(account.kind === 'role' ? 180_000 : 60_000);
    const api = await apiAs(account.key);
    try {
      // 1) 有效權限碼（api-read）
      const permResult = await compareApiRead({
        recorder,
        entry: permEntry.id,
        title: '有效權限碼：/api/permissions/user vs /api/workspace/session',
        role: account.key,
        legacyApi: api,
        legacy: permEntry.legacy.api as LegacyApiSource,
        native: permEntry.native.api as NativeApiSource,
        rules: permEntry.normalize,
      });

      // 2) 導覽可見性
      const [permRes, profileRes, gaRes, sessionRes] = await Promise.all([
        api.get('/api/permissions/user'),
        api.get('/api/user/profile'),
        api.get('/api/general-affairs/access'),
        api.get('/api/workspace/session'),
      ]);
      expect(permRes.status(), '舊 /api/permissions/user').toBe(200);
      expect(sessionRes.status(), '新 /api/workspace/session').toBe(200);
      const permissions = ((await permRes.json()).permissions || []) as string[];
      const profile = profileRes.ok() ? await profileRes.json() : null;
      const ga = gaRes.ok() ? await gaRes.json() : null;
      const session = await sessionRes.json();

      const facts: LegacyNavFacts = {
        permissions,
        profileRole: profile?.profile?.role ?? null,
        roleCodes: [account.roleCode, ...(account.systemRoles || [])],
        generalAffairsAccess: Boolean(ga?.allowed),
      };
      // 規則表求值（單元層快速檢查；module 類帳號沒有 DOM 證據時也以它為舊版來源）
      const rulesItems = legacyNavItems(facts, navData);
      let navResult;
      const extraResults = [];

      if (account.kind === 'role') {
        // 舊版 DOM（桌機展開所有下拉）+ 手機漢堡選單
        const ctx = await loginAs(browser, account.key);
        try {
          const page = await ctx.newPage();
          await page.setViewportSize({ width: 1440, height: 900 });
          const desktop = await extractLegacyNavDom(page, 'desktop');
          await page.setViewportSize({ width: 390, height: 844 });
          const mobile = await extractLegacyNavDom(page, 'mobile');
          // 新版殼層 DOM
          await page.setViewportSize({ width: 1440, height: 900 });
          const nativeDom = await extractNativeNavDom(page);
          const sessionItems = nativeNavItems(session.navigation);
          const nativeItems = nativeDomToItems(nativeDom.items, session.navigation);

          if (!desktop.navbarFound) {
            test.info().annotations.push({ type: 'legacy-navbar-missing', description: `舊 Navbar 未渲染（最後網址 ${new URL(desktop.finalUrl).pathname}）` });
          }
          navResult = compareNavItems({
            recorder,
            entry: navEntry.id,
            title: '導覽可見性：舊 Navbar DOM vs 新版殼層選單 DOM',
            role: account.key,
            legacyEndpoint: `舊站 / 的 Navbar DOM（桌機 1440，展開所有下拉）${desktop.navbarFound ? '' : '【未渲染】'}`,
            nativeEndpoint: `/workspace/index.html 全站功能選單 DOM${nativeDom.shellFound ? '' : '【未渲染】'}`,
            legacyItems: desktop.items,
            nativeItems,
          });
          extraResults.push(
            recorder.record({
              entry: rulesEntry.id,
              mechanism: 'navigation',
              role: account.key,
              title: '舊版規則表求值 vs 舊 Navbar DOM（不一致代表規則表漂移）',
              legacy: { endpoint: '規則表求值（tests/parity/map/navigation.json）' },
              native: { endpoint: '舊 Navbar DOM（桌機）' },
              compared: { ruleItems: rulesItems.length, domItems: desktop.items.length },
              diffs: diffRulesVsDom(rulesItems, desktop.items),
            }),
            recorder.record({
              entry: mobileEntry.id,
              mechanism: 'navigation',
              role: account.key,
              title: '舊 Navbar：桌機 vs 手機漢堡選單',
              legacy: { endpoint: '舊 Navbar DOM（桌機 1440）' },
              native: { endpoint: '舊 Navbar DOM（手機 390）' },
              compared: { desktopItems: desktop.items.length, mobileItems: mobile.items.length },
              diffs: diffDesktopVsMobile(desktop.items, mobile.items),
            }),
            recorder.record({
              entry: domSessionEntry.id,
              mechanism: 'navigation',
              role: account.key,
              title: '新版殼層選單 DOM vs /api/workspace/session navigation',
              legacy: { endpoint: 'GET /api/workspace/session -> navigation' },
              native: { endpoint: '/workspace/index.html 全站功能選單 DOM' },
              compared: { sessionItems: sessionItems.length, domItems: dedupeItems(nativeItems).length },
              diffs: diffNativeDomVsSession(nativeItems, sessionItems),
            }),
          );
        } finally {
          await ctx.close();
        }
      } else {
        navResult = compareNavigation({
          recorder,
          map,
          entry: navEntry.id,
          title: '導覽可見性：舊 Navbar 規則表（無 DOM 證據）vs 新 session navigation',
          role: account.key,
          facts,
          nativeNavigation: session.navigation,
        });
      }

      const all = [permResult, navResult, ...extraResults];
      if (all.some((r) => r.status === 'pending-approval')) {
        test.info().annotations.push({ type: 'pending-approval', description: '有待使用者核可的白名單差異（見 parity-report.json）' });
      }
      for (const r of all) assertNoUnlistedDiffs(r);
    } finally {
      await api.dispose();
    }
  });
}

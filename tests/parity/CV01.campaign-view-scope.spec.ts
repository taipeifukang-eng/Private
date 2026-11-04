import { expect, test, type APIRequestContext } from '@playwright/test';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { apiForUser, hasMonthlyAccess, monthlyStoreCode, SCENARIOS, setupCv01, type CampaignKey, type CvFixtures } from '../support/cv01-fixtures';
import { buildWriteCases, getJson, pool, READ_PAIRS, sendJson, statusClass, writeGroupKey, type WriteCase } from '../support/cv01-cases';

// CV01 對等層：舊版（已含 dc87ea4 活動查看權限）API 與新版 workspace API，對舊版 matrix 角色逐項比對
// 可見活動、可見門市（各分頁列）、活動檢視入口、寫入允許與否，結果必須逐項相同。
// 資料：VW/ZT 測試門市、保留年度 2099 的活動（CVP-<runId>-*）；活動與任命經 registry 登錄、sweeper 清除，帳號由 fixture 清除。
// 與舊版不同的行為列在 tests/parity/allowlist.json（approvedBy 為 null，待使用者核可）；本頁目前沒有任何差異條目。

const map = loadMap('campaign-view-scope');
const entry = (id: string) => map.entries.find((e) => e.id === id)!.id;
const recorder = new ParityRecorder('campaign-view-scope');

let fx: CvFixtures;

test.beforeAll(async ({}, testInfo) => {
  test.setTimeout(240_000);
  if (testInfo.project.name !== 'desktop-1440') return;
  fx = await setupCv01();
});
test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop-1440' || !fx) return;
  const log = await fx.teardown();
  expect(log, '清除 fixture').toEqual([]);
});

const ids = (rows: any[]) => new Set(rows.map((r) => String(r.id ?? `${r.checklist_item_id ?? ''}:${r.store_id ?? ''}:${r.employee_code ?? ''}`)));
const fixtureOnly = (rows: any[]) => rows.filter((r) => typeof r?.name !== 'string' || r.name.startsWith(fx.namePrefix));

function statusDiff(key: string, l: number, n: number): Diff[] {
  // 403／404 同為「拒絕」（舊 API 對看不到的活動回 404，新版前置閘門回 403）；允許與否必須相同。
  return statusClass(l) === statusClass(n) ? [] : [{ kind: 'status', key, legacy: l, native: n }];
}
function setDiffs(key: string, l: Set<string>, n: Set<string>): Diff[] {
  const out: Diff[] = [];
  for (const id of Array.from(l)) if (!n.has(id)) out.push({ kind: 'only-legacy', key: `${key}#${id}` });
  for (const id of Array.from(n)) if (!l.has(id)) out.push({ kind: 'only-native', key: `${key}#${id}` });
  return out;
}

for (const key of Object.keys(SCENARIOS)) {
  test(`${key}：可見活動、入口、分頁可見門市、寫入與舊版逐項相同`, async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1440', '資料層對等只跑桌機專案');
    test.setTimeout(600_000);
    const sc = SCENARIOS[key];
    const user = fx.users[key];
    const ctx: APIRequestContext = await apiForUser(user);
    try {
      // 1) 可見活動清單
      {
        const l = await getJson(ctx, '/api/campaigns');
        const n = await getJson(ctx, `/api/workspace/campaigns?q=${encodeURIComponent(fx.namePrefix)}`);
        const lRows = l.status === 200 ? fixtureOnly(l.json?.campaigns || []) : [];
        const nRows = n.status === 200 ? n.json?.records || [] : [];
        const r = recorder.record({
          entry: entry('campaign-list'),
          mechanism: 'api-read',
          role: key,
          title: `可見活動清單（${sc.desc}）`,
          legacy: { endpoint: 'GET /api/campaigns', status: l.status },
          native: { endpoint: 'GET /api/workspace/campaigns?q=CVP-', status: n.status },
          compared: { legacy: lRows.length, native: nRows.length },
          diffs: [...statusDiff('status', l.status, n.status), ...setDiffs('campaign', ids(lRows), ids(nRows))],
        });
        assertNoUnlistedDiffs(r);
      }

      // 2) 活動檢視入口：舊 entry-access ↔ 新 session capabilities.campaignView ＋ 導覽「活動檢視」
      {
        const l = await getJson(ctx, '/api/campaigns/entry-access');
        const s = await getJson(ctx, '/api/workspace/session');
        expect(s.status).toBe(200);
        const navItem = (s.json.navigation || []).flatMap((g: any) => g.items).find((i: any) => i.href === '/activity-management');
        const lv = l.json?.canEnter === true;
        const diffs: Diff[] = [];
        if (lv !== (s.json.capabilities.campaignView === true)) diffs.push({ kind: 'changed', key: 'capabilities.campaignView', legacy: lv, native: s.json.capabilities.campaignView });
        if (lv !== Boolean(navItem)) diffs.push({ kind: 'changed', key: 'navigation.活動檢視（是否出現）', legacy: lv, native: Boolean(navItem) });
        assertNoUnlistedDiffs(
          recorder.record({
            entry: entry('entry-access'),
            mechanism: 'api-read',
            role: key,
            title: `活動檢視入口（${sc.desc}）`,
            legacy: { endpoint: 'GET /api/campaigns/entry-access', status: l.status },
            native: { endpoint: 'GET /api/workspace/session', status: s.status },
            compared: { canEnter: lv },
            diffs: [...statusDiff('status', l.status, 200), ...diffs],
          }),
        );
      }

      // 3) 各分頁可見列（SM / SUP / INV / DRAFT 四種受眾）
      {
        const diffs: Diff[] = [];
        const jobs = (['SM', 'SUP', 'INV', 'DRAFT'] as CampaignKey[]).flatMap((ck) => READ_PAIRS.map((pair) => ({ ck, pair })));
        const results = await pool(jobs, 8, async ({ ck, pair }) => {
          const cid = fx.campaigns[ck].id;
          return { ck, pair, l: await getJson(ctx, pair.legacy(cid)), n: await getJson(ctx, pair.native(cid)) };
        });
        const compared = results.length;
        for (const { ck, pair, l, n } of results) {
          const tag = `${pair.name}[${ck}]`;
          diffs.push(...statusDiff(`${tag}.status`, l.status, n.status));
          if (l.status === 200 && n.status === 200) diffs.push(...setDiffs(tag, ids(pair.rows(l.json)), ids(pair.rows(n.json))));
        }
        assertNoUnlistedDiffs(
          recorder.record({
            entry: entry('tab-reads'),
            mechanism: 'api-read',
            role: key,
            title: `活動檢視各分頁可見列（${sc.desc}）`,
            legacy: { endpoint: 'GET /api/campaign-*' },
            native: { endpoint: 'GET /api/workspace/campaign-tools' },
            compared: { requests: compared },
            diffs,
          }),
        );
      }

      // 4) 每月人員狀態的活動檢視（需要有可用的 monthly 門市：被任命者用第一間任命門市）
      if (hasMonthlyAccess(sc)) {
        // 無活動任命的情境以 VW001 查詢（fixture 另給 area_manager 任命以通過門市前置限制；G 不能加任命，由 G2 覆蓋）
        const storeId = fx.stores[monthlyStoreCode(sc)].id;
        const base = `/api/workspace/monthly/tools?store=${storeId}&month=2099-05`;
        const meta = await getJson(ctx, `${base}&op=meta`);
        if (meta.status !== 200) {
          // 所有情境都應通過 monthly 的門市前置限制；失敗代表 fixture 或前置權限出了問題，不得靜默略過
          expect(meta.status, `${key}：monthly meta 應為 200`).toBe(200);
          test.info().annotations.push({ type: 'skip-monthly', description: `${key}：monthly meta HTTP ${meta.status}，略過每月人員狀態內的活動檢視比對` });
        } else {
          const lc = await getJson(ctx, '/api/campaigns/entry-access');
          const pubL = await getJson(ctx, '/api/campaigns/published');
          const pubN = await getJson(ctx, `${base}&op=activity`);
          const lRows = pubL.status === 200 ? fixtureOnly(pubL.json?.data || []) : [];
          const nRows = pubN.status === 200 ? fixtureOnly(pubN.json?.data || []) : [];
          const diffs: Diff[] = [...statusDiff('published.status', pubL.status, pubN.status), ...setDiffs('published', ids(lRows), ids(nRows))];
          if ((lc.json?.canEnter === true) !== (meta.json.capabilities.activity === true)) {
            diffs.push({ kind: 'changed', key: 'meta.capabilities.activity', legacy: lc.json?.canEnter, native: meta.json.capabilities.activity });
          }
          assertNoUnlistedDiffs(
            recorder.record({
              entry: entry('campaign-published'),
              mechanism: 'api-read',
              role: key,
              title: `已發布活動／每月人員狀態活動檢視按鈕（${sc.desc}）`,
              legacy: { endpoint: 'GET /api/campaigns/published', status: pubL.status },
              native: { endpoint: 'GET /api/workspace/monthly/tools?op=activity', status: pubN.status },
              compared: { legacy: lRows.length, native: nRows.length },
              diffs,
            }),
          );
          // 活動明細：排程門市（店長只看任命門市）與 plan 內的門市列
          const detailDiffs: Diff[] = [];
          let detailCount = 0;
          for (const ck of ['SM', 'SUP', 'INV', 'DRAFT'] as CampaignKey[]) {
            const cid = fx.campaigns[ck].id;
            const l = await getJson(ctx, `/api/campaigns/${cid}/view`);
            const n = await getJson(ctx, `${base}&op=activityDetail&id=${cid}`);
            detailCount += 1;
            detailDiffs.push(...statusDiff(`detail[${ck}].status`, l.status, n.status));
            if (l.status === 200 && n.status === 200) {
              detailDiffs.push(...setDiffs(`detail[${ck}].schedules`, ids(l.json.schedules || []), ids(n.json.schedules || [])));
              const stores = new Set<string>((l.json.schedules || []).map((s: any) => s.store_id));
              for (const [planKey, resource] of [['details', 'store-details'], ['ownStaff', 'store-own-staff'], ['headcount', 'store-headcount']] as const) {
                const lp = await getJson(ctx, `/api/campaign-${resource}?campaign_id=${cid}`);
                const want = ids((lp.json?.data || []).filter((r: any) => stores.has(r.store_id)));
                detailDiffs.push(...setDiffs(`detail[${ck}].plan.${planKey}`, want, ids(n.json.plan?.[planKey] || [])));
              }
            }
          }
          assertNoUnlistedDiffs(
            recorder.record({
              entry: entry('activity-detail'),
              mechanism: 'api-read',
              role: key,
              title: `活動檢視明細（${sc.desc}）`,
              legacy: { endpoint: 'GET /api/campaigns/[id]/view + 各分頁' },
              native: { endpoint: 'GET /api/workspace/monthly/tools?op=activityDetail' },
              compared: { campaigns: detailCount },
              diffs: detailDiffs,
            }),
          );
        }
      }

      // 5) 寫入允許與否（狀態碼）：同一份內容舊／新各送一次，兩次之間還原資料
      {
        const diffs: Diff[] = [];
        const cases = buildWriteCases();
        const groups = new Map<string, WriteCase[]>();
        for (const c of cases) groups.set(writeGroupKey(c), [...(groups.get(writeGroupKey(c)) || []), c]);
        const groupResults = await pool(Array.from(groups.values()), 8, async (group) => {
          const out: Diff[] = [];
          for (const c of group) {
            const body = c.body(fx);
            if (c.reset) await c.reset(fx);
            const l = await sendJson(ctx, c.method, c.legacyPath, body);
            if (c.reset) await c.reset(fx);
            const nBody = c.nativeBody ? await c.nativeBody(fx, ctx) : body;
            const n = await sendJson(ctx, c.nativeMethod || c.method, `/api/workspace/campaign-tools?resource=${c.resource}`, nBody);
            if (c.reset) await c.reset(fx);
            out.push(...statusDiff(c.name, l.status, n.status));
          }
          return out;
        });
        for (const d of groupResults) diffs.push(...d);
        assertNoUnlistedDiffs(
          recorder.record({
            entry: entry('store-writes'),
            mechanism: 'write-readback',
            role: key,
            title: `寫入允許與否（${sc.desc}）`,
            legacy: { endpoint: 'POST／DELETE /api/campaign-*' },
            native: { endpoint: 'POST／DELETE /api/workspace/campaign-tools' },
            compared: { cases: cases.length },
            diffs,
          }),
        );
      }
    } finally {
      await ctx.dispose();
    }
  });
}

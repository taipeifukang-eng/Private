import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  audience,
  CAMPAIGN_FLAGS,
  canEnterOracle,
  DATA_STORES,
  P,
  SCENARIOS,
  setupCv01,
  visibleStores,
  apiForUser,
  identity,
  type CampaignKey,
  type CvFixtures,
  type Scenario,
} from '../support/cv01-fixtures';
import { buildWriteCases, getJson, pool, sendJson, writeGroupKey, type WriteCase } from '../support/cv01-cases';

// CV01 整合層：新版 workspace API 對照「規格」（oracle，依規格而不是依實作）：
// 權限閘門、發布閘門、身分（store_managers）、範圍（店長任命門市／督導與盤點組全部／view_all 全部／編輯者全部）、
// 寫入（RLS 對齊的權限碼）、活動檢視入口。舊版對照見 tests/parity/CV01。

let fx: CvFixtures;
test.beforeAll(async ({}, testInfo) => {
  test.setTimeout(240_000);
  if (testInfo.project.name !== 'desktop-1440') return;
  fx = await setupCv01();
});
test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop-1440' || !fx) return;
  expect(await fx.teardown(), '清除 fixture').toEqual([]);
});

const has = (sc: Scenario, c: string) => sc.perms.includes(c);
const fmt = (s: Iterable<string>) => `[${Array.from(s).sort().join(',')}]`;
const KEYS = Object.keys(CAMPAIGN_FLAGS) as CampaignKey[];

/** 各分頁：發布閘門以外的放行來源與範圍 bypass（規格第 6 點）。 */
function readConfig(sc: Scenario, resource: string, key: CampaignKey) {
  const a = audience(sc, key);
  const manage = has(sc, P.manage);
  const pub = a.published;
  const cfg: Record<string, { gate: boolean; bypass: boolean }> = {
    schedules: { gate: pub, bypass: false },
    details: { gate: pub || has(sc, P.storeDetailEdit), bypass: has(sc, P.storeDetailEdit) || manage },
    headcount: { gate: pub || has(sc, P.storeDetailEdit) || manage, bypass: has(sc, P.storeDetailEdit) || manage },
    ownStaff: { gate: pub || manage, bypass: manage },
    completions: { gate: pub || has(sc, P.checklistEdit), bypass: has(sc, P.checklistEdit) || manage },
    trips: { gate: pub || has(sc, P.equipEdit), bypass: has(sc, P.equipEdit) || manage },
    requests: { gate: pub || manage, bypass: manage },
    supportStaff: { gate: pub || manage, bypass: manage },
  };
  return cfg[resource];
}

test.describe('讀取矩陣（workspace API）', () => {
  for (const sk of Object.keys(SCENARIOS)) {
    test(`${sk}：入口、活動清單與各分頁可見門市`, async ({}, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-1440', '資料層只跑桌機專案');
      test.setTimeout(300_000);
      const sc = SCENARIOS[sk];
      const i = identity(sc);
      const ctx: APIRequestContext = await apiForUser(fx.users[sk]);
      try {
        // 入口
        const session = await getJson(ctx, '/api/workspace/session');
        expect(session.status).toBe(200);
        expect(session.json.capabilities.campaignView, `${sk} 活動檢視入口`).toBe(canEnterOracle(sc));
        const nav = (session.json.navigation || []).flatMap((g: any) => g.items).find((x: any) => x.href === '/activity-management');
        expect(Boolean(nav), `${sk} 導覽「活動檢視」`).toBe(canEnterOracle(sc));

        // 活動清單：權限閘門＋發布閘門；各項編輯權（含行銷／商品部發布）與 manage、view_all 看全部（含草稿）
        const seeAll = i.viewAll || [P.manage, P.campaignEdit, P.storeDetailEdit, P.equipEdit, P.checklistEdit].some((c) => has(sc, c));
        const gate = i.viewAll || i.viewOwn || seeAll || has(sc, P.supportReq) || has(sc, P.supportAssign);
        const list = await getJson(ctx, `/api/workspace/campaigns?q=${encodeURIComponent(fx.namePrefix)}`);
        if (!gate) {
          expect(list.status, `${sk} 清單應被擋`).toBe(403);
        } else {
          expect(list.status).toBe(200);
          const got = new Set<string>((list.json.records as any[]).map((r) => KEYS.find((k) => fx.campaigns[k].id === r.id)!));
          const want = new Set<string>(KEYS.filter((k) => seeAll || audience(sc, k).published));
          expect(fmt(got), `${sk} 可見活動`).toBe(fmt(want));
        }

        // 各分頁
        for (const key of KEYS) {
          const cid = fx.campaigns[key].id;
          for (const resource of ['schedules', 'details', 'headcount', 'ownStaff', 'completions', 'trips', 'requests', 'supportStaff']) {
            const cfg = readConfig(sc, resource, key);
            const res = await getJson(ctx, `/api/workspace/campaign-tools?resource=${resource}&campaign_id=${cid}`);
            const label = `${sk} ${resource}[${key}]`;
            if (!cfg.gate) {
              expect([403, 404], `${label} 應被擋，實際 ${res.status}`).toContain(res.status);
              continue;
            }
            expect(res.status, label).toBe(200);
            const rows: any[] = resource === 'schedules' ? res.json.schedules : res.json.data;
            if (['schedules', 'details', 'headcount', 'ownStaff', 'completions'].includes(resource)) {
              const got = new Set<string>(rows.map((r) => fx.storeIdToCode[r.store_id]).filter(Boolean));
              expect(fmt(got), `${label} 可見門市`).toBe(fmt(visibleStores(sc, key, cfg.bypass)));
            } else {
              // 支援需求／人員／車次：任一端門市在範圍內即可見
              const scope = visibleStores(sc, key, cfg.bypass);
              const all = scope.size === DATA_STORES.length;
              const pairs: Record<string, [string, string]> = { R1: ['VW001', 'ZT02'], R2: ['ZT02', 'ZT03'], R3: ['ZT03', 'VW002'] };
              if (resource === 'trips') {
                const names = new Set(Array.from(scope).map((c) => fx.stores[c].name));
                const trips: Record<number, [string, string]> = { 1: ['VW001', 'ZT02'], 2: ['ZT01', 'ZT02'] };
                const want = Object.entries(trips).filter(([, [f, t]]) => all || names.has(fx.stores[f].name) || names.has(fx.stores[t].name)).map(([n]) => Number(n));
                expect(rows.map((r) => r.set_number).sort(), `${label} 車次`).toEqual(want.sort());
              } else {
                const want = Object.entries(pairs).filter(([, [rq, sp]]) => all || scope.has(rq) || scope.has(sp)).map(([k]) => k);
                const got = rows.map((r) => Object.entries(fx.requests[key]).find(([, v]) => v.id === (resource === 'requests' ? r.id : r.support_request_id))?.[0]).filter(Boolean);
                expect(Array.from(new Set(got)).sort(), `${label} 需求`).toEqual(want.sort());
              }
            }
          }
        }
      } finally {
        await ctx.dispose();
      }
    });
  }
});

/** 寫入 oracle（規格「寫入規則」）。 */
function canWrite(sc: Scenario, key: CampaignKey, storeCodes: string[], editCodes: string[], rlsCodes: string[], anyStore: boolean): boolean {
  const i = identity(sc);
  if (has(sc, P.manage) || editCodes.some((c) => has(sc, c))) return true;
  if (rlsCodes.length > 0 && !rlsCodes.some((c) => has(sc, c))) return false;
  if (!(i.viewOwn || i.viewAll)) return false;
  const f = CAMPAIGN_FLAGS[key];
  const sup = i.isSup && f.pubSup;
  const sm = i.isSM && f.pubSM;
  const dp = i.isInv && f.pubInv;
  if (!(sup || sm || dp)) return false;
  if (sup || dp) return true;
  const ok = (code: string) => i.managed.includes(code);
  return anyStore ? storeCodes.some(ok) : storeCodes.every(ok);
}

test.describe('寫入矩陣（workspace API）', () => {
  for (const sk of Object.keys(SCENARIOS)) {
    test(`${sk}：寫入允許與否依規格`, async ({}, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop-1440', '資料層只跑桌機專案');
      test.setTimeout(300_000);
      const sc = SCENARIOS[sk];
      const ctx = await apiForUser(fx.users[sk]);
      try {
        const groups = new Map<string, WriteCase[]>();
        for (const c of buildWriteCases()) groups.set(writeGroupKey(c), [...(groups.get(writeGroupKey(c)) || []), c]);
        const outcomes = await pool(Array.from(groups.values()), 8, async (group) => {
          const out: { c: WriteCase; status: number }[] = [];
          for (const c of group) {
            if (c.reset) await c.reset(fx);
            const res = await sendJson(ctx, c.method, `/api/workspace/campaign-tools?resource=${c.resource}`, c.body(fx));
            if (c.reset) await c.reset(fx);
            out.push({ c, status: res.status });
          }
          return out;
        });
        for (const { c, status } of outcomes.flat()) {
          const want = canWrite(sc, c.campaign, c.storeCodes, c.editCodes, c.rlsCodes, !!c.anyStore);
          if (want) expect(status, `${sk} ${c.name} 應允許`).toBeLessThan(300);
          else expect([403, 404], `${sk} ${c.name} 應被擋，實際 ${status}`).toContain(status);
        }
      } finally {
        await ctx.dispose();
      }
    });
  }
});

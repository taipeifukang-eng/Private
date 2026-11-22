import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';

/**
 * CV01（活動查看權限 view_own / view_all）測試資料。
 * 規則：只用 DEV（env-guard）、只用 VW/ZT 測試門市；活動與門市任命經 registry 登錄、由 sweeper 清除；
 * 帳號與角色不在 sweeper 白名單（D15 禁止由 service role 依登錄刪除 profiles / roles），改由本模組在 teardown 與
 * 下次 setup 開頭依標記（cvp-test-* 信箱、cvp_test_* 角色）清除，孤兒數由 sweeper 的 report 目標（MARKER_TARGETS）檢查。
 * 帳號密碼每次隨機產生，只存在記憶體，不輸出、不寫檔。
 */

const nodeRequire = createRequire(path.join(__dirname, 'cv01-fixtures.ts'));
const ROOT = path.resolve(__dirname, '..', '..');
const { createRegistry, RUN_ID_RE } = nodeRequire('./registry.cjs') as {
  createRegistry: (o: { runId: string }) => { record: (e: { table: string; column?: string; values: string[]; note?: string }) => void };
  RUN_ID_RE: RegExp;
};

export const TEST_ORIGIN = 'http://localhost:3002';
export const EMAIL_PREFIX = 'cvp-test-';
export const ROLE_PREFIX = 'cvp_test_';
export const INV_DEPT = '營業部-盤點組';

export const P = {
  own: 'activity.campaign.view_own',
  all: 'activity.campaign.view_all',
  legacy: 'activity.campaign.view',
  campaignEdit: 'activity.campaign.edit',
  manage: 'activity.manage',
  access: 'activity.management.access',
  storeDetailEdit: 'activity.store_detail.edit',
  checklistEdit: 'activity.checklist.edit',
  equipEdit: 'activity.equipment_trip.edit',
  supportReq: 'activity.support_request.edit',
  supportAssign: 'activity.support_assign.edit',
} as const;
/** 讓每月人員狀態頁／monthly tools 可載入的權限（與活動權限無關，oracle 不使用）。 */
export const PAGE_PERM = 'monthly.status.view_own';
/**
 * monthly tools 的門市前置限制（requireStore）靠 store_managers 任命通過；DEV 的 stores RLS 讓沒有任命的帳號讀不到門市。
 * 沒有活動任命的情境若要比對「每月人員狀態內的活動檢視」，fixture 另給一筆 area_manager 任命（areaAppt）：
 * 它不是 store_manager／supervisor，不影響活動身分與範圍，也不影響這些情境的入口結果（盤點組與 view_all 本來就能進入、其餘沒有 view_own/view_all）。
 * 部門身分持 view_own 的情境（G）不能加任命（會讓入口變成可進入），改由 G2（任命只有 area_manager）覆蓋 monthly 比對。
 */
export const hasMonthlyAccess = (sc: Scenario): boolean => sc.appts.length > 0 || sc.areaAppt === true;
/** monthly tools 用的門市代碼：有任命用第一間任命門市，否則用 VW001。 */
export const monthlyStoreCode = (sc: Scenario): string => (sc.appts.length ? sc.appts[0][0] : 'VW001');

export interface Scenario {
  title: string;
  dept: string | null;
  appts: [string, 'store_manager' | 'supervisor' | 'area_manager'][];
  /** 另給 VW001 的 area_manager 任命，只為了通過 monthly 門市前置限制。 */
  areaAppt?: boolean;
  perms: string[];
  desc: string;
}

/** 與舊版 scripts/test-campaign-view-scope.cjs 的 matrix 角色對應（單店店長、雙店長、督導、盤點組、view_all、只有 edit、無權限、部門身分）。 */
export const SCENARIOS: Record<string, Scenario> = {
  A_single_mgr: { title: '店長', dept: null, appts: [['VW001', 'store_manager']], perms: [P.own], desc: '單店店長（VW001）' },
  A2_mgr_support: { title: '店長', dept: null, appts: [['VW001', 'store_manager']], perms: [P.own, P.supportAssign, P.supportReq], desc: '單店店長，另有 support 編輯權（較接近正式店長角色）' },
  B_dual_mgr: { title: '店長', dept: null, appts: [['VW001', 'store_manager'], ['VW002', 'store_manager']], perms: [P.own], desc: '雙店長（VW001+VW002）' },
  C_supervisor: { title: '督導', dept: null, appts: [['ZT01', 'supervisor']], perms: [P.own], desc: '督導（ZT01，活動檢視看全部門市）' },
  C2_sup_support: { title: '督導', dept: null, appts: [['ZT01', 'supervisor']], perms: [P.own, P.supportAssign, P.supportReq], desc: '督導，另有 support 編輯權' },
  G_dept_mgr_view_own: { title: '營業部經理', dept: '營業部', appts: [], perms: [P.own], desc: '部門身分（營業主管）持 view_own、無 view_all、無任命' },
  G2_dept_mgr_area_only: { title: '營業部經理', dept: '營業部', appts: [['VW001', 'area_manager']], perms: [P.own], desc: '部門身分持 view_own，只有 area_manager 任命（不是店長也不是督導）' },
  F_dept_mgr_access_only: { title: '營業部經理', dept: '營業部', appts: [], areaAppt: true, perms: [P.access], desc: '部門身分只有 management.access（不再自動放行）' },
  H_inventory_view_own: { title: '盤點人員', dept: INV_DEPT, appts: [], areaAppt: true, perms: [P.own], desc: '盤點組只有 view_own（部門受眾，看全部門市）' },
  I_view_all: { title: '營業部經理', dept: '營業部', appts: [], areaAppt: true, perms: [P.all], desc: 'view_all' },
  J_edit_only: { title: '行銷', dept: '行銷部', appts: [], areaAppt: true, perms: [P.storeDetailEdit, P.checklistEdit, P.equipEdit], desc: '只有 store_detail / checklist / equipment_trip 編輯權' },
  K_no_perm: { title: '店員', dept: null, appts: [], areaAppt: true, perms: [], desc: '無任何權限' },
  L_legacy_view: { title: '店長', dept: null, appts: [['VW001', 'store_manager']], perms: [P.legacy], desc: '只有舊 view（第一階段視同 view_own）的單店店長' },
  M_manage_only: { title: '行銷', dept: '行銷部', appts: [], areaAppt: true, perms: [P.manage], desc: '只有 activity.manage（發布 PATCH 舊版放行）' },
  E_campaign_edit_only: { title: '行銷', dept: '行銷部', appts: [], areaAppt: true, perms: [P.campaignEdit], desc: '只有 activity.campaign.edit' },
  N_mgr_store_detail_only: { title: '店長', dept: null, appts: [['VW001', 'store_manager']], perms: [P.own, P.storeDetailEdit], desc: '單店店長（VW001）持 view_own＋store_detail.edit（無 support_assign.edit）' },
  R_mgr_and_sup: { title: '店長', dept: null, appts: [['VW001', 'store_manager'], ['ZT01', 'supervisor']], perms: [P.own], desc: '同時有店長(VW001)與督導(ZT01)任命' },
};

export const CAMPAIGN_FLAGS = {
  ALL: { pubSup: true, pubSM: true, pubInv: true },
  SUP: { pubSup: true, pubSM: false, pubInv: false },
  SM: { pubSup: false, pubSM: true, pubInv: false },
  INV: { pubSup: false, pubSM: false, pubInv: true },
  DRAFT: { pubSup: false, pubSM: false, pubInv: false },
} as const;
export type CampaignKey = keyof typeof CAMPAIGN_FLAGS;

export const FIXTURE_STORES = ['VW001', 'VW002', 'ZT01', 'ZT02', 'ZT03'];
/** 每個活動都有資料的門市。 */
export const DATA_STORES = ['VW001', 'VW002', 'ZT01', 'ZT02'];

export function runIdOrThrow(): string {
  const runId = process.env.TEST_RUN_ID || '';
  if (!RUN_ID_RE.test(runId)) throw new Error('必須由 run-all 啟動（需要 TEST_RUN_ID）');
  return runId;
}

type Db = any;
function adminDb(): Db {
  const guard = nodeRequire('./env-guard.cjs') as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
  const { env } = guard.assertDevEnvironment({ root: ROOT });
  const { createClient } = nodeRequire('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => Db };
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
}

export interface CvUser {
  key: string;
  id: string;
  email: string;
  password: string;
}

export interface CvFixtures {
  db: Db;
  runId: string;
  stores: Record<string, { id: string; name: string }>;
  storeIdToCode: Record<string, string>;
  campaigns: Record<CampaignKey, { id: string; name: string }>;
  items: Record<CampaignKey, string>;
  requests: Record<CampaignKey, Record<'R1' | 'R2' | 'R3', { id: string; req: string; sup: string }>>;
  users: Record<string, CvUser>;
  namePrefix: string;
  teardown: () => Promise<string[]>;
}

/** 依標記清除殘留（活動、帳號、角色）；回傳失敗訊息。 */
export async function cleanupCv01(db: Db = adminDb()): Promise<string[]> {
  const log: string[] = [];
  const { data: camps } = await db.from('campaigns').select('id').like('name', 'CVP-%');
  const campIds = (camps || []).map((c: { id: string }) => c.id);
  if (campIds.length) {
    const r = await db.from('campaigns').delete().in('id', campIds); // 子表 ON DELETE CASCADE
    if (r.error) log.push(`campaigns: ${r.error.message}`);
  }
  const { data: profs } = await db.from('profiles').select('id').like('email', `${EMAIL_PREFIX}%@example.test`);
  const uids = (profs || []).map((p: { id: string }) => p.id);
  if (uids.length) {
    await db.from('store_managers').delete().in('user_id', uids);
    await db.from('user_roles').delete().in('user_id', uids);
  }
  const { data: roles } = await db.from('roles').select('id').like('code', `${ROLE_PREFIX}%`);
  const roleIds = (roles || []).map((r: { id: string }) => r.id);
  if (roleIds.length) {
    await db.from('user_roles').delete().in('role_id', roleIds);
    await db.from('role_permissions').delete().in('role_id', roleIds);
    const r = await db.from('roles').delete().in('id', roleIds);
    if (r.error) log.push(`roles: ${r.error.message}`);
  }
  for (let page = 1; ; page += 1) {
    const r = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (r.error) {
      log.push(`listUsers: ${r.error.message}`);
      break;
    }
    const users = r.data.users || [];
    for (const u of users) {
      if (u.email && u.email.startsWith(EMAIL_PREFIX) && u.email.endsWith('@example.test')) {
        const d = await db.auth.admin.deleteUser(u.id);
        if (d.error) log.push(`deleteUser: ${d.error.message}`);
      }
    }
    if (users.length < 200) break;
  }
  return log;
}

/** 建立活動、子表資料、帳號、角色與任命。scenarios 預設全部。 */
export async function setupCv01(scenarioKeys: string[] = Object.keys(SCENARIOS)): Promise<CvFixtures> {
  const runId = runIdOrThrow();
  const registry = createRegistry({ runId });
  const db = adminDb();
  const leftover = await cleanupCv01(db);
  if (leftover.length) throw new Error(`清除上次殘留失敗：${leftover.join('; ')}`);

  const stores: CvFixtures['stores'] = {};
  const storeIdToCode: Record<string, string> = {};
  for (const s of must(await db.from('stores').select('id,store_code,store_name').in('store_code', FIXTURE_STORES), '讀取測試門市') as any[]) {
    stores[s.store_code] = { id: s.id, name: s.store_name };
    storeIdToCode[s.id] = s.store_code;
  }
  for (const code of FIXTURE_STORES) if (!stores[code]) throw new Error(`DEV 缺少測試門市 ${code}`);

  const codes = Array.from(new Set([...Object.values(SCENARIOS).flatMap((s) => s.perms), PAGE_PERM]));
  const permIds: Record<string, string> = {};
  for (const p of must(await db.from('permissions').select('id,code').in('code', codes), '讀取 permissions') as any[]) permIds[p.code] = p.id;
  for (const c of codes) if (!permIds[c]) throw new Error(`DEV 缺少權限 ${c}（migration 20261103090000 未套用？）`);

  const namePrefix = `CVP-${runId}`;
  const campaigns = {} as CvFixtures['campaigns'];
  const items = {} as CvFixtures['items'];
  const requests = {} as CvFixtures['requests'];
  for (const [key, flags] of Object.entries(CAMPAIGN_FLAGS) as [CampaignKey, (typeof CAMPAIGN_FLAGS)[CampaignKey]][]) {
    const row = must(
      await db
        .from('campaigns')
        .insert({
          name: `${namePrefix}-${key}`,
          start_date: '2099-05-01',
          end_date: '2099-06-30',
          is_active: true,
          published_to_supervisors: flags.pubSup,
          published_to_store_managers: flags.pubSM,
          published_to_inventory_team: flags.pubInv,
        })
        .select('id,name')
        .single(),
      `建立活動 ${key}`,
    ) as { id: string; name: string };
    campaigns[key] = row;
    registry.record({ table: 'campaigns', column: 'id', values: [row.id], note: 'CV01 活動 fixture（子表 cascade）' });
    const cid = row.id;
    must(await db.from('campaign_schedules').insert(DATA_STORES.map((c) => ({ campaign_id: cid, store_id: stores[c].id, activity_date: '2099-05-10' }))), '排程');
    must(await db.from('campaign_store_details').insert(DATA_STORES.map((c) => ({ campaign_id: cid, store_id: stores[c].id, notes: 'cvp' }))), '門市明細');
    must(await db.from('campaign_store_headcount').insert(DATA_STORES.map((c) => ({ campaign_id: cid, store_id: stores[c].id, extra_support_count: 0, supervisor_count: 0 }))), '人力');
    must(await db.from('campaign_store_own_staff').insert(DATA_STORES.map((c) => ({ campaign_id: cid, store_id: stores[c].id, employee_code: 'CVP001', employee_name: 'cvp', sort_order: 0 }))), '自有人員');
    const item = must(await db.from('campaign_checklist_items').insert({ campaign_id: cid, task_name: 'CVP item', item_order: 1 }).select('id').single(), '檢核項目') as { id: string };
    items[key] = item.id;
    must(await db.from('campaign_checklist_completions').insert(DATA_STORES.map((c) => ({ checklist_item_id: item.id, store_id: stores[c].id, is_completed: false }))), '檢核完成');
    must(
      await db.from('campaign_equipment_trips').insert([
        { campaign_id: cid, set_number: 1, trip_date: '2099-05-10', from_location: stores.VW001.name, to_location: stores.ZT02.name },
        { campaign_id: cid, set_number: 2, trip_date: '2099-05-11', from_location: stores.ZT01.name, to_location: stores.ZT02.name },
      ]),
      '設備車次',
    );
    const reqs = must(
      await db
        .from('campaign_support_requests')
        .insert([
          { campaign_id: cid, requesting_store_id: stores.VW001.id, supporting_store_id: stores.ZT02.id, requested_count: 1 },
          { campaign_id: cid, requesting_store_id: stores.ZT02.id, supporting_store_id: stores.ZT03.id, requested_count: 1 },
          { campaign_id: cid, requesting_store_id: stores.ZT03.id, supporting_store_id: stores.VW002.id, requested_count: 1 },
        ])
        .select('id,requesting_store_id,supporting_store_id'),
      '支援需求',
    ) as any[];
    const rk = {} as CvFixtures['requests'][CampaignKey];
    for (const r of reqs) {
      const rq = storeIdToCode[r.requesting_store_id];
      rk[rq === 'VW001' ? 'R1' : rq === 'ZT02' ? 'R2' : 'R3'] = { id: r.id, req: rq, sup: storeIdToCode[r.supporting_store_id] };
    }
    requests[key] = rk;
    must(
      await db.from('campaign_support_staff').insert(
        Object.values(rk).map((r) => ({
          support_request_id: r.id,
          campaign_id: cid,
          requesting_store_id: stores[r.req].id,
          supporting_store_id: stores[r.sup].id,
          employee_code: 'CVPF',
          employee_name: 'cvp',
          sort_order: 0,
        })),
      ),
      '支援人員',
    );
  }

  const users: Record<string, CvUser> = {};
  for (const key of scenarioKeys) {
    const sc = SCENARIOS[key];
    const role = must(
      await db.from('roles').insert({ name: `CVP Test ${key}`, code: `${ROLE_PREFIX}${key.toLowerCase()}`, description: 'campaign view scope parity test role', is_system: false, is_active: true }).select('id').single(),
      `建立角色 ${key}`,
    ) as { id: string };
    must(await db.from('role_permissions').insert([...sc.perms, PAGE_PERM].map((c) => ({ role_id: role.id, permission_id: permIds[c], is_allowed: true }))), `角色權限 ${key}`);
    const email = `${EMAIL_PREFIX}${key.toLowerCase().replace(/_/g, '-')}@example.test`;
    const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `CVP ${key}` } });
    if (created.error) throw new Error(`建立帳號 ${key} 失敗：${created.error.message}`);
    const uid = created.data.user.id as string;
    users[key] = { key, id: uid, email, password };
    must(await db.from('profiles').update({ department: sc.dept, job_title: sc.title, role: 'member' }).eq('id', uid), `profile ${key}`);
    must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
    const apptRows: [string, string][] = [...sc.appts, ...(sc.areaAppt ? ([['VW001', 'area_manager']] as [string, string][]) : [])];
    if (apptRows.length) {
      const rows = must(
        await db.from('store_managers').insert(apptRows.map(([code, type], i) => ({ user_id: uid, store_id: stores[code].id, role_type: type, is_primary: i === 0 }))).select('id'),
        `store_managers ${key}`,
      ) as { id: string }[];
      registry.record({ table: 'store_managers', column: 'id', values: rows.map((r) => r.id), note: `CV01 任命 fixture（${key}）` });
    }
  }

  return {
    db,
    runId,
    stores,
    storeIdToCode,
    campaigns,
    items,
    requests,
    users,
    namePrefix,
    teardown: () => cleanupCv01(db),
  };
}

/** 以 workspace 登入路由登入（cookie 與舊站共用），回傳可呼叫舊 API 與 workspace API 的 request context。 */
export async function apiForUser(user: CvUser): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
  const res = await ctx.post('/api/workspace/login', { data: { email: user.email, password: user.password } });
  if (!res.ok()) {
    await ctx.dispose();
    throw new Error(`帳號 ${user.key} 登入失敗（HTTP ${res.status()}）`);
  }
  return ctx;
}

/** 只含本次 fixture 活動的名稱集合（用來過濾列表結果，避免 DEV 既有活動干擾）。 */
export function fixtureKeysFromNames(fx: Pick<CvFixtures, 'campaigns'>, names: string[]): CampaignKey[] {
  return (Object.keys(fx.campaigns) as CampaignKey[]).filter((k) => names.includes(fx.campaigns[k].name));
}

// ---------------------------------------------------------------- Oracle（依規格，不依實作）
export function identity(sc: Scenario) {
  return {
    viewAll: sc.perms.includes(P.all),
    viewOwn: sc.perms.includes(P.own) || sc.perms.includes(P.legacy),
    isSup: sc.appts.some((a) => a[1] === 'supervisor'),
    isSM: sc.appts.some((a) => a[1] === 'store_manager'),
    isInv: sc.dept === INV_DEPT,
    managed: sc.appts.filter((a) => a[1] === 'store_manager').map((a) => a[0]),
    hasAppt: sc.appts.length > 0,
  };
}

/** 規格第 1~5 點：該使用者對該活動是否通過發布閘門、範圍是否為全部。 */
export function audience(sc: Scenario, key: CampaignKey) {
  const i = identity(sc);
  const c = CAMPAIGN_FLAGS[key];
  const sup = i.viewOwn && i.isSup && c.pubSup;
  const sm = i.viewOwn && i.isSM && c.pubSM;
  const dp = i.viewOwn && i.isInv && c.pubInv;
  return { i, published: i.viewAll || sup || sm || dp, scopeAll: i.viewAll || sup || dp, sm };
}

/** 規格第 7 點：活動檢視入口。 */
export function canEnterOracle(sc: Scenario): boolean {
  const i = identity(sc);
  if (i.viewAll) return true;
  return i.viewOwn && (i.hasAppt || i.isInv);
}

/** 可見門市（以 DATA_STORES 為母集合）；bypass 為持對應 edit 權。 */
export function visibleStores(sc: Scenario, key: CampaignKey, bypass = false): Set<string> {
  const a = audience(sc, key);
  if (bypass || a.scopeAll) return new Set(DATA_STORES);
  if (a.sm) return new Set(a.i.managed.filter((c) => DATA_STORES.includes(c)));
  return new Set();
}

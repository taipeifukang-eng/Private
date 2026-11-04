#!/usr/bin/env node
'use strict';
/**
 * 活動專案查看權限（campaign view scope）DEV 整合測試。
 * 規格：docs/campaign-view-scope-spec.md
 *
 * 做什麼：
 *   1. 只在 DEV Supabase 上建立 @example.test 測試帳號（cvs-test-*）、測試角色（cvs_test_*）、
 *      測試門市任命與測試活動（CVS-TEST-*），不修改任何既有帳號。
 *   2. 以各帳號的 session cookie 呼叫「舊版站」（預設 http://localhost:3012，NODE_ENV=development）的活動 API，
 *      逐支驗證可見性與寫入矩陣；並可用瀏覽器驗證 /activity-management、每月人員狀態頁按鈕、權限頁顯示。
 *   3. 結束（含失敗）時一律清除自己建立的資料；--cleanup 可單獨清除上次殘留。
 *
 * 用法：
 *   node scripts/test-campaign-view-scope.cjs            # API 矩陣 + UI（需要 playwright）
 *   node scripts/test-campaign-view-scope.cjs --no-ui    # 只跑 API 矩陣
 *   node scripts/test-campaign-view-scope.cjs --cleanup  # 只清除殘留測試資料
 *   --ui-only       只跑 UI 驗證
 *   --json <path>   把完整矩陣寫成 JSON
 *   --keep          測試完不清除（除錯用，之後請務必 --cleanup）
 *
 * 安全：
 *   - 只讀 .env.development.local（不讀 .env.local / .env.production* / *.bak）；
 *     URL 與 anon / service_role JWT 的 ref 必須等於 DEV ref，且不得以 odvk 開頭，否則直接中止。
 *   - 測試帳號密碼每次執行隨機產生，只存在記憶體，不輸出、不寫檔。
 *   - 站台必須是 localhost / 127.0.0.1。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const ARGS = process.argv.slice(2);
const FLAG = (n) => ARGS.includes(n);
const ARG_VAL = (n) => {
  const i = ARGS.indexOf(n);
  return i >= 0 ? ARGS[i + 1] : null;
};

const DEV_REF = 'mjpdfpxqttbhzeimmtqr';
const BASE = (process.env.CVS_BASE_URL || 'http://localhost:3012').replace(/\/+$/, '');
const PREFIX = 'CVS-TEST';
const EMAIL_PREFIX = 'cvs-test-';
const ROLE_PREFIX = 'cvs_test_';
const INV_DEPT = '營業部-盤點組';

// ---------------------------------------------------------------- DEV 守衛
function loadDevEnv() {
  const file = path.join(ROOT, '.env.development.local');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error('找不到 .env.development.local（只允許讀這個 env 檔）');
  }
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    const q = v[0];
    if ((q === '"' || q === "'") && v.lastIndexOf(q) > 0) v = v.slice(1, v.lastIndexOf(q));
    else v = v.replace(/\s+#.*$/, '').trim();
    env[m[1]] = v;
  }
  const jwtRef = (t, label, role) => {
    const p = JSON.parse(Buffer.from(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (p.role !== role) throw new Error(`${label} 的 JWT role 必須是 ${role}`);
    return p.ref;
  };
  const urlRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  const refs = [
    urlRef,
    env.EXPECTED_SUPABASE_PROJECT_REF,
    jwtRef(env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'anon key', 'anon'),
    jwtRef(env.SUPABASE_SERVICE_ROLE_KEY, 'service role key', 'service_role'),
  ];
  for (const r of refs) {
    if (String(r).toLowerCase().startsWith('odvk')) throw new Error('偵測到 Production ref，拒絕執行');
    if (r !== DEV_REF) throw new Error('Supabase ref 不是 DEV，拒絕執行');
  }
  if (env.ALLOW_DEV_DATABASE_OPERATIONS !== 'true') throw new Error('ALLOW_DEV_DATABASE_OPERATIONS 必須為 true');
  if (process.env.NODE_ENV === 'production') throw new Error('NODE_ENV 不得為 production');
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('測試站只允許 localhost / 127.0.0.1');
  return env;
}

const ENV = loadDevEnv();
const { createClient } = require('@supabase/supabase-js');
const admin = createClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------- 常數
const P = {
  own: 'activity.campaign.view_own',
  all: 'activity.campaign.view_all',
  legacy: 'activity.campaign.view',
  campaignEdit: 'activity.campaign.edit',
  manage: 'activity.manage',
  access: 'activity.management.access',
  storeDetailEdit: 'activity.store_detail.edit',
  checklistEdit: 'activity.checklist.edit',
  equipEdit: 'activity.equipment_trip.edit',
  marketing: 'activity.marketing.publish',
  merchandise: 'activity.merchandise.publish',
  supportReq: 'activity.support_request.edit',
  supportAssign: 'activity.support_assign.edit',
  staffOverview: 'activity.staff_overview.view',
};
// 每個測試角色額外持有，讓 /monthly-status 頁可載入（與活動權限無關，oracle 不使用）
const PAGE_PERM = 'monthly.status.view_own';

// 測試情境：appts = [門市代碼, role_type]
const SCENARIOS = {
  A_single_mgr: { title: '店長', dept: null, appts: [['VW001', 'store_manager']], perms: [P.own], desc: '單店店長（VW001）' },
  B_dual_mgr: { title: '店長', dept: null, appts: [['VW001', 'store_manager'], ['VW002', 'store_manager']], perms: [P.own], desc: '雙店長（VW001+VW002）' },
  C_supervisor: { title: '督導', dept: null, appts: [['ZT01', 'supervisor']], perms: [P.own], desc: '督導（只任命 ZT01，活動檢視看全部）' },
  D_title_sup_but_mgr: { title: '督導', dept: null, appts: [['VW001', 'store_manager']], perms: [P.own], desc: '職稱寫督導但只有店長任命（身分以 store_managers 為準）' },
  E_title_mgr_no_appt: { title: '店長', dept: null, appts: [], perms: [P.own], desc: '職稱店長但沒有任何任命，持 view_own' },
  F_dept_mgr_access_only: { title: '營業部經理', dept: '營業部', appts: [], perms: [P.access], desc: '營業主管，只有 management.access，無活動查看權' },
  G_dept_mgr_view_own: { title: '營業部經理', dept: '營業部', appts: [], perms: [P.own], desc: '營業主管，持 view_own 無 view_all，無任命' },
  H_inventory_view_own: { title: '盤點人員', dept: INV_DEPT, appts: [], perms: [P.own], desc: '盤點組，持 view_own（部門受眾）' },
  H2_inventory_no_perm: { title: '盤點人員', dept: INV_DEPT, appts: [], perms: [P.access], desc: '盤點組，無活動查看權' },
  I_view_all: { title: '營業部經理', dept: '營業部', appts: [], perms: [P.all], desc: 'view_all（含未發布與全部門市）' },
  J_edit_only: { title: '行銷', dept: '行銷部', appts: [], perms: [P.storeDetailEdit, P.checklistEdit, P.equipEdit], desc: '只有 store_detail/checklist/equipment_trip 編輯權' },
  K_no_perm: { title: '店員', dept: null, appts: [], perms: [], desc: '無任何權限' },
  L_legacy_view: { title: '店長', dept: null, appts: [['VW001', 'store_manager']], perms: [P.legacy], desc: '只有舊 view（第一階段視同 view_own），VW001 店長' },
  M_campaign_edit_only: { title: '行銷', dept: '行銷部', appts: [], perms: [P.campaignEdit], desc: '只有 activity.campaign.edit' },
  N_marketing_dept: { title: '行銷專員', dept: '行銷部', appts: [], perms: [P.access], desc: '行銷部，只有 management.access（不再自動放行）' },
  O_manage_only: { title: '管理', dept: null, appts: [], perms: [P.manage], desc: '只有 activity.manage' },
  A2_mgr_realistic: { title: '店長', dept: null, appts: [['VW001', 'store_manager']], perms: [P.own, P.supportAssign, P.supportReq], desc: '單店店長（VW001），另有 support_assign/support_request 編輯權（較接近正式店長角色）' },
  C2_sup_realistic: { title: '督導', dept: null, appts: [['ZT01', 'supervisor']], perms: [P.own, P.supportAssign, P.supportReq], desc: '督導（ZT01），另有 support_assign/support_request 編輯權' },
  // ---- 第二輪修正新增（草稿外洩 / view_all 任命寫入 / 督導寫任一門市）
  S_aux_only: { title: '店員', dept: null, appts: [], perms: [P.supportReq, P.supportAssign, P.staffOverview], desc: '只有 support_request/support_assign/staff_overview（輔助權限，不放行草稿）' },
  T_mgr_aux_stdov: { title: '店長', dept: null, appts: [['VW001', 'store_manager']], perms: [P.own, P.staffOverview], desc: '單店店長（VW001）+ staff_overview.view（不得讀草稿）' },
  U_viewall_sup: { title: '督導', dept: null, appts: [['ZT01', 'supervisor']], perms: [P.all, P.supportAssign, P.supportReq], desc: 'view_all + 督導任命(ZT01)（正式區 business_supervisor 類型）' },
  V_viewall_mgr: { title: '店長', dept: null, appts: [['VW001', 'store_manager']], perms: [P.all, P.supportAssign, P.supportReq], desc: 'view_all + 店長任命(VW001)' },
  W_legacy_sup: { title: '督導', dept: null, appts: [['ZT01', 'supervisor']], perms: [P.legacy], desc: '督導(ZT01)，只有舊 view（第一階段視同 view_own）' },
  R_mgr_and_sup: { title: '店長', dept: null, appts: [['VW001', 'store_manager'], ['ZT01', 'supervisor']], perms: [P.own], desc: '同時有店長(VW001)與督導(ZT01)任命' },
};

const CAMPAIGNS = {
  ALL: { pubSup: true, pubSM: true, pubInv: true },
  SUP: { pubSup: true, pubSM: false, pubInv: false },
  SM: { pubSup: false, pubSM: true, pubInv: false },
  INV: { pubSup: false, pubSM: false, pubInv: true },
  DRAFT: { pubSup: false, pubSM: false, pubInv: false },
  PUB: { pubSup: false, pubSM: false, pubInv: false }, // 專供發布 API 測試
};

const FIXTURE_STORES = ['VW001', 'VW002', 'ZT01', 'ZT02', 'ZT03'];
const DATA_STORES = ['VW001', 'VW002', 'ZT01', 'ZT02']; // 每個活動都有資料的門市

// ---------------------------------------------------------------- 狀態
const state = {
  stores: {}, // code -> {id, name}
  storeIdToCode: {},
  campaigns: {}, // key -> row
  roles: {}, // scenario -> role id
  users: {}, // scenario -> {id, email, password, cookie}
  permIds: {},
  trips: {}, // key -> id
  requests: {}, // R1..R3 -> id
  items: {}, // campaign key -> checklist item id
};
const matrix = [];
let failCount = 0;

function record(role, endpoint, expected, actual, ok) {
  matrix.push({ role, endpoint, expected: String(expected), actual: String(actual), ok: !!ok });
  if (!ok) failCount += 1;
}
const fmtSet = (s) => '[' + [...s].sort().join(',') + ']';
const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

function must(res, what) {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
}

// ---------------------------------------------------------------- 清除
async function cleanup() {
  const log = [];
  // 活動與子表
  const { data: camps } = await admin.from('campaigns').select('id').like('name', `${PREFIX}%`);
  const campIds = (camps || []).map((c) => c.id);
  if (campIds.length) {
    const { data: items } = await admin.from('campaign_checklist_items').select('id').in('campaign_id', campIds);
    const itemIds = (items || []).map((i) => i.id);
    if (itemIds.length) await admin.from('campaign_checklist_completions').delete().in('checklist_item_id', itemIds);
    for (const t of [
      'campaign_support_staff',
      'campaign_support_requests',
      'campaign_checklist_items',
      'campaign_store_own_staff',
      'campaign_store_headcount',
      'campaign_store_details',
      'campaign_schedules',
      'campaign_equipment_trips',
      'campaign_department_publish',
    ]) {
      const r = await admin.from(t).delete().in('campaign_id', campIds);
      if (r.error && r.error.code !== '42P01') log.push(`${t}: ${r.error.message}`);
    }
    const r = await admin.from('campaigns').delete().in('id', campIds);
    if (r.error) log.push(`campaigns: ${r.error.message}`);
  }
  // 使用者
  const { data: profs } = await admin.from('profiles').select('id,email').like('email', `${EMAIL_PREFIX}%@example.test`);
  const uids = (profs || []).map((p) => p.id);
  if (uids.length) {
    await admin.from('store_managers').delete().in('user_id', uids);
    await admin.from('user_roles').delete().in('user_id', uids);
  }
  // 角色
  const { data: roles } = await admin.from('roles').select('id').like('code', `${ROLE_PREFIX}%`);
  const roleIds = (roles || []).map((r) => r.id);
  if (roleIds.length) {
    await admin.from('user_roles').delete().in('role_id', roleIds);
    await admin.from('role_permissions').delete().in('role_id', roleIds);
    const r = await admin.from('roles').delete().in('id', roleIds);
    if (r.error) log.push(`roles: ${r.error.message}`);
  }
  // auth users（依 email 列舉，避免 profiles 已不存在）
  let page = 1;
  for (;;) {
    const r = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (r.error) {
      log.push(`listUsers: ${r.error.message}`);
      break;
    }
    const users = r.data.users || [];
    for (const u of users) {
      if (u.email && u.email.startsWith(EMAIL_PREFIX) && u.email.endsWith('@example.test')) {
        const d = await admin.auth.admin.deleteUser(u.id);
        if (d.error) log.push(`deleteUser: ${d.error.message}`);
      }
    }
    if (users.length < 200) break;
    page += 1;
  }
  return log;
}

// ---------------------------------------------------------------- 建立資料
const WRITE_LANES = 8;
// 一組活動 + 子表資料。lane 0 = 讀取矩陣與一般用；其餘 lane 只給寫入矩陣平行執行用（各自獨立資料列，避免互相干擾）
async function buildCampaignSet(laneIdx, L) {
  for (const [key, flags] of Object.entries(CAMPAIGNS)) {
    const row = must(
      await admin
        .from('campaigns')
        .insert({
          name: laneIdx === 0 ? `${PREFIX}-${key}` : `${PREFIX}-L${laneIdx}-${key}`,
          start_date: '2026-11-01',
          end_date: '2026-12-31',
          is_active: true,
          published_to_supervisors: flags.pubSup,
          published_to_store_managers: flags.pubSM,
          published_to_inventory_team: flags.pubInv,
        })
        .select('*')
        .single(),
      `建立活動 ${key}`
    );
    L.campaigns[key] = row;
  }

  // 子表資料（PUB 活動不需要）
  for (const key of Object.keys(CAMPAIGNS).filter((k) => k !== 'PUB')) {
    const cid = L.campaigns[key].id;
    must(await admin.from('campaign_schedules').insert(DATA_STORES.map((c) => ({ campaign_id: cid, store_id: state.stores[c].id, activity_date: '2026-11-10' }))), '排程');
    must(await admin.from('campaign_store_details').insert(DATA_STORES.map((c) => ({ campaign_id: cid, store_id: state.stores[c].id, notes: 'cvs' }))), '門市明細');
    must(await admin.from('campaign_store_headcount').insert(DATA_STORES.map((c) => ({ campaign_id: cid, store_id: state.stores[c].id, extra_support_count: 0, supervisor_count: 0 }))), '人力');
    must(await admin.from('campaign_store_own_staff').insert(DATA_STORES.map((c) => ({ campaign_id: cid, store_id: state.stores[c].id, employee_code: 'CVS001', employee_name: 'cvs', sort_order: 0 }))), '自有人員');
    const item = must(await admin.from('campaign_checklist_items').insert({ campaign_id: cid, task_name: 'CVS item', item_order: 1 }).select('id').single(), '檢核項目');
    L.items[key] = item.id;
    must(await admin.from('campaign_checklist_completions').insert(DATA_STORES.map((c) => ({ checklist_item_id: item.id, store_id: state.stores[c].id, is_completed: false }))), '檢核完成');
    const trips = must(
      await admin
        .from('campaign_equipment_trips')
        .insert([
          { campaign_id: cid, set_number: 1, trip_date: '2026-11-10', from_location: state.stores.VW001.name, to_location: state.stores.ZT02.name },
          { campaign_id: cid, set_number: 2, trip_date: '2026-11-11', from_location: state.stores.ZT01.name, to_location: state.stores.ZT02.name },
          { campaign_id: cid, set_number: 3, trip_date: '2026-11-12', from_location: state.stores.ZT02.name, to_location: state.stores.ZT03.name },
        ])
        .select('id,set_number'),
      '設備車次'
    );
    L.trips[key] = Object.fromEntries(trips.map((t) => [`T${t.set_number}`, t.id]));
    const reqs = must(
      await admin
        .from('campaign_support_requests')
        .insert([
          { campaign_id: cid, requesting_store_id: state.stores.VW001.id, supporting_store_id: state.stores.ZT02.id, requested_count: 1 },
          { campaign_id: cid, requesting_store_id: state.stores.ZT02.id, supporting_store_id: state.stores.ZT03.id, requested_count: 1 },
          { campaign_id: cid, requesting_store_id: state.stores.ZT03.id, supporting_store_id: state.stores.VW002.id, requested_count: 1 },
        ])
        .select('id,requesting_store_id,supporting_store_id'),
      '支援需求'
    );
    L.requests[key] = {};
    for (const r of reqs) {
      const rq = state.storeIdToCode[r.requesting_store_id];
      const sp = state.storeIdToCode[r.supporting_store_id];
      const k = rq === 'VW001' ? 'R1' : rq === 'ZT02' ? 'R2' : 'R3';
      L.requests[key][k] = { id: r.id, req: rq, sup: sp };
    }
    const staffRows = Object.values(L.requests[key]).map((r) => ({
      support_request_id: r.id,
      campaign_id: cid,
      requesting_store_id: state.stores[r.req].id,
      supporting_store_id: state.stores[r.sup].id,
      employee_code: 'CVSF',
      employee_name: 'cvs',
      sort_order: 0,
    }));
    must(await admin.from('campaign_support_staff').insert(staffRows), '支援人員');
  }
}

async function setup() {
  // 門市
  const st = must(await admin.from('stores').select('id,store_code,store_name').in('store_code', FIXTURE_STORES), '讀取測試門市');
  for (const code of FIXTURE_STORES) {
    const s = st.find((x) => x.store_code === code);
    if (!s) throw new Error(`DEV 缺少測試門市 ${code}`);
    state.stores[code] = { id: s.id, name: s.store_name };
    state.storeIdToCode[s.id] = code;
  }

  // 權限 id
  const codes = [...Object.values(P), PAGE_PERM];
  const perms = must(await admin.from('permissions').select('id,code').in('code', codes), '讀取 permissions');
  for (const p of perms) state.permIds[p.code] = p.id;
  for (const c of codes) if (!state.permIds[c]) throw new Error(`DEV 缺少權限 ${c}（migration 未套用？）`);

  // 活動：lane 0 供讀取／UI；寫入矩陣平行跑在 WRITE_LANES 組獨立資料上
  state.lanes = [state];
  await buildCampaignSet(0, state);
  const extra = [];
  for (let n = 1; n < WRITE_LANES; n += 1) {
    const L = { campaigns: {}, items: {}, trips: {}, requests: {} };
    state.lanes.push(L);
    extra.push(buildCampaignSet(n, L));
  }
  await Promise.all(extra);

  // 角色 / 帳號 / 任命
  await Promise.all(Object.entries(SCENARIOS).map(async ([key, sc]) => {
    {
      const code = `${ROLE_PREFIX}${key.toLowerCase()}`;
      const role = must(
        await admin.from('roles').insert({ name: `CVS Test ${key}`, code, description: 'campaign view scope test role', is_system: false, is_active: true }).select('id').single(),
        `建立角色 ${key}`
      );
      state.roles[key] = role.id;
      must(await admin.from('role_permissions').insert([...sc.perms, PAGE_PERM].map((c) => ({ role_id: role.id, permission_id: state.permIds[c], is_allowed: true }))), `角色權限 ${key}`);
    }
    const email = `${EMAIL_PREFIX}${key.toLowerCase().replace(/_/g, '-')}@example.test`;
    const password = crypto.randomBytes(18).toString('base64url') + 'aA1!';
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `CVS ${key}` } });
    if (created.error) throw new Error(`建立帳號 ${key} 失敗：${created.error.message}`);
    const uid = created.data.user.id;
    state.users[key] = { id: uid, email, password };
    must(await admin.from('profiles').update({ department: sc.dept, job_title: sc.title, role: 'member' }).eq('id', uid), `profile ${key}`);
    if (state.roles[key]) {
      must(await admin.from('user_roles').insert({ user_id: uid, role_id: state.roles[key], is_active: true }), `user_roles ${key}`);
    }
    if (sc.appts.length) {
      must(
        await admin.from('store_managers').insert(sc.appts.map(([code, type], i) => ({ user_id: uid, store_id: state.stores[code].id, role_type: type, is_primary: i === 0 }))),
        `store_managers ${key}`
      );
    }
  }));
}

// ---------------------------------------------------------------- 登入 / HTTP
function buildCookie(session) {
  const name = `sb-${DEV_REF}-auth-token`;
  const value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
  const SIZE = 3180;
  if (value.length <= SIZE) return `${name}=${value}`;
  const parts = [];
  for (let i = 0, n = 0; i < value.length; i += SIZE, n += 1) parts.push(`${name}.${n}=${value.slice(i, i + SIZE)}`);
  return parts.join('; ');
}

async function login() {
  await Promise.all(Object.entries(state.users).map(async ([key, u]) => {
    const c = createClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await c.auth.signInWithPassword({ email: u.email, password: u.password });
    if (r.error) throw new Error(`登入 ${key} 失敗：${r.error.message}`);
    u.session = r.data.session;
    u.cookie = buildCookie(r.data.session);
  }));
}

async function api(key, method, url, body) {
  const headers = { 'content-type': 'application/json' };
  if (key) headers.cookie = state.users[key].cookie;
  const res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, json };
}

// ---------------------------------------------------------------- Oracle（依規格，不依實作）
function ident(sc) {
  return {
    has: (c) => sc.perms.includes(c),
    viewAll: sc.perms.includes(P.all),
    viewOwn: sc.perms.includes(P.own) || sc.perms.includes(P.legacy),
    isSup: sc.appts.some((a) => a[1] === 'supervisor'),
    isSM: sc.appts.some((a) => a[1] === 'store_manager'),
    isInv: sc.dept === INV_DEPT,
    managed: sc.appts.filter((a) => a[1] === 'store_manager').map((a) => a[0]),
    hasAppt: sc.appts.length > 0,
  };
}

function audience(sc, ckey) {
  const i = ident(sc);
  const c = CAMPAIGNS[ckey];
  const sup = i.viewOwn && i.isSup && c.pubSup;
  const sm = i.viewOwn && i.isSM && c.pubSM;
  const dp = i.viewOwn && i.isInv && c.pubInv;
  const published = i.viewAll || sup || sm || dp;
  const scopeAll = i.viewAll || sup || dp;
  return { i, published, scopeAll, sm };
}

/** 回傳可見門市代碼集合（以 DATA_STORES 為母集合） */
function storeScope(sc, ckey, bypass) {
  const a = audience(sc, ckey);
  if (bypass || a.scopeAll) return new Set(DATA_STORES);
  if (a.sm) return new Set(a.i.managed.filter((c) => DATA_STORES.includes(c)));
  return new Set();
}

function readExpect(ep, sc, ckey) {
  const a = audience(sc, ckey);
  const i = a.i;
  const manage = i.has(P.manage);
  const cfg = {
    schedules: { gate: a.published, bypass: false },
    view: { gate: a.published, bypass: false },
    'store-details': { gate: a.published || i.has(P.storeDetailEdit), bypass: i.has(P.storeDetailEdit) || manage },
    headcount: { gate: a.published || i.has(P.storeDetailEdit) || manage, bypass: i.has(P.storeDetailEdit) || manage },
    'own-staff': { gate: a.published || manage, bypass: manage },
    completions: { gate: a.published || i.has(P.checklistEdit), bypass: i.has(P.checklistEdit) || manage },
    'checklist-items': { gate: a.published || i.has(P.checklistEdit), bypass: true },
    trips: { gate: a.published || i.has(P.equipEdit), bypass: i.has(P.equipEdit) || manage },
    'support-requests': { gate: a.published || manage, bypass: manage },
    'support-staff': { gate: a.published || manage, bypass: manage },
    'dept-publish': { gate: a.published || i.has(P.marketing) || i.has(P.merchandise) || i.has(P.checklistEdit), bypass: true },
  }[ep];
  if (!cfg.gate) return { status: 403 };
  const scope = storeScope(sc, ckey, cfg.bypass);
  if (['schedules', 'view', 'store-details', 'headcount', 'own-staff', 'completions'].includes(ep)) {
    return { status: 200, stores: scope };
  }
  if (ep === 'trips') {
    if (scope.size === DATA_STORES.length && (cfg.bypass || a.scopeAll)) return { status: 200, trips: new Set(['T1', 'T2', 'T3']) };
    const names = new Set([...scope].map((c) => state.stores[c].name));
    const out = new Set();
    const T = { T1: ['VW001', 'ZT02'], T2: ['ZT01', 'ZT02'], T3: ['ZT02', 'ZT03'] };
    for (const [k, [f, t]] of Object.entries(T)) if (names.has(state.stores[f].name) || names.has(state.stores[t].name)) out.add(k);
    return { status: 200, trips: out };
  }
  if (ep === 'support-requests' || ep === 'support-staff') {
    const R = { R1: ['VW001', 'ZT02'], R2: ['ZT02', 'ZT03'], R3: ['ZT03', 'VW002'] };
    if (cfg.bypass || a.scopeAll) return { status: 200, reqs: new Set(Object.keys(R)) };
    const out = new Set();
    for (const [k, [rq, sp]] of Object.entries(R)) if (scope.has(rq) || scope.has(sp)) out.add(k);
    return { status: 200, reqs: out };
  }
  if (ep === 'checklist-items') return { status: 200, items: 1 };
  return { status: 200 };
}

function canWrite(sc, ckey, storeCodes, editCodes, unapp, anyStore, rls) {
  const a = audience(sc, ckey);
  const i = a.i;
  if (i.has(P.manage) || editCodes.some((c) => i.has(c))) return true;
  // RLS 寫入 policy 要求的權限（API 先回 403，不再讓 RLS 回 500）；completions 另有依任命放行的規則，不在此檢查
  if (rls && !rls.appointed && rls.codes.length > 0 && !rls.codes.some((c) => i.has(c))) return false;
  if (unapp.some((c) => i.has(c)) && !i.hasAppt) return true;
  // view_all 本身不能寫，但視同 view_own 的讀權：有任命者依任命身分寫入
  const readOk = i.viewOwn || i.viewAll;
  if (!readOk) return false;
  const sup = i.isSup && CAMPAIGNS[ckey].pubSup;
  const sm = i.isSM && CAMPAIGNS[ckey].pubSM;
  const dp = i.isInv && CAMPAIGNS[ckey].pubInv;
  if (!(sup || sm || dp)) return false;
  if (sup || dp) return true;
  const ok = (code) => i.managed.includes(code);
  return anyStore ? storeCodes.some(ok) : storeCodes.every(ok);
}

// ---------------------------------------------------------------- 讀取矩陣
const READ_EPS = {
  view: (cid) => `/api/campaigns/${cid}/view`,
  schedules: (cid) => `/api/campaign-schedules?campaign_id=${cid}`,
  'store-details': (cid) => `/api/campaign-store-details?campaign_id=${cid}`,
  headcount: (cid) => `/api/campaign-store-headcount?campaign_id=${cid}`,
  'own-staff': (cid) => `/api/campaign-store-own-staff?campaign_id=${cid}`,
  completions: (cid) => `/api/campaign-checklist-completions?campaign_id=${cid}`,
  'checklist-items': (cid) => `/api/campaign-checklist-items?campaign_id=${cid}`,
  trips: (cid) => `/api/campaign-equipment-trips?campaign_id=${cid}`,
  'support-requests': (cid) => `/api/campaign-support-requests?campaign_id=${cid}`,
  'support-staff': (cid) => `/api/campaign-support-staff?campaign_id=${cid}`,
  'dept-publish': (cid) => `/api/campaign-department-publish?campaign_id=${cid}`,
};

function storeCodesOf(rows, field = 'store_id') {
  return new Set((rows || []).map((r) => state.storeIdToCode[r[field]]).filter(Boolean));
}

function reverseLookup(map, id) {
  return Object.entries(map).find(([, v]) => (typeof v === 'string' ? v === id : v.id === id))?.[0];
}

async function testReads(key) {
  const sc = SCENARIOS[key];
  const i = ident(sc);
  const myIds = new Set(Object.values(state.campaigns).map((c) => c.id));

  // 入口與清單
  const entry = await api(key, 'GET', '/api/campaigns/entry-access');
  const wantEntry = i.viewAll || (i.viewOwn && (i.hasAppt || i.isInv));
  record(key, 'GET /api/campaigns/entry-access', `canEnter=${wantEntry}`, `${entry.status} canEnter=${entry.json?.canEnter}`, entry.status === 200 && entry.json?.canEnter === wantEntry);

  const pub = await api(key, 'GET', '/api/campaigns/published');
  const wantPubStatus = i.viewAll || i.viewOwn ? 200 : 403;
  if (pub.status !== wantPubStatus) {
    record(key, 'GET /api/campaigns/published', `status ${wantPubStatus}`, `status ${pub.status}`, false);
  } else if (wantPubStatus === 403) {
    record(key, 'GET /api/campaigns/published', 'status 403', 'status 403', true);
  } else {
    const got = new Set((pub.json?.data || []).filter((c) => myIds.has(c.id)).map((c) => reverseLookup(state.campaigns, c.id)));
    const want = new Set(Object.keys(CAMPAIGNS).filter((k) => (k !== 'PUB' || i.viewAll) && audience(sc, k).published));
    record(key, 'GET /api/campaigns/published (CVS 活動)', fmtSet(want), fmtSet(got), setEq(want, got));
  }

  const listing = await api(key, 'GET', '/api/campaigns');
  const wantList =
    i.viewAll || i.viewOwn || [P.manage, P.campaignEdit, P.storeDetailEdit, P.equipEdit, P.checklistEdit, P.marketing, P.merchandise, P.supportReq, P.supportAssign].some((c) => i.has(c));
  const gotList = listing.status === 200 ? new Set((listing.json?.campaigns || []).filter((c) => myIds.has(c.id)).map((c) => reverseLookup(state.campaigns, c.id))) : new Set();
  // 可看全部（含草稿）：view_all / manage / campaign.edit / store_detail.edit / equipment_trip.edit / checklist.edit / marketing / merchandise。
  // support_request.edit、support_assign.edit、staff_overview.view、management.access 只是閘門，其餘人只看已發布給其身分的活動。
  const seeAll = i.viewAll || [P.manage, P.campaignEdit, P.storeDetailEdit, P.equipEdit, P.checklistEdit, P.marketing, P.merchandise].some((c) => i.has(c));
  const wantListSet = !wantList ? new Set() : seeAll ? new Set(Object.keys(CAMPAIGNS)) : new Set(Object.keys(CAMPAIGNS).filter((k) => audience(sc, k).published));
  record(key, 'GET /api/campaigns', wantList ? `200 ${fmtSet(wantListSet)}` : '403', `${listing.status} ${fmtSet(gotList)}`, wantList ? listing.status === 200 && setEq(wantListSet, gotList) : listing.status === 403);

  // 每個活動 × 每支 API
  for (const ckey of ['ALL', 'SUP', 'SM', 'INV', 'DRAFT']) {
    const cid = state.campaigns[ckey].id;
    for (const [ep, mk] of Object.entries(READ_EPS)) {
      const exp = readExpect(ep, sc, ckey);
      const res = await api(key, 'GET', mk(cid));
      const label = `GET ${ep} [${ckey}]`;
      if (exp.status === 403) {
        // 擋下 = 403（API 閘門）或 404（RLS 讓未發布活動對該使用者不可見）
        record(key, label, '擋下(403/404)', String(res.status), res.status === 403 || res.status === 404);
        continue;
      }
      if (res.status !== 200 || res.json?.success === false) {
        record(key, label, '200', `${res.status} ${res.json?.error || ''}`.trim(), false);
        continue;
      }
      if (exp.stores) {
        const rows = ep === 'view' || ep === 'schedules' ? res.json.schedules : res.json.data;
        const got = storeCodesOf(rows);
        record(key, label, fmtSet(exp.stores), fmtSet(got), setEq(exp.stores, got));
      } else if (exp.trips) {
        const got = new Set((res.json.data || []).map((t) => reverseLookup(state.trips[ckey], t.id)).filter(Boolean));
        record(key, label, fmtSet(exp.trips), fmtSet(got), setEq(exp.trips, got));
      } else if (exp.reqs) {
        const rows = res.json.data || [];
        const got = new Set(
          rows
            .map((r) => {
              const id = ep === 'support-requests' ? r.id : r.support_request_id;
              return Object.entries(state.requests[ckey]).find(([, v]) => v.id === id)?.[0];
            })
            .filter(Boolean)
        );
        record(key, label, fmtSet(exp.reqs), fmtSet(got), setEq(exp.reqs, got));
      } else if (exp.items !== undefined) {
        const got = (res.json.data || []).length;
        record(key, label, `items=${exp.items}`, `items=${got}`, got === exp.items);
      } else {
        record(key, label, '200', '200', true);
      }
    }
  }
}

// ---------------------------------------------------------------- RLS 直讀（使用者 JWT，繞過 API）
/**
 * 第二輪修正（草稿外洩）：support_request.edit / support_assign.edit / staff_overview.view 不得讓人在 RLS 層直接讀到草稿活動。
 * 只驗證沒有其他放行來源的情境，期望值：campaigns = 已發布給其身分的活動；沒有任命者讀子表 = 0 筆。
 */
async function testRls(key) {
  const sc = SCENARIOS[key];
  const u = state.users[key];
  const c = createClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${u.session.access_token}` } },
  });
  const myIds = new Set(Object.values(state.campaigns).map((x) => x.id));
  const camps = await c.from('campaigns').select('id').like('name', `${PREFIX}%`);
  const got = new Set((camps.data || []).filter((x) => myIds.has(x.id)).map((x) => reverseLookup(state.campaigns, x.id)));
  const want = new Set(Object.keys(CAMPAIGNS).filter((k) => audience(sc, k).published));
  record(key, 'RLS 直讀 campaigns', fmtSet(want), camps.error ? `error ${camps.error.message}` : fmtSet(got), !camps.error && setEq(want, got));
  // 任命者直讀子表：只能讀到「已發布給其身分」活動上的資料（草稿 / 未發布給店長的活動 = 0 筆）。
  if (sc.appts.some((a) => a[1] === 'store_manager') && !ident(sc).viewAll) {
    for (const t of ['campaign_store_details', 'campaign_store_headcount', 'campaign_store_own_staff', 'campaign_support_requests', 'campaign_support_staff']) {
      const draftIds = Object.keys(CAMPAIGNS).filter((k) => !audience(sc, k).published).map((k) => state.campaigns[k].id);
      if (draftIds.length === 0) continue;
      const r = await c.from(t).select('id').in('campaign_id', draftIds);
      const n = (r.data || []).length;
      record(key, `RLS 直讀 ${t}（任命者、未發布給其身分的活動）`, '0 筆', r.error ? `error ${r.error.message}` : `${n} 筆`, !r.error && n === 0);
    }
    const itemIds = Object.keys(CAMPAIGNS).filter((k) => !audience(sc, k).published && state.lanes[0].items[k]).map((k) => state.lanes[0].items[k]);
    if (itemIds.length > 0) {
      const r = await c.from('campaign_checklist_completions').select('id').in('checklist_item_id', itemIds);
      const n = (r.data || []).length;
      record(key, 'RLS 直讀 campaign_checklist_completions（任命者、未發布給其身分的活動）', '0 筆', r.error ? `error ${r.error.message}` : `${n} 筆`, !r.error && n === 0);
    }
  }
  if (sc.appts.length === 0) {
    for (const t of ['campaign_support_requests', 'campaign_support_staff', 'campaign_store_headcount', 'campaign_store_own_staff']) {
      const r = await c.from(t).select('id').in('campaign_id', [...myIds]);
      const n = (r.data || []).length;
      record(key, `RLS 直讀 ${t}（無任命、無 view_all）`, '0 筆', r.error ? `error ${r.error.message}` : `${n} 筆`, !r.error && n === 0);
    }
  }
}

// ---------------------------------------------------------------- RLS 直寫（使用者 JWT，繞過 API）
/**
 * 第三輪：RLS 寫入 policy 必須與 API（authorizeCampaignStoreWrite）完全一致。
 * 直接以使用者 JWT 對資料表寫入（不帶 RETURNING，避免 SELECT policy 影響判斷），再用 service_role 核對資料庫實際有沒有被改。
 * 期望值與 API 寫入矩陣共用同一個 oracle（canWrite）。
 */
async function testRlsDirectWrites(key, L) {
  const sc = SCENARIOS[key];
  const u = state.users[key];
  const i0 = ident(sc);
  const db = createClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${u.session.access_token}` } },
  });
  const sid = (c) => state.stores[c].id;
  const light = !(i0.viewOwn || (i0.viewAll && i0.hasAppt) || i0.has(P.manage) || [P.storeDetailEdit, P.checklistEdit, P.equipEdit, P.supportAssign, P.supportReq, P.campaignEdit].some((c) => i0.has(c)));
  const CKS = light ? ['ALL'] : ['ALL', 'DRAFT', 'SM', 'SUP'];
  const STORES = light ? ['VW001'] : ['VW001', 'VW002', 'ZT01'];
  const tag = 'rw' + crypto.randomBytes(3).toString('hex');
  const chk = (label, want, changed, err) =>
    record(key, `RLS 直寫 ${label}`, want ? '可寫' : '不可寫', `err=${err?.code || '-'} changed=${changed}`, changed === want);

  for (const ck of CKS) {
    const cid = L.campaigns[ck].id;
    for (const store of STORES) {
      // completions UPDATE
      {
        const item = L.items[ck];
        const want = canWrite(sc, ck, [store], [P.checklistEdit], [], false, undefined);
        await admin.from('campaign_checklist_completions').update({ manager_note: null }).eq('checklist_item_id', item).eq('store_id', sid(store));
        const r = await db.from('campaign_checklist_completions').update({ manager_note: tag }).eq('checklist_item_id', item).eq('store_id', sid(store));
        const row = must(await admin.from('campaign_checklist_completions').select('manager_note').eq('checklist_item_id', item).eq('store_id', sid(store)).maybeSingle(), 'rw comp');
        chk(`UPDATE completions [${ck}] ${store}`, want, row?.manager_note === tag, r.error);
        await admin.from('campaign_checklist_completions').update({ manager_note: null }).eq('checklist_item_id', item).eq('store_id', sid(store));
      }
      // completions DELETE（刪除成功才算可寫，之後補回）
      {
        const item = L.items[ck];
        const want = canWrite(sc, ck, [store], [P.checklistEdit], [], false, undefined);
        const r = await db.from('campaign_checklist_completions').delete().eq('checklist_item_id', item).eq('store_id', sid(store));
        const row = must(await admin.from('campaign_checklist_completions').select('id').eq('checklist_item_id', item).eq('store_id', sid(store)).maybeSingle(), 'rw comp del');
        chk(`DELETE completions [${ck}] ${store}`, want, !row, r.error);
        if (!row) must(await admin.from('campaign_checklist_completions').insert({ checklist_item_id: item, store_id: sid(store), is_completed: false }), 'rw comp reseed');
      }
      // own_staff INSERT / DELETE
      {
        const want = canWrite(sc, ck, [store], [], [], false, { codes: [P.supportAssign] });
        const code = 'RWI' + tag;
        await admin.from('campaign_store_own_staff').delete().eq('campaign_id', cid).eq('employee_code', code);
        const r = await db.from('campaign_store_own_staff').insert({ campaign_id: cid, store_id: sid(store), employee_code: code, employee_name: 'rw', sort_order: 1 });
        const n = (must(await admin.from('campaign_store_own_staff').select('id').eq('campaign_id', cid).eq('store_id', sid(store)).eq('employee_code', code), 'rw own') || []).length;
        chk(`INSERT own_staff [${ck}] ${store}`, want, n > 0, r.error);
        await admin.from('campaign_store_own_staff').delete().eq('campaign_id', cid).eq('employee_code', code);

        const dcode = 'RWD' + tag;
        must(await admin.from('campaign_store_own_staff').insert({ campaign_id: cid, store_id: sid(store), employee_code: dcode, employee_name: 'rw', sort_order: 9 }), 'rw own seed');
        const r2 = await db.from('campaign_store_own_staff').delete().eq('campaign_id', cid).eq('store_id', sid(store)).eq('employee_code', dcode);
        const left = (must(await admin.from('campaign_store_own_staff').select('id').eq('campaign_id', cid).eq('store_id', sid(store)).eq('employee_code', dcode), 'rw own del') || []).length;
        chk(`DELETE own_staff [${ck}] ${store}`, want, left === 0, r2.error);
        await admin.from('campaign_store_own_staff').delete().eq('campaign_id', cid).eq('employee_code', dcode);
      }
      // support_requests INSERT（請求門市 = store，支援門市 ZT03 避免撞到種子資料的唯一鍵）
      {
        const want = canWrite(sc, ck, [store], [], [], false, { codes: [P.supportReq] });
        const r = await db.from('campaign_support_requests').insert({ campaign_id: cid, requesting_store_id: sid(store), supporting_store_id: sid('ZT03'), requested_count: 77 });
        const n = (must(await admin.from('campaign_support_requests').select('id').eq('campaign_id', cid).eq('requesting_store_id', sid(store)).eq('supporting_store_id', sid('ZT03')).eq('requested_count', 77), 'rw req') || []).length;
        chk(`INSERT support_requests [${ck}] req=${store}`, want, n > 0, r.error);
        await admin.from('campaign_support_requests').delete().eq('campaign_id', cid).eq('requested_count', 77);
      }
      // support_staff INSERT（請求門市 = store，支援門市 ZT02；任一端在任命內即可）
      {
        const want = canWrite(sc, ck, [store, 'ZT02'], [], [], true, { codes: [P.supportAssign] });
        const rq = L.requests[ck].R1;
        const code = 'RWS' + store;
        const r = await db.from('campaign_support_staff').insert({ support_request_id: rq.id, campaign_id: cid, requesting_store_id: sid(store), supporting_store_id: sid('ZT02'), employee_code: code, employee_name: 'rw', sort_order: 5 });
        const n = (must(await admin.from('campaign_support_staff').select('id').eq('campaign_id', cid).eq('employee_code', code), 'rw sstaff') || []).length;
        chk(`INSERT support_staff [${ck}] req=${store} sup=ZT02`, want, n > 0, r.error);
        await admin.from('campaign_support_staff').delete().eq('campaign_id', cid).eq('employee_code', code);
      }
    }
    // support_requests UPDATE：改 requested_count（舊列 USING）與改請求門市（新列 WITH CHECK）
    {
      const rq = L.requests[ck].R1; // 請求門市 VW001
      const want1 = canWrite(sc, ck, ['VW001'], [], [], false, { codes: [P.supportReq] });
      await admin.from('campaign_support_requests').update({ requested_count: 1 }).eq('id', rq.id);
      const r = await db.from('campaign_support_requests').update({ requested_count: 66 }).eq('id', rq.id);
      const row = must(await admin.from('campaign_support_requests').select('requested_count,requesting_store_id').eq('id', rq.id).maybeSingle(), 'rw req upd');
      chk(`UPDATE support_requests count [${ck}] req=VW001`, want1, row?.requested_count === 66, r.error);
      await admin.from('campaign_support_requests').update({ requested_count: 1 }).eq('id', rq.id);

      const want2 = want1 && canWrite(sc, ck, ['ZT01'], [], [], false, { codes: [P.supportReq] });
      const r2 = await db.from('campaign_support_requests').update({ requesting_store_id: sid('ZT01') }).eq('id', rq.id);
      const row2 = must(await admin.from('campaign_support_requests').select('requesting_store_id').eq('id', rq.id).maybeSingle(), 'rw req upd2');
      chk(`UPDATE support_requests 改請求門市 VW001->ZT01 [${ck}]（WITH CHECK）`, want2, row2?.requesting_store_id === sid('ZT01'), r2.error);
      await admin.from('campaign_support_requests').update({ requesting_store_id: sid('VW001') }).eq('id', rq.id);
    }
    // 無 edit 權不得直寫：headcount / store_details / schedules
    {
      const wantHc = i0.has(P.manage) || i0.has(P.storeDetailEdit);
      const f = (q) => q.eq('campaign_id', cid).eq('store_id', sid('VW001'));
      await f(admin.from('campaign_store_headcount').update({ extra_support_count: 0 }));
      const r = await f(db.from('campaign_store_headcount').update({ extra_support_count: 55 }));
      const row = must(await f(admin.from('campaign_store_headcount').select('extra_support_count')).maybeSingle(), 'rw hc');
      chk(`UPDATE headcount [${ck}] VW001`, wantHc, row?.extra_support_count === 55, r.error);
      await f(admin.from('campaign_store_headcount').update({ extra_support_count: 0 }));

      const r2 = await f(db.from('campaign_store_details').update({ notes: tag }));
      const row2 = must(await f(admin.from('campaign_store_details').select('notes')).maybeSingle(), 'rw det');
      chk(`UPDATE store_details [${ck}] VW001`, wantHc, row2?.notes === tag, r2.error);
      await f(admin.from('campaign_store_details').update({ notes: 'cvs' }));

      const wantSch = i0.has(P.manage) || i0.has(P.campaignEdit);
      const r3 = await f(db.from('campaign_schedules').update({ activity_date: '2026-12-25' }));
      const row3 = must(await f(admin.from('campaign_schedules').select('activity_date')).maybeSingle(), 'rw sch');
      chk(`UPDATE schedules [${ck}] VW001`, wantSch, row3?.activity_date === '2026-12-25', r3.error);
      await f(admin.from('campaign_schedules').update({ activity_date: '2026-11-10' }));
    }
  }
  // campaigns 直接改發布狀態（lane 專屬的 DRAFT 活動）
  {
    const cid = L.campaigns.DRAFT.id;
    const want = i0.has(P.manage) || i0.has(P.campaignEdit);
    await admin.from('campaigns').update({ published_to_supervisors: false }).eq('id', cid);
    const r = await db.from('campaigns').update({ published_to_supervisors: true }).eq('id', cid);
    const row = must(await admin.from('campaigns').select('published_to_supervisors').eq('id', cid).maybeSingle(), 'rw camp');
    chk('UPDATE campaigns 發布 [DRAFT]', want, row?.published_to_supervisors === true, r.error);
    await admin.from('campaigns').update({ published_to_supervisors: false }).eq('id', cid);
  }
}

// ---------------------------------------------------------------- 寫入矩陣
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isDenied = (status) => status === 401 || status === 403 || status === 404;

/**
 * RLS 寫入政策：manage 或指定權限；completions 另允許「該門市的任命者」，
 * 以及（本輪新增）有督導任命或盤點組、讀權為 view_own/view_all 且活動已發布給督導/盤點組者寫任一門市。
 */
function rlsAllows(sc, rls, storeCodes, ckey) {
  const i = ident(sc);
  if (i.has(P.manage) || rls.codes.some((c) => i.has(c))) return true;
  if (rls.appointed) {
    // 店長任命門市：只認 store_manager 任命、讀權為 view_own/view_all、且活動已發布給店長（RLS campaign_user_manages_store）
    if ((i.viewOwn || i.viewAll) && CAMPAIGNS[ckey].pubSM && sc.appts.some(([code, role]) => role === 'store_manager' && storeCodes.includes(code))) return true;
    if ((i.viewOwn || i.viewAll) && ((i.isSup && CAMPAIGNS[ckey].pubSup) || (i.isInv && CAMPAIGNS[ckey].pubInv))) return true;
  }
  return false;
}

async function writeCase(key, label, ckey, storeCodes, editCodes, unapp, anyStore, exec, effect, reset, rls) {
  const sc = SCENARIOS[key];
  const apiAllow = canWrite(sc, ckey, storeCodes, editCodes, unapp, anyStore, rls);
  const rlsOk = rlsAllows(sc, rls, storeCodes, ckey);
  // API 與 RLS 必須一致：API 放行但 RLS 會擋 => 視為失敗（舊版會回 500）
  const want = apiAllow && rlsOk;
  try {
    await reset();
    const res = await exec();
    const changed = await effect();
    // 兩種預期：1) API 與 RLS 都放行 => 200 + 資料已寫入；2) 其餘 => 401/403/404 + 資料不變（API 與 RLS 不一致視為失敗）
    const okStatus = want ? res.status === 200 && res.json?.success !== false : isDenied(res.status);
    const okEffect = want ? changed === true : changed === false;
    const expText = want ? '200 + 資料已寫入' : '擋下(401/403/404，不得是 500) + 資料不變';
    record(key, label, expText, `${res.status} ${changed ? '資料已變更' : '資料不變'}${res.json?.error ? ' (' + res.json.error + ')' : ''}`, okStatus && okEffect);
  } catch (e) {
    record(key, label, want ? 'allow' : 'deny', `例外：${e.message}`, false);
  } finally {
    try {
      await reset();
    } catch {
      /* 清除階段會再處理 */
    }
  }
}

async function testWrites(key, idx, L) {
  const tag = String(100 + idx); // 每個情境不同，用來判斷「是誰寫的」
  const cidOf = (k) => L.campaigns[k].id;
  const sid = (c) => state.stores[c].id;
  // 明顯全部會被擋的情境（沒有 view_own、沒有任何編輯權/manage）只抽樣一間門市，節省時間
  const i0 = ident(SCENARIOS[key]);
  const light = !(i0.viewOwn || (i0.viewAll && i0.hasAppt) || i0.has(P.manage) || [P.storeDetailEdit, P.checklistEdit, P.equipEdit, P.supportAssign, P.supportReq].some((c) => i0.has(c)));
  const WRITE_STORES = light ? ['VW001'] : ['VW001', 'VW002', 'ZT02'];

  // W1 headcount POST（四種活動 × 三間門市）
  for (const ckey of light ? ['ALL'] : ['ALL', 'DRAFT', 'SM', 'SUP']) {
    for (const store of WRITE_STORES) {
      await writeCase(
        key, `POST headcount [${ckey}] ${store}`, ckey, [store], [P.storeDetailEdit], [], false,
        () => api(key, 'POST', '/api/campaign-store-headcount', { campaign_id: cidOf(ckey), store_id: sid(store), extra_support_count: Number(tag) }),
        async () => {
          const r = must(await admin.from('campaign_store_headcount').select('extra_support_count').eq('campaign_id', cidOf(ckey)).eq('store_id', sid(store)).maybeSingle(), 'effect');
          return r?.extra_support_count === Number(tag);
        },
        async () => {
          await admin.from('campaign_store_headcount').update({ extra_support_count: 0 }).eq('campaign_id', cidOf(ckey)).eq('store_id', sid(store));
        },
        { codes: [P.storeDetailEdit] }
      );
    }
  }

  const ALL = 'ALL';
  for (const store of WRITE_STORES) {
    // W2 own-staff POST
    const code = `CVSW${tag}`;
    const delOwn = async () => {
      await admin.from('campaign_store_own_staff').delete().eq('campaign_id', cidOf(ALL)).eq('store_id', sid(store)).eq('employee_code', code);
    };
    await writeCase(
      key, `POST own-staff [ALL] ${store}`, ALL, [store], [], [], false,
      () => api(key, 'POST', '/api/campaign-store-own-staff', { campaign_id: cidOf(ALL), store_id: sid(store), employee_code: code, employee_name: 'cvs w' }),
      async () => {
        const r = must(await admin.from('campaign_store_own_staff').select('id').eq('campaign_id', cidOf(ALL)).eq('store_id', sid(store)).eq('employee_code', code), 'effect');
        return r.length > 0;
      },
      delOwn,
      { codes: [P.supportAssign] }
    );

    // W3 own-staff DELETE（先 seed 一筆，成功時應被刪除）
    const delCode = `CVSD${tag}`;
    await writeCase(
      key, `DELETE own-staff [ALL] ${store}`, ALL, [store], [], [], false,
      () => api(key, 'DELETE', '/api/campaign-store-own-staff', { campaign_id: cidOf(ALL), store_id: sid(store), employee_code: delCode }),
      async () => {
        const r = must(await admin.from('campaign_store_own_staff').select('id').eq('campaign_id', cidOf(ALL)).eq('store_id', sid(store)).eq('employee_code', delCode), 'effect');
        return r.length === 0; // 資料被刪 = 有變更
      },
      async () => {
        await admin.from('campaign_store_own_staff').delete().eq('campaign_id', cidOf(ALL)).eq('store_id', sid(store)).eq('employee_code', delCode);
        must(await admin.from('campaign_store_own_staff').insert({ campaign_id: cidOf(ALL), store_id: sid(store), employee_code: delCode, employee_name: 'cvs d', sort_order: 9 }), 'seed own-staff');
      },
      { codes: [P.supportAssign] }
    );

    // W4 checklist completion POST
    const itemId = L.items[ALL];
    await writeCase(
      key, `POST checklist-completions [ALL] ${store}`, ALL, [store], [P.checklistEdit], [], false,
      () => api(key, 'POST', '/api/campaign-checklist-completions', { checklist_item_id: itemId, store_id: sid(store), is_completed: true, manager_note: `n${tag}` }),
      async () => {
        const r = must(await admin.from('campaign_checklist_completions').select('is_completed,manager_note').eq('checklist_item_id', itemId).eq('store_id', sid(store)).maybeSingle(), 'effect');
        return r?.manager_note === `n${tag}`;
      },
      async () => {
        await admin.from('campaign_checklist_completions').update({ is_completed: false, manager_note: null }).eq('checklist_item_id', itemId).eq('store_id', sid(store));
      },
      { codes: [P.checklistEdit], appointed: true }
    );

    // W5 support-requests POST（請求門市 = store，支援門市 ZT01）
    const delReq = async () => {
      await admin.from('campaign_support_requests').delete().eq('campaign_id', cidOf(ALL)).eq('requesting_store_id', sid(store)).eq('supporting_store_id', sid('ZT01'));
    };
    await writeCase(
      key, `POST support-requests [ALL] req=${store}`, ALL, [store], [], [], false,
      () => api(key, 'POST', '/api/campaign-support-requests', { campaign_id: cidOf(ALL), requesting_store_id: sid(store), supporting_store_id: sid('ZT01'), requested_count: 3, notes: `n${tag}` }),
      async () => {
        const r = must(await admin.from('campaign_support_requests').select('id').eq('campaign_id', cidOf(ALL)).eq('requesting_store_id', sid(store)).eq('supporting_store_id', sid('ZT01')), 'effect');
        return r.length > 0;
      },
      delReq,
      { codes: [P.supportReq] }
    );

    // W6 support-requests DELETE（seed 後刪）
    let seededReq = null;
    await writeCase(
      key, `DELETE support-requests [ALL] req=${store}`, ALL, [store], [], [], false,
      () => api(key, 'DELETE', '/api/campaign-support-requests', { id: seededReq }),
      async () => {
        const r = must(await admin.from('campaign_support_requests').select('id').eq('id', seededReq), 'effect');
        return r.length === 0;
      },
      async () => {
        await delReq();
        const row = must(
          await admin.from('campaign_support_requests').insert({ campaign_id: cidOf(ALL), requesting_store_id: sid(store), supporting_store_id: sid('ZT01'), requested_count: 1 }).select('id').single(),
          'seed support-request'
        );
        seededReq = row.id;
      },
      { codes: [P.supportReq] }
    );
    await delReq();
  }

  // W7 / W8 support-staff（三筆支援需求；店長只要請求門市或支援門市其一是自己的就可）
  for (const [rk, r] of Object.entries(L.requests[ALL]).filter(([k]) => !light || k === 'R1')) {
    const empCode = `CVSS${tag}`;
    await writeCase(
      key, `POST support-staff [ALL] ${rk}(${r.req}->${r.sup})`, ALL, [r.req, r.sup], [], [], true,
      () =>
        api(key, 'POST', '/api/campaign-support-staff', {
          support_request_id: r.id, campaign_id: cidOf(ALL), supporting_store_id: sid(r.sup), requesting_store_id: sid(r.req), employee_code: empCode, employee_name: 'cvs s',
        }),
      async () => {
        const rows = must(await admin.from('campaign_support_staff').select('id').eq('support_request_id', r.id).eq('employee_code', empCode), 'effect');
        return rows.length > 0;
      },
      async () => {
        await admin.from('campaign_support_staff').delete().eq('support_request_id', r.id).eq('employee_code', empCode);
      },
      { codes: [P.supportAssign] }
    );
    const delCode = `CVSX${tag}`;
    let staffId = null;
    await writeCase(
      key, `DELETE support-staff [ALL] ${rk}(${r.req}->${r.sup})`, ALL, [r.req, r.sup], [], [], true,
      () => api(key, 'DELETE', '/api/campaign-support-staff', { id: staffId }),
      async () => {
        const rows = must(await admin.from('campaign_support_staff').select('id').eq('id', staffId), 'effect');
        return rows.length === 0;
      },
      async () => {
        await admin.from('campaign_support_staff').delete().eq('support_request_id', r.id).eq('employee_code', delCode);
        const row = must(
          await admin.from('campaign_support_staff').insert({
            support_request_id: r.id, campaign_id: cidOf(ALL), supporting_store_id: sid(r.sup), requesting_store_id: sid(r.req), employee_code: delCode, employee_name: 'cvs x', sort_order: 9,
          }).select('id').single(),
          'seed support-staff'
        );
        staffId = row.id;
      },
      { codes: [P.supportAssign] }
    );
    await admin.from('campaign_support_staff').delete().eq('support_request_id', r.id).eq('employee_code', delCode);
  }

  // W7b 硬性保證（不經矩陣推算）：非 manage 的店長／督導，經 API 新增支援人員必須 200 且寫入。
  // 防止矩陣預期與實作一起漂移，把合法操作誤判為「應擋」。
  if (key === 'A2_mgr_realistic' || key === 'C2_sup_realistic') {
    const mine = Object.values(L.requests[ALL]).find((r) => key === 'C2_sup_realistic' || r.req === 'VW001' || r.sup === 'VW001');
    const hardCode = `CVSH${tag}`;
    try {
      await admin.from('campaign_support_staff').delete().eq('support_request_id', mine.id).eq('employee_code', hardCode);
      const res = await api(key, 'POST', '/api/campaign-support-staff', {
        support_request_id: mine.id, campaign_id: cidOf(ALL), supporting_store_id: sid(mine.sup), requesting_store_id: sid(mine.req), employee_code: hardCode, employee_name: 'cvs hard',
      });
      const rows = must(await admin.from('campaign_support_staff').select('id').eq('support_request_id', mine.id).eq('employee_code', hardCode), 'hard effect');
      record(key, `POST support-staff 硬性保證(非 manage 合法操作必成功) ${mine.req}->${mine.sup}`, '200 + 資料已寫入', `${res.status} ${rows.length ? '資料已寫入' : '未寫入'}${res.json?.error ? ' (' + res.json.error + ')' : ''}`, res.status === 200 && res.json?.success !== false && rows.length === 1);
    } catch (e) {
      record(key, 'POST support-staff 硬性保證', '200 + 資料已寫入', `例外：${e.message}`, false);
    } finally {
      await admin.from('campaign_support_staff').delete().eq('support_request_id', mine.id).eq('employee_code', hardCode);
    }
  }

  // W9 發布 PATCH（只有 activity.manage / activity.campaign.edit）
  {
    const pid = cidOf('PUB');
    const i = ident(SCENARIOS[key]);
    const want = i.has(P.manage) || i.has(P.campaignEdit);
    const resetPub = async () => {
      await admin.from('campaigns').update({ published_to_supervisors: false }).eq('id', pid);
    };
    await resetPub();
    const res = await api(key, 'PATCH', '/api/campaigns/publish', { campaignId: pid, publishType: 'supervisors', status: true });
    const row = must(await admin.from('campaigns').select('published_to_supervisors').eq('id', pid).single(), 'effect');
    const changed = row.published_to_supervisors === true;
    const ok = want ? res.status === 200 && changed : isDenied(res.status) && !changed;
    record(key, 'PATCH /api/campaigns/publish', want ? '200 + 旗標已更新' : '擋下 + 旗標不變', `${res.status} ${changed ? '旗標已更新' : '旗標不變'}${res.json?.error ? ' (' + res.json.error + ')' : ''}`, ok);
    await resetPub();
  }
}

// ---------------------------------------------------------------- UI（選用）
async function testUI() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    try {
      ({ chromium } = require('playwright-core'));
    } catch {
      record('UI', 'playwright', '可用', '未安裝，略過 UI 測試', false);
      return;
    }
  }
  const browser = await chromium.launch();
  const consoleErrors = [];
  try {
    const ctxFor = async (key) => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      const u = state.users[key];
      const name = `sb-${DEV_REF}-auth-token`;
      const value = 'base64-' + Buffer.from(JSON.stringify(u.session)).toString('base64url');
      const cookies = [];
      const SIZE = 3180;
      if (value.length <= SIZE) cookies.push({ name, value, url: BASE });
      else for (let n = 0, p = 0; p < value.length; p += SIZE, n += 1) cookies.push({ name: `${name}.${n}`, value: value.slice(p, p + SIZE), url: BASE });
      await ctx.addCookies(cookies);
      return ctx;
    };

    // 1) /activity-management：看得到的活動名稱
    for (const key of process.env.CVS_UI_PUB_ONLY ? [] : Object.keys(SCENARIOS)) {
      const ctx = await ctxFor(key);
      const page = await ctx.newPage();
      page.on('console', (m) => {
        if (m.type() === 'error' && !/403|404|Failed to load resource|權限不足/.test(m.text())) consoleErrors.push(`${key}: ${m.text().slice(0, 120)}`);
      });
      await page.goto(`${BASE}/activity-management`, { waitUntil: 'networkidle', timeout: 90000 });
      await page.waitForTimeout(800);
      const text = await page.locator('body').innerText();
      const sc = SCENARIOS[key];
      const i = ident(sc);
      const want = new Set(Object.keys(CAMPAIGNS).filter((k) => ['ALL', 'SUP', 'SM', 'INV', 'DRAFT'].includes(k) && audience(sc, k).published));
      const got = new Set(['ALL', 'SUP', 'SM', 'INV', 'DRAFT'].filter((k) => new RegExp(`${PREFIX}-${k}(?![A-Z])`).test(text)));
      record(key, 'UI /activity-management 顯示的 CVS 活動', fmtSet(want), fmtSet(got), setEq(want, got));
      await ctx.close();
    }

    // 2) 每月人員狀態頁「活動檢視」按鈕
    for (const key of process.env.CVS_UI_PUB_ONLY ? [] : Object.keys(SCENARIOS)) {
      const ctx = await ctxFor(key);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/monthly-status`, { waitUntil: 'networkidle', timeout: 90000 });
      await page.waitForTimeout(1500);
      const url = page.url();
      const btn = await page.locator('a[href="/activity-management"]').count();
      const sc = SCENARIOS[key];
      const i = ident(sc);
      const wantBtn = i.viewAll || (i.viewOwn && (i.hasAppt || i.isInv));
      const onPage = url.includes('/monthly-status');
      // 有些帳號沒有每月人員狀態頁權限，會被導走；此時按鈕不存在視為「頁面不可進入」，只在可進入時比對
      record(key, 'UI /monthly-status「活動檢視」按鈕', onPage ? `visible=${wantBtn}` : '頁面不可進入(略過)', onPage ? `visible=${btn > 0}` : `被導向 ${new URL(url).pathname}`, onPage ? (btn > 0) === wantBtn : true);
      await ctx.close();
    }

    // 2b) 排程頁「發布」按鈕：只有 activity.manage / activity.campaign.edit 才顯示。
    // DEV 的 user_roles / role_permissions 開了 RLS 但沒有 policy，瀏覽器端的權限查詢對非 admin 一律查不到，
    // 所以頁面「有權限時顯示」無法在 DEV 以測試帳號驗證；改為：
    //   (a) UI：只有編輯權（J）時按鈕不顯示；
    //   (b) 靜態檢查原始碼：按鈕包在 canPublishCampaign 內，且 canPublishCampaign 只由 admin / activity.manage / activity.campaign.edit 決定。
    {
      const key = 'J_edit_only';
      const ctx = await ctxFor(key);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/admin/activity-management/schedule/${state.campaigns.PUB.id}`, { waitUntil: 'networkidle', timeout: 90000 });
      await page.waitForSelector('h1', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(5000);
      const onPage = page.url().includes('/admin/activity-management/schedule/');
      const shown = await page.getByRole('button', { name: /發布給(督導|店長|盤點組)/ }).count();
      record(key, 'UI 排程頁發布按鈕（只有 store_detail/checklist/equipment_trip 編輯權）', onPage ? 'visible=false' : '頁面不可進入(略過)', onPage ? `visible=${shown > 0}` : `被導向 ${new URL(page.url()).pathname}`, onPage ? shown === 0 : true);
      await ctx.close();
      const src = fs.readFileSync(path.join(ROOT, 'app/admin/activity-management/schedule/[id]/page.tsx'), 'utf8');
      const wrapped = /\{canPublishCampaign && \(\s*<div[^>]*>\s*<button\s+onClick=\{\(\) => handlePublish\('supervisors'\)\}/.test(src);
      const setter = /setCanPublishCampaign\(isRbacAdmin \|\| permSet\.has\('activity\.manage'\) \|\| permSet\.has\('activity\.campaign\.edit'\)\)/.test(src);
      record('STATIC', '排程頁發布按鈕包在 canPublishCampaign 內', 'true', String(wrapped), wrapped);
      record('STATIC', 'canPublishCampaign 只由 admin / activity.manage / activity.campaign.edit 決定', 'true', String(setter), setter);
    }

    // 3) 權限頁顯示（用 admin 預設以外的 I_view_all 帳號無權限進角色頁，改用既有 admin 路徑：以 service role 取一個管理員 session）
    const roleLabels = process.env.CVS_UI_PUB_ONLY ? [] : await roleAdminCheck(browser);
    for (const r of roleLabels) record('ROLE-UI', r.label, r.expected, r.actual, r.ok);
  } finally {
    await browser.close();
  }
  if (consoleErrors.length) record('UI', 'console 錯誤', '無', consoleErrors.slice(0, 5).join(' | '), false);
}

/** 建立臨時管理員（cvs-test-admin）進入角色編輯頁，檢查活動專案查看權限的顯示名稱 */
async function roleAdminCheck(browser) {
  const out = [];
  const email = `${EMAIL_PREFIX}ui-admin@example.test`;
  const password = crypto.randomBytes(18).toString('base64url') + 'aA1!';
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'CVS UI Admin' } });
  if (created.error) return [{ label: '建立 UI 管理員', expected: 'ok', actual: created.error.message, ok: false }];
  const uid = created.data.user.id;
  await admin.from('profiles').update({ role: 'admin', job_title: '系統管理員' }).eq('id', uid);
  const c = createClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const s = await c.auth.signInWithPassword({ email, password });
  if (s.error) return [{ label: '登入 UI 管理員', expected: 'ok', actual: s.error.message, ok: false }];
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const name = `sb-${DEV_REF}-auth-token`;
  const value = 'base64-' + Buffer.from(JSON.stringify(s.data.session)).toString('base64url');
  const cookies = [];
  const SIZE = 3180;
  if (value.length <= SIZE) cookies.push({ name, value, url: BASE });
  else for (let n = 0, p = 0; p < value.length; p += SIZE, n += 1) cookies.push({ name: `${name}.${n}`, value: value.slice(p, p + SIZE), url: BASE });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  // [情境, 應被勾選的元件類型, 勾選元件的名稱]
  const checks = [
    ['A_single_mgr', 'radio', /查看自己管理門市/],
    ['I_view_all', 'radio', /查看全部/],
    ['L_legacy_view', 'checkbox', /（舊）查看，將停用/],
  ];
  for (const [key, kind, nameRe] of checks) {
    await page.goto(`${BASE}/admin/roles/${state.roles[key]}`, { waitUntil: 'networkidle', timeout: 90000 });
    await page.waitForTimeout(1500);
    await page.getByText('展開分類').first().click();
    await page.waitForTimeout(1200);
    const card = page.locator("xpath=//*[normalize-space(text())='活動專案']/ancestor::div[.//button[contains(.,'個別設定')]][1]");
    await card.first().locator("button:has-text('個別設定')").first().click();
    await page.waitForTimeout(1200);
    const text = await page.locator('body').innerText();
    for (const label of ['查看全部', '查看自己管理門市', '（舊）查看，將停用']) {
      const has = text.includes(label);
      out.push({ label: `權限頁 role=${key} 顯示「${label}」`, expected: '有', actual: has ? '有' : '無', ok: has });
    }
    const checked = await page.getByRole(kind, { name: nameRe }).first().isChecked().catch(() => false);
    out.push({ label: `權限頁 role=${key} 已勾選 ${nameRe.source}`, expected: '已勾選', actual: checked ? '已勾選' : '未勾選', ok: checked });
    // 快速預設按鈕要反映實際勾選範圍：只有 view_all 時不顯示「查看自己管理門市」預設；舊 view 時顯示舊 view 的標籤
    const presetTexts = await page.locator('[role="group"][aria-label="活動專案 授權模式"] button').allInnerTexts().catch(() => []);
    const presetOwn = presetTexts.some((t) => t.includes('查看自己管理門市'));
    const presetLegacy = presetTexts.some((t) => t.includes('（舊）查看，將停用'));
    const wantPreset = { A_single_mgr: [true, false], I_view_all: [false, false], L_legacy_view: [false, true] }[key];
    out.push({ label: `權限頁 role=${key} 快速預設按鈕「查看自己管理門市」/「（舊）查看」`, expected: `${wantPreset[0]}/${wantPreset[1]}`, actual: `${presetOwn}/${presetLegacy} [${presetTexts.join('|')}]`, ok: presetOwn === wantPreset[0] && presetLegacy === wantPreset[1] });
    const dupWarn = text.includes('重複的資料查看範圍');
    out.push({ label: `權限頁 role=${key} 無「重複的資料查看範圍」警告`, expected: '無', actual: dupWarn ? '有' : '無', ok: !dupWarn });
  }
  await ctx.close();
  return out;
}

// ---------------------------------------------------------------- 主流程
async function main() {
  if (FLAG('--cleanup')) {
    const log = await cleanup();
    console.log(log.length ? `清除完成但有警告：\n${log.join('\n')}` : '清除完成');
    return;
  }

  // 站台 preflight：不得為 503（未通過 DEV 守衛）
  try {
    const r = await fetch(`${BASE}/api/campaigns/published`, { redirect: 'manual' });
    if (r.status >= 500) throw new Error(`測試站回 ${r.status}`);
  } catch (e) {
    throw new Error(`無法使用測試站 ${BASE}：${e.message}`);
  }

  const leftovers = await cleanup(); // 殘留先清
  if (leftovers.length) console.warn('殘留清除警告：', leftovers.join('; '));

  let uiError = null;
  try {
    await setup();
    await login();

    // 未登入
    if (!FLAG('--ui-only')) for (const [m, u, b] of [
      ['GET', '/api/campaigns/published'],
      ['GET', '/api/campaigns'],
      ['PATCH', '/api/campaigns/publish', { campaignId: state.campaigns.PUB.id, publishType: 'supervisors', status: true }],
      ['POST', '/api/campaign-store-headcount', { campaign_id: state.campaigns.ALL.id, store_id: state.stores.VW001.id, extra_support_count: 1 }],
      ['GET', `/api/campaign-support-requests?campaign_id=${state.campaigns.ALL.id}`],
    ]) {
      const r = await api(null, m, u, b);
      record('anonymous', `${m} ${u.split('?')[0]}`, '401', String(r.status), r.status === 401);
    }

    const keys = Object.keys(SCENARIOS);
    // 讀取：每批 4 個情境並行
    if (!FLAG('--ui-only')) for (let i = 0; i < keys.length; i += 12) {
      await Promise.all(keys.slice(i, i + 12).map((k) => testReads(k)));
    }
    // RLS 直讀（草稿外洩）
    if (!FLAG('--ui-only')) {
      for (const k of ['F_dept_mgr_access_only', 'N_marketing_dept', 'A_single_mgr', 'B_dual_mgr', 'L_legacy_view', 'R_mgr_and_sup', 'S_aux_only', 'A2_mgr_realistic', 'C2_sup_realistic', 'T_mgr_aux_stdov', 'U_viewall_sup', 'V_viewall_mgr']) await testRls(k);
    }
    // RLS 直寫（繞過 API，與 API 結果必須一致）；情境平行分到各 lane
    if (!FLAG('--ui-only')) {
      const t1 = Date.now();
      await Promise.all(
        state.lanes.map(async (L, laneIdx) => {
          for (let i = laneIdx; i < keys.length; i += WRITE_LANES) await testRlsDirectWrites(keys[i], L);
        })
      );
      console.log(`RLS 直寫耗時 ${Math.round((Date.now() - t1) / 1000)} 秒`);
    }
    // 寫入：情境平行分到 WRITE_LANES 條 lane，同一條 lane 內依序（lane 各自有獨立活動與資料列，避免互相干擾）
    if (!FLAG('--ui-only')) {
      const t0 = Date.now();
      await Promise.all(
        state.lanes.map(async (L, laneIdx) => {
          for (let i = laneIdx; i < keys.length; i += WRITE_LANES) await testWrites(keys[i], i, L);
        })
      );
      console.log(`寫入矩陣耗時 ${Math.round((Date.now() - t0) / 1000)} 秒`);
    }
    if (!FLAG('--no-ui')) {
      try {
        await testUI();
      } catch (e) {
        uiError = e;
        record('UI', 'UI 測試執行', '完成', `例外：${e.message}`, false);
      }
    }
  } finally {
    if (!FLAG('--keep')) {
      const log = await cleanup();
      console.log(log.length ? `清除警告：${log.join('; ')}` : '測試資料已清除');
    } else {
      console.log('--keep：測試資料保留，請之後執行 --cleanup');
    }
  }

  // 輸出
  const byRole = {};
  for (const m of matrix) {
    byRole[m.role] = byRole[m.role] || { pass: 0, fail: 0 };
    byRole[m.role][m.ok ? 'pass' : 'fail'] += 1;
  }
  console.log('\n== 各情境結果（pass/fail）==');
  for (const [r, v] of Object.entries(byRole)) {
    const desc = SCENARIOS[r]?.desc || '';
    console.log(`${r.padEnd(24)} ${String(v.pass).padStart(4)} / ${String(v.fail).padStart(3)}  ${desc}`);
  }
  const failed = matrix.filter((m) => !m.ok);
  if (failed.length) {
    console.log('\n== 失敗項目 ==');
    for (const f of failed) console.log(`[${f.role}] ${f.endpoint}\n    預期: ${f.expected}\n    實際: ${f.actual}`);
  }
  console.log(`\n總計 ${matrix.length} 項，通過 ${matrix.length - failed.length}，失敗 ${failed.length}`);
  const jsonPath = ARG_VAL('--json');
  if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify({ at: new Date().toISOString(), base: BASE, total: matrix.length, failed: failed.length, matrix }, null, 1));
  if (uiError) console.log('UI 測試例外：', uiError.message);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(async (e) => {
  console.error('測試中止：', e.message);
  try {
    if (!FLAG('--keep')) await cleanup();
  } catch {
    /* ignore */
  }
  process.exit(2);
});

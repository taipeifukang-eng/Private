import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { submitMovements } from '../support/w06-fixtures';
import {
  adminDb,
  confirmationsOf,
  grantTransferSupervisors,
  historyOf,
  masterOf,
  nativePreview,
  nativeSave,
  p02Code,
  p02Stores,
  purgeP02,
  purgeReceipts,
  registerP02,
  seedMaster,
  transferRequestsOf,
} from '../support/p02-fixtures';

// P02 整合層（M2 規格 D.1、D.2、F.3、F.4）：
//   F.4 角色權限矩陣：11 頁對應的 workspace API，用 role-matrix 角色驗證允許與拒絕（未登入 401）。
//   D.1 員工匯入、異動批次、批次升遷：整批原子；完全重複且已存在的列自動略過並列在結果；其他錯誤整批不存。
//   D.2 調店：原店與新店督導都確認才生效；同一督導確認一次；系統管理員可代確認並留紀錄；批次的調店列建立為待確認申請。
//   F.3 地圖預設只看營運中（有權限才可勾選已停止）、門市列表「已停止數量」。
// 員編只用 FKF6xxxx／FKPT7xx／FK6xxx、ZT01～ZT04 與保留月份 2099；測試結束清除。

type Account = { key: string; kind: string; profileRole: string; jobTitle?: string; department?: string; permissions: string[] | 'ALL' };
const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'role-matrix.json'), 'utf8')) as { accounts: Account[] };
const account = (key: string) => fixture.accounts.find((a) => a.key === key)!;
const holds = (a: Account, codes: string[]) => a.permissions === 'ALL' || codes.some((c) => (a.permissions as string[]).includes(c));
const STORE_READ = ['store.store.view', 'store.store.view_inactive', 'store.store.create', 'store.store.edit', 'store.store.clone', 'store.manage'];
// 與 lib/workspace/store-personnel.ts 同一條規則（舊版門市員工歷程頁的判斷）。
const personnelOk = (a: Account) =>
  a.profileRole === 'admin' || (!['督導', '店長', '代理店長', '督導(代理店長)'].includes(a.jobTitle || '') && !!a.department?.startsWith('營業') && ['member', 'manager'].includes(a.profileRole));

const ROLE_KEYS = [
  'admin', 'navigation', 'ops_manager', 'ops_assistant', 'supervisor', 'store_manager', 'acting_manager', 'employee', 'denied',
  'employee_view', 'employee_edit', 'employee_delete', 'store_view', 'store_edit', 'store_delete',
  'supervisor_mgmt_view', 'supervisor_mgmt_edit', 'store_manager_assign_view', 'store_manager_assign_edit',
];

test.describe('F.4 角色權限矩陣：11 頁對應的 workspace API', () => {
  let zt01 = '';
  test.beforeAll(async () => {
    zt01 = (await p02Stores()).ZT01;
  });
  const endpoints = (store: string) => [
    { page: '門市管理／新增／編輯／搬遷', path: '/api/workspace/stores', allowed: (a: Account) => holds(a, STORE_READ) },
    { page: '門市整合地圖', path: '/api/workspace/store-map', allowed: (a: Account) => holds(a, ['store.store.view', 'store.store.view_inactive', 'store.manage']) },
    { page: '店長指派', path: '/api/workspace/store-managers', allowed: (a: Account) => holds(a, ['store.manager.assign', 'store.manage']) },
    { page: '經理／督導管理', path: '/api/workspace/supervisors', allowed: (a: Account) => holds(a, ['store.manager.assign', 'store.supervisor.assign', 'store.manage']) },
    { page: '批次匯入員工', path: '/api/workspace/employee-import', allowed: (a: Account) => holds(a, ['employee.import']) },
    { page: '門市員工', scoped: true, path: `/api/workspace/store-employees?store=${store}`, allowed: (a: Account) => holds(a, STORE_READ) },
    { page: '門市員工主檔', scoped: true, path: `/api/workspace/store-personnel?store=${store}`, allowed: (a: Account) => holds(a, STORE_READ) && personnelOk(a) },
    { page: '門市批次升遷', scoped: true, path: `/api/workspace/store-promotions?store=${store}`, allowed: (a: Account) => holds(a, ['employee.promotion.batch']) && personnelOk(a) },
    { page: '調店登記確認', path: '/api/workspace/transfers', allowed: (a: Account) => holds(a, ['employee.store_transfer.create', 'employee.store_transfer.confirm']) },
  ];

  test('未登入：每支 API 回 401', async ({ request }) => {
    for (const e of endpoints(zt01)) {
      const res = await request.get(`${TEST_ORIGIN}${e.path}`);
      expect(res.status(), e.path).toBe(401);
    }
  });

  for (const key of ROLE_KEYS) {
    test(`角色 ${key}`, async () => {
      const a = account(key);
      const api = await apiAs(key);
      try {
        for (const e of endpoints(zt01)) {
          const res = await api.get(e.path);
          const want = e.allowed(a);
          // 允許時 200；拒絕時一定是 403（不是 500，也不洩漏資料）。
          // 門市範圍的頁面：有權限但沒有被指派該門市（RLS 看不到）時回 404，不洩漏門市是否存在；管理員與被指派的督導一定是 200。
          if (want && (e as any).scoped && !['admin', 'supervisor'].includes(key)) expect([200, 404], `${key} ${e.page}`).toContain(res.status());
          else expect(res.status(), `${key} ${e.page} ${e.path}`).toBe(want ? 200 : 403);
        }
      } finally {
        await api.dispose();
      }
    });
  }

  test('寫入入口同樣拒絕：沒有權限的角色不能建立門市、匯入員工、送出調店確認', async () => {
    for (const key of ['denied', 'store_view', 'employee']) {
      const api = await apiAs(key);
      try {
        const create = await api.post('/api/workspace/stores', { data: { operation: 'create', requestId: randomUUID(), data: { store_code: 'ZTX99', store_name: 'x', is_franchise: false } } });
        expect(create.status(), `${key} 建立門市`).toBe(403);
        const imp = await api.put('/api/workspace/employee-import', { data: { requestId: randomUUID(), rows: [] } });
        expect(imp.status(), `${key} 匯入員工`).toBe(403);
        const confirm = await api.post('/api/workspace/transfers/confirm', { data: { id: randomUUID() } });
        expect(confirm.status(), `${key} 調店確認`).toBe(403);
      } finally {
        await api.dispose();
      }
    }
  });
});

test.describe('D.1 整批原子與完全重複略過', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let st: Record<string, string> = {};
  const started = new Date().toISOString();
  const code = {
    impA: p02Code('FKF', 1), impB: p02Code('FKPT', 2), impC: p02Code('FK', 3), impD: p02Code('FKF', 4),
    onb: p02Code('FKF', 5), xfer: p02Code('FKF', 6), promo: p02Code('FKF', 7),
  };
  const all = () => Object.values(code);

  test.beforeAll(async () => {
    admin = await apiAs('admin');
    st = await p02Stores();
    await purgeP02(all());
  });
  test.afterAll(async () => {
    await registerP02(all()).catch(() => undefined);
    await purgeP02(all()).catch(() => undefined);
    await purgeReceipts(started, [st.ZT01]).catch(() => undefined);
    await admin?.dispose();
  });

  test('員工匯入：新員編整批新增（FKPT 自動兼職）', async () => {
    const p = await nativePreview(admin, [['ZT01', code.impA, 'P02 匯入甲', '專員', '2026-10-01'], ['ZT01', code.impB, 'P02 匯入乙', '兼職助理', '2026-10-01']]);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body.valid).toBe(true);
    expect(p.body.duplicates).toEqual([]);
    const s = await nativeSave(admin, p.body);
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.imported).toBe(2);
    expect(s.body.skipped).toEqual([]);
    const a = (await masterOf(code.impA))[0], b = (await masterOf(code.impB))[0];
    expect(a.employment_type).toBe('full_time');
    expect(b.employment_type).toBe('part_time');
  });

  test('員工匯入：同一份檔案再送一次，完全重複且已存在的列自動略過並列在結果', async () => {
    const rows: any[] = [['ZT01', code.impA, 'P02 匯入甲', '專員', '2026-10-01'], ['ZT01', code.impB, 'P02 匯入乙', '兼職助理', '2026-10-01']];
    const p = await nativePreview(admin, rows);
    expect(p.body.valid, JSON.stringify(p.body.errors)).toBe(true);
    expect(p.body.duplicates.map((d: any) => d.employee_code).sort()).toEqual([code.impA, code.impB].sort());
    expect(p.body.duplicates.map((d: any) => Number(d.row))).toEqual([2, 3]);
    const s = await nativeSave(admin, p.body);
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.imported).toBe(0);
    expect(s.body.skipped).toHaveLength(2);
    expect(await masterOf(code.impA)).toHaveLength(1);
    expect(await masterOf(code.impB)).toHaveLength(1);
  });

  test('員工匯入：重複列與新列混合，只新增新列，重複列略過', async () => {
    const p = await nativePreview(admin, [['ZT01', code.impA, 'P02 匯入甲', '專員', '2026-10-01'], ['ZT01', code.impC, 'P02 匯入丙', '店長', '2026-10-02']]);
    expect(p.body.valid).toBe(true);
    expect(p.body.duplicates).toHaveLength(1);
    const s = await nativeSave(admin, p.body);
    expect(s.body.imported).toBe(1);
    expect(s.body.skipped).toHaveLength(1);
    expect(await masterOf(code.impC)).toHaveLength(1);
    expect(await masterOf(code.impA)).toHaveLength(1);
  });

  test('員工匯入：其他錯誤整批不存（已存在但內容不同、職位不在清單、FKI），預覽逐列說明原因', async () => {
    const p = await nativePreview(admin, [
      ['ZT01', code.impA, '不同姓名', '專員', '2026-10-01'], // 已存在但內容不同
      ['ZT01', code.impD, 'P02 新員', '不存在的職位', '2026-10-01'], // F.1 職位限制
      ['ZT01', 'FKI001', '實習生', '專員', '2026-10-01'], // E.2
      ['ZT01', p02Code('FKF', 8), 'P02 好列', '專員', '2026-10-01'], // 本身沒問題，也不能單獨被存
    ]);
    expect(p.status).toBe(200);
    expect(p.body.valid).toBe(false);
    const byRow = (n: number) => p.body.errors.filter((e: any) => Number(e.row) === n).map((e: any) => e.message).join('｜');
    expect(byRow(2)).toContain('已存在');
    expect(byRow(3)).toContain('職位');
    expect(byRow(4)).toContain('FKI');
    expect(byRow(5)).toBe('');
    // 繞過預覽直接送儲存：整批不存。
    const forced = await nativeSave(admin, p.body);
    expect(forced.status).toBe(409);
    expect(await masterOf(code.impD)).toHaveLength(0);
    expect(await masterOf(p02Code('FKF', 8))).toHaveLength(0);
  });

  test('異動批次：完全重複的列自動略過並列出，其他列照常儲存；錯誤整批不存', async () => {
    const onb = { employee_code: code.onb, employee_name: 'P02 批次入職', store_id: st.ZT01, movement_type: 'onboarding', birthday: '1990-01-05', onboarding_is_pharmacist: false, effective_date: '2099-06-01' };
    const first = await submitMovements(admin, [onb]);
    expect(first.ok, JSON.stringify(first.body)).toBe(true);
    expect((first.body as any).created).toBe(1);
    // 同一列再加一筆新的升職：重複列略過、升職列儲存。
    const promo = { employee_code: code.onb, employee_name: 'P02 批次入職', store_id: st.ZT01, movement_type: 'promotion', position: '組長', effective_date: '2099-07-01' };
    const blank: Record<string, unknown> = { birthday: '', position: '', newbie_level: '', notes: '', from_store_id: '', to_store_id: '', onboarding_is_pharmacist: false };
    const rows = [onb, promo].map((r) => ({ ...blank, ...r }));
    const v = await admin.post('/api/workspace/movement-validation', { data: { rows } });
    const vb = await v.json();
    expect(vb.valid, JSON.stringify(vb.errors)).toBe(true);
    expect(vb.skipped.map((x: any) => x.row)).toEqual([1]);
    const s = await admin.post('/api/workspace/movement-submit', { data: { rows: vb.rows, version: vb.version, requestId: randomUUID() } });
    expect(s.status(), await s.text()).toBe(200);
    const sb = await s.json();
    expect(sb.created).toBe(1);
    expect(sb.skipped).toHaveLength(1);
    expect((await historyOf(code.onb)).map((h) => h.movement_type)).toEqual(['onboarding', 'promotion']);
    // 錯誤整批不存：一列有效的升職＋一列找不到員工。
    const bad = [
      { ...rows[1], position: '主任', effective_date: '2099-08-01' },
      { ...rows[1], employee_code: p02Code('FKF', 9), employee_name: '不存在的人', position: '組長', effective_date: '2099-08-01' },
    ];
    const bv = await admin.post('/api/workspace/movement-validation', { data: { rows: bad } });
    const bb = await bv.json();
    expect(bb.valid).toBe(false);
    expect(bb.canSubmit).toBe(false);
    expect(bb.errors.some((e: any) => e.row === 2)).toBe(true);
    // 直接送儲存（版本對不上）也整批不存。
    const forced = await admin.post('/api/workspace/movement-submit', { data: { rows: bad, version: 'a'.repeat(32), requestId: randomUUID() } });
    expect([400, 409]).toContain(forced.status());
    expect((await historyOf(code.onb)).map((h) => h.movement_date.slice(0, 7))).toEqual(['2099-06', '2099-07']);
  });

  test('D.2 批次輸入的調店列建立為待確認申請，不直接生效；重複送出自動略過', async () => {
    await seedMaster(code.xfer, 'P02 批次調店', st.ZT01);
    const row = { employee_code: code.xfer, employee_name: 'P02 批次調店', store_id: '', movement_type: 'store_transfer', from_store_id: st.ZT01, to_store_id: st.ZT02, effective_date: '2099-06-15' };
    const r = await submitMovements(admin, [row]);
    expect(r.ok, JSON.stringify(r.body)).toBe(true);
    expect((r.body as any).transferRequests).toBe(1);
    expect((r.body as any).records[0].pending_transfer_request).toBe(true);
    const reqs = await transferRequestsOf(code.xfer);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].status).toBe('pending');
    expect(reqs[0].requested_date).toBe('2099-06-15');
    expect(reqs[0].from_store_id).toBe(st.ZT01);
    expect(reqs[0].to_store_id).toBe(st.ZT02);
    expect(await historyOf(code.xfer)).toHaveLength(0);
    const m = await masterOf(code.xfer);
    expect(m.filter((x) => x.is_active).map((x) => x.store_id)).toEqual([st.ZT01]);
    const again = await submitMovements(admin, [row]);
    expect(again.ok, JSON.stringify(again.body)).toBe(true);
    expect((again.body as any).created).toBe(0);
    expect((again.body as any).skipped).toHaveLength(1);
    expect(await transferRequestsOf(code.xfer)).toHaveLength(1);
  });

  test('批次升遷：已存在且完全相同的升遷列略過並列出，新列儲存；檔案內重複列整批不存', async () => {
    await seedMaster(code.promo, 'P02 批次升遷', st.ZT01);
    const endpoint = `/api/workspace/store-promotions?store=${st.ZT01}`;
    const row = (position: string, date: string) => ({ employee_code: code.promo, employee_name: 'P02 批次升遷', position, newbie_level: '', effective_date: date, notes: '' });
    const run = async (rows: any[]) => {
      const v = await admin.post(endpoint, { data: { operation: 'validate', rows } });
      const vb = await v.json();
      return { v, vb };
    };
    let { vb } = await run([row('組長', '2099-06-01')]);
    expect(vb.valid, JSON.stringify(vb.errors)).toBe(true);
    expect(vb.duplicates).toEqual([]);
    let s = await admin.post(endpoint, { data: { operation: 'save', rows: [row('組長', '2099-06-01')], expected: vb.expected, requestId: randomUUID() } });
    expect(s.status(), await s.text()).toBe(200);
    expect((await s.json()).created).toBe(1);
    // 重複＋新列
    const mixed = [row('組長', '2099-06-01'), row('主任', '2099-07-01')];
    ({ vb } = await run(mixed));
    expect(vb.valid, JSON.stringify(vb.errors)).toBe(true);
    expect(vb.duplicates.map((d: any) => d.row)).toEqual([1]);
    s = await admin.post(endpoint, { data: { operation: 'save', rows: mixed, expected: vb.expected, requestId: randomUUID() } });
    expect(s.status(), await s.text()).toBe(200);
    const sb = await s.json();
    expect(sb.created).toBe(1);
    expect(sb.skipped).toHaveLength(1);
    expect((await historyOf(code.promo)).filter((h) => h.movement_type === 'promotion')).toHaveLength(2);
    // 檔案內重複列：整批不存。
    const dupInFile = [row('專員', '2099-08-01'), row('專員', '2099-08-01')];
    const dv = await admin.post(endpoint, { data: { operation: 'validate', rows: dupInFile } });
    const dbb = await dv.json();
    expect(dbb.valid).toBe(false);
    expect((await historyOf(code.promo)).filter((h) => h.movement_type === 'promotion')).toHaveLength(2);
  });
});

test.describe('D.2 調店：原店與新店督導都確認才生效', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let sup: APIRequestContext;
  let ops: APIRequestContext;
  let outsider: APIRequestContext;
  let st: Record<string, string> = {};
  let undo: () => Promise<void> = async () => undefined;
  const code = { two: p02Code('FKF', 11), same: p02Code('FKF', 12), proxy: p02Code('FKF', 13), none: p02Code('FKF', 14), reject: p02Code('FKF', 15) };
  const all = () => Object.values(code);

  async function createRequest(c: string, from: string, to: string) {
    await seedMaster(c, `P02 調店 ${c}`, from);
    const res = await admin.post('/api/workspace/transfers/create', { data: { requestId: randomUUID(), data: { employee_code: c, employee_name: `P02 調店 ${c}`, from_store_id: from, to_store_id: to, notes: '' } } });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()).id as string;
  }
  async function rowFor(api: APIRequestContext, id: string) {
    const res = await api.get('/api/workspace/transfers?status=all');
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()).rows.find((r: any) => r.id === id);
  }
  async function completeConfirm(api: APIRequestContext, id: string, date: string) {
    const pv = await api.post('/api/workspace/transfers/preview', { data: { id, effective_date: date } });
    expect(pv.status(), await pv.text()).toBe(200);
    const pb = await pv.json();
    expect(pb.canSubmit, JSON.stringify(pb.conflicts)).toBe(true);
    return api.post('/api/workspace/transfers/confirm', { data: { id, effective_date: date, version: pb.version } });
  }

  test.beforeAll(async () => {
    st = await p02Stores();
    await purgeP02(all());
    // `supervisor` 測試帳號已是 ZT01～ZT03 的督導；`ops_manager` 暫時任命為 ZT04 督導，兩者暫時加上調店確認權限。
    undo = await grantTransferSupervisors([
      { roleCode: 'vue_workspace_supervisor', email: 'vue-workspace-supervisor@example.test', stores: [st.ZT01, st.ZT02, st.ZT03] },
      { roleCode: 'vue_workspace_ops_manager', email: 'vue-workspace-ops-manager@example.test', stores: [st.ZT04] },
    ]);
    admin = await apiAs('admin');
    sup = await apiAs('supervisor');
    ops = await apiAs('ops_manager');
    outsider = await apiAs('store_view');
  });
  test.afterAll(async () => {
    await registerP02(all()).catch(() => undefined);
    await purgeP02(all()).catch(() => undefined);
    await undo().catch(() => undefined);
    for (const api of [admin, sup, ops, outsider]) await api?.dispose();
  });

  test('兩位不同督導：先確認的一側仍是待確認，兩側都確認才生效，確認畫面資料顯示兩位督導各自狀態', async () => {
    const id = await createRequest(code.two, st.ZT01, st.ZT04);
    const before = await rowFor(sup, id);
    expect(before.status).toBe('pending');
    expect(before.canConfirm).toBe(true);
    expect(before.mySides).toEqual(['from']);
    expect(before.willComplete).toBe(false);
    expect(before.supervisors.from).toContain('測試督導');
    expect(before.confirmations.from.confirmed).toBe(false);
    expect(before.confirmations.to.confirmed).toBe(false);
    // 原店督導確認：不需要日期，仍是待確認。
    const first = await sup.post('/api/workspace/transfers/confirm', { data: { id } });
    expect(first.status(), await first.text()).toBe(200);
    expect(await first.json()).toMatchObject({ status: 'pending', waitingFor: ['to'] });
    expect(await historyOf(code.two)).toHaveLength(0);
    expect((await masterOf(code.two)).filter((m) => m.is_active).map((m) => m.store_id)).toEqual([st.ZT01]);
    // 同一位督導重複確認：冪等。
    const repeat = await sup.post('/api/workspace/transfers/confirm', { data: { id } });
    expect(repeat.status()).toBe(200);
    expect((await repeat.json()).alreadyConfirmed).toBe(true);
    // 新店督導：看得到原店已確認，這一次確認會讓兩側齊全，需要生效日。
    const mid = await rowFor(ops, id);
    expect(mid.confirmations.from.confirmed).toBe(true);
    expect(mid.confirmations.from.by_name).toBe('測試督導');
    expect(mid.confirmations.from.proxy).toBe(false);
    expect(mid.mySides).toEqual(['to']);
    expect(mid.willComplete).toBe(true);
    const noDate = await ops.post('/api/workspace/transfers/confirm', { data: { id } });
    expect(noDate.status()).toBe(400);
    const done = await completeConfirm(ops, id, '2099-08-10');
    expect(done.status(), await done.text()).toBe(200);
    expect((await done.json()).status).toBe('confirmed');
    const conf = await confirmationsOf(id);
    expect(conf.map((c) => [c.side, c.is_proxy])).toEqual([['from', false], ['to', false]]);
    expect(new Set(conf.map((c) => c.confirmed_by)).size).toBe(2);
    expect((await historyOf(code.two)).map((h) => h.movement_type)).toEqual(['store_transfer']);
    expect((await masterOf(code.two)).filter((m) => m.is_active).map((m) => m.store_id)).toEqual([st.ZT04]);
  });

  test('同一位督導同時是兩店督導：確認一次即生效', async () => {
    const id = await createRequest(code.same, st.ZT01, st.ZT02);
    const row = await rowFor(sup, id);
    expect(row.mySides).toEqual(['from', 'to']);
    expect(row.willComplete).toBe(true);
    const done = await completeConfirm(sup, id, '2099-08-11');
    expect(done.status(), await done.text()).toBe(200);
    const conf = await confirmationsOf(id);
    expect(conf).toHaveLength(2);
    expect(conf.every((c) => c.is_proxy === false)).toBe(true);
    expect(new Set(conf.map((c) => c.confirmed_by)).size).toBe(1);
    expect((await historyOf(code.same)).map((h) => h.movement_type)).toEqual(['store_transfer']);
  });

  test('系統管理員可代為確認並留下紀錄（代確認的那一側標記 proxy）', async () => {
    const id = await createRequest(code.proxy, st.ZT01, st.ZT04);
    expect((await sup.post('/api/workspace/transfers/confirm', { data: { id } })).status()).toBe(200);
    const row = await rowFor(admin, id);
    expect(row.mySides).toEqual(['to']);
    const done = await completeConfirm(admin, id, '2099-08-12');
    expect(done.status(), await done.text()).toBe(200);
    const conf = await confirmationsOf(id);
    expect(conf.map((c) => [c.side, c.is_proxy])).toEqual([['from', false], ['to', true]]);
    const after = await rowFor(admin, id);
    expect(after.status).toBe('confirmed');
    expect(after.confirmations.to.proxy).toBe(true);
  });

  test('不是這兩店督導的人不能確認（403）；管理員一次代兩側時兩側都標記代確認', async () => {
    const id = await createRequest(code.none, st.ZT02, st.ZT04);
    const o = await outsider.post('/api/workspace/transfers/confirm', { data: { id } });
    expect(o.status()).toBe(403);
    // ops_manager 只是 ZT04 督導，不是 ZT02 督導：只能確認新店一側。
    const mine = await rowFor(ops, id);
    expect(mine.mySides).toEqual(['to']);
    const admRow = await rowFor(admin, id);
    expect(admRow.mySides).toEqual(['from', 'to']);
    const done = await completeConfirm(admin, id, '2099-08-13');
    expect(done.status(), await done.text()).toBe(200);
    expect((await confirmationsOf(id)).map((c) => [c.side, c.is_proxy])).toEqual([['from', true], ['to', true]]);
  });

  test('督導仍可拒絕申請，不產生異動', async () => {
    const id = await createRequest(code.reject, st.ZT01, st.ZT02);
    const res = await sup.post('/api/workspace/transfers', { data: { operation: 'reject', id } });
    expect(res.status(), await res.text()).toBe(200);
    expect((await transferRequestsOf(code.reject))[0].status).toBe('rejected');
    expect(await historyOf(code.reject)).toHaveLength(0);
  });
});

test.describe('F.3 地圖預設只看營運中、已停止數量', () => {
  test('地圖預設只回營運中門市；沒有「查看已停止」權限的人帶參數也看不到已停止門市', async () => {
    const db = adminDb();
    const { count: inactive } = await db.from('stores').select('id', { count: 'exact', head: true }).eq('is_active', false);
    const admin = await apiAs('admin');
    const viewer = await apiAs('store_view');
    const nav = await apiAs('navigation');
    try {
      const def = await (await admin.get('/api/workspace/store-map')).json();
      expect(def.canInactive).toBe(true);
      expect(def.stores.every((s: any) => s.is_active === true)).toBe(true);
      const withInactive = await (await admin.get('/api/workspace/store-map?inactive=true')).json();
      expect(withInactive.stores.filter((s: any) => !s.is_active)).toHaveLength(inactive ?? 0);
      const v = await (await viewer.get('/api/workspace/store-map?inactive=true')).json();
      expect(v.canInactive).toBe(false);
      expect(v.stores.every((s: any) => s.is_active === true)).toBe(true);
      const n = await (await nav.get('/api/workspace/store-map')).json();
      expect(n.canInactive).toBe(true);
    } finally {
      for (const a of [admin, viewer, nav]) await a.dispose();
    }
  });

  test('門市列表回傳已停止數量（只有可查看已停止者才有）', async () => {
    const { count: inactive } = await adminDb().from('stores').select('id', { count: 'exact', head: true }).eq('is_active', false);
    const admin = await apiAs('admin');
    const viewer = await apiAs('store_view');
    try {
      const a = await (await admin.get('/api/workspace/stores')).json();
      expect(a.inactiveCount).toBe(inactive ?? 0);
      expect(a.stores.every((s: any) => s.is_active === true)).toBe(true);
      const withInactive = await (await admin.get('/api/workspace/stores?inactive=true')).json();
      expect(withInactive.stores.filter((s: any) => !s.is_active)).toHaveLength(inactive ?? 0);
      const v = await (await viewer.get('/api/workspace/stores')).json();
      expect(v.inactiveCount).toBeNull();
    } finally {
      await admin.dispose();
      await viewer.dispose();
    }
  });

  test('店長指派資料含各店目前店長（頁面據此顯示「已有店長」提示）', async () => {
    const admin = await apiAs('admin');
    try {
      const body = await (await admin.get('/api/workspace/store-managers')).json();
      expect(Array.isArray(body.assignments)).toBe(true);
      for (const a of body.assignments) {
        expect(a.store_id).toBeTruthy();
        expect(a.user_id).toBeTruthy();
      }
    } finally {
      await admin.dispose();
    }
  });
});

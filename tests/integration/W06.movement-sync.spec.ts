import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import {
  W06_MONTHS,
  MOVEMENT_HINT,
  adjustmentsOf,
  adminDb,
  applyStoreMonth,
  historyOf,
  initializeMonth,
  insertHistory,
  masterOf,
  monthlyView,
  purgeReceipts,
  purgeW06,
  recheckOf,
  recompute,
  registerW06,
  rosterRows,
  seedMaster,
  seedRoster,
  storeName,
  submitMovements,
  w06Code,
  w06StoreIds,
} from '../support/w06-fixtures';
import { pickEffectivePosition, positionRank } from '../../lib/workspace/position-rank';

// W06 整合層（M2 規格 A、B 組）：異動登記後名冊自動回寫（A.1）、已送審月份只記「需重新確認」（A.2）、
// 草稿以異動為準覆蓋並留紀錄（A.3）、留停期間不列名冊與復職指定門市（A.4）、調店兩店提示（A.5）、
// 升職生效月整月（A.6）、補登過去異動只寫歷史（B.1）、同日多階取最高職等（B.2）、升職同步員工主檔（B.3）。
// 資料只用測試員編範圍 FK7xxx／FKF7xxxx／FKPT8xx、ZT01／ZT02 與保留月份 2099-07～2099-09。

const { m1, m2, m3 } = W06_MONTHS;
const c = {
  promo: w06Code('FK', 1),
  leave: w06Code('FK', 2),
  resign: w06Code('FK', 3),
  onboard: w06Code('FK', 4),
  orderA: w06Code('FK', 5),
  orderB: w06Code('FK', 6),
  locked: w06Code('FK', 7),
  manual: w06Code('FK', 8),
  xfer: w06Code('FKPT', 1),
  rank: w06Code('FK', 9),
  backdate: w06Code('FKF', 1),
  probation: w06Code('FKF', 2),
  other: w06Code('FKF', 3),
};
const all = () => Object.values(c);
const field = (rows: Record<string, any>[], month: string, key: string) => rows.find((r) => r.year_month === month)?.[key];

test.describe('W06 異動回寫每月人員名冊', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let zt01 = '';
  let zt02 = '';
  const started = new Date().toISOString();

  const clean = async () => {
    await registerW06(all()).catch(() => undefined); // 登錄只是 sweeper 後備，失敗不能擋住清除
    await purgeW06(all(), [zt01, zt02]);
  };
  test.beforeAll(async () => {
    admin = await apiAs('admin');
    const ids = await w06StoreIds(admin, m1);
    zt01 = ids.ZT01;
    zt02 = ids.ZT02;
    await purgeW06(all(), [zt01, zt02]);
  });
  test.afterAll(async () => {
    await clean().catch(() => undefined);
    await purgeReceipts(started, [zt01, zt02]).catch(() => undefined);
    await admin?.dispose();
  });

  test('A.1／A.6 升職：生效月整月認定新職位，之後所有已初始化月份跟著；員工主檔同步（B.3）', async () => {
    await seedMaster(c.promo, 'W06 升職甲', zt01, { position: '專員' });
    await seedRoster(zt01, m1, [{ code: c.promo, name: 'W06 升職甲' }]);
    await seedRoster(zt01, m2, [{ code: c.promo, name: 'W06 升職甲' }]);
    await seedRoster(zt01, m3, [{ code: c.promo, name: 'W06 升職甲' }]);
    // 過去日期的升職（今天以前）才會立即同步主檔；月份名冊是 2099，生效日所在月份與之後都要認定新職位。
    const r = await submitMovements(admin, [{ employee_code: c.promo, employee_name: 'W06 升職甲', store_id: zt01, movement_type: 'promotion', position: '組長', effective_date: '2099-08-15' }]);
    expect(r.ok, JSON.stringify(r.body)).toBe(true);
    const rows = await rosterRows(c.promo);
    expect(field(rows, m1, 'position')).toBe('專員');
    expect(field(rows, m2, 'position')).toBe('組長'); // 升職日 15 號，整個 8 月都算組長（A.6）
    expect(field(rows, m3, 'position')).toBe('組長');
    // 異動寫入歷史
    const h = await historyOf(c.promo);
    expect(h.map((x) => [x.movement_type, x.movement_date, x.new_value])).toEqual([['promotion', '2099-08-15', '組長']]);
    // 未來日期的升職不改今天的主檔（排程生效），主檔仍是專員。
    expect((await masterOf(c.promo))[0].current_position).toBe('專員');
  });

  test('A.1 代理：生效月起標註記，不改正式職位', async () => {
    const r = await submitMovements(admin, [{ employee_code: c.promo, employee_name: 'W06 升職甲', store_id: zt01, movement_type: 'acting_manager', position: '代理店長', effective_date: '2099-09-02' }]);
    expect(r.ok, JSON.stringify(r.body)).toBe(true);
    const rows = await rosterRows(c.promo);
    expect(field(rows, m2, 'is_acting_manager')).toBe(false);
    expect(field(rows, m3, 'is_acting_manager')).toBe(true);
    expect(field(rows, m3, 'position')).toBe('組長'); // 代理只註記
  });

  test('A.1／A.4 留停：留停當月仍列名冊（天數為留停日前一天），留停期間後續月份不列名冊', async () => {
    await seedMaster(c.leave, 'W06 留停', zt01);
    for (const m of [m1, m2, m3]) await seedRoster(zt01, m, [{ code: c.leave, name: 'W06 留停' }]);
    const r = await submitMovements(admin, [{ employee_code: c.leave, employee_name: 'W06 留停', store_id: zt01, movement_type: 'leave_without_pay', effective_date: '2099-07-20' }]);
    expect(r.ok, JSON.stringify(r.body)).toBe(true);
    const rows = await rosterRows(c.leave);
    expect(rows.map((x) => x.year_month)).toEqual([m1]); // m2、m3 已移出名冊
    expect(rows[0].monthly_status).toBe('leave_of_absence');
    expect(Number(rows[0].work_days)).toBe(19);
    expect(rows[0].partial_month_reason).toBe('留職停薪');
    // A.4 復職可指定門市（不一定回原店）：2099-09-10 復職到 ZT02，天數從復職日（含）起算，列入復職門市名冊。
    await seedRoster(zt02, m3, [{ code: w06Code('FKF', 50), name: 'W06 ZT02 其他人' }]); // 讓 ZT02 的 9 月是已初始化月份
    const back = await submitMovements(admin, [{ employee_code: c.leave, employee_name: 'W06 留停', store_id: zt02, movement_type: 'return_to_work', effective_date: '2099-09-10' }]);
    expect(back.ok, JSON.stringify(back.body)).toBe(true);
    const after = await rosterRows(c.leave);
    const zt02Row = after.find((x) => x.store_id === zt02 && x.year_month === m3);
    expect(zt02Row, '復職門市名冊').toBeTruthy();
    expect(Number(zt02Row!.work_days)).toBe(21); // 30 - 10 + 1
    expect(zt02Row!.partial_month_reason).toBe('復職');
    expect(after.some((x) => x.store_id === zt01 && x.year_month !== m1)).toBe(false);
    // 主檔：復職門市為在職，原店列停用
    const masters = await masterOf(c.leave);
    expect(masters.filter((x) => x.is_active).map((x) => x.store_id)).toEqual([zt02]);
  });

  test('A.1 離職：離職當天算上班，之後月份不列名冊', async () => {
    await seedMaster(c.resign, 'W06 離職', zt01);
    for (const m of [m1, m2, m3]) await seedRoster(zt01, m, [{ code: c.resign, name: 'W06 離職' }]);
    const r = await submitMovements(admin, [{ employee_code: c.resign, employee_name: 'W06 離職', store_id: zt01, movement_type: 'resignation', effective_date: '2099-08-12' }]);
    expect(r.ok, JSON.stringify(r.body)).toBe(true);
    const rows = await rosterRows(c.resign);
    expect(rows.map((x) => x.year_month)).toEqual([m1, m2]);
    expect(field(rows, m2, 'monthly_status')).toBe('resigned');
    expect(Number(field(rows, m2, 'work_days'))).toBe(12);
  });

  test('A.1 入職：生效月列為到職（天數含當天），之後已初始化月份補列，入職藥師身分同步', async () => {
    await seedRoster(zt01, m2, [{ code: c.other, name: 'W06 其他人' }]);
    await seedRoster(zt01, m3, [{ code: c.other, name: 'W06 其他人' }]);
    const r = await submitMovements(admin, [{ employee_code: c.onboard, employee_name: 'W06 新進', store_id: zt01, movement_type: 'onboarding', birthday: '1995-04-05', effective_date: '2099-08-10', onboarding_is_pharmacist: true }]);
    expect(r.ok, JSON.stringify(r.body)).toBe(true);
    const rows = await rosterRows(c.onboard);
    expect(rows.map((x) => x.year_month)).toEqual([m2, m3]);
    expect(field(rows, m2, 'monthly_status')).toBe('new_hire');
    expect(Number(field(rows, m2, 'work_days'))).toBe(22); // 31 - 10 + 1
    expect(field(rows, m2, 'position')).toBe('新人');
    expect(field(rows, m2, 'newbie_level')).toBe('未過階新人');
    expect(field(rows, m3, 'is_pharmacist')).toBe(true);
    expect(field(rows, m3, 'monthly_status')).toBe('full_month');
  });

  test('A.1 先初始化後登錄，與先登錄後初始化，結果相同', async () => {
    await purgeW06(all().filter((x) => x !== c.orderA && x !== c.orderB), [zt01, zt02]);
    const events = (code: string, store: string, name: string) => [
      { employee_code: code, employee_name: name, store_id: store, movement_type: 'promotion', position: '組長', effective_date: `${m1}-10` },
      { employee_code: code, employee_name: name, store_id: store, movement_type: 'acting_manager', position: '代理店長', effective_date: `${m1}-12` },
      { employee_code: code, employee_name: name, store_id: store, movement_type: 'leave_without_pay', effective_date: `${m2}-20` },
    ];
    // 順序一（ZT01）：先登錄異動，再初始化兩個月份。
    await seedMaster(c.orderA, 'W06 順序甲', zt01);
    expect((await submitMovements(admin, events(c.orderA, zt01, 'W06 順序甲'))).ok).toBe(true);
    expect((await initializeMonth(admin, zt01, m1)).status).toBe(200);
    expect((await initializeMonth(admin, zt01, m2)).status).toBe(200);
    // 順序二（ZT02）：先初始化兩個月份，再登錄同樣的異動。
    await seedMaster(c.orderB, 'W06 順序乙', zt02);
    expect((await initializeMonth(admin, zt02, m1)).status).toBe(200);
    expect((await initializeMonth(admin, zt02, m2)).status).toBe(200);
    expect((await submitMovements(admin, events(c.orderB, zt02, 'W06 順序乙'))).ok).toBe(true);
    const pick = (rows: Record<string, any>[]) => rows.map((r) => ({ month: r.year_month, position: r.position, level: r.newbie_level, acting: r.is_acting_manager, status: r.monthly_status, days: r.work_days === null ? null : Number(r.work_days), reason: r.partial_month_reason, notes: r.partial_month_notes, total: r.total_days_in_month }));
    const a = pick(await rosterRows(c.orderA, [m1, m2, m3]));
    const b = pick(await rosterRows(c.orderB, [m1, m2, m3]));
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    expect(a.find((x) => x.month === m1)).toMatchObject({ position: '組長', acting: true });
    expect(a.find((x) => x.month === m2)).toMatchObject({ status: 'leave_of_absence', days: 19 });
  });

  test('A.2 已送審月份不動，記入「需重新確認」；月結頁讀得到；退回草稿後一鍵依異動重算', async () => {
    await purgeW06([], [zt01, zt02]);
    await seedMaster(c.locked, 'W06 鎖月', zt01);
    await seedRoster(zt01, m1, [{ code: c.locked, name: 'W06 鎖月' }]);
    await seedRoster(zt01, m2, [{ code: c.locked, name: 'W06 鎖月', status: 'submitted' }]);
    await seedRoster(zt01, m3, [{ code: c.locked, name: 'W06 鎖月' }]);
    const r = await submitMovements(admin, [{ employee_code: c.locked, employee_name: 'W06 鎖月', store_id: zt01, movement_type: 'promotion', position: '主任', effective_date: `${m1}-05` }]);
    expect(r.ok, JSON.stringify(r.body)).toBe(true); // 不再整筆拒絕
    let rows = await rosterRows(c.locked);
    expect(field(rows, m1, 'position')).toBe('主任');
    expect(field(rows, m2, 'position')).toBe('專員'); // 已送審月份不動
    expect(field(rows, m3, 'position')).toBe('主任');
    const pending = await recheckOf(c.locked);
    expect(pending.map((x) => [x.year_month, x.field, x.old_value, x.new_value, x.source_type])).toEqual([[m2, 'position', '專員', '主任', 'movement']]);
    // 月結頁 API：需重新確認清單（門市、月份、員工、原因）
    const view = await monthlyView(admin, zt01, m2);
    expect(view.status).toBe(200);
    const mine = (view.body.recheck as any[]).filter((x) => x.employee_code === c.locked);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ year_month: m2, field: 'position', new_value: '主任' });
    expect(mine[0].reason_label).toContain('已送審或已確認');
    // 仍是已送審：一鍵重算被拒絕
    const denied = await admin.post('/api/workspace/monthly', { data: { action: 'recompute', store: zt01, month: m2 } });
    expect(denied.status()).toBe(409);
    // 退回草稿（模擬退回後的狀態）後一鍵重算
    await adminDb().from('monthly_staff_status').update({ status: 'draft' }).eq('employee_code', c.locked).eq('year_month', m2);
    const ok = await admin.post('/api/workspace/monthly', { data: { action: 'recompute', store: zt01, month: m2 } });
    expect(ok.status(), await ok.text()).toBe(200);
    rows = await rosterRows(c.locked);
    expect(field(rows, m2, 'position')).toBe('主任');
    expect(await recheckOf(c.locked)).toHaveLength(0);
    expect((await recheckOf(c.locked, 'resolved')).length).toBeGreaterThan(0);
  });

  test('A.3 店長手動改過的草稿資料以異動為準覆蓋，留下「近期因異動自動調整」紀錄', async () => {
    await seedMaster(c.manual, 'W06 手改', zt01);
    await seedRoster(zt01, m1, [{ code: c.manual, name: 'W06 手改', position: '副店長' }]); // 店長手動改成副店長
    const r = await submitMovements(admin, [{ employee_code: c.manual, employee_name: 'W06 手改', store_id: zt01, movement_type: 'promotion', position: '組長', effective_date: `${m1}-03` }]);
    expect(r.ok, JSON.stringify(r.body)).toBe(true);
    expect(field(await rosterRows(c.manual), m1, 'position')).toBe('組長');
    const log = await adjustmentsOf(c.manual);
    const pos = log.find((x) => x.field === 'position');
    expect(pos).toMatchObject({ old_value: '副店長', new_value: '組長', year_month: m1 });
    expect(pos!.movement_label).toContain('升職');
    expect(pos!.movement_id).toBeTruthy();
    const view = await monthlyView(admin, zt01, m1);
    const list = (view.body.adjustments as any[]).filter((x) => x.employee_code === c.manual);
    expect(list.some((x) => x.field === 'position' && x.old_value === '副店長' && x.new_value === '組長')).toBe(true);
  });

  test('A.5 調店：兩店列都加「請填寫本店實際時數」，天數照舊；已送審月份不再整筆拒絕（A.2）', async () => {
    await seedMaster(c.xfer, 'W06 兼職調店', zt01, { type: 'part_time', position: '兼職助理' });
    await seedRoster(zt01, m2, [{ code: c.xfer, name: 'W06 兼職調店', type: 'part_time', position: '兼職助理' }]);
    await seedRoster(zt02, m2, [{ code: w06Code('FKF', 51), name: 'W06 ZT02 其他人' }]);
    const from = await storeName(zt01);
    const to = await storeName(zt02);
    await insertHistory({ code: c.xfer, name: 'W06 兼職調店', store: zt02, type: 'store_transfer', date: `${m2}-15`, old: from, new: to });
    await recompute(c.xfer, m2, { type: 'store_transfer' });
    const rows = await rosterRows(c.xfer, [m2]);
    const out = rows.find((x) => x.store_id === zt01)!;
    const into = rows.find((x) => x.store_id === zt02)!;
    expect(out).toMatchObject({ monthly_status: 'transferred_out', partial_month_reason: '調出店', movement_hint: MOVEMENT_HINT });
    expect(Number(out.work_days)).toBe(14);
    expect(into).toMatchObject({ monthly_status: 'transferred_in', partial_month_reason: '調入店', movement_hint: MOVEMENT_HINT });
    expect(Number(into.work_days)).toBe(17);
    // 已送審的調出店月份：不動，記入需重新確認（舊版 WORKSPACE_MONTH_LOCKED 整筆拒絕已取消）
    await adminDb().from('monthly_staff_status').update({ status: 'submitted' }).eq('employee_code', c.xfer).eq('store_id', zt01);
    await insertHistory({ code: c.xfer, name: 'W06 兼職調店', store: zt01, type: 'promotion', date: `${m2}-02`, old: '兼職助理', new: '兼職專員' });
    const r = await recompute(c.xfer, m2, { type: 'promotion' });
    expect(r.recheck).toBeGreaterThan(0);
    expect((await recheckOf(c.xfer)).some((x) => x.store_id === zt01 && x.field === 'position')).toBe(true);
    expect((await rosterRows(c.xfer, [m2])).find((x) => x.store_id === zt01)!.position).toBe('兼職助理');
  });

  test('B.1／B.2／B.3 同日多階取最高職等；補登較早的異動只寫歷史，員工目前職位取最新；主檔同步', async () => {
    await seedMaster(c.rank, 'W06 職等', zt01, { position: '專員' });
    await seedRoster(zt01, m1, [{ code: c.rank, name: 'W06 職等', position: '新人' }]);
    // 同日登記「新人二階」與「專員」（B.2 例子），登記順序故意讓專員先、二階新人後。
    const r = await submitMovements(admin, [
      { employee_code: c.rank, employee_name: 'W06 職等', store_id: zt01, movement_type: 'promotion', position: '專員', effective_date: '2025-01-10' },
      { employee_code: c.rank, employee_name: 'W06 職等', store_id: zt01, movement_type: 'promotion', position: '新人', newbie_level: '二階新人', effective_date: '2025-01-10' },
    ]);
    expect(r.ok, JSON.stringify(r.body)).toBe(true);
    expect(field(await rosterRows(c.rank), m1, 'position')).toBe('專員');
    expect((await masterOf(c.rank))[0].current_position).toBe('專員'); // 主檔＝最新有效升職（過去日期立即生效）
    // B.1：補登更早日期的升職，只寫歷史；目前狀態仍是最新一筆。
    const back = await submitMovements(admin, [{ employee_code: c.rank, employee_name: 'W06 職等', store_id: zt01, movement_type: 'promotion', position: '副店長', effective_date: '2024-06-01' }]);
    expect(back.ok, JSON.stringify(back.body)).toBe(true);
    expect((await historyOf(c.rank)).map((x) => x.movement_date)).toEqual(['2024-06-01', '2025-01-10', '2025-01-10']);
    expect(field(await rosterRows(c.rank), m1, 'position')).toBe('專員');
    expect((await masterOf(c.rank))[0].current_position).toBe('專員');
  });

  test('B.1 補登較早的調店不再被 WORKSPACE_LATER_MOVEMENT 拒絕：只寫歷史，目前所在門市不變', async () => {
    await seedMaster(c.backdate, 'W06 補登調店', zt01);
    const before = await masterOf(c.backdate);
    expect(before).toHaveLength(1);
    // 先有一筆較晚的異動（升職），再補登較早的調店。
    const later = await submitMovements(admin, [{ employee_code: c.backdate, employee_name: 'W06 補登調店', store_id: zt01, movement_type: 'promotion', position: '組長', effective_date: '2099-09-01' }]);
    expect(later.ok, JSON.stringify(later.body)).toBe(true);
    const r = await submitMovements(admin, [{ employee_code: c.backdate, employee_name: 'W06 補登調店', store_id: zt02, movement_type: 'store_transfer', from_store_id: zt01, to_store_id: zt02, effective_date: '2099-08-01' }]);
    expect(r.ok, JSON.stringify(r.body)).toBe(true);
    // D.2：批次輸入的調店只建立待確認申請；由系統管理員代兩店督導確認（補登 2099-08-01）後才寫入歷史。
    expect((r.body as any).transferRequests).toBe(1);
    expect((await historyOf(c.backdate)).map((x) => x.movement_type)).toEqual(['promotion']);
    const { data: pending } = await adminDb().from('store_transfer_requests').select('id,status,requested_date').eq('employee_code', c.backdate);
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('pending');
    expect(pending[0].requested_date).toBe('2099-08-01');
    const pv = await admin.post('/api/workspace/transfers/preview', { data: { id: pending[0].id, effective_date: '2099-08-01' } });
    expect(pv.status(), await pv.text()).toBe(200);
    const cf = await admin.post('/api/workspace/transfers/confirm', { data: { id: pending[0].id, effective_date: '2099-08-01', version: (await pv.json()).version } });
    expect(cf.status(), await cf.text()).toBe(200);
    const h = await historyOf(c.backdate);
    expect(h.map((x) => x.movement_type)).toEqual(['store_transfer', 'promotion']);
    const active = (await masterOf(c.backdate)).filter((x) => x.is_active);
    expect(active.map((x) => x.store_id)).toEqual([zt01]); // 最新一筆是升職，所在門市不被補登的調店改動
  });

  test('B.3 升職／代理／過試用期同步員工主檔：主檔職位與最新升職異動不一致時，新的異動會校正', async () => {
    await seedMaster(c.probation, 'W06 主檔漏改', zt01, { position: '專員' });
    await insertHistory({ code: c.probation, name: 'W06 主檔漏改', store: zt01, type: 'promotion', date: '2025-02-01', old: '專員', new: '主任' });
    expect((await masterOf(c.probation))[0].current_position).toBe('專員'); // 舊版漏改：異動寫入了，主檔沒改
    const r = await submitMovements(admin, [{ employee_code: c.probation, employee_name: 'W06 主檔漏改', store_id: zt01, movement_type: 'pass_probation', effective_date: '2025-03-01' }]);
    expect(r.ok, JSON.stringify(r.body)).toBe(true);
    const m = (await masterOf(c.probation))[0];
    expect(m.current_position).toBe('主任');
    expect(m.position).toBe('主任');
  });

  test('B.2 資料庫職等排序與共用職等表（lib/workspace/position-rank.ts）一致', async () => {
    const db = adminDb();
    const cases: Array<[string, string | null]> = [['新人', '未過階新人'], ['新人', '一階新人'], ['新人', '二階新人'], ['新人', null], ['專員', null], ['組長', null], ['主任', null], ['副店長', null], ['店長', null], ['督導', null], ['經理', null], ['行政', '未過階行政'], ['行政', '過階行政'], ['總經理', null], ['兼職助理', null], ['代理店長', null]];
    for (const [position, level] of cases) {
      const { data } = await db.rpc('workspace_position_rank', { p_position: position, p_level: level });
      const ts = positionRank(position, level);
      const expected = ts === null ? null : (ts.track === 'admin' ? 100 : 0) + ts.rank;
      expect(data, `${position}/${level}`).toBe(expected);
    }
    // 同日多筆：SQL 取有效職位的結果要和 TS pickEffectivePosition 相同（含無法比較時保留先登錄者）。
    const sets: Array<Array<{ position: string; level?: string }>> = [
      [{ position: '專員' }, { position: '新人', level: '二階新人' }],
      [{ position: '新人', level: '一階新人' }, { position: '新人', level: '二階新人' }],
      [{ position: '組長' }, { position: '主任' }, { position: '專員' }],
      [{ position: '兼職助理' }, { position: '專員' }],
      [{ position: '行政', level: '過階行政' }, { position: '專員' }],
    ];
    const code = c.rank;
    for (const set of sets) {
      await adminDb().from('employee_movement_history').delete().eq('employee_code', code).eq('movement_type', 'promotion');
      for (let i = 0; i < set.length; i += 1) {
        const e = set[i];
        await insertHistory({ code, name: 'W06 職等', store: zt01, type: 'promotion', date: '2030-05-05', old: null, new: e.position, notes: e.level ? `${e.position === '行政' ? '行政階級' : '新人等級'}:${e.level}` : null });
        await new Promise((resolve) => setTimeout(resolve, 15 * (i + 1)));
      }
      const { data } = await adminDb().rpc('workspace_effective_promotion', { p_code: code, p_until: '2030-12-31' });
      const expected = pickEffectivePosition(set.map((e) => ({ position: e.position, level: e.level ?? null, effective_date: '2030-05-05' })));
      expect(data?.[0]?.pos, JSON.stringify(set)).toBe(expected?.position);
    }
  });

  test('A.1 初始化與重算共用單一計算：同一門市月份重複套用結果不變（冪等）', async () => {
    await purgeW06([], [zt01, zt02]);
    await seedMaster(c.orderA, 'W06 順序甲', zt01);
    await insertHistory({ code: c.orderA, name: 'W06 順序甲', store: zt01, type: 'promotion', date: `${m1}-10`, old: '專員', new: '組長' });
    await seedRoster(zt01, m1, [{ code: c.orderA, name: 'W06 順序甲' }]);
    const first = await applyStoreMonth(zt01, m1, { log: true });
    expect(first.updated).toBeGreaterThan(0);
    const logged = (await adjustmentsOf(c.orderA)).length;
    expect(logged).toBeGreaterThan(0);
    const second = await applyStoreMonth(zt01, m1, { log: true });
    expect(second.updated).toBe(0);
    expect(second.created).toBe(0);
    expect(second.removed).toBe(0);
    expect((await adjustmentsOf(c.orderA)).length).toBe(logged); // 第二次沒有新的調整紀錄
  });
});

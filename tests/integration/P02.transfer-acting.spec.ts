import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { submitMovements } from '../support/w06-fixtures';
import { adminDb, confirmationsOf, historyOf, p02Code, p02Stores, purgeP02, registerP02, seedMaster, transferRequestsOf } from '../support/p02-fixtures';

// P02 整合層（M2 規格 H.5 修訂版，使用者 2026-11-06）：登記調店時偵測「目前是代理店長」並詢問新任職的門市是否也擔任代理店長。
//   選「是」：調店確認生效時在新店自動登記代理店長異動（生效日同調店日）；選「否」：代理註記隨調店結束。
//   批次輸入的調店列：預覽標出目前是代理店長的列，逐列可勾「新店續任代理」（預設不勾）。
//   刪除該調店異動時，連帶產生的新店代理異動一併還原。
// 資料用測試員編 FKF6xxxx、ZT01／ZT04 與保留月份 2099，測後清除。

test.describe('H.5 調店與代理店長', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let st: Record<string, string> = {};
  const code = { yes: p02Code('FKF', 61), no: p02Code('FKF', 62), plain: p02Code('FKF', 63), batch: p02Code('FKF', 64), edit: p02Code('FKF', 65) };
  const all = () => Object.values(code);
  const acting = async (c: string, store: string, until: string) => {
    const { data, error } = await adminDb().rpc('workspace_acting_active', { p_code: c, p_store: store, p_until: until });
    expect(error?.message).toBeUndefined();
    return data as boolean;
  };

  // 登記調店時的偵測以「今天」為準，所以單筆申請測試的代理異動用過去日期；批次預覽以調店生效日偵測，可用 2099 保留日期。
  async function seedActing(c: string, date = '2025-07-05') {
    await seedMaster(c, `P02 代理 ${c}`, st.ZT01, { position: '主任' });
    const { error } = await adminDb().from('employee_movement_history').insert({ employee_code: c, employee_name: `P02 代理 ${c}`, store_id: st.ZT01, movement_type: 'acting_manager', movement_date: date, old_value: '主任', new_value: '代理店長' });
    if (error) throw new Error(error.message);
  }
  async function createRequest(c: string, continueActing?: boolean) {
    const data: any = { employee_code: c, employee_name: `P02 代理 ${c}`, from_store_id: st.ZT01, to_store_id: st.ZT04, notes: '' };
    if (continueActing !== undefined) data.continue_acting = continueActing;
    const res = await admin.post('/api/workspace/transfers/create', { data: { requestId: randomUUID(), data } });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()).id as string;
  }
  async function confirm(id: string, date: string) {
    const pv = await admin.post('/api/workspace/transfers/preview', { data: { id, effective_date: date } });
    expect(pv.status(), await pv.text()).toBe(200);
    const pb = await pv.json();
    expect(pb.canSubmit, JSON.stringify(pb.conflicts)).toBe(true);
    const res = await admin.post('/api/workspace/transfers/confirm', { data: { id, effective_date: date, version: pb.version } });
    return { res, pb };
  }

  test.beforeAll(async () => {
    st = await p02Stores();
    await purgeP02(all());
    admin = await apiAs('admin');
  });
  test.afterAll(async () => {
    await registerP02(all()).catch(() => undefined);
    await purgeP02(all()).catch(() => undefined);
    await admin?.dispose();
  });

  test('登記調店時偵測：代理店長回 acting=true，一般員工 acting=false；非代理者送 continue_acting=true 也記為否', async () => {
    await seedActing(code.yes);
    await seedMaster(code.plain, 'P02 一般', st.ZT01);
    const a = await admin.get('/api/workspace/transfers/create', { params: { acting_code: code.yes, from_store_id: st.ZT01 } });
    expect(await a.json()).toEqual({ acting: true });
    const b = await admin.get('/api/workspace/transfers/create', { params: { acting_code: code.plain, from_store_id: st.ZT01 } });
    expect(await b.json()).toEqual({ acting: false });
    expect((await admin.get('/api/workspace/transfers/create', { params: { acting_code: 'bad code!' } })).status()).toBe(400);
    await createRequest(code.plain, true);
    expect((await transferRequestsOf(code.plain))[0].continue_acting).toBe(false);
  });

  test('選「是」：確認後在新店自動登記代理店長異動（同調店日），原店不再代理；刪除調店連帶還原', async () => {
    const id = await createRequest(code.yes, true);
    const req0 = (await transferRequestsOf(code.yes))[0];
    expect(req0.continue_acting).toBe(true);
    const list = await (await admin.get('/api/workspace/transfers?status=pending')).json();
    expect(list.rows.find((r: any) => r.id === id).continue_acting).toBe(true);
    const { res, pb } = await confirm(id, '2099-08-10');
    expect(pb.actingNow).toBe(true);
    expect(pb.continueActing).toBe(true);
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'confirmed', actingContinued: true, actingEnded: false });
    const hist = await historyOf(code.yes);
    expect(hist.map((h) => [h.movement_type, h.movement_date, h.store_id])).toEqual([
      ['acting_manager', '2025-07-05', st.ZT01],
      ['store_transfer', '2099-08-10', st.ZT04],
      ['acting_manager', '2099-08-10', st.ZT04],
    ]);
    const req = (await transferRequestsOf(code.yes))[0];
    expect(req.acting_movement_id).toBe(hist[2].id);
    expect(req.acting_ended).toBe(false);
    expect(await acting(code.yes, st.ZT04, '2099-12-31')).toBe(true);
    expect(await acting(code.yes, st.ZT01, '2099-12-31')).toBe(false);
    // 已確認的申請清單可看出新店續任代理
    const done = await (await admin.get('/api/workspace/transfers?status=confirmed')).json();
    expect(done.rows.find((r: any) => r.id === id).acting_movement_id).toBe(hist[2].id);

    // 刪除調店異動：連帶產生的新店代理異動一併還原（不需要先刪較新的代理）
    const del = await admin.delete(`/api/workspace/employee-movements/${hist[1].id}`);
    expect(del.status(), await del.text()).toBe(200);
    const after = await historyOf(code.yes);
    expect(after.map((h) => h.movement_type)).toEqual(['acting_manager']);
    expect((await transferRequestsOf(code.yes))[0].status).toBe('rejected');
    expect(await acting(code.yes, st.ZT01, '2099-12-31')).toBe(true);
  });

  test('選「否」（預設）：代理註記隨調店結束，不自動登記新店代理', async () => {
    await seedActing(code.no);
    const id = await createRequest(code.no, false);
    const { res, pb } = await confirm(id, '2099-08-11');
    expect(pb.actingNow).toBe(true);
    expect(pb.continueActing).toBe(false);
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.json()).toMatchObject({ actingEnded: true, actingContinued: false });
    expect((await historyOf(code.no)).map((h) => h.movement_type)).toEqual(['acting_manager', 'store_transfer']);
    const req = (await transferRequestsOf(code.no))[0];
    expect(req.acting_ended).toBe(true);
    expect(req.acting_movement_id).toBeNull();
    expect(await acting(code.no, st.ZT04, '2099-12-31')).toBe(false);
    expect(await acting(code.no, st.ZT01, '2099-12-31')).toBe(false);
  });

  test('批次輸入：預覽標出目前是代理店長的調店列，逐列勾「新店續任代理」才續任；儲存建立待確認申請，確認後自動登記', async () => {
    await seedActing(code.batch, '2099-07-05');
    const row: any = { employee_code: code.batch, employee_name: `P02 代理 ${code.batch}`, store_id: '', movement_type: 'store_transfer', from_store_id: st.ZT01, to_store_id: st.ZT04, effective_date: '2099-08-12', notes: '', position: '', newbie_level: '', birthday: '', onboarding_is_pharmacist: false };
    const unchecked = await admin.post('/api/workspace/movement-validation', { data: { rows: [row] } });
    const ub = await unchecked.json();
    expect(ub.valid, JSON.stringify(ub.errors)).toBe(true);
    expect(ub.actingTransfers).toEqual([`${code.batch}|2099-08-12`]);
    expect(ub.rows[0].continue_acting).toBeUndefined();
    // 勾選：資料列帶 continue_acting=true 送出
    const checked = await admin.post('/api/workspace/movement-validation', { data: { rows: [{ ...row, continue_acting: true }] } });
    const cb = await checked.json();
    expect(cb.valid).toBe(true);
    expect(cb.rows[0].continue_acting).toBe(true);
    const saved = await admin.post('/api/workspace/movement-submit', { data: { rows: cb.rows, version: cb.version, requestId: randomUUID() } });
    expect(saved.status(), await saved.text()).toBe(200);
    const req = (await transferRequestsOf(code.batch))[0];
    expect(req.status).toBe('pending');
    expect(req.continue_acting).toBe(true);
    expect(await historyOf(code.batch)).toHaveLength(1); // 只有原本的代理異動，調店尚未生效
    const { res } = await confirm(req.id, '2099-08-12');
    expect(res.status(), await res.text()).toBe(200);
    expect((await historyOf(code.batch)).map((h) => h.movement_type)).toEqual(['acting_manager', 'store_transfer', 'acting_manager']);
    expect(await acting(code.batch, st.ZT04, '2099-12-31')).toBe(true);
  });

  test('批次輸入未勾選（預設）：申請記為不續任；非代理店長的員工調店列不會被標出', async () => {
    const plain = p02Code('FKF', 66);
    try {
      await seedMaster(plain, 'P02 一般批次', st.ZT01);
      const row: any = { employee_code: plain, employee_name: 'P02 一般批次', store_id: '', movement_type: 'store_transfer', from_store_id: st.ZT01, to_store_id: st.ZT04, effective_date: '2099-08-12', notes: '', position: '', newbie_level: '', birthday: '', onboarding_is_pharmacist: false, continue_acting: true };
      const v = await (await admin.post('/api/workspace/movement-validation', { data: { rows: [row] } })).json();
      expect(v.actingTransfers).toEqual([]);
      const r = await submitMovements(admin, [row]);
      expect(r.ok, JSON.stringify(r.body)).toBe(true);
      // 即使送了 continue_acting=true，非代理店長不會記下
      expect((await transferRequestsOf(plain))[0].continue_acting).toBe(false);
    } finally {
      await registerP02([plain]).catch(() => undefined);
      await purgeP02([plain]).catch(() => undefined);
    }
  });

  test('確認後修改調店生效日：自動登記的新店代理異動跟著改；更正調店日期（同月）也一併更正', async () => {
    await seedActing(code.edit);
    const id = await createRequest(code.edit, true);
    const { res } = await confirm(id, '2099-08-13');
    expect(res.status(), await res.text()).toBe(200);
    const hist = await historyOf(code.edit);
    const transfer = hist.find((h) => h.movement_type === 'store_transfer')!;
    const patch = await admin.patch(`/api/workspace/employee-movements/${transfer.id}`, { data: { movement_date: '2099-08-14' } });
    expect(patch.status(), await patch.text()).toBe(200);
    expect((await historyOf(code.edit)).map((h) => [h.movement_type, h.movement_date])).toEqual([
      ['acting_manager', '2025-07-05'],
      ['store_transfer', '2099-08-14'],
      ['acting_manager', '2099-08-14'],
    ]);
  });

  test('調店確認紀錄只有一筆，confirmations 查詢與清單一致', async () => {
    // code.no、code.edit 的申請都已由管理員確認（admin 不是兩店督導，記為代確認）：各恰好一筆確認紀錄
    for (const c of [code.no, code.edit]) {
      const reqs = (await transferRequestsOf(c)).filter((r) => r.status === 'confirmed');
      expect(reqs.length, c).toBeGreaterThan(0);
      for (const r of reqs) {
        const confs = await confirmationsOf(r.id);
        expect(confs).toHaveLength(1);
        expect(confs[0]).toMatchObject({ side: 'admin', is_proxy: true });
      }
    }
  });
});

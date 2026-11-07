import { expect, test } from '@playwright/test';
import { apiAs } from '../support/auth';
import {
  M4B_MONTH,
  bonusRulesDb,
  deleteRunMasters,
  improvementsOf,
  patchImprovement,
  readImprovement,
  reportBody,
  seedFollowupInspection,
} from '../support/m4b-fixtures';
import { readMaster, runIdOrThrow, storeId, userId } from '../support/m4-fixtures';
import { addDays, bonusScore, improvementToday, legacyReportBonus, reportBonus } from '../../lib/workspace/improvement-rules';

// W17 整合層（M4 Q17、Q18、Q19、急迫標示）：
//  Q18 誰能回報（管理員、該門市店長、有「提交改善」權限者；只有查看權限者不行）；
//  Q19 逾期（待改善超過期限，或補跑程式標成已逾期）一律可補回報，回補 0 分；
//  Q17 回補天數用台灣日期：資料庫觸發器與純函式同輸入同輸出，並對照舊版（UTC 日期）算法；
//  列表帶出急迫標示與剩餘天數。資料只用 ZT 測試門市與保留月份 2099，測後只刪自己建立的列。

const get = (api: any, id: string) => api.get('/api/workspace/improvement-detail', { params: { id } });
const post = (api: any, data: unknown) => api.post('/api/workspace/improvement-detail', { data });

test.afterAll(async () => {
  await deleteRunMasters();
});

test('Q18 誰能回報：管理員、該門市店長、有「提交改善」權限者可以；只有查看權限者與無權限者不行', async () => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const zt01 = await seedFollowupInspection({ store: 'ZT01', inspector: 'supervisor', date: `${M4B_MONTH.followup}-05`, tag: 'w17-q18-a', count: 3 });
  const zt02 = await seedFollowupInspection({ store: 'ZT02', inspector: 'admin', date: `${M4B_MONTH.followup}-06`, tag: 'w17-q18-b', count: 2 });
  const [a1, a2, a3] = zt01.improvements.map((i) => i.id);
  const [b1, b2] = zt02.improvements.map((i) => i.id);
  const roles = new Map<string, any>();
  const as = async (role: string) => {
    if (!roles.has(role)) roles.set(role, await apiAs(role));
    return roles.get(role);
  };
  try {
    // ZT01 的項目（督導巡店單）：管理員、ZT01 店長、督導（也是該單督導，並有提交權限）可回報
    for (const [role, expected] of [['admin', true], ['store_manager', true], ['acting_manager', true], ['supervisor', true], ['navigation', false], ['ops_manager', false]] as const) {
      const res = await get(await as(role), a1);
      expect(res.status(), `${role} 讀 ZT01 項目`).toBe(200);
      expect((await res.json()).canSubmit, `${role} canSubmit`).toBe(expected);
    }
    // ZT02 的項目（管理員建立的單）：ZT01 店長看不到；督導（指派 ZT02、有提交權限，但不是店長也不是管理員）可代回報；只有查看權限者不行
    expect((await get(await as('store_manager'), b1)).status()).toBe(404);
    expect((await (await get(await as('supervisor'), b1)).json()).canSubmit).toBe(true);
    expect((await (await get(await as('navigation'), b1)).json()).canSubmit).toBe(false);
    // 無改善權限的人：403
    for (const role of ['employee', 'denied']) expect((await get(await as(role), a1)).status(), role).toBe(403);

    // 寫入：只有查看權限者送出被擋下（403，且沒有寫進去）
    const view = await (await get(await as('admin'), a2)).json();
    for (const role of ['navigation', 'ops_manager']) {
      const res = await post(await as(role), reportBody(a2, view.record.updated_at));
      expect(res.status(), `${role} 送出`).toBe(403);
    }
    expect((await readImprovement(a2)).status).toBe('pending');
    // 有權限者：代回報 ZT02（提交權限者）、店長回報 ZT01
    const proxy = await post(await as('supervisor'), reportBody(b2, (await (await get(await as('supervisor'), b2)).json()).record.updated_at));
    expect(proxy.status(), (await proxy.text()).slice(0, 200)).toBe(200);
    expect((await readImprovement(b2)).status).toBe('improved');
    expect((await readImprovement(b2)).improved_by, '代回報的人記為回報人').toBe(userId('supervisor'));
    const mine = await post(await as('store_manager'), reportBody(a3, (await (await get(await as('store_manager'), a3)).json()).record.updated_at));
    expect(mine.status(), (await mine.text()).slice(0, 200)).toBe(200);
    expect((await readImprovement(a3)).status).toBe('improved');
  } finally {
    for (const api of roles.values()) await api.dispose();
  }
});

test('回報：回補按規則算並加進總分；重送同內容回同一筆、他人再送 409、已改善不可再改', async () => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const seeded = await seedFollowupInspection({ store: 'ZT01', inspector: 'supervisor', date: `${M4B_MONTH.followup}-07`, tag: 'w17-report', count: 2, deduction: 10, total: 200 });
  const [first, second] = seeded.improvements;
  const manager = await apiAs('store_manager');
  const admin = await apiAs('admin');
  try {
    const rules = await bonusRulesDb();
    const view = await (await get(manager, first.id)).json();
    expect(view.estimate, '伺服器預估回補').toBeTruthy();
    const body = reportBody(first.id, view.record.updated_at);
    const res = await post(manager, body);
    expect(res.status(), (await res.text()).slice(0, 200)).toBe(200);
    const saved = await readImprovement(first.id);
    // 巡店日在 2099 年（未來），回報當天天數為 0；預期值用同一套純函式與資料庫規則算
    const expected = reportBonus({ inspectionDate: `${M4B_MONTH.followup}-07`, deadline: saved.deadline, improvedAt: saved.improved_at, deduction: Number(saved.deduction_amount), rules });
    expect(saved.status).toBe('improved');
    expect(saved.days_taken).toBe(expected.days_taken);
    expect(Number(saved.bonus_score)).toBe(expected.bonus_score);
    expect(Number(saved.bonus_score)).toBe(bonusScore(Number(saved.deduction_amount), expected.percent));
    const master = await readMaster(seeded.id);
    expect(Number(master.improvement_bonus)).toBe(Number(saved.bonus_score));
    expect(Number(master.total_score)).toBe(200 + Number(saved.bonus_score));
    // 重送完全相同的內容：冪等，回同一筆
    const again = await post(manager, body);
    expect(again.status()).toBe(200);
    expect((await again.json()).record.id).toBe(first.id);
    expect(Number((await readMaster(seeded.id)).improvement_bonus), '冪等重送不重複加分').toBe(Number(saved.bonus_score));
    // 別人再送：項目已改善 → 409
    const other = await post(admin, reportBody(first.id, view.record.updated_at, { description: '另一份說明' }));
    expect(other.status()).toBe(409);
    // 已改善後詳情不可再回報
    const after = await (await get(admin, first.id)).json();
    expect(after.canSubmit).toBe(false);
    expect(after.displayStatus).toBe('improved');
    // 另一項仍待改善，不受影響
    expect((await readImprovement(second.id)).status).toBe('pending');
    // 欄位驗證
    const fresh = await (await get(admin, second.id)).json();
    expect((await post(admin, { ...reportBody(second.id, fresh.record.updated_at), description: '   ' })).status()).toBe(400);
    expect((await post(admin, { ...reportBody(second.id, fresh.record.updated_at), photos: [] })).status()).toBe(400);
    expect((await post(admin, { ...reportBody(second.id, fresh.record.updated_at), version: '1999-01-01T00:00:00Z' })).status()).toBe(409);
  } finally {
    await manager.dispose();
    await admin.dispose();
  }
});

test('Q19 逾期一律可補回報，回補 0 分（待改善過期限、補跑程式標的已逾期都一樣）', async () => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const seeded = await seedFollowupInspection({ store: 'ZT01', inspector: 'supervisor', date: `${M4B_MONTH.followup}-08`, tag: 'w17-q19', count: 2, deduction: 8, total: 210 });
  const [pendingLate, dbOverdue] = seeded.improvements;
  // 期限調成過去（台灣日期）；第二筆另外標成補跑程式的 overdue 狀態
  await patchImprovement(pendingLate.id, { deadline: addDays(improvementToday(), -3) });
  await patchImprovement(dbOverdue.id, { deadline: addDays(improvementToday(), -10), status: 'overdue' });
  const manager = await apiAs('store_manager');
  const admin = await apiAs('admin');
  try {
    const list = await (await admin.get('/api/workspace/improvements')).json();
    const row = list.records.find((r: any) => r.id === pendingLate.id);
    expect(row.status, '列表顯示為已逾期（只在顯示時計算）').toBe('overdue');
    expect((await readImprovement(pendingLate.id)).status, '資料庫仍是 pending，不寫回').toBe('pending');
    expect(row.remaining).toMatch(/^逾期 3 天$/);
    for (const item of [pendingLate, dbOverdue]) {
      const view = await (await get(manager, item.id)).json();
      expect(view.displayStatus).toBe('overdue');
      expect(view.canSubmit, '逾期仍可補報').toBe(true);
      const res = await post(manager, reportBody(item.id, view.record.updated_at));
      expect(res.status(), (await res.text()).slice(0, 200)).toBe(200);
      const saved = await readImprovement(item.id);
      expect(saved.status).toBe('improved');
      expect(Number(saved.bonus_score), '逾期回補 0').toBe(0);
      expect(saved.improvement_description).toBeTruthy();
      expect(saved.improvement_photo_urls.length).toBe(1);
    }
    const master = await readMaster(seeded.id);
    expect(Number(master.improvement_bonus)).toBe(0);
    expect(Number(master.total_score), '逾期補報不改分數').toBe(210);
    // 已改善後不可再補
    expect((await (await get(manager, pendingLate.id)).json()).canSubmit).toBe(false);
  } finally {
    await manager.dispose();
    await admin.dispose();
  }
});

test('Q17 台灣日期：資料庫觸發器與純函式同輸入同輸出（含台灣凌晨 0–8 點邊界），並對照舊版 UTC 算法', async () => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const date = `${M4B_MONTH.boundary}-10`;
  const cases = [
    { at: '2099-10-12T15:59:00Z', name: '台灣 10/12 23:59' },
    { at: '2099-10-12T16:00:00Z', name: '台灣 10/13 00:00' },
    { at: '2099-10-13T16:00:00Z', name: '台灣 10/14 00:00（舊版 UTC 仍是 10/13）' },
    { at: '2099-10-14T16:30:00Z', name: '台灣 10/15 00:30' },
    { at: '2099-10-15T16:00:00Z', name: '台灣 10/16 00:00（第 6 天）' },
    { at: '2099-10-17T16:00:00Z', name: '台灣 10/18 00:00（超過期限 10/17）' },
    { at: '2099-10-17T15:00:00Z', name: '台灣 10/17 23:00（期限當天）' },
  ];
  const seeded = await seedFollowupInspection({ store: 'ZT03', inspector: 'supervisor', date, tag: 'w17-q17', count: cases.length, deduction: 10, total: 150 });
  const rules = await bonusRulesDb();
  const defaults = rules.length === 3 && rules[0].day_to === 3 && rules[0].bonus_score === 20 && rules[1].day_to === 5 && rules[2].day_to === 7;
  let legacyDiffers = 0;
  for (const [i, c] of cases.entries()) {
    const item = seeded.improvements[i];
    await patchImprovement(item.id, { status: 'improved', improved_at: c.at, improvement_description: '邊界測試', improvement_photo_urls: [] });
    const saved = await readImprovement(item.id);
    const expected = reportBonus({ inspectionDate: date, deadline: saved.deadline, improvedAt: c.at, deduction: Number(saved.deduction_amount), rules });
    const legacy = legacyReportBonus({ inspectionDate: date, improvedAt: c.at, deduction: Number(saved.deduction_amount), rules });
    expect(saved.days_taken, `${c.name} 天數`).toBe(expected.days_taken);
    expect(Number(saved.bonus_score), `${c.name} 回補`).toBe(expected.bonus_score);
    if (legacy.days_taken !== saved.days_taken || legacy.bonus_score !== Number(saved.bonus_score)) legacyDiffers += 1;
  }
  if (defaults) expect(legacyDiffers, '舊版 UTC 算法在凌晨邊界會不同（Q17 已核可）').toBeGreaterThanOrEqual(3);
  // 總分＝基本分數加全部回補；評級用該單完成當時的門檻
  const rows = await improvementsOf(seeded.id);
  const sum = rows.reduce((s, r) => s + Number(r.bonus_score || 0), 0);
  const master = await readMaster(seeded.id);
  expect(Number(master.improvement_bonus)).toBeCloseTo(sum, 1);
  expect(Number(master.total_score)).toBeCloseTo(150 + sum, 1);
});

test('列表：急迫標示（剩 2 天內）、剩餘天數、逾期；範圍：店長只看到自己門市', async () => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const today = improvementToday();
  const zt01 = await seedFollowupInspection({ store: 'ZT01', inspector: 'supervisor', date: `${M4B_MONTH.followup}-09`, tag: 'w17-list-a', count: 4 });
  const zt02 = await seedFollowupInspection({ store: 'ZT02', inspector: 'admin', date: `${M4B_MONTH.followup}-10`, tag: 'w17-list-b', count: 1 });
  const [soon, today0, later, late] = zt01.improvements;
  await patchImprovement(soon.id, { deadline: addDays(today, 2) });
  await patchImprovement(today0.id, { deadline: today });
  await patchImprovement(later.id, { deadline: addDays(today, 3) });
  await patchImprovement(late.id, { deadline: addDays(today, -1) });
  const admin = await apiAs('admin');
  const manager = await apiAs('store_manager');
  try {
    const list = await (await admin.get('/api/workspace/improvements')).json();
    const by = (id: string) => list.records.find((r: any) => r.id === id);
    expect(by(soon.id)).toMatchObject({ status: 'pending', urgent: true, remaining: '剩 2 天' });
    expect(by(today0.id)).toMatchObject({ status: 'pending', urgent: true, remaining: '今天到期' });
    expect(by(later.id)).toMatchObject({ status: 'pending', urgent: false, remaining: '剩 3 天' });
    expect(by(late.id)).toMatchObject({ status: 'overdue', urgent: false, remaining: '逾期 1 天' });
    expect(list.records.length, '全部載入，不再只取每個狀態 200 筆').toBeGreaterThanOrEqual(5);
    const mine = await (await manager.get('/api/workspace/improvements')).json();
    expect(mine.records.some((r: any) => r.id === soon.id)).toBe(true);
    expect(mine.records.some((r: any) => r.id === zt02.improvements[0].id), '店長看不到其他門市').toBe(false);
    const zt01Id = await storeId('ZT01');
    expect(mine.records.every((r: any) => r.store_id === zt01Id || r.inspector_name), '店長的列表都是自己門市或自己建立的單').toBe(true);
  } finally {
    await admin.dispose();
    await manager.dispose();
  }
});

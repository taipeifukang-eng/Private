import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { M4B_MONTH, bonusRulesDb, deleteRunMasters, patchImprovement, readImprovement, seedFollowupInspection } from '../support/m4b-fixtures';
import { runIdOrThrow } from '../support/m4-fixtures';
import { addDays, daysBetween, improvementToday, legacyReportBonus, taipeiDate } from '../../lib/workspace/improvement-rules';

// W17 對等層（M4 Q17–Q19）：舊版 /api/inspection/improvements 與新版 /api/workspace/improvements 同一批種子、同一個角色逐項對照；
//  list-scope（角色矩陣等價：看得到哪些項目）→ 不應有差異；urgent（急迫標示、逾期顯示）→ 只有台灣凌晨 0–8 點的逾期判定是已核可差異；
//  bonus-days（影響獎金）→ 台灣 8 點以後相同，凌晨 0–8 點是 Q17 已核可差異；
//  write-permission（Q18）、overdue-report（Q19）、list-limit → 舊版事實由原始碼讀出，已核可差異列白名單。

const map = loadMap('improvements');
const recorder = new ParityRecorder('improvements');
const find = (id: string) => map.entries.find((e) => e.id === id)!;
const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const D = (day: number) => `${M4B_MONTH.followup}-${String(day).padStart(2, '0')}`;

function report(entry: string, title: string, legacy: any, native: any, role = 'admin', mechanism?: 'api-read' | 'write-readback') {
  const e = find(entry);
  assertNoUnlistedDiffs(
    recorder.record({
      entry,
      mechanism: mechanism || e.mechanism,
      role,
      title,
      legacy: { endpoint: e.legacy.api?.path || e.legacy.source || '' },
      native: { endpoint: e.native.api?.path || e.native.source || '' },
      compared: legacy,
      diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
    }),
  );
}

const names = new Map<string, string>(); // id → 名稱（讓差異鍵穩定）
let A: Awaited<ReturnType<typeof seedFollowupInspection>>; // ZT01，督導 supervisor
let B: Awaited<ReturnType<typeof seedFollowupInspection>>; // ZT02，管理員建立
let C: Awaited<ReturnType<typeof seedFollowupInspection>>; // 急迫與逾期
test.beforeAll(async () => {
  runIdOrThrow();
  const today = improvementToday();
  A = await seedFollowupInspection({ store: 'ZT01', inspector: 'supervisor', date: D(25), tag: 'w17-par-a', count: 3, deduction: 5 });
  B = await seedFollowupInspection({ store: 'ZT02', inspector: 'admin', date: D(26), tag: 'w17-par-b', count: 2, deduction: 4 });
  C = await seedFollowupInspection({ store: 'ZT01', inspector: 'supervisor', date: D(27), tag: 'w17-par-c', count: 5, deduction: 3 });
  A.improvements.forEach((r, i) => names.set(r.id, `A${i}`));
  B.improvements.forEach((r, i) => names.set(r.id, `B${i}`));
  // C3（期限為台灣昨天）只在 urgent 項目對照：它的逾期顯示在台灣凌晨 0–8 點兩邊不同（已核可），不放進角色矩陣對照
  C.improvements.forEach((r, i) => i !== 3 && names.set(r.id, `C${i}`));
  // A2 已改善（有回補），B1 補跑程式標的 overdue；C 組做急迫與逾期情境
  await patchImprovement(A.improvements[2].id, { status: 'improved', improved_at: new Date().toISOString(), improvement_description: '測試', improvement_photo_urls: [] });
  await patchImprovement(B.improvements[1].id, { status: 'overdue', deadline: addDays(today, -12) });
  await patchImprovement(C.improvements[0].id, { deadline: addDays(today, 1) }); // 剩 1 天
  await patchImprovement(C.improvements[1].id, { deadline: today }); // 今天到期
  await patchImprovement(C.improvements[2].id, { deadline: addDays(today, 3) }); // 剩 3 天
  await patchImprovement(C.improvements[3].id, { deadline: addDays(today, -1) }); // 台灣昨天到期（凌晨 0–8 點時舊版 UTC 日期還沒算逾期）
  await patchImprovement(C.improvements[4].id, { deadline: addDays(today, -4) }); // 一定逾期
});
test.afterAll(async () => {
  await deleteRunMasters();
});

const ROLES = ['admin', 'navigation', 'ops_manager', 'supervisor', 'store_manager', 'acting_manager', 'ops_assistant', 'employee', 'denied'];
const seededIds = () => new Set(names.keys());
const shape = (r: any) => ({ status: r.status, deadline: String(r.deadline).slice(0, 10), deduction: Number(r.deduction_amount), days_taken: r.days_taken ?? null, bonus: Number(r.bonus_score || 0) });

test('list-scope：同一批種子、每個角色，舊版與新版看到的項目與欄位相同（角色矩陣等價）', async () => {
  test.setTimeout(300_000);
  for (const role of ROLES) {
    const api = await apiAs(role);
    try {
      const [l, n] = [await api.get('/api/inspection/improvements'), await api.get('/api/workspace/improvements')];
      const pick = async (res: any, key: string) => {
        if (res.status() !== 200) return { status: res.status(), items: {} as Record<string, unknown> };
        const rows = (await res.json())[key] as any[];
        return { status: 200, items: Object.fromEntries(rows.filter((r) => seededIds().has(r.id)).map((r) => [names.get(r.id)!, shape(r)])) };
      };
      const legacy = await pick(l, 'improvements');
      const native = await pick(n, 'records');
      report('list-scope', `${role}：可見項目`, legacy, native, role, 'api-read');
      if (role === 'admin') expect(Object.keys(native.items)).toHaveLength(names.size);
      if (role === 'denied') expect(native.status).toBe(403);
    } finally {
      await api.dispose();
    }
  }
});

test('urgent：急迫標示與逾期顯示，舊版與新版同輸入對照（只有台灣凌晨 0–8 點的逾期判定不同）', async () => {
  test.setTimeout(300_000);
  const api = await apiAs('admin');
  try {
    const l = (await (await api.get('/api/inspection/improvements')).json()).improvements as any[];
    const n = (await (await api.get('/api/workspace/improvements')).json()).records as any[];
    // 舊版畫面邏輯（app/inspection/improvements/page.tsx）：剩餘天數 ＝ 期限（當地日期）－今天（當地日期）；急迫 ＝ 狀態 pending 且剩餘天數 ≤ 2
    const src = read('app/inspection/improvements/page.tsx');
    expect(src).toContain("const isUrgent = item.status === 'pending' && daysRemaining <= 2;");
    const legacyDays = (deadline: string) => daysBetween(taipeiDate(new Date()), deadline.slice(0, 10)); // 使用者在台灣，本機日期即台灣日期
    const scenarios: Record<string, number> = { soonOneDay: 0, today: 1, threeDays: 2, yesterday: 3, fourDaysAgo: 4 };
    const legacy: Record<string, unknown> = {};
    const native: Record<string, unknown> = {};
    for (const [name, i] of Object.entries(scenarios)) {
      const id = C.improvements[i].id;
      const lr = l.find((r) => r.id === id);
      const nr = n.find((r) => r.id === id);
      legacy[name] = { status: lr.status, urgent: lr.status === 'pending' && legacyDays(lr.deadline) <= 2 };
      native[name] = { status: nr.status, urgent: !!nr.urgent };
    }
    // 一定相同：不在邊界的情境
    for (const name of ['soonOneDay', 'today', 'threeDays', 'fourDaysAgo']) expect(native[name], name).toEqual(legacy[name]);
    report('urgent', '急迫標示與逾期顯示', legacy, native, 'admin', 'api-read');
    expect(native.soonOneDay).toEqual({ status: 'pending', urgent: true });
    expect(native.yesterday).toEqual({ status: 'overdue', urgent: false });
  } finally {
    await api.dispose();
  }
});

test('bonus-days：同一組回報時間，舊版（UTC 日期）與新版資料庫觸發器（台灣日期）逐點對照', async () => {
  test.setTimeout(300_000);
  runIdOrThrow();
  const date = `${M4B_MONTH.boundary}-20`;
  const rules = await bonusRulesDb();
  // 回報時間（UTC）：台灣 8 點以後與凌晨 0–8 點各數個，涵蓋級距邊界
  const after8 = ['2099-10-22T04:00:00Z', '2099-10-23T01:00:00Z', '2099-10-24T07:30:00Z', '2099-10-25T05:00:00Z'];
  const early = ['2099-10-22T16:30:00Z', '2099-10-23T18:00:00Z', '2099-10-24T20:15:00Z', '2099-10-25T16:00:00Z'];
  const seeded = await seedFollowupInspection({ store: 'ZT03', inspector: 'supervisor', date, tag: 'w17-par-bonus', count: after8.length + early.length, deduction: 10, total: 150 });
  // 期限放寬到很遠，避免把這個對照混進 Q19（逾期回補 0）
  for (const [i, at] of [...after8, ...early].entries()) {
    const id = seeded.improvements[i].id;
    await patchImprovement(id, { deadline: '2100-01-01' });
    await patchImprovement(id, { status: 'improved', improved_at: at, improvement_description: '對照', improvement_photo_urls: [] });
  }
  const run = async (times: string[], offset: number) => {
    const legacy: string[] = [];
    const native: string[] = [];
    for (const [i, at] of times.entries()) {
      const row = await readImprovement(seeded.improvements[offset + i].id);
      const l = legacyReportBonus({ inspectionDate: date, improvedAt: at, deduction: Number(row.deduction_amount), rules });
      legacy.push(`${at} → ${l.days_taken} 天 / ${l.bonus_score} 分`);
      native.push(`${at} → ${row.days_taken} 天 / ${Number(row.bonus_score)} 分`);
    }
    return { legacy: legacy.join('\n'), native: native.join('\n') };
  };
  const a = await run(after8, 0);
  const e = await run(early, after8.length);
  report('bonus-days', '回報時間（台灣 8 點以後）', { afterEightAM: a.legacy }, { afterEightAM: a.native }, 'store_manager', 'write-readback');
  report('bonus-days-early', '回報時間（台灣凌晨 0–8 點）', { earlyMorning: e.legacy }, { earlyMorning: e.native }, 'store_manager', 'write-readback');
});

test('write-permission：舊版資料庫更新政策與新版 canSubmit 的寫入資格（Q18）', async () => {
  const sql = read('supabase/migration_add_improvement_system.sql');
  const policy = sql.slice(sql.indexOf('CREATE POLICY "更新待改善事項"'), sql.indexOf('CREATE POLICY "建立待改善事項"'));
  const codes = (text: string) => Array.from(new Set(Array.from(text.matchAll(/inspection\.improvement\.[a-z_]+/g)).map((m) => m[0]))).sort();
  const src = read('lib/workspace/improvements.ts');
  const canSubmit = src.slice(src.indexOf('const canSubmit ='), src.indexOf('return { row, master, canSubmit }'));
  const legacy = {
    permissionCodes: codes(policy),
    storeManagerOfStore: /store_managers sm/.test(policy),
    inspectorOfInspection: /im\.inspector_id = auth\.uid\(\)/.test(policy),
    admin: /p\.role = 'admin'/.test(policy),
  };
  const native = {
    permissionCodes: codes(canSubmit),
    storeManagerOfStore: canSubmit.includes('access.stores.includes(row.store_id)'),
    inspectorOfInspection: false,
    admin: canSubmit.includes('access.admin'),
  };
  expect(legacy.permissionCodes).toEqual(['inspection.improvement.manage']);
  report('write-permission', '寫入資格', legacy, native, 'admin', 'write-readback');
});

test('overdue-report：資料庫標成已逾期的項目，舊版不可補報、新版可補報（Q19）；待改善過期限兩邊都可', async () => {
  test.setTimeout(300_000);
  const page = read('app/inspection/improvements/[id]/page.tsx');
  expect(page).toContain("setCanSubmit(hasSubmitAccess && detail.status === 'pending');");
  const api = await apiAs('store_manager');
  try {
    const view = async (id: string) => (await (await api.get('/api/workspace/improvement-detail', { params: { id } })).json()).canSubmit as boolean;
    // 舊版規則：status === 'pending'（待改善過期限仍是 pending）；資料庫 overdue 不可
    const legacy = { dbOverdueCanReport: false, pendingPastDeadlineCanReport: true };
    // 準備：ZT01 項目兩個（一個標成 overdue，一個 pending 但過期限）
    const seeded = await seedFollowupInspection({ store: 'ZT01', inspector: 'supervisor', date: D(28), tag: 'w17-par-overdue', count: 2 });
    await patchImprovement(seeded.improvements[0].id, { status: 'overdue', deadline: addDays(improvementToday(), -8) });
    await patchImprovement(seeded.improvements[1].id, { deadline: addDays(improvementToday(), -3) });
    const native = { dbOverdueCanReport: await view(seeded.improvements[0].id), pendingPastDeadlineCanReport: await view(seeded.improvements[1].id) };
    report('overdue-report', '逾期是否可補報', legacy, native, 'store_manager', 'write-readback');
    expect(native.dbOverdueCanReport).toBe(true);
  } finally {
    await api.dispose();
  }
});

test('list-limit：舊版每個狀態最多載 200 筆，新版全部載入', async () => {
  const legacySrc = read('app/api/inspection/improvements/route.ts');
  const nativeSrc = read('app/api/workspace/improvements/route.ts');
  const limit = Number(/const LIST_LIMIT = (\d+);/.exec(legacySrc)?.[1]);
  expect(limit).toBe(200);
  const nativeLimited = /LIST_LIMIT|\.limit\(\d+\)/.test(nativeSrc);
  report('list-limit', '每狀態筆數上限', { limitPerStatus: limit }, { limitPerStatus: nativeLimited ? 'limited' : 'all' }, 'admin', 'api-read');
});

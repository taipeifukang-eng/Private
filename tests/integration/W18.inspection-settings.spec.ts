import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiAs } from '../support/auth';
import { adminDb, DEFAULT_THRESHOLDS, deleteRunMasters, M4_MONTH, readMaster, runIdOrThrow, seedMaster, storeId } from '../support/m4-fixtures';
import { DEFAULT_GRADE_MAPPING, gradeFromMapping, legacyHardcodedGrade } from '../../lib/workspace/inspection-scoring';

// W18 整合層（M4 Q5–Q8）：
//  Q5 評級門檻 snapshot（資料庫 trigger）：完成當時記錄門檻；之後改評級對照表不影響已完成的單，改善加分只加分數；
//  Q6 設定 API 回等待改善筆數；Q7 重疊的回補規則被擋（400）；
//  SQL 函式 workspace_grade_for_score 與舊版寫死門檻在邊界分數上同輸入同輸出。
// 會暫時改寫 DEV 的評級對照表（寫入前備份全部列，finally 還原），並使用保留月份 2099-06 的測試巡店。

const asc = (a: { grade: number }, b: { grade: number }) => a.grade - b.grade;

test.afterAll(async () => {
  await deleteRunMasters();
});

test('設定 API：只有範本管理權限可讀；回傳等待改善筆數（Q6）', async () => {
  runIdOrThrow();
  for (const role of ['denied', 'supervisor', 'employee']) {
    const api = await apiAs(role);
    try {
      expect((await api.get('/api/workspace/inspection-settings')).status(), role).toBe(403);
    } finally {
      await api.dispose();
    }
  }
  const api = await apiAs('admin');
  try {
    const res = await api.get('/api/workspace/inspection-settings');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const count = await adminDb().from('inspection_improvements').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    expect(count.error).toBeNull();
    expect(typeof body.pendingImprovements).toBe('number');
    expect(body.pendingImprovements).toBe(count.count);
    expect(Array.isArray(body.grades) && body.grades.length).toBe(11);
  } finally {
    await api.dispose();
  }
});

test('Q7：啟用中的回補規則天數重疊被擋下（400），資料不變；空缺允許不在此測（不改 DEV 設定）', async () => {
  const api = await apiAs('admin');
  try {
    const body = await (await api.get('/api/workspace/inspection-settings')).json();
    const active = (body.bonus as any[]).filter((b) => b.is_active);
    test.skip(!active.length, 'DEV 沒有啟用中的回補規則，無法建立重疊情境');
    const target = active[0];
    const before = JSON.stringify(body.bonus);
    const res = await api.post('/api/workspace/inspection-settings', {
      data: {
        writeId: randomUUID(),
        version: body.version,
        kind: 'bonus',
        id: null,
        data: { day_from: target.day_from, day_to: target.day_to, bonus_score: 1, description: 'ZT 重疊測試（不應寫入）', sort_order: 9999, is_active: true },
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('重疊');
    const after = await (await api.get('/api/workspace/inspection-settings')).json();
    expect(JSON.stringify(after.bonus), '被擋下後沒有任何寫入').toBe(before);
    expect(after.version).toBe(body.version);
  } finally {
    await api.dispose();
  }
});

test('SQL 邊界：workspace_grade_for_score（預設門檻）與舊版寫死門檻同輸入同輸出', async () => {
  const db = adminDb();
  const scores = [220, 219.9, 215, 214.9, 191, 190.9, 181, 180.9, 171, 170.9, 161, 160.9, 151, 150.9, 141, 140.9, 131, 130.9, 121, 120.9, 0];
  for (const s of scores) {
    const r = await db.rpc('workspace_grade_for_score', { p_score: s, p_thresholds: DEFAULT_THRESHOLDS });
    expect(r.error, String(s)).toBeNull();
    expect(Number(r.data), `分數 ${s}`).toBe(legacyHardcodedGrade(s));
    expect(Number(r.data)).toBe(gradeFromMapping(s, DEFAULT_GRADE_MAPPING));
  }
  // 未提供 snapshot 時用目前設定表（與 TS 以設定表資料計算一致）
  const current = (await db.from('inspection_grade_mapping').select('grade,min_score')).data as { grade: number; min_score: string }[];
  const mapping = current.map((m) => ({ grade: m.grade, min_score: Number(m.min_score) }));
  for (const s of [0, 150, 190.9, 200, 220]) {
    const r = await db.rpc('workspace_grade_for_score', { p_score: s, p_thresholds: null });
    expect(Number(r.data), `目前設定 ${s}`).toBe(gradeFromMapping(s, mapping));
  }
});

test('Q5：完成時記錄門檻；之後改評級對照表，已完成的單評級與加分重算都照 snapshot；新完成的單用新門檻', async () => {
  const db = adminDb();
  const month = M4_MONTH.snapshot;
  const original = ((await db.from('inspection_grade_mapping').select('id,grade,min_score').order('grade')).data || []) as { id: string; grade: number; min_score: string }[];
  expect(original.length).toBe(11);
  const tpl = await db.from('inspection_templates').select('id,section_name,item_name').eq('is_active', true).limit(1).single();
  expect(tpl.error).toBeNull();
  const zt04 = await storeId('ZT04');
  try {
    // 1) 草稿：沒有 snapshot；變成已完成：記下完成當時的對照表
    const id = await seedMaster({ store: 'ZT04', inspector: 'admin', date: `${month}-02`, status: 'draft', total: 200, tag: 'snap-main' });
    expect((await readMaster(id)).grade_thresholds, '草稿不留 snapshot').toBeNull();
    // 一筆有扣分的檢查結果，完成時由既有 trigger 產生待改善項目
    const result = await db.from('inspection_results').insert({ inspection_id: id, template_id: tpl.data.id, max_score: 20, given_score: 10, deduction_amount: 10, is_improvement: true, selected_items: [], notes: 'ZT M4 snapshot' }).select('id').single();
    expect(result.error).toBeNull();
    const done = await db.from('inspection_masters').update({ status: 'completed', total_score: 200 }).eq('id', id).select('*').single();
    expect(done.error).toBeNull();
    const snapshot = done.data.grade_thresholds as { grade: number; min_score: number }[];
    expect(Array.isArray(snapshot) && snapshot.length).toBe(11);
    expect([...snapshot].sort(asc).map((m) => [m.grade, Number(m.min_score)])).toEqual(original.map((m) => [m.grade, Number(m.min_score)]));
    const gradeAtCompletion = done.data.grade;
    expect(Number(gradeAtCompletion)).toBe(gradeFromMapping(200, snapshot.map((m) => ({ grade: m.grade, min_score: Number(m.min_score) }))));

    // 2) 把評級對照表改成很嚴（除 0 級外都要 9000 分以上）
    for (const m of original.filter((x) => x.grade > 0)) {
      const u = await db.from('inspection_grade_mapping').update({ min_score: 9000 + m.grade }).eq('id', m.id);
      expect(u.error).toBeNull();
    }
    // 3) 已完成的單：只改分數（例如補分），評級照 snapshot，不被新門檻蓋掉
    const bumped = await db.from('inspection_masters').update({ total_score: 201 }).eq('id', id).select('*').single();
    expect(bumped.error).toBeNull();
    const snapMapping = snapshot.map((m) => ({ grade: m.grade, min_score: Number(m.min_score) }));
    expect(Number(bumped.data.grade), '已完成的單不受改門檻影響').toBe(gradeFromMapping(201, snapMapping));
    const strict = original.map((m) => ({ grade: m.grade, min_score: m.grade === 0 ? 0 : 9000 + m.grade }));
    expect(gradeFromMapping(201, strict), '若套用新門檻，201 分會掉到 0 級').toBe(0);
    expect(Number(bumped.data.grade), '但已完成的單照 snapshot').toBeGreaterThan(0);
    expect(JSON.stringify(bumped.data.grade_thresholds)).toBe(JSON.stringify(snapshot));

    // 4) 改善回報：加分重算（只加分數；評級仍照 snapshot）
    const imp = await db.from('inspection_improvements').select('id,deduction_amount,status').eq('inspection_id', id);
    expect(imp.error).toBeNull();
    expect(imp.data.length, '完成時產生 1 筆待改善').toBe(1);
    const rule = await db.from('inspection_bonus_config').select('day_from,day_to,bonus_score,sort_order').eq('is_active', true).order('sort_order');
    const percent = Number((rule.data as any[]).find((r) => 0 >= r.day_from && 0 <= r.day_to)?.bonus_score ?? 0);
    const upd = await db.from('inspection_improvements').update({ status: 'improved', improved_at: new Date().toISOString(), improved_by: (await db.from('inspection_masters').select('inspector_id').eq('id', id).single()).data.inspector_id, improvement_description: 'ZT M4 snapshot' }).eq('id', imp.data[0].id);
    expect(upd.error).toBeNull();
    const bonus = Math.round(((10 * percent) / 100) * 10) / 10;
    const after = await readMaster(id);
    expect(Number(after.improvement_bonus)).toBe(bonus);
    expect(Number(after.total_score)).toBe(Math.round((201 + bonus) * 10) / 10);
    expect(Number(after.grade), '加分只加分數，評級仍照完成當時的門檻').toBe(gradeFromMapping(Number(after.total_score), snapMapping));
    expect(JSON.stringify(after.grade_thresholds)).toBe(JSON.stringify(snapshot));

    // 5) 改門檻之後才完成的新單：用新門檻（snapshot 是新對照表）
    const later = await seedMaster({ store: 'ZT04', inspector: 'admin', date: `${month}-03`, status: 'draft', total: 200, tag: 'snap-later' });
    const laterDone = await db.from('inspection_masters').update({ status: 'completed', total_score: 200 }).eq('id', later).select('*').single();
    expect(laterDone.error).toBeNull();
    expect(laterDone.data.grade).toBe('0');
    expect(laterDone.data.grade_thresholds.find((m: any) => m.grade === 10).min_score).toBe(9010);
    void zt04;
  } finally {
    // 還原評級對照表（依備份的每一列）
    for (const m of original) await db.from('inspection_grade_mapping').update({ min_score: m.min_score }).eq('id', m.id);
    const restored = ((await db.from('inspection_grade_mapping').select('id,grade,min_score').order('grade')).data || []) as typeof original;
    expect(restored.map((m) => [m.grade, Number(m.min_score)])).toEqual(original.map((m) => [m.grade, Number(m.min_score)]));
  }
});

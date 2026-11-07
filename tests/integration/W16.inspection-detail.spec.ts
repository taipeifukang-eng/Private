import { expect, test } from '@playwright/test';
import { apiAs } from '../support/auth';
import { M4B_MONTH, activeTemplates, deleteRunMasters, improvementsOf, seedFollowupInspection, seedMaster, seedResults } from '../support/m4b-fixtures';
import { adminDb, readMaster, runIdOrThrow } from '../support/m4-fixtures';
import { followupNotice } from '../../lib/workspace/inspection-print';

// W16 整合層（M4 Q21 期限資料、Q22 刪除）：
//  詳情 API 帶出列印報表要印的期限日期與回補級距（系統算的，不是寫死 3 個工作日）、連帶刪除的筆數；
//  刪除：需「刪除巡店」權限、經理巡店另需「經理巡店」權限、版本不符拒絕、連同明細／當班人員／改善回報一併刪除。
// 測試資料只用 ZT 測試門市與保留月份 2099，測後只刪自己建立的列。

const detail = (api: any, id: string) => api.get('/api/workspace/inspection-detail', { params: { id } });
const del = (api: any, id: string, version: number) => api.delete('/api/workspace/inspection-detail', { data: { id, version } });
const count = async (table: string, column: string, id: string) => {
  const r = await adminDb().from(table).select('id', { count: 'exact', head: true }).eq(column, id);
  if (r.error) throw new Error(r.error.message);
  return r.count || 0;
};

test.afterAll(async () => {
  await deleteRunMasters();
});

test('詳情帶出列印用的期限日期、回補級距與連帶刪除筆數（Q21、Q22）', async () => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const seeded = await seedFollowupInspection({ store: 'ZT01', inspector: 'supervisor', date: `${M4B_MONTH.detail}-05`, tag: 'w16-detail', count: 3 });
  await adminDb().from('inspection_on_duty_staff').insert([
    { inspection_id: seeded.id, employee_code: 'ZT-W16-1', employee_name: '[自動測試]甲', position: '店長', is_duty_supervisor: true },
    { inspection_id: seeded.id, employee_code: 'ZT-W16-2', employee_name: '[自動測試]乙', position: '藥師', is_duty_supervisor: false },
  ]);
  const admin = await apiAs('admin');
  try {
    const res = await detail(admin, seeded.id);
    expect(res.status(), (await res.text()).slice(0, 200)).toBe(200);
    const data = await res.json();
    const deadlines = (await improvementsOf(seeded.id)).map((i) => i.deadline).sort();
    expect(data.followup.deadline).toBe(deadlines[0]);
    const expected = followupNotice({ inspectionDate: `${M4B_MONTH.detail}-05`, deadline: deadlines[0], rules: data.bonusRules });
    expect(data.followup.text).toBe(expected.text);
    expect(data.followup.text).toMatch(/^請於 \d{4}-\d{2}-\d{2} 前回報/);
    expect(data.followup.text, '不再寫死 3 個工作日').not.toContain('工作日');
    expect(data.bonusRules.length).toBeGreaterThan(0);
    expect(data.counts).toMatchObject({ results: 3, staff: 2, improvements: 3 });
    expect(data.canDelete).toBe(true);
    expect(data.store.address === undefined, '報表要印店址').toBe(false);
    expect(data.record.inspection_no).toBeTruthy();
    expect(data.record.signature_photo_url === undefined, '回傳簽名欄位').toBe(false);
  } finally {
    await admin.dispose();
  }
});

test('Q22 刪除：版本不符拒絕；成功後連同明細、當班人員、改善回報一併刪除；重複刪除視為已移除', async () => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const seeded = await seedFollowupInspection({ store: 'ZT02', inspector: 'supervisor', date: `${M4B_MONTH.detail}-06`, tag: 'w16-delete', count: 2, deduction: 6 });
  await adminDb().from('inspection_on_duty_staff').insert({ inspection_id: seeded.id, employee_code: 'ZT-W16-3', employee_name: '[自動測試]丙', position: '店長', is_duty_supervisor: false });
  const deleter = await apiAs('inspection_delete');
  try {
    const master = await readMaster(seeded.id);
    // 沒有「刪除巡店」權限的人不能刪（即使看得到）
    const nav = await apiAs('navigation');
    try {
      expect((await del(nav, seeded.id, master.workspace_version)).status(), 'navigation 沒有刪除權限').toBe(403);
    } finally {
      await nav.dispose();
    }
    // 版本不符：409，資料還在
    const stale = await del(deleter, seeded.id, master.workspace_version + 99);
    expect(stale.status()).toBe(409);
    expect(await count('inspection_masters', 'id', seeded.id)).toBe(1);
    // 正確版本：刪除，連帶清掉
    expect(await count('inspection_results', 'inspection_id', seeded.id)).toBe(2);
    expect(await count('inspection_improvements', 'inspection_id', seeded.id)).toBe(2);
    expect(await count('inspection_on_duty_staff', 'inspection_id', seeded.id)).toBe(1);
    const ok = await del(deleter, seeded.id, master.workspace_version);
    expect(ok.status(), (await ok.text()).slice(0, 200)).toBe(200);
    expect(await count('inspection_masters', 'id', seeded.id)).toBe(0);
    expect(await count('inspection_results', 'inspection_id', seeded.id)).toBe(0);
    expect(await count('inspection_improvements', 'inspection_id', seeded.id)).toBe(0);
    expect(await count('inspection_on_duty_staff', 'inspection_id', seeded.id)).toBe(0);
    const again = await del(deleter, seeded.id, master.workspace_version);
    expect(again.status()).toBe(200);
    expect((await again.json()).alreadyRemoved).toBe(true);
  } finally {
    await deleter.dispose();
  }
});

test('Q22 經理巡店：刪除（與查看）需要「經理巡店」權限；有刪除權限但沒有經理權限者被擋', async () => {
  test.setTimeout(240_000);
  runIdOrThrow();
  const id = await seedMaster({ store: 'ZT03', inspector: 'ops_manager', date: `${M4B_MONTH.detail}-07`, status: 'completed', total: 200, type: 'manager', tag: 'w16-manager' });
  await seedResults(id, (await activeTemplates(2)).map((template) => ({ template, deduction: 0 })));
  const master = await readMaster(id);
  const limited = await apiAs('inspection_delete'); // 刪除巡店＋查看全部，但沒有經理巡店權限
  const admin = await apiAs('admin');
  try {
    expect((await detail(limited, id)).status(), '沒有經理權限看不到經理單').toBe(403);
    const blocked = await del(limited, id, master.workspace_version);
    expect(blocked.status()).toBe(403);
    expect(await count('inspection_masters', 'id', id), '被擋下後資料仍在').toBe(1);
    const view = await (await detail(admin, id)).json();
    expect(view.canDelete).toBe(true);
    expect(view.counts).toMatchObject({ results: 2, improvements: 0 });
    // 督導單：有刪除權限的人 canDelete 為 true
    const supId = await seedMaster({ store: 'ZT03', inspector: 'supervisor', date: `${M4B_MONTH.detail}-08`, status: 'completed', total: 200, tag: 'w16-sup' });
    expect((await (await detail(limited, supId)).json()).canDelete).toBe(true);
    const ok = await del(admin, id, master.workspace_version);
    expect(ok.status(), (await ok.text()).slice(0, 200)).toBe(200);
    expect(await count('inspection_masters', 'id', id)).toBe(0);
  } finally {
    await limited.dispose();
    await admin.dispose();
  }
});

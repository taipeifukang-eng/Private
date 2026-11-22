import { expect, test, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import {
  addManual,
  ensureSummary,
  readMonth,
  registerFixtureRows,
  saveRow,
  staffCode,
  testStoreIds,
} from '../support/w01a-fixtures';

// W01a 整合層：/api/workspace/monthly 的角色權限矩陣、狀態規則（M1-x1）、刪除 409（W01a-q1）、
// 送審前檢查、總覽與統計、異動歷程與業績明細。資料只用 ZT 測試門市 + 保留月份 2099-01。

type Account = { key: string; permissions: string[] | 'ALL'; kind: string };
const accounts = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'role-matrix.json'), 'utf8')) as { accounts: Account[] }).accounts;
const has = (a: Account, code: string) => a.permissions === 'ALL' || a.permissions.includes(code);
const anyOf = (a: Account, codes: string[]) => codes.some((c) => has(a, c));

const MONTH = '2099-01';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

test('未登入：讀取與寫入皆為 401', async ({ request }) => {
  expect((await request.get(`${TEST_ORIGIN}/api/workspace/monthly`, { params: { month: MONTH } })).status()).toBe(401);
  const res = await request.post(`${TEST_ORIGIN}/api/workspace/monthly`, { data: {}, headers: { Origin: TEST_ORIGIN } });
  expect(res.status()).toBe(401);
});

for (const account of accounts) {
  test(`總覽讀取權限矩陣 ${account.key}`, async () => {
    let api: APIRequestContext;
    try {
      api = await apiAs(account.key);
    } catch (e) {
      // 測試帳號本身無法登入屬於環境問題（與月結無關），標記略過並在報告中說明，不當成通過。
      test.skip(String((e as Error).message).includes('登入失敗'), `帳號 ${account.key} 無法登入（環境）`);
      throw e;
    }
    try {
      const allowed = anyOf(account, ['monthly.status.view_all', 'monthly.status.view_own']);
      const res = await api.get('/api/workspace/monthly', { params: { month: MONTH } });
      if (!allowed) {
        expect(res.status()).toBe(403);
        return;
      }
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(JSON.stringify(body)).not.toMatch(/stack|at .*\.ts/);
      // 統計卡片只給有 view_stats 的角色
      expect(!!body.stats).toBe(has(account, 'monthly.status.view_stats'));
      expect(body.canViewStats).toBe(has(account, 'monthly.status.view_stats'));
      expect(body.canViewPerformance).toBe(has(account, 'monthly.status.view_performance'));
      // 總覽摘要只含門市代號與狀態，不外洩統計欄位；且只含有效且可見的門市
      const visible = new Set((body.stores as { id: string }[]).map((s) => s.id));
      for (const s of body.summaries as Record<string, unknown>[]) {
        expect(Object.keys(s).sort()).toEqual(['store_id', 'store_status']);
        expect(visible.has(String(s.store_id))).toBe(true);
      }
      // 停用門市切換：allStores 是 stores 的超集合，stores 只含有效門市
      const all = body.allStores as { id: string; is_active?: boolean }[];
      expect(all.length).toBeGreaterThanOrEqual(body.stores.length);
      for (const s of body.stores as { id: string }[]) expect(all.some((a) => a.id === s.id)).toBe(true);
      if (body.stats) {
        const s = body.stats;
        expect(s.total).toBe(body.stores.length);
        expect(s.pending).toBe(s.total - s.confirmed - s.submitted);
      }
      // 沒有任何寫入權限碼的帳號：沒有編輯類能力
      if (body.store && body.storeActive !== false) {
        expect(body.canEdit).toBe(has(account, 'monthly.status.edit'));
        expect(body.canSubmit).toBe(has(account, 'monthly.status.submit'));
        expect(body.canConfirm).toBe(has(account, 'monthly.status.confirm'));
        expect(body.canRevert).toBe(has(account, 'monthly.status.revert'));
        expect(body.canUnconfirm).toBe(has(account, 'monthly.status.unconfirm'));
        // 刪除（規格 B.2）：照舊版只認管理員或該門市店長，不看 monthly.status.edit
        expect(typeof body.canDelete).toBe('boolean');
      }
    } finally {
      await api.dispose();
    }
  });
}

test.describe('Origin 與輸入驗證（admin）', () => {
  test('寫入要求 Origin；錯誤月份、不支援操作、缺少門市', async () => {
    const admin = await apiAs('admin');
    try {
      const stores = await testStoreIds(admin, MONTH);
      const bad = await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: stores.ZT01, month: MONTH }, headers: { Origin: 'http://evil.example' } });
      expect(bad.status()).toBe(403);
      expect((await admin.get('/api/workspace/monthly', { params: { month: '2099-13' } })).status()).toBe(400);
      expect((await admin.post('/api/workspace/monthly', { data: { action: 'bogus', store: stores.ZT01, month: MONTH } })).status()).toBe(400);
      const forbidden = await admin.get('/api/workspace/monthly', { params: { month: MONTH, store: MISSING_ID } });
      expect(forbidden.status()).toBe(403);
      expect(JSON.stringify(await forbidden.json())).not.toMatch(/stack/);
      // 刪除：id 格式錯誤 400、不存在 404
      expect((await admin.post('/api/workspace/monthly', { data: { action: 'delete', store: stores.ZT01, month: MONTH, id: 'abc' } })).status()).toBe(400);
      expect((await admin.post('/api/workspace/monthly', { data: { action: 'delete', store: stores.ZT01, month: MONTH, id: MISSING_ID } })).status()).toBe(404);
    } finally {
      await admin.dispose();
    }
  });
});

test.describe('W01a 流程（ZT 測試門市 + 2099-01）', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let zt01 = '';
  let zt02 = '';
  const ids: Record<string, string> = {};

  test.beforeAll(async () => {
    admin = await apiAs('admin');
    const stores = await testStoreIds(admin, MONTH);
    zt01 = stores.ZT01;
    zt02 = stores.ZT02;
    // 乾淨起點：若上次中止遺留 2099-01 草稿，先刪（只有草稿，只限 2099 保留月份與測試門市）。
    for (const store of [zt01, zt02]) {
      const { body } = await readMonth(admin, store, MONTH);
      for (const r of body.records || []) {
        if (r.status !== 'draft') throw new Error('保留月份 2099-01 有非草稿資料，請先執行 sweeper');
        await admin.post('/api/workspace/monthly', { data: { action: 'delete', store, month: MONTH, id: r.id } });
      }
    }
    ids.normal = (await addManual(admin, zt01, MONTH, { name: 'W01a 專員', code: staffCode('N') })).id;
    ids.part = (await addManual(admin, zt01, MONTH, { name: 'W01a 兼職', code: staffCode('P', true), position: '兼職專員', employment_type: 'part_time', work_hours: 0, work_days: 0 })).id;
    ids.newbie = (await addManual(admin, zt01, MONTH, { name: 'W01a 新人', code: staffCode('B'), position: '新人', newbie_level: '一階新人' })).id;
    ids.other = (await addManual(admin, zt02, MONTH, { name: 'W01a 二店', code: staffCode('T') })).id;
    await ensureSummary(admin, zt01, MONTH);
    await ensureSummary(admin, zt02, MONTH);
    await registerFixtureRows(zt01, MONTH);
    await registerFixtureRows(zt02, MONTH);
    // 新人：到職 2099-01 的前 2 個月，目前登記一階 -> 舊版規則「應該過二階段」
    const { body } = await readMonth(admin, zt01, MONTH);
    const rec = body.records.find((r: any) => r.id === ids.newbie);
    await saveRow(admin, zt01, MONTH, rec, { start_date: '2098-11-01', newbie_level: '一階新人' });
  });

  test.afterAll(async () => {
    await admin?.dispose();
  });

  test('草稿狀態的名冊、總覽與統計', async () => {
    const { status, body } = await readMonth(admin, zt01, MONTH);
    expect(status).toBe(200);
    expect(body.records).toHaveLength(3);
    expect(body.canDelete).toBe(true);
    expect(body.canViewStats).toBe(true);
    // 摘要：兩間測試門市都有狀態；統計為整體數字且 待填寫 = 總數 - 已確認 - 已提交
    const mine = body.summaries.filter((s: any) => [zt01, zt02].includes(s.store_id));
    expect(mine).toHaveLength(2);
    expect(body.stats.total).toBe(body.stores.length);
    expect(body.stats.pending).toBe(body.stats.total - body.stats.confirmed - body.stats.submitted);
  });

  test('業績與獎金欄位：沒有 view_performance 的角色，records 不得含這些 key（伺服器端移除）', async () => {
    const PERF = ['transaction_count', 'sales_amount', 'gross_profit', 'gross_profit_rate', 'last_month_single_item_bonus'];
    const adminRead = await readMonth(admin, zt01, MONTH);
    expect(adminRead.body.records.length).toBeGreaterThan(0);
    // 對照組：有權限者仍拿得到獎金欄位（證明下面的缺席是被移除，而不是本來就沒有）
    expect(Object.keys(adminRead.body.records[0])).toContain('last_month_single_item_bonus');
    let checked = 0;
    for (const account of accounts) {
      if (has(account, 'monthly.status.view_performance')) continue;
      let api: APIRequestContext;
      try {
        api = await apiAs(account.key);
      } catch {
        continue;
      }
      try {
        const res = await api.get('/api/workspace/monthly', { params: { month: MONTH, store: zt01 } });
        if (res.status() !== 200) continue;
        const body = await res.json();
        expect(body.canViewPerformance).toBe(false);
        for (const r of body.records as Record<string, unknown>[]) for (const key of PERF) expect(Object.keys(r), `${account.key} 不應看到 ${key}`).not.toContain(key);
        if (body.records.length) checked += 1;
      } finally {
        await api.dispose();
      }
    }
    test.info().annotations.push({ type: 'checked-accounts', description: String(checked) });
  });

  test('送審前檢查報告：兼職缺時數與新人階段同一份', async () => {
    const res = await admin.get('/api/workspace/monthly', { params: { op: 'precheck', month: MONTH, store: zt01 } });
    expect(res.status()).toBe(200);
    const { report } = await res.json();
    expect(report.partTimeMissingHours.map((p: any) => p.id)).toEqual([ids.part]);
    expect(report.newbiesNeedCheck.map((n: any) => n.id)).toEqual([ids.newbie]);
    expect(report.newbiesNeedCheck[0]).toMatchObject({ current_level: '一階新人', suggested_action: '應該過二階段' });
    expect(report.hasIssues).toBe(true);
  });

  test('狀態規則：草稿不可確認、退回、取消確認；沒有人員的月份不可送審', async () => {
    for (const action of ['confirm', 'revert', 'unconfirm']) {
      const res = await admin.post('/api/workspace/monthly', { data: { action, store: zt01, month: MONTH } });
      expect(res.status(), action).toBe(409);
    }
    const stores = await testStoreIds(admin, MONTH);
    const empty = stores.ZT03;
    const res = await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: empty, month: '2099-02' } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain('尚無人員資料');
  });

  test('送審：新人階段未確認回 409，帶 skipChecks 才能送出；送出後各動作依規則表', async () => {
    const blocked = await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: zt01, month: MONTH } });
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).error).toContain('新人階段');

    const ok = await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: zt01, month: MONTH, skipChecks: true } });
    expect(ok.status()).toBe(200);
    const { body } = await readMonth(admin, zt01, MONTH);
    expect(body.records.every((r: any) => r.status === 'submitted')).toBe(true);
    expect(body.storeStatus).toBe('submitted');
    expect(body.summaries.find((s: any) => s.store_id === zt01).store_status).toBe('submitted');

    // 已送審：不可再送審、不可取消確認；不可儲存（409）
    expect((await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: zt01, month: MONTH, skipChecks: true } })).status()).toBe(409);
    expect((await admin.post('/api/workspace/monthly', { data: { action: 'unconfirm', store: zt01, month: MONTH } })).status()).toBe(409);
    const rec = body.records.find((r: any) => r.id === ids.normal);
    const save = await admin.post('/api/workspace/monthly', { data: { action: 'save', store: zt01, month: MONTH, id: ids.normal, version: rec.updated_at, updates: { work_days: 29, work_hours: null, notes: '不應寫入' } } });
    expect(save.status()).toBe(409);
  });

  test('W01a-q1：已送審的人員不可刪除（409，說明需先退回）', async () => {
    const res = await admin.post('/api/workspace/monthly', { data: { action: 'delete', store: zt01, month: MONTH, id: ids.normal } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain('退回');
    const { body } = await readMonth(admin, zt01, MONTH);
    expect(body.records.some((r: any) => r.id === ids.normal)).toBe(true);
    // 規格 B.2：畫面照舊版，門市未確認時每列都有刪除按鈕；非草稿按下後由 API 回 409 並說明需先退回
    expect(body.records.find((r: any) => r.id === ids.normal).status).toBe('submitted');
  });

  test('確認 -> 已確認的人員也不可刪除；取消確認 -> 退回後才可刪除', async () => {
    expect((await admin.post('/api/workspace/monthly', { data: { action: 'confirm', store: zt01, month: MONTH } })).status()).toBe(200);
    let { body } = await readMonth(admin, zt01, MONTH);
    expect(body.storeStatus).toBe('confirmed');
    const del = await admin.post('/api/workspace/monthly', { data: { action: 'delete', store: zt01, month: MONTH, id: ids.normal } });
    expect(del.status()).toBe(409);
    // 已確認不可退回、不可再確認
    expect((await admin.post('/api/workspace/monthly', { data: { action: 'revert', store: zt01, month: MONTH } })).status()).toBe(409);
    expect((await admin.post('/api/workspace/monthly', { data: { action: 'confirm', store: zt01, month: MONTH } })).status()).toBe(409);

    expect((await admin.post('/api/workspace/monthly', { data: { action: 'unconfirm', store: zt01, month: MONTH } })).status()).toBe(200);
    expect((await admin.post('/api/workspace/monthly', { data: { action: 'revert', store: zt01, month: MONTH } })).status()).toBe(200);
    ({ body } = await readMonth(admin, zt01, MONTH));
    expect(body.records.every((r: any) => r.status === 'draft')).toBe(true);

    const ok = await admin.post('/api/workspace/monthly', { data: { action: 'delete', store: zt01, month: MONTH, id: ids.normal } });
    expect(ok.status()).toBe(200);
    ({ body } = await readMonth(admin, zt01, MONTH));
    expect(body.records.some((r: any) => r.id === ids.normal)).toBe(false);
    expect(body.records).toHaveLength(2);
  });

  test('刪除只認管理員或該門市店長（規格 B.2，不看 monthly.status.edit）：其他帳號 403', async () => {
    for (const key of ['store_manager', 'ops_manager', 'monthly_view', 'monthly_edit', 'ops_assistant', 'supervisor']) {
      const api = await apiAs(key);
      try {
        // store_manager、supervisor 在 DEV 被指派 ZT01（舊版店長可刪），用不存在的 id 驗證授權通過（404）而不真的刪除；其他帳號 403
        const assigned = key === 'store_manager' || key === 'supervisor';
        const res = await api.post('/api/workspace/monthly', { data: { action: 'delete', store: zt01, month: MONTH, id: assigned ? MISSING_ID : ids.part } });
        expect(res.status(), key).toBe(assigned ? 404 : 403);
      } finally {
        await api.dispose();
      }
    }
    // 沒有被刪
    const { body } = await readMonth(admin, zt01, MONTH);
    expect(body.records.some((r: any) => r.id === ids.part)).toBe(true);
  });

  test('混合狀態防線：API 無法製造混合狀態（已送審門市不可新增人員），整間門市動作在草稿門市一律 409', async () => {
    // 混合狀態只可能來自資料異常或舊資料（API 本身擋住）；整間門市動作的 every 判斷由單元測試 rowsAllowAll 與 rules-usage 涵蓋。
    // 這裡驗證兩道防線：(1) 已送審的 zt02 不可再新增草稿人員；(2) 退回後（全草稿）確認／退回／取消確認皆 409，且狀態不變。
    expect((await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: zt02, month: MONTH, skipChecks: true } })).status()).toBe(200);
    const blocked = await admin.post('/api/workspace/monthly/tools', {
      data: { op: 'manual', store: zt02, month: MONTH, requestId: randomUUID(), employee: { employee_name: 'W01a 混合', employee_code: staffCode('M'), position: '專員', employment_type: 'full_time', monthly_status: 'full_month', work_days: 30, work_hours: 0 } },
    });
    expect(blocked.status()).toBe(409);
    expect((await admin.post('/api/workspace/monthly', { data: { action: 'revert', store: zt02, month: MONTH } })).status()).toBe(200);
    const before = (await readMonth(admin, zt02, MONTH)).body.records.map((r: any) => `${r.id}:${r.status}`).sort();
    for (const action of ['confirm', 'revert', 'unconfirm']) {
      expect((await admin.post('/api/workspace/monthly', { data: { action, store: zt02, month: MONTH } })).status(), action).toBe(409);
    }
    const after = (await readMonth(admin, zt02, MONTH)).body.records.map((r: any) => `${r.id}:${r.status}`).sort();
    expect(after).toEqual(before);
  });

  test('各門市業績明細與異動歷程的授權', async () => {
    // 規格 B.3：不再要求 view_performance；伺服器只保留登入與門市可見範圍（monthly_edit 沒有可見門市 -> 403）
    const noPerf = await apiAs('monthly_edit');
    try {
      expect((await noPerf.get('/api/workspace/monthly', { params: { op: 'staffDetails', id: ids.part } })).status()).toBe(403);
    } finally {
      await noPerf.dispose();
    }
    // admin：格式錯誤 400、不存在 404、存在（手動新增沒有業績明細）回空陣列
    expect((await admin.get('/api/workspace/monthly', { params: { op: 'staffDetails', id: 'abc' } })).status()).toBe(400);
    expect((await admin.get('/api/workspace/monthly', { params: { op: 'staffDetails', id: MISSING_ID } })).status()).toBe(404);
    const details = await admin.get('/api/workspace/monthly', { params: { op: 'staffDetails', id: ids.part } });
    expect(details.status()).toBe(200);
    expect((await details.json()).details).toEqual([]);

    // 異動歷程（規格 B.4）：缺員編 400；可查任何員編（不限本月名冊、不限門市），沒有紀錄回空陣列
    expect((await admin.get('/api/workspace/monthly', { params: { op: 'movements', month: MONTH, store: zt01 } })).status()).toBe(400);
    const nobody = await admin.get('/api/workspace/monthly', { params: { op: 'movements', month: MONTH, store: zt01, employee_code: 'ZTNOBODY' } });
    expect(nobody.status()).toBe(200);
    expect((await nobody.json()).movements).toEqual([]);
    const { body } = await readMonth(admin, zt01, MONTH);
    const code = body.records.find((r: any) => r.id === ids.part).employee_code;
    const mv = await admin.get('/api/workspace/monthly', { params: { op: 'movements', month: MONTH, store: zt01, employee_code: code } });
    expect(mv.status()).toBe(200);
    expect(Array.isArray((await mv.json()).movements)).toBe(true);
    // 其他門市的人員也可查（照舊版，不縮小到本店）
    const other = (await readMonth(admin, zt02, MONTH)).body.records[0].employee_code;
    expect((await admin.get('/api/workspace/monthly', { params: { op: 'movements', month: MONTH, store: zt01, employee_code: other } })).status()).toBe(200);
  });

  test('停用門市：可唯讀查看歷史，不可寫入', async () => {
    const body = await (await admin.get('/api/workspace/monthly', { params: { month: MONTH } })).json();
    const inactive = (body.allStores as { id: string; is_active?: boolean }[]).find((s) => s.is_active === false);
    test.skip(!inactive, 'DEV 沒有已停止門市可驗證');
    const read = await readMonth(admin, inactive!.id, MONTH);
    expect(read.status).toBe(200);
    expect(read.body.storeActive).toBe(false);
    expect(read.body.canEdit).toBe(false);
    expect(read.body.canSubmit).toBe(false);
    expect(read.body.canDelete).toBe(false);
    const write = await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: inactive!.id, month: MONTH } });
    expect(write.status()).toBe(403);
  });
});

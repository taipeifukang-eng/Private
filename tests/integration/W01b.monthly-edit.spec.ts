import { expect, test, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { apiAs } from '../support/auth';
import { readRowsAsServiceRole } from '../support/parity';
import { previewBonusBlock } from '../../lib/monthly-staff/block';
import { plannedExtraTaskHours } from '../../lib/monthly-staff/hours';
import { addManual, clearDraftMonth, editUpdates, ensureSummary, postSave, readMonth, registerFixtureRows, staffCode, testStoreIds, W01B_MONTHS } from '../support/w01b-fixtures';

// W01b 整合層：POST /api/workspace/monthly action=save（單人編輯）。
// 角色權限、驗證錯誤（DB 不變動）、樂觀鎖、跨店、狀態規則（草稿才可存）、
// 儲存後 DB 觸發器算出的 calculated_block 必須等於前端 previewBonusBlock（同一組輸入 ≥20 組）、
// 外務規劃時數／外務時數、督導卡班關閉清空。資料只用 ZT 測試門市 + 保留月份 2099-02 / 2099-03。

type Account = { key: string; permissions: string[] | 'ALL'; kind: string };
const accounts = (JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'role-matrix.json'), 'utf8')) as { accounts: Account[] }).accounts;
const has = (a: Account, code: string) => a.permissions === 'ALL' || a.permissions.includes(code);

const DRAFT = W01B_MONTHS.integrationDraft;
const CONFIRMED = W01B_MONTHS.integrationConfirmed;

test.describe('W01b 單人編輯 API（ZT 測試門市 + 2099-02 / 2099-03）', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let zt01 = '';
  let zt02 = '';
  const ids: Record<string, string> = {};
  const versions: Record<string, string | null> = {};

  const dbRow = async (id: string) => (await readRowsAsServiceRole('monthly_staff_status', { eq: { id } }))[0];

  test.beforeAll(async () => {
    admin = await apiAs('admin');
    const stores = await testStoreIds(admin, DRAFT);
    zt01 = stores.ZT01;
    zt02 = stores.ZT02;
    await clearDraftMonth(admin, [zt01, zt02], DRAFT);
    ids.main = (await addManual(admin, zt01, DRAFT, { name: 'W01b 主測', code: staffCode('M') })).id;
    ids.rights = (await addManual(admin, zt01, DRAFT, { name: 'W01b 權限', code: staffCode('R') })).id;
    ids.other = (await addManual(admin, zt02, DRAFT, { name: 'W01b 二店', code: staffCode('T') })).id;
    await ensureSummary(admin, zt01, DRAFT);
    await ensureSummary(admin, zt02, DRAFT);
    await registerFixtureRows(zt01, DRAFT);
    await registerFixtureRows(zt02, DRAFT);
    for (const key of ['main', 'rights', 'other']) versions[key] = (await dbRow(ids[key])).updated_at as string;

    // 已確認月份：ZT01 一名人員 -> 送審 -> 確認
    await clearDraftMonth(admin, [zt01], CONFIRMED).catch(() => undefined);
    ids.confirmed = (await addManual(admin, zt01, CONFIRMED, { name: 'W01b 已確認', code: staffCode('C') })).id;
    await ensureSummary(admin, zt01, CONFIRMED);
    await registerFixtureRows(zt01, CONFIRMED);
    expect((await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: zt01, month: CONFIRMED, skipChecks: true } })).status()).toBe(200);
    expect((await admin.post('/api/workspace/monthly', { data: { action: 'confirm', store: zt01, month: CONFIRMED } })).status()).toBe(200);
    versions.confirmed = (await dbRow(ids.confirmed)).updated_at as string;
  });

  test.afterAll(async () => {
    await admin?.dispose();
  });

  // 舊版職位下拉不含特殊職位；API 只在紀錄原本就是該特殊職位時放行（避免資料遺失）。
  // 要存特殊職位的情境，改存「原本就是該職位」的專用人員（用到才建立）。
  const SPECIALS = ['督導(代理店長)', '區經理(代理店長)', '督導(店長)', '區經理(店長)'];
  const specialIds: Record<string, string> = {};
  async function specialId(position: string) {
    if (!specialIds[position]) {
      specialIds[position] = (await addManual(admin, zt01, DRAFT, { name: `W01b ${position}`, code: staffCode('ABCD'[SPECIALS.indexOf(position)]), position })).id;
      await registerFixtureRows(zt01, DRAFT);
    }
    return specialIds[position];
  }
  async function saveMain(patch: Record<string, unknown>) {
    const special = typeof patch.position === 'string' && SPECIALS.includes(patch.position);
    const id = special ? await specialId(patch.position as string) : ids.main;
    const res = await postSave(admin, zt01, DRAFT, id, versions.main, editUpdates(patch));
    const body = await res.json();
    if (res.status() === 200 && !special) versions.main = body.record.updated_at;
    return { status: res.status(), body, id };
  }

  // ------------------------------------------------------------------ 權限
  test('save 權限矩陣：admin 200；其餘角色 403（無 edit、或有 edit 但未被指派 ZT01）；未登入 401', async ({ request }) => {
    const anon = await request.post('http://localhost:3002/api/workspace/monthly', { data: { action: 'save' }, headers: { Origin: 'http://localhost:3002' } });
    expect(anon.status()).toBe(401);
    // admin
    const ok = await postSave(admin, zt01, DRAFT, ids.rights, versions.rights, editUpdates({ notes: 'admin 儲存' }));
    expect(ok.status()).toBe(200);
    versions.rights = (await ok.json()).record.updated_at;
    let checked = 0;
    for (const account of accounts) {
      if (account.key === 'admin') continue;
      let api: APIRequestContext;
      try {
        api = await apiAs(account.key);
      } catch {
        continue;
      }
      try {
        const res = await postSave(api, zt01, DRAFT, ids.rights, versions.rights, editUpdates({ notes: `${account.key} 嘗試` }));
        // 被指派 ZT01 的測試帳號不存在於 DEV 矩陣；所有非 admin 帳號都不可存
        expect(res.status(), account.key).toBe(403);
        const body = JSON.stringify(await res.json());
        expect(body).not.toMatch(/stack|\.ts:/);
        checked += 1;
        // 有 edit 權限但沒有指派 -> 一律 403（assignment 檢查）；沒有 edit -> 403
        void has(account, 'monthly.status.edit');
      } finally {
        await api.dispose();
      }
    }
    expect(checked).toBeGreaterThan(5);
    expect((await dbRow(ids.rights)).notes).toBe('admin 儲存');
  });

  // ------------------------------------------------------------------ 驗證
  const BAD: [string, Record<string, unknown>][] = [
    ['position 不在選項', { position: '不存在的職位' }],
    ['employment_type 非法', { employment_type: 'contract' }],
    ['monthly_status 非法', { monthly_status: 'bogus' }],
    ['newbie_level 非法', { newbie_level: '超級新人' }],
    ['行政缺階段（W01b 必填）', { position: '行政', newbie_level: null }],
    ['partial_month_reason 非法', { partial_month_reason: '不明' }],
    ['start_date 格式錯誤', { start_date: '2099/02/01' }],
    ['旗標非 boolean', { is_dual_position: 'yes' }],
    ['supervisor_name 超過 1000 字', { is_supervisor_rotation: true, supervisor_name: 'x'.repeat(1001) }],
    ['supervisor_shift_hours 745', { is_supervisor_rotation: true, supervisor_shift_hours: 745 }],
    ['extra_task_external_hours 負數', { extra_tasks: ['長照外務'], extra_task_external_hours: -1 }],
    ['extra_tasks 含不明項目', { extra_tasks: ['外送'] }],
    ['work_days 32', { work_days: 32 }],
    ['work_hours 745', { work_hours: 745 }],
    ['notes 超過 4000 字', { notes: 'x'.repeat(4001) }],
  ];
  for (const [name, patch] of BAD) {
    test(`驗證錯誤 400 且 DB 不變：${name}`, async () => {
      const before = await dbRow(ids.main);
      const { status, body } = await saveMain(patch);
      expect(status, JSON.stringify(body).slice(0, 200)).toBe(400);
      const after = await dbRow(ids.main);
      expect(after).toEqual(before);
    });
  }

  test('行政階段必填只檢查是否為空（照舊版）：選到新人階段不擋；空白擋下', async () => {
    expect((await saveMain({ position: '行政', newbie_level: '一階新人' })).status).toBe(200);
    const blank = await saveMain({ position: '行政', newbie_level: null });
    expect(blank.status).toBe(400);
    expect(blank.body.error).toContain('過階');
    expect((await saveMain({ position: '專員', newbie_level: null })).status).toBe(200);
  });

  test('職位只認舊版 POSITION_OPTIONS；特殊職位僅在紀錄原本就是該職位時可存', async () => {
    for (const position of SPECIALS) {
      // 一般人員改成特殊職位：400，DB 不變
      const before = await dbRow(ids.main);
      const res = await saveMain({ position });
      // saveMain 對特殊職位會改存專用人員，因此另外直接打 main
      expect(res.status, position).toBe(200);
      const direct = await postSave(admin, zt01, DRAFT, ids.main, null, editUpdates({ position }));
      expect(direct.status(), position).toBe(400);
      expect(await dbRow(ids.main)).toEqual(before);
    }
    // GET 下拉選項不含特殊職位
    const { body } = await readMonth(admin, zt01, DRAFT);
    for (const position of SPECIALS) expect(body.options.positions).not.toContain(position);
  });

  test('行政選過階／未過階可儲存', async () => {
    for (const level of ['過階行政', '未過階行政']) {
      const { status, body } = await saveMain({ position: '行政', newbie_level: level });
      expect(status).toBe(200);
      expect(body.record.newbie_level).toBe(level);
    }
    expect((await saveMain({ position: '專員', newbie_level: null })).status).toBe(200);
  });

  // ------------------------------------------------------------------ 區塊：DB 觸發器 vs 前端預覽
  const SCENARIOS: Record<string, unknown>[] = [
    {},
    { work_days: 0 },
    { monthly_status: 'new_hire', work_days: 12 },
    { monthly_status: 'resigned', work_days: 20, partial_month_reason: '離職' },
    { position: '店長', is_dual_position: true },
    { position: '副店長', is_dual_position: true },
    { position: '區經理(代理店長)', is_dual_position: true },
    { position: '督導(店長)', is_dual_position: true },
    { position: '督導(店長)', is_dual_position: true, monthly_status: 'new_hire', work_days: 10 },
    { position: '督導(代理店長)', is_dual_position: true, work_hours: 120, work_days: null },
    { position: '督導(代理店長)', is_dual_position: false },
    { position: '督導', is_dual_position: true, is_acting_manager: true },
    { position: '督導', is_dual_position: true },
    { is_supervisor_rotation: true, supervisor_name: '卡班者', supervisor_shift_hours: 8 },
    { extra_tasks: ['長照外務'], extra_task_external_hours: 5 },
    { extra_tasks: ['診所業務'], extra_task_external_hours: 3 },
    { extra_tasks: ['長照外務', '診所業務'], monthly_status: 'new_hire', work_days: 10 },
    { employment_type: 'part_time', position: '助理', work_days: 0, work_hours: 40 },
    { employment_type: 'part_time', position: '兼職專員', work_days: 0, work_hours: 40 },
    { employment_type: 'part_time', position: '助理', is_pharmacist: true, work_days: 0, work_hours: 40 },
    { employment_type: 'part_time', position: '助理', work_days: 0, work_hours: 40, extra_tasks: ['長照外務'] },
    { employment_type: 'part_time', is_supervisor_rotation: true, work_days: 0, work_hours: 40 },
    { is_pharmacist: true },
    { monthly_status: 'promoted', work_days: 15 },
    { monthly_status: 'leave_return', work_days: 7.5 },
  ];
  test(`儲存後 DB 觸發器的 calculated_block 等於前端預覽（${SCENARIOS.length} 組同一份輸入）`, async () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(20);
    const seen = new Set<number>();
    for (const patch of SCENARIOS) {
      const updates = editUpdates(patch);
      const expected = previewBonusBlock({
        employment_type: updates.employment_type,
        monthly_status: updates.monthly_status,
        is_pharmacist: updates.is_pharmacist,
        position: updates.position,
        is_dual_position: updates.is_dual_position,
        is_supervisor_rotation: updates.is_supervisor_rotation,
        is_acting_manager: updates.is_acting_manager,
        work_days: updates.work_days,
        extra_tasks: updates.extra_tasks,
      });
      const { status, body, id } = await saveMain(patch);
      expect(status, `${JSON.stringify(patch)} -> ${JSON.stringify(body).slice(0, 160)}`).toBe(200);
      expect(body.record.calculated_block, JSON.stringify(patch)).toBe(expected);
      expect((await dbRow(id)).calculated_block, JSON.stringify(patch)).toBe(expected);
      seen.add(expected);
    }
    for (const b of [1, 2, 3, 4, 5, 6]) expect(seen.has(b), `情境沒有涵蓋區塊 ${b}`).toBe(true);
  });

  // ------------------------------------------------------------------ 外務時數
  test('外務：規劃時數照共用公式、外務時數 0 存 null、關閉外務清空', async () => {
    const cases: Record<string, unknown>[] = [
      { extra_tasks: ['長照外務'], extra_task_external_hours: 5 },
      { extra_tasks: ['診所業務'], monthly_status: 'new_hire', work_days: 10, extra_task_external_hours: 0 },
      { extra_tasks: ['長照外務'], monthly_status: 'new_hire', work_days: 0 },
      { extra_tasks: ['長照外務'], position: '督導(代理店長)', is_dual_position: true, work_hours: 96, work_days: null },
      { extra_tasks: ['長照外務'], employment_type: 'part_time', position: '助理', work_days: 0, work_hours: 50 },
    ];
    for (const patch of cases) {
      const u = editUpdates(patch);
      const planned = plannedExtraTaskHours({ position: u.position, employment_type: u.employment_type, is_dual_position: u.is_dual_position, monthly_status: u.monthly_status, work_days: u.work_days, work_hours: u.work_hours });
      const { status, body } = await saveMain(patch);
      expect(status).toBe(200);
      expect(body.record.extra_task_planned_hours ?? null, JSON.stringify(patch)).toBe(planned);
      expect(body.record.extra_task_external_hours ?? null).toBe((u.extra_task_external_hours as number | null) || null);
    }
    expect((await saveMain({ extra_tasks: ['長照外務'], extra_task_external_hours: 5 })).body.record.extra_task_planned_hours).toBe(160);
    // 規格 C.2：照舊版，外務時數 > 0 時寫入未滿月備註前綴；原備註以「; 」接在後面；沒有外務時數則維持原備註
    expect((await saveMain({ extra_tasks: ['長照外務'], extra_task_external_hours: 5, partial_month_notes: '' })).body.record.partial_month_notes).toBe('外務時數: 5小時');
    expect((await saveMain({ extra_tasks: ['診所業務'], extra_task_external_hours: 2.5, partial_month_notes: '5/15 到職' })).body.record.partial_month_notes).toBe('外務時數: 2.5小時; 5/15 到職');
    expect((await saveMain({ extra_tasks: ['長照外務'], extra_task_external_hours: 0, partial_month_notes: '備註' })).body.record.partial_month_notes).toBe('備註');
    // 規格 G.3：既有前綴（含疊加）先移除再加最新一個；時數 0／空只移除前綴
    expect((await saveMain({ extra_tasks: ['長照外務'], extra_task_external_hours: 6, partial_month_notes: '外務時數: 5小時; 外務時數: 5小時; 原備註' })).body.record.partial_month_notes).toBe('外務時數: 6小時; 原備註');
    expect((await saveMain({ extra_tasks: ['長照外務'], extra_task_external_hours: 0, partial_month_notes: '外務時數: 6小時; 原備註' })).body.record.partial_month_notes).toBe('原備註');
    expect((await saveMain({ extra_tasks: ['長照外務'], extra_task_external_hours: 0, partial_month_notes: '外務時數: 6小時' })).body.record.partial_month_notes ?? null).toBeNull();
    const cleared = await saveMain({ extra_tasks: [] });
    expect(cleared.body.record.extra_tasks).toBeNull();
    expect(cleared.body.record.extra_task_planned_hours).toBeNull();
    expect(cleared.body.record.extra_task_external_hours).toBeNull();
  });

  test('天數與時數的儲存：督導(代理店長)-雙與兼職只存時數，其餘正職只存天數', async () => {
    const dual = await saveMain({ position: '督導(代理店長)', is_dual_position: true, work_hours: 100, work_days: 5 });
    expect(dual.body.record.work_days).toBeNull();
    expect(dual.body.record.work_hours).toBe(100);
    const part = await saveMain({ employment_type: 'part_time', position: '助理', work_days: 9, work_hours: 42 });
    expect(part.body.record.work_days).toBeNull();
    expect(part.body.record.work_hours).toBe(42);
    const full = await saveMain({ work_days: 18, work_hours: 99, monthly_status: 'new_hire' });
    expect(full.body.record.work_days).toBe(18);
    expect(full.body.record.work_hours).toBeNull();
    expect(full.body.record.partial_month_days).toBe(18);
  });

  test('督導卡班關閉時清空支援欄位', async () => {
    const on = await saveMain({ is_supervisor_rotation: true, supervisor_employee_code: 'S001', supervisor_name: '卡班督導', supervisor_position: '督導', supervisor_shift_hours: 12 });
    expect(on.body.record).toMatchObject({ supervisor_employee_code: 'S001', supervisor_name: '卡班督導', supervisor_position: '督導', supervisor_shift_hours: 12 });
    const off = await saveMain({ is_supervisor_rotation: false, supervisor_employee_code: 'S001', supervisor_name: '卡班督導', supervisor_position: '督導', supervisor_shift_hours: 12 });
    expect(off.body.record).toMatchObject({ supervisor_employee_code: null, supervisor_name: null, supervisor_position: null, supervisor_shift_hours: null });
  });

  test('新人升階提醒不阻擋儲存：滿 1 個月仍停在未過階的新人，API 照常儲存（提醒只在畫面）', async () => {
    const { status, body } = await saveMain({ position: '新人', monthly_status: 'full_month', start_date: '2099-01-10', newbie_level: '未過階新人' });
    expect(status).toBe(200);
    expect(body.record.newbie_level).toBe('未過階新人');
    // 滿 6 個月的新人：API 不會因為「應改專員」而改職位
    const six = await saveMain({ position: '新人', start_date: '2098-08-01', newbie_level: '二階新人' });
    expect(six.status).toBe(200);
    expect(six.body.record.position).toBe('新人');
  });

  // ------------------------------------------------------------------ 樂觀鎖、跨店、狀態
  test('並行寫入照舊版後寫覆蓋：舊版本（或不帶版本）存檔也成功', async () => {
    const stale = versions.main;
    expect((await saveMain({ notes: 'A 存檔' })).status).toBe(200);
    const res = await postSave(admin, zt01, DRAFT, ids.main, stale, editUpdates({ notes: 'B 用舊版本' }));
    expect(res.status()).toBe(200);
    expect((await dbRow(ids.main)).notes).toBe('B 用舊版本');
    const noVersion = await postSave(admin, zt01, DRAFT, ids.main, null, editUpdates({ notes: 'C 不帶版本' }));
    expect(noVersion.status()).toBe(200);
    expect((await dbRow(ids.main)).notes).toBe('C 不帶版本');
  });

  test('id 屬於 ZT02 但 store 帶 ZT01：409，不可跨店改資料', async () => {
    const res = await postSave(admin, zt01, DRAFT, ids.other, versions.other, editUpdates({ notes: '跨店' }));
    expect(res.status()).toBe(409);
    expect((await dbRow(ids.other)).notes ?? '').not.toBe('跨店');
  });

  test('已送審與已確認不可儲存（規則表：只有草稿可編輯）', async () => {
    const confirmed = await postSave(admin, zt01, CONFIRMED, ids.confirmed, versions.confirmed, editUpdates({ notes: '已確認' }));
    expect(confirmed.status()).toBe(409);
    expect((await dbRow(ids.confirmed)).notes ?? '').not.toBe('已確認');
    // 草稿月份送審後同樣不可存（用 ZT02 那一列，不影響主測資料）
    const submit = await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: zt02, month: DRAFT, skipChecks: true } });
    expect(submit.status()).toBe(200);
    const submitted = await postSave(admin, zt02, DRAFT, ids.other, (await dbRow(ids.other)).updated_at as string, editUpdates({ notes: '已送審' }));
    expect(submitted.status()).toBe(409);
  });

  test('已確認的人員：名冊讀取仍能回傳（供專屬畫面），且 status 為 confirmed', async () => {
    const { status, body } = await readMonth(admin, zt01, CONFIRMED);
    expect(status).toBe(200);
    expect(body.records.map((r: any) => r.status)).toEqual(['confirmed']);
    expect(body.records[0].total_days_in_month).toBeGreaterThan(27);
  });
});

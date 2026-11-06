import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import * as XLSX from 'xlsx';
import { apiAs } from '../support/auth';
import {
  W05_MONTHS,
  addMonthlyManual,
  adminDb,
  adminUserId,
  createEmployee,
  ensureStats,
  masterRows,
  monthlyRows,
  purgeCodes,
  recheckRows,
  registerCode,
  registerRoster,
  resetMonths,
  storeIds,
  w05Code,
} from '../support/w05-fixtures';

// W05 整合層（M2 規格 E.1-E.4、F.1）：員編規則在每個新增入口的 API 與 DEV SQL 都生效、FKPT 自動兼職、
// 員工管理改職位只動未送審／未確認月份並登記「需重新確認」。資料只用測試員編範圍與 ZT01／ZT02、保留月份 2099-11／2099-12。

const BAD_CODES = ['FKI001', 'FK12', 'FKF1234', 'FKPT1234', 'ABC123', 'FK12345'];
const codes = {
  fk: w05Code('FK', 1),
  fkf: w05Code('FKF', 1),
  fkpt: w05Code('FKPT', 1),
  lower: w05Code('FK', 2),
  dup: w05Code('FK', 3),
  imp4: w05Code('FK', 4),
  imp5: w05Code('FKF', 2),
  impPt: w05Code('FKPT', 2),
  edit: w05Code('FK', 5),
  manual: w05Code('FKPT', 3),
  bd: w05Code('FK', 6),
};
const all = () => Object.values(codes);

function xlsx(rows: unknown[][]): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['門市代號', '員編', '姓名', '職位', '到職日期'], ...rows]), '員工資料');
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}
async function importPreview(api: APIRequestContext, buffer: Buffer) {
  const res = await api.post('/api/workspace/employee-import', { multipart: { file: { name: 'w05.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer } } });
  return { status: res.status(), body: await res.json() };
}

test.describe('W05 員工管理與員編規則', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let zt01 = '';
  let zt02 = '';

  test.beforeAll(async () => {
    admin = await apiAs('admin');
    await purgeCodes(all());
    const ids = await storeIds(admin, W05_MONTHS.draft);
    zt01 = ids.ZT01;
    zt02 = ids.ZT02;
    await resetMonths([zt01, zt02]);
  });
  test.afterAll(async () => {
    for (const code of all()) await registerCode(code).catch(() => undefined);
    await purgeCodes(all());
    await resetMonths([zt01, zt02]).catch(() => undefined);
    await admin?.dispose();
  });

  test('E.1 新增員工：三種合法格式成功，小寫與空白先正規化為大寫', async () => {
    for (const code of [codes.fk, codes.fkf, codes.fkpt]) {
      const r = await createEmployee(admin, { employee_code: code, employee_name: `W05 ${code}`, current_position: '專員' });
      expect(r.status, `${code} ${JSON.stringify(r.body)}`).toBe(200);
      expect(r.body.employee_code).toBe(code);
    }
    const r = await createEmployee(admin, { employee_code: `  ${codes.lower.toLowerCase()} `, employee_name: 'W05 小寫', current_position: '' });
    expect(r.status).toBe(200);
    expect(r.body.employee_code).toBe(codes.lower);
    expect((await masterRows(codes.lower)).length).toBe(1);
  });

  test('E.3 FKPT 自動兼職，其餘正職（API 回傳與資料庫一致）', async () => {
    expect((await masterRows(codes.fkpt))[0].employment_type).toBe('part_time');
    expect((await masterRows(codes.fk))[0].employment_type).toBe('full_time');
    expect((await masterRows(codes.fkf))[0].employment_type).toBe('full_time');
    const again = await createEmployee(admin, { employee_code: codes.dup, employee_name: 'W05 回傳類型' });
    expect(again.body.employment_type).toBe('full_time');
  });

  test('E.1／E.2 新增員工：不合規與 FKI 一律 400，資料庫沒有任何新列，確認旗標無法繞過', async () => {
    for (const code of BAD_CODES) {
      const r = await createEmployee(admin, { employee_code: code, employee_name: 'W05 不合規', confirmInternCode: true });
      expect(r.status, code).toBe(400);
      expect(String(r.body.error || r.body.message || JSON.stringify(r.body))).toMatch(/員編|實習生/);
      expect((await masterRows(code)).length, code).toBe(0);
    }
    expect((await createEmployee(admin, { employee_code: '   ', employee_name: 'x' })).status).toBe(400);
  });

  test('G 新增員工：員編已存在（主檔、月人員狀態、異動紀錄任一處）一律擋下 409', async () => {
    const r = await createEmployee(admin, { employee_code: codes.fk, employee_name: 'W05 重複' });
    expect(r.status).toBe(409);
    expect((await masterRows(codes.fk)).length).toBe(1);
  });

  test('E.1 DEV SQL 與 API 同一套規則：直接呼叫 RPC 也擋下小寫、FKI、錯誤長度', async () => {
    const db = adminDb();
    const actor = adminUserId();
    expect(actor).toBeTruthy();
    for (const code of ['fk1234', 'FKI123', 'FK12', 'FKF123456', 'FKPT12']) {
      const { error } = await db.rpc('workspace_employee_create', { p_actor: actor, p_request: randomUUID(), p_data: { employee_code: code, employee_name: 'W05 RPC' } });
      expect(error?.message, code).toContain('WORKSPACE_INVALID');
    }
    const { data } = await db.rpc('workspace_employee_id_valid', { p_code: 'FKPT123' });
    expect(data).toBe(true);
    expect((await db.rpc('workspace_employee_id_type', { p_code: 'FKPT123' })).data).toBe('part_time');
  });

  test('E.1／F.1 員工匯入預覽：4 位補 FK、5 位補 FKF；FKI、錯誤格式、不在清單的職位逐列標示', async () => {
    const good = await importPreview(admin, xlsx([['ZT01', codes.imp4.slice(2), '匯入甲', '專員', '2026-10-01'], ['ZT01', codes.imp5.slice(3), '匯入乙', '店長', '2026-10-01'], ['ZT01', codes.impPt.toLowerCase(), '匯入丙', '兼職助理', '2026-10-01']]));
    expect(good.status).toBe(200);
    expect(good.body.errors).toEqual([]);
    expect(good.body.valid).toBe(true);
    expect(good.body.rows.map((r: any) => r.employee_code)).toEqual([codes.imp4, codes.imp5, codes.impPt]);

    const bad = await importPreview(admin, xlsx([
      ['ZT01', 'FKI001', '甲', '專員', '2026-10-01'],
      ['ZT01', 'FK12', '乙', '專員', '2026-10-01'],
      ['ZT01', '123', '丙', '專員', '2026-10-01'],
      ['ZT01', codes.imp4, '丁', '實習藥師', '2026-10-01'],
    ]));
    expect(bad.status).toBe(200);
    expect(bad.body.valid).toBe(false);
    const msg = (row: number) => bad.body.errors.filter((e: any) => e.row === row).map((e: any) => e.message).join('|');
    expect(msg(2)).toContain('實習生');
    expect(msg(3)).toContain('員編格式錯誤');
    expect(msg(4)).toContain('員編格式錯誤');
    expect(msg(5)).toContain('職位不在公司職位清單內');
  });

  test('E.1／E.3／F.1 員工匯入送出：整批寫入、FKPT 為兼職；繞過預覽送壞資料整批不存', async () => {
    const preview = await importPreview(admin, xlsx([['ZT01', codes.imp4, '匯入甲', '專員', '2026-10-01'], ['ZT01', codes.imp5, '匯入乙', '店長', '2026-10-01'], ['ZT01', codes.impPt, '匯入丙', '兼職助理', '2026-10-01']]));
    expect(preview.body.valid).toBe(true);

    const rows = preview.body.rows;
    const evil = await admin.put('/api/workspace/employee-import', { data: { requestId: randomUUID(), rows: [rows[0], { ...rows[1], employee_code: 'FKI777' }] } });
    expect(evil.status()).toBe(409);
    const badPos = await admin.put('/api/workspace/employee-import', { data: { requestId: randomUUID(), rows: [{ ...rows[0], position: '實習藥師' }] } });
    expect(badPos.status()).toBe(409);
    for (const code of [codes.imp4, codes.imp5, codes.impPt, 'FKI777']) expect((await masterRows(code)).length, `${code} 不應被寫入`).toBe(0);

    const ok = await admin.put('/api/workspace/employee-import', { data: { requestId: randomUUID(), rows } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).imported).toBe(3);
    expect((await masterRows(codes.imp4))[0].employment_type).toBe('full_time');
    expect((await masterRows(codes.imp5))[0].employment_type).toBe('full_time');
    const pt = (await masterRows(codes.impPt))[0];
    expect(pt.employment_type).toBe('part_time');
    expect(pt.position).toBe('兼職助理');
  });

  test('E.1 生日匯入（只比對既有員編）：FKI 與格式錯誤在預覽標示，合規員編正常比對', async () => {
    const csv = `員編,姓名,生日\n${codes.fk},W05 ${codes.fk},1990-01-05\nFKI001,實習,1990-01-05\nFK12,錯誤,1990-01-05\n`;
    const res = await admin.post('/api/workspace/employee-birthdays', { multipart: { file: { name: 'w05.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) } } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.rows.map((r: any) => r.employee_code)).toEqual([codes.fk]);
    expect(body.errors.some((e: any) => e.row === 3 && /實習生/.test(e.message))).toBe(true);
    expect(body.errors.some((e: any) => e.row === 4 && /員編格式錯誤/.test(e.message))).toBe(true);

    // 只含合規列：可以儲存，並直接送 FKI 到儲存端點也會被擋
    const good = await admin.post('/api/workspace/employee-birthdays', { multipart: { file: { name: 'w05.csv', mimeType: 'text/csv', buffer: Buffer.from(`員編,姓名,生日\n${codes.fk},W05 ${codes.fk},1990-01-05\n`) } } });
    const preview = await good.json();
    expect(preview.valid).toBe(true);
    const evil = await admin.put('/api/workspace/employee-birthdays', { data: { requestId: randomUUID(), expected: preview.expected, rows: [{ employee_code: 'FKI001', employee_name: '實習', birthday: '1990-01-05' }] } });
    expect(evil.status()).toBe(400);
    const save = await admin.put('/api/workspace/employee-birthdays', { data: { requestId: randomUUID(), expected: preview.expected, rows: preview.rows.map((r: any) => ({ employee_code: r.employee_code, employee_name: r.employee_name, birthday: r.birthday })) } });
    expect(save.status()).toBe(200);
    expect(String((await masterRows(codes.fk))[0].birthday)).toBe('1990-01-05');
  });

  test('E.1 異動入職：驗證端點對 FKI、錯誤格式回報欄位錯誤；DEV 資料庫觸發器也擋下新入職員編', async () => {
    const row = (employee_code: string) => ({ employee_code, employee_name: 'W05 入職', store_id: zt01, movement_type: 'onboarding', birthday: '1990-01-05', effective_date: '2099-01-02', onboarding_is_pharmacist: false });
    for (const [code, pattern] of [['FKI001', /實習生/], ['FK12', /員編格式錯誤/]] as const) {
      const res = await admin.post('/api/workspace/movement-validation', { data: { rows: [row(code)] } });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.valid, code).toBe(false);
      expect(body.errors.some((e: any) => e.field === 'employee_code' && pattern.test(e.message)), code).toBe(true);
    }
    // 資料庫防線：直接寫入入職異動，不合規員編在 BEFORE INSERT 就被擋，沒有留下任何列。
    const db = adminDb();
    const { error } = await db.from('employee_movement_history').insert({ employee_code: 'FKI001', employee_name: 'W05', movement_type: 'onboarding', movement_date: '2099-01-02', store_id: zt01 });
    expect(error?.message).toContain('WORKSPACE_INVALID');
    const { data } = await db.from('employee_movement_history').select('id').eq('employee_code', 'FKI001');
    expect(data).toEqual([]);
  });

  test('E.1／H.2／H.8 每月人員狀態手動新增：員編必填（空白、FKI、錯誤格式 400）；合規員編可新增，類型一律依員編；資料庫觸發器同樣擋下', async () => {
    for (const code of ['FKI001', 'FK12', 'ABCDEFG', '', '   ']) {
      const r = await addMonthlyManual(admin, zt01, W05_MONTHS.draft, { employee_name: 'W05 手動', employee_code: code });
      expect(r.status, JSON.stringify(code)).toBe(400);
    }
    // 沒有 employee_code 欄位同樣擋下
    const missing = await addMonthlyManual(admin, zt01, W05_MONTHS.draft, { employee_name: 'W05 未填員編' });
    expect(missing.status).toBe(400);
    // H.8：FKPT 員編即使送來「正職」也記為兼職
    const ok = await addMonthlyManual(admin, zt01, W05_MONTHS.draft, { employee_name: 'W05 手動兼職', employee_code: ` ${codes.manual.toLowerCase()} `, position: '兼職助理', employment_type: 'full_time', work_days: 0, work_hours: 12 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const row = (await monthlyRows(codes.manual, [W05_MONTHS.draft]))[0];
    expect(row.employee_code).toBe(codes.manual);
    expect(row.employment_type).toBe('part_time');
    // 一般員編（FK／FKF）即使送來「兼職」也記為正職
    const full = await addMonthlyManual(admin, zt01, W05_MONTHS.draft, { employee_name: 'W05 手動正職', employee_code: codes.edit, employment_type: 'part_time' });
    expect(full.status, JSON.stringify(full.body)).toBe(200);
    expect((await monthlyRows(codes.edit, [W05_MONTHS.draft]))[0].employment_type).toBe('full_time');
    await adminDb().from('monthly_staff_status').delete().eq('employee_code', codes.edit).eq('year_month', W05_MONTHS.draft);
    // 資料庫防線：直接寫入手動新增列，不合規或空白員編在 BEFORE INSERT 被擋；類型由員編決定
    for (const bad of ['FKI002', '']) {
      const { error } = await adminDb().from('monthly_staff_status').insert({ year_month: W05_MONTHS.draft, store_id: zt01, employee_code: bad, employee_name: 'W05', is_manually_added: true });
      expect(error?.message, JSON.stringify(bad)).toContain('WORKSPACE_INVALID');
    }
    const { error: nullErr } = await adminDb().from('monthly_staff_status').insert({ year_month: W05_MONTHS.draft, store_id: zt01, employee_name: 'W05', is_manually_added: true });
    expect(nullErr?.message).toContain('WORKSPACE_INVALID');
    await registerRoster(zt01, W05_MONTHS.draft);
  });

  test.describe('E.4 編輯職位只改未送審、未確認月份', () => {
    let expected: any;
    test('準備：員工主檔 + 草稿月份與已確認月份名冊（皆為專員）', async () => {
      const c = await createEmployee(admin, { employee_code: codes.edit, employee_name: 'W05 編輯前', current_position: '專員' });
      expect(c.status).toBe(200);
      expect((await addMonthlyManual(admin, zt01, W05_MONTHS.draft, { employee_name: 'W05 編輯前', employee_code: codes.edit })).status).toBe(200);
      expect((await addMonthlyManual(admin, zt01, W05_MONTHS.locked, { employee_name: 'W05 編輯前', employee_code: codes.edit })).status).toBe(200);
      await ensureStats(admin, zt01, W05_MONTHS.locked);
      expect((await admin.post('/api/workspace/monthly', { data: { action: 'submit', store: zt01, month: W05_MONTHS.locked, skipChecks: true } })).status()).toBe(200);
      await registerRoster(zt01, W05_MONTHS.locked);
      await registerRoster(zt01, W05_MONTHS.draft);
      await registerCode(codes.edit);
      expect((await monthlyRows(codes.edit)).map((r) => [r.year_month, r.status, r.position])).toEqual([[W05_MONTHS.draft, 'draft', '專員'], [W05_MONTHS.locked, 'submitted', '專員']]);
    });

    test('姓名全部月份同步；職位只更新草稿月份，已送審月份不動並登記需重新確認', async () => {
      const read = await admin.get('/api/workspace/employees/edit', { params: { employee: codes.edit } });
      expect(read.status()).toBe(200);
      expected = (await read.json()).expected;
      const res = await admin.put('/api/workspace/employees/edit', {
        data: { requestId: randomUUID(), expected, data: { employee_code: codes.edit, employee_name: 'W05 編輯後', current_position: '主任', start_date: '', birthday: '' } },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.position_updated_months).toBe(1);
      expect(body.recheck_count).toBe(1);
      expect(body.recheck[0]).toMatchObject({ year_month: W05_MONTHS.locked, old: '專員', new: '主任' });

      const rows = await monthlyRows(codes.edit);
      const byMonth = Object.fromEntries(rows.map((r) => [r.year_month, r]));
      expect(byMonth[W05_MONTHS.draft].position).toBe('主任');
      expect(byMonth[W05_MONTHS.locked].position).toBe('專員');
      expect(byMonth[W05_MONTHS.draft].employee_name).toBe('W05 編輯後');
      expect(byMonth[W05_MONTHS.locked].employee_name).toBe('W05 編輯後');
      expect((await masterRows(codes.edit))[0]).toMatchObject({ employee_name: 'W05 編輯後', current_position: '主任' });

      const recheck = await recheckRows(codes.edit);
      expect(recheck).toHaveLength(1);
      expect(recheck[0]).toMatchObject({ year_month: W05_MONTHS.locked, store_id: zt01, field: 'position', old_value: '專員', new_value: '主任', status: 'pending', source_type: 'employee_edit', reason: 'employee_edit_position' });
      expect(recheck[0].monthly_staff_status_id).toBe(byMonth[W05_MONTHS.locked].id);
      await registerCode(codes.edit);
    });

    test('版本過期回 409；相同 requestId 重送回相同結果、不會重複登記', async () => {
      const stale = await admin.put('/api/workspace/employees/edit', {
        data: { requestId: randomUUID(), expected, data: { employee_code: codes.edit, employee_name: 'W05 再改', current_position: '組長', start_date: '', birthday: '' } },
      });
      expect(stale.status()).toBe(409);
      const fresh = (await (await admin.get('/api/workspace/employees/edit', { params: { employee: codes.edit } })).json()).expected;
      const requestId = randomUUID();
      const payload = { requestId, expected: fresh, data: { employee_code: codes.edit, employee_name: 'W05 編輯後', current_position: '組長', start_date: '', birthday: '' } };
      const first = await admin.put('/api/workspace/employees/edit', { data: payload });
      const second = await admin.put('/api/workspace/employees/edit', { data: payload });
      expect(first.status()).toBe(200);
      expect(await second.json()).toEqual(await first.json());
      const recheck = await recheckRows(codes.edit);
      expect(recheck).toHaveLength(1);
      expect(recheck[0]).toMatchObject({ old_value: '專員', new_value: '組長', status: 'pending' });
    });

    test('職位改回已送審月份原本的職位：待確認項目自動結案', async () => {
      const fresh = (await (await admin.get('/api/workspace/employees/edit', { params: { employee: codes.edit } })).json()).expected;
      const res = await admin.put('/api/workspace/employees/edit', { data: { requestId: randomUUID(), expected: fresh, data: { employee_code: codes.edit, employee_name: 'W05 編輯後', current_position: '專員', start_date: '', birthday: '' } } });
      expect(res.status()).toBe(200);
      expect((await res.json()).recheck_count).toBe(0);
      const recheck = await recheckRows(codes.edit);
      expect(recheck.map((r) => r.status)).toEqual(['resolved']);
    });

    test('共用結構：workspace_monthly_recheck_add 可供 A.2 使用，重複登記只更新新值', async () => {
      const db = adminDb();
      const actor = adminUserId();
      const call = (value: string) => db.rpc('workspace_monthly_recheck_add', { p_actor: actor, p_code: codes.edit, p_name: 'W05', p_store: zt01, p_month: W05_MONTHS.locked, p_status_id: null, p_field: 'status', p_old: 'full_month', p_new: value, p_reason: 'movement:resignation', p_label: '離職異動，已送審月份未更動', p_source_type: 'movement', p_source_id: 'w05-shared' });
      const a = await call('resigned');
      const b = await call('leave_of_absence');
      expect(a.error).toBeNull();
      expect(b.data).toBe(a.data);
      const rows = (await recheckRows(codes.edit)).filter((r) => r.field === 'status');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ new_value: 'leave_of_absence', status: 'pending', source_type: 'movement' });
      await registerCode(codes.edit);
    });
  });

  test('權限：沒有員工管理權限的帳號不能新增或編輯員工', async () => {
    const viewer = await apiAs('employee_view');
    try {
      const r = await createEmployee(viewer, { employee_code: codes.bd, employee_name: 'W05 無權限' });
      expect([401, 403]).toContain(r.status);
      expect((await masterRows(codes.bd)).length).toBe(0);
    } finally {
      await viewer.dispose();
    }
    void zt02;
  });
});

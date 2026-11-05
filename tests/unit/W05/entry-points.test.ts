import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseEmployeeImport } from '../../../lib/workspace/employee-import';
import { parseBirthdayCsv } from '../../../lib/workspace/employee-birthdays';
import { validateMovementFields } from '../../../lib/workspace/movement-fields';
import { EMPLOYEE_ID_SQL_PATTERN } from '../../../lib/workspace/employee-id-rule';
import { POSITION_OPTIONS } from '../../../types/workflow';

// W05 單元層：所有新增入口共用同一套員編規則（E.1），員工匯入職位限公司職位清單（F.1）。

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const STORE = { id: '11111111-1111-4111-8111-111111111111', store_code: 'ZT01', store_name: '測試門市' };

function workbook(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([['門市代號', '員編', '姓名', '職位', '到職日期'], ...rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '員工資料');
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}

describe('員工匯入（E.1、F.1）', () => {
  it('合法列：4 位數字補 FK、5 位數字補 FKF、FKPT 原樣；職位在清單內', () => {
    const r = parseEmployeeImport(workbook([
      ['ZT01', '1234', '甲', '專員', '2026-10-01'],
      ['ZT01', '56789', '乙', '店長', '2026-10-01'],
      ['ZT01', ' fkpt007 ', '丙', '兼職助理', '2026-10-01'],
    ]), [STORE]);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.employee_code)).toEqual(['FK1234', 'FKF56789', 'FKPT007']);
    expect(r.valid).toBe(true);
  });
  it('FKI、格式錯誤、補不出合法格式的員編都在預覽標示錯誤', () => {
    const r = parseEmployeeImport(workbook([
      ['ZT01', 'FKI001', '甲', '專員', '2026-10-01'],
      ['ZT01', 'FK12', '乙', '專員', '2026-10-01'],
      ['ZT01', '123', '丙', '專員', '2026-10-01'],
      ['ZT01', 'FKF1234567', '丁', '專員', '2026-10-01'],
    ]), [STORE]);
    expect(r.valid).toBe(false);
    expect(r.errors.filter((e) => e.row === 2)[0].message).toContain('實習生');
    for (const row of [3, 4, 5]) expect(r.errors.some((e) => e.row === row && e.message.includes('員編格式錯誤')), `row ${row}`).toBe(true);
  });
  it('職位不在公司職位清單內時預覽標示錯誤（F.1）', () => {
    const r = parseEmployeeImport(workbook([
      ['ZT01', 'FK1234', '甲', '實習藥師', '2026-10-01'],
      ['ZT01', 'FK1235', '乙', '專員 ', '2026-10-01'],
      ['ZT01', 'FK1236', '丙', '總經理', '2026-10-01'],
    ]), [STORE]);
    expect(r.errors).toEqual([{ row: 2, message: '職位不在公司職位清單內' }]);
  });
  it('清單內每個職位都可匯入', () => {
    const rows = POSITION_OPTIONS.map((p, i) => ['ZT01', `FK${String(1000 + i)}`, `員${i}`, p, '2026-10-01']);
    expect(parseEmployeeImport(workbook(rows), [STORE]).errors).toEqual([]);
  });
});

describe('生日匯入（E.1，只比對既有員編）', () => {
  it('合規員編通過、FKI 與格式錯誤在預覽標示', () => {
    const r = parseBirthdayCsv('員編,姓名,生日\nfk1234,甲,1990-01-05\nFKI001,乙,1990-01-05\nFK12,丙,1990-01-05\nFKPT123,丁,1990/2/3\n', '2026-11-05');
    expect(r.rows.map((x) => x.employee_code)).toEqual(['FK1234', 'FKPT123']);
    expect(r.errors.map((e) => e.row)).toEqual([3, 4]);
    expect(r.errors[0].message).toContain('實習生');
    expect(r.errors[1].message).toContain('員編格式錯誤');
  });
});

describe('異動入職（E.1）', () => {
  const base = { employee_name: '甲', store_id: STORE.id, movement_type: 'onboarding', birthday: '1990-01-05', effective_date: '2026-10-01', onboarding_is_pharmacist: false };
  const codeErrors = (employee_code: string, movement_type = 'onboarding') =>
    validateMovementFields([{ ...base, employee_code, movement_type }], '2026-11-05').errors.filter((e) => e.field === 'employee_code');
  it('入職用新員編：合法通過，FKI 與錯誤格式被拒', () => {
    expect(codeErrors('FK1234')).toEqual([]);
    expect(codeErrors('fkf12345')).toEqual([]);
    expect(codeErrors('FKPT123')).toEqual([]);
    expect(codeErrors('FKI001')[0].message).toContain('實習生');
    expect(codeErrors('FK123')[0].message).toContain('員編格式錯誤');
    expect(codeErrors('ABCDEF')[0].message).toContain('員編格式錯誤');
  });
  it('其餘異動針對既有員工，不重複套用新建立員編規則（只擋新建立的員編）', () => {
    expect(codeErrors('LEGACY-01', 'resignation')).toEqual([]);
  });
});

describe('前後端與 DEV SQL 使用同一套規則', () => {
  it('SQL 規則函式與 TS 樣式相同', () => {
    const sql = read('supabase/workspace-dev/20261105200000_w05_employee_id_rule.sql');
    expect(sql).toContain(`'${EMPLOYEE_ID_SQL_PATTERN}'`);
    expect(sql).toContain("LIKE 'FKPT%'");
  });
  it('員工匯入 SQL 的職位清單與 POSITION_OPTIONS 完全相同', () => {
    const sql = read('supabase/workspace-dev/20261105200000_w05_employee_id_rule.sql');
    const m = /positions text\[\]:=ARRAY\[([^\]]+)\]/.exec(sql);
    expect(m).not.toBeNull();
    const list = m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
    expect(list).toEqual([...POSITION_OPTIONS]);
  });
  it('新增員工、員工匯入、生日、異動入職、手動新增的 SQL 與 API 都不再留下舊的寬鬆員編樣式', () => {
    const sql = read('supabase/workspace-dev/20261105200000_w05_employee_id_rule.sql');
    expect(sql).not.toMatch(/\[A-Z0-9_-\]/);
    for (const file of ['app/api/workspace/employees/route.ts', 'app/api/workspace/employee-birthdays/route.ts', 'lib/workspace/employee-import.ts', 'lib/workspace/employee-birthdays.ts']) {
      // 只檢查「新增」路徑；employees/route.ts 的 GET 歷程查詢是既有員編查詢，不屬於新增入口。
      const source = read(file), created = source.includes('export async function POST') ? source.slice(source.indexOf('export async function POST')) : source;
      expect(created, file).not.toMatch(/\[A-Z0-9_-\]/);
      expect(read(file), file).toMatch(/employee-id-rule/);
    }
    expect(read('app/api/workspace/monthly/tools/route.ts')).toMatch(/checkEmployeeId/);
    expect(read('lib/workspace/movement-fields.ts')).toMatch(/checkEmployeeId/);
    expect(read('vue-workspace/src/pages/EmployeeCreate.vue')).toMatch(/employee-id-rule/);
    expect(read('vue-workspace/src/pages/EmployeeCreate.vue')).not.toMatch(/FKI/);
  });
  it('員工編輯 SQL：姓名全部月份同步、職位只改未送審未確認月份並登記需重新確認', () => {
    const sql = read('supabase/workspace-dev/20261105200100_w05_employee_edit_recheck.sql');
    expect(sql).toMatch(/UPDATE monthly_staff_status SET employee_name=new_name WHERE employee_code=code/);
    expect(sql).toMatch(/workspace_staff_month_locked\(m\.store_id,m\.year_month,m\.status\)/);
    expect(sql).toMatch(/workspace_monthly_recheck_add\(/);
    expect(sql).not.toMatch(/UPDATE monthly_staff_status SET employee_name=[^;]*position=/);
  });
});

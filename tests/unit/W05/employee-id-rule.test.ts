import { describe, expect, it } from 'vitest';
import {
  EMPLOYEE_ID_MAX_LENGTH,
  EMPLOYEE_ID_PATTERN,
  checkEmployeeId,
  completeExcelEmployeeId,
  employmentTypeForEmployeeId,
  isInternEmployeeId,
  isValidEmployeeId,
  normalizeEmployeeId,
} from '../../../lib/workspace/employee-id-rule';

// W05 單元層：員編規則（M2 規格 E.1、E.2、E.3、G：Excel 補前綴）。

describe('員編格式（E.1）：只有 FK+4、FKF+5、FKPT+3 三種', () => {
  it.each(['FK1234', 'FKF12345', 'FKPT123', 'FK0000', 'FKF00001', 'FKPT999'])('%s 合法', (code) => {
    expect(checkEmployeeId(code)).toEqual({ ok: true, code });
    expect(isValidEmployeeId(code)).toBe(true);
  });
  it.each(['FK123', 'FK12345', 'FKF1234', 'FKF123456', 'FKPT12', 'FKPT1234', 'FK12A4', 'FKP123', 'FKX1234', '1234', 'ABC', 'FK-123', 'FK１２３４', 'FK12 34'])('%s 格式錯誤', (code) => {
    const r = checkEmployeeId(code);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('format');
  });
  it('輸入去前後空白並轉大寫', () => {
    expect(normalizeEmployeeId('  fk1234 ')).toBe('FK1234');
    expect(normalizeEmployeeId('\tfkpt007\n')).toBe('FKPT007');
    expect(checkEmployeeId(' fkf12345 ')).toEqual({ ok: true, code: 'FKF12345' });
  });
  it('非字串與空白視為空', () => {
    for (const v of [undefined, null, 12, {}, '', '   ']) {
      const r = checkEmployeeId(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('empty');
    }
  });
  it('長度上限由規則決定：最長為 FKF+5 的 8 碼', () => {
    expect(EMPLOYEE_ID_MAX_LENGTH).toBe(8);
    for (const code of ['FK1234', 'FKF12345', 'FKPT123']) expect(code.length).toBeLessThanOrEqual(EMPLOYEE_ID_MAX_LENGTH);
    expect(isValidEmployeeId('FKF123456')).toBe(false);
  });
  it('樣式使用 ^$ 錨定，換行夾帶無法繞過', () => {
    expect(EMPLOYEE_ID_PATTERN.test('FK1234\nX')).toBe(false);
    expect(isValidEmployeeId('FK1234\nFK1235')).toBe(false);
  });
});

describe('FKI 實習生一律拒絕（E.2）', () => {
  it.each(['FKI001', 'fki123', ' FKI12 ', 'FKI', 'FKI1234'])('%s 被拒', (code) => {
    const r = checkEmployeeId(code);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('intern');
      expect(r.message).toContain('實習生');
    }
    expect(isInternEmployeeId(code)).toBe(true);
  });
  it('FKI 不影響其他前綴', () => {
    expect(isInternEmployeeId('FK1234')).toBe(false);
    expect(isInternEmployeeId('FKPT123')).toBe(false);
  });
});

describe('FKPT 自動兼職（E.3）', () => {
  it('FKPT 開頭為兼職，其餘為正職', () => {
    expect(employmentTypeForEmployeeId('FKPT123')).toBe('part_time');
    expect(employmentTypeForEmployeeId(' fkpt001 ')).toBe('part_time');
    expect(employmentTypeForEmployeeId('FK1234')).toBe('full_time');
    expect(employmentTypeForEmployeeId('FKF12345')).toBe('full_time');
    expect(employmentTypeForEmployeeId('')).toBe('full_time');
  });
});

describe('Excel 員編欄補前綴（G）', () => {
  it('只有 4 位數字補 FK、只有 5 位數字補 FKF', () => {
    expect(completeExcelEmployeeId('1234')).toBe('FK1234');
    expect(completeExcelEmployeeId(1234)).toBe('FK1234');
    expect(completeExcelEmployeeId('12345')).toBe('FKF12345');
    expect(completeExcelEmployeeId(' 12345 ')).toBe('FKF12345');
  });
  it('其他長度與已有前綴的值不補', () => {
    for (const [input, out] of [['123', '123'], ['123456', '123456'], ['fk1234', 'FK1234'], ['FKPT123', 'FKPT123'], ['', '']]) expect(completeExcelEmployeeId(input)).toBe(out);
  });
  it('補完後仍須通過規則，補不出合法格式的值被拒', () => {
    expect(checkEmployeeId(completeExcelEmployeeId('123')).ok).toBe(false);
    expect(checkEmployeeId(completeExcelEmployeeId('1234')).ok).toBe(true);
    expect(checkEmployeeId(completeExcelEmployeeId('12345')).ok).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  prescriptionSaveError,
  prescriptionStatus,
  prescriptionStatusLabel,
  prescriptionTotal,
  validCount,
  validPointValue,
} from '../../../lib/workspace/prescription-rules';

// W03 處方箋規則：與舊版 PrescriptionTab.tsx 逐項對照（字面防漂移＋表格驅動）。

const legacy = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'components/performance/PrescriptionTab.tsx'), 'utf8');

describe('舊版字面（對照來源）', () => {
  for (const literal of [
    "return /^\\d+$/.test(value.trim());",
    "return /^\\d+(\\.\\d{1,4})?$/.test(value.trim());",
    "status === 'complete' ? '已完成'",
    "status === 'partial' ? '部分填寫'",
    "status === 'invalid' ? '格式錯誤' : '未填'",
    '一般箋張數需為非負整數',
    '慢箋張數需為非負整數',
    '一般箋點值最多輸入小數四位',
    '慢箋點值最多輸入小數四位',
    'Math.round((Number(regular) / 4 + Number.EPSILON) * 10) / 10',
  ]) {
    it(literal, () => expect(legacy).toContain(literal));
  }
});

describe('驗證', () => {
  it('張數：非負整數字串', () => {
    for (const ok of ['0', '10', ' 7 ', '2147483647']) expect(validCount(ok), ok).toBe(true);
    for (const bad of ['', '-1', '1.5', 'abc', '1e3', '١٢']) expect(validCount(bad), bad).toBe(false);
  });
  it('點值：最多四位小數', () => {
    for (const ok of ['0', '1', '1.2', '1.2345', '99999999.9999']) expect(validPointValue(ok), ok).toBe(true);
    for (const bad of ['1.23456', '-1', '.5', '1.', 'abc', '']) expect(validPointValue(bad), bad).toBe(false);
  });
});

describe('資料狀態徽章', () => {
  const full = { regular_prescription_count: 10, regular_prescription_point_value: 1.5, chronic_prescription_count: 5, chronic_prescription_point_value: 2 };
  const cases: [string, any, string][] = [
    ['全填', full, '已完成'],
    ['全空', {}, '未填'],
    ['全 null', { regular_prescription_count: null, regular_prescription_point_value: null, chronic_prescription_count: null, chronic_prescription_point_value: null }, '未填'],
    ['只填一格', { regular_prescription_count: 3 }, '部分填寫'],
    ['三格', { ...full, chronic_prescription_point_value: '' }, '部分填寫'],
    ['張數非整數', { ...full, regular_prescription_count: '1.5' }, '格式錯誤'],
    ['點值超過四位', { ...full, chronic_prescription_point_value: '1.23456' }, '格式錯誤'],
    ['格式錯誤優先於完整', { ...full, regular_prescription_point_value: 'x' }, '格式錯誤'],
    ['格式錯誤優先於部分', { chronic_prescription_count: '-2' }, '格式錯誤'],
    ['數字 0 視為有填', { regular_prescription_count: 0, regular_prescription_point_value: 0, chronic_prescription_count: 0, chronic_prescription_point_value: 0 }, '已完成'],
  ];
  for (const [name, row, label] of cases) it(name, () => expect(prescriptionStatusLabel(prescriptionStatus(row))).toBe(label));
});

describe('總慢箋張數', () => {
  it('一般箋 / 4 四捨五入到小數 1 位 + 慢箋', () => {
    const t = (r: number | string, c: number | string) => prescriptionTotal({ regular_prescription_count: r, chronic_prescription_count: c });
    expect(t(10, 0)).toBe(2.5);
    expect(t(7, 0)).toBe(1.8);
    expect(t(7, 3)).toBe(4.8);
    expect(t(0, 0)).toBe(0);
    expect(t(2, 0)).toBe(0.5);
    expect(t(1, 0)).toBe(0.3);
    expect(t(3, 1)).toBe(1.8);
  });
  it('缺少或格式錯誤為 null', () => {
    expect(prescriptionTotal({ regular_prescription_count: 10 })).toBeNull();
    expect(prescriptionTotal({ regular_prescription_count: '', chronic_prescription_count: 1 })).toBeNull();
    expect(prescriptionTotal({ regular_prescription_count: '1.5', chronic_prescription_count: 1 })).toBeNull();
  });
});

describe('儲存前檢查訊息', () => {
  const row = { store_code: 'ZT01', store_name: '測試', regular_prescription_count: 1, regular_prescription_point_value: 1, chronic_prescription_count: 1, chronic_prescription_point_value: 1 };
  it('通過', () => expect(prescriptionSaveError(row)).toBeNull());
  it('各欄位訊息與舊版相同', () => {
    expect(prescriptionSaveError({ ...row, regular_prescription_count: '-1' })).toBe('ZT01 測試：一般箋張數需為非負整數');
    expect(prescriptionSaveError({ ...row, chronic_prescription_count: '1.5' })).toBe('ZT01 測試：慢箋張數需為非負整數');
    expect(prescriptionSaveError({ ...row, regular_prescription_point_value: '1.23456' })).toBe('ZT01 測試：一般箋點值最多輸入小數四位');
    expect(prescriptionSaveError({ ...row, chronic_prescription_point_value: '1.23456' })).toBe('ZT01 測試：慢箋點值最多輸入小數四位');
  });
});

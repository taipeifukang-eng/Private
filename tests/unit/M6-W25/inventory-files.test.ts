import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as X from 'xlsx';
import {
  buildCsv,
  buildInventoryFileName,
  buildWorkbook,
  code,
  conflictsToText,
  DuplicateCodesError,
  finalRows,
  integrate,
  mergeOkFiles,
  normalize,
  processFilesIndividually,
  rowsFromBuffer,
  summarizePerFile,
} from '../../../vue-workspace/src/lib/inventory-files';

const FIX = path.resolve(__dirname, '..', '..', 'fixtures', 'm6');
const buf = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIX, name)));
const rows = (name: string, base = false) => rowsFromBuffer(buf(name), base);

describe('M6-W25 A1 檔名（台北時間 YYYY-MM-DD，M月D日盤點結果檔維持舊寫法）', () => {
  const d = new Date('2026-11-21T03:00:00Z'); // 台北 11:00
  it('四種檔名', () => {
    expect(buildInventoryFileName('externalRecount', d)).toBe('外盤應複盤清單_2026-11-21.xlsx');
    expect(buildInventoryFileName('internalRecount', d)).toBe('內部盤點複盤資料_2026-11-21.xlsx');
    expect(buildInventoryFileName('uninventoried', d)).toBe('系統有庫存但未盤點檔案_2026-11-21.xlsx');
    expect(buildInventoryFileName('result', d)).toBe('11月21日盤點結果檔.xlsx');
  });
  it('跨午夜以台北時間為準（UTC 16:00 起已是台北隔天）', () => {
    expect(buildInventoryFileName('externalRecount', new Date('2026-11-21T15:59:59Z'))).toContain('2026-11-21');
    expect(buildInventoryFileName('externalRecount', new Date('2026-11-21T16:00:00Z'))).toContain('2026-11-22');
    expect(buildInventoryFileName('result', new Date('2026-12-31T16:00:00Z'))).toBe('1月1日盤點結果檔.xlsx');
    expect(buildInventoryFileName('internalRecount', new Date('2026-12-31T16:00:00Z'))).toContain('2027-01-01');
  });
  it('月與日個位數：橫線版補零，結果檔不補零', () => {
    const one = new Date('2038-03-05T04:00:00Z');
    expect(buildInventoryFileName('uninventoried', one)).toBe('系統有庫存但未盤點檔案_2038-03-05.xlsx');
    expect(buildInventoryFileName('result', one)).toBe('3月5日盤點結果檔.xlsx');
  });
  it('檔名不含斜線（Windows 會把斜線改成底線）', () => {
    for (const k of ['externalRecount', 'internalRecount', 'uninventoried', 'result'] as const) expect(buildInventoryFileName(k, d)).not.toMatch(/[\\/]/);
  });
  it('工作表名稱預設 Sheet1，可指定', () => {
    expect(buildWorkbook(X, [{ a: 1 }]).SheetNames).toEqual(['Sheet1']);
    expect(buildWorkbook(X, [{ a: 1 }], '盤差原因').SheetNames).toEqual(['盤差原因']);
    expect(buildWorkbook(X, [{ a: 1 }], '爭議異動明細').SheetNames).toEqual(['爭議異動明細']);
  });
});

describe('M6-W25 品號補零 8 位（與舊版 formatProductCode 相同）', () => {
  it.each([[12, '00000012'], ['345', '00000345'], ['00000345', '00000345'], [2000215, '02000215'], ['ABC-77', 'ABC-77'], [' 7 ', '00000007'], ['123456789', '123456789']])('%s -> %s', (v, e) => {
    expect(code(v)).toBe(e);
  });
});

describe('M6-W25 A2 最終檔衝突擋下', () => {
  const zero = [
    { 品號: '00000012', 庫存量: 10, 實際量: 10 },
    { 品號: '00000345', 庫存量: 5, 實際量: 5 },
  ];
  const internal = (list: [string, number, number][]) => list.map(([c, stock, qty]) => ({ 品號: c, 庫存量: stock, 盤點數量: qty }));

  it('沒有衝突：輸出與舊版累加結果逐列相同', () => {
    const r = finalRows(zero, internal([['00000007', 8, 5], ['00000007', 8, 3]]), internal([['02000215', -2, -2]]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([
      { 品號: '00000012', 庫存量: 10, 實際量: 10, 盤差量: 0 },
      { 品號: '00000345', 庫存量: 5, 實際量: 5, 盤差量: 0 },
      { 品號: '00000007', 庫存量: 8, 實際量: 8, 盤差量: 0 },
      { 品號: '02000215', 庫存量: -2, 實際量: -2, 盤差量: 0 },
    ]);
  });
  it('單一衝突：無盤差與複盤資料同時出現', () => {
    const r = finalRows(zero, internal([['00000012', 10, 1]]), []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0]).toMatchObject({ code: '00000012', kind: 'zero-and-recount' });
    expect(r.conflicts[0].places.map((p) => p.source)).toEqual(['模組二保留的無盤差品項', '修改後內部複盤資料']);
  });
  it('單一衝突：庫存量不一致（跨檔與同檔不同列）', () => {
    const cross = finalRows([], internal([['00000007', 8, 5]]), internal([['00000007', 9, 0]]));
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.conflicts.map((c) => c.kind)).toEqual(['stock-mismatch']);
    const same = finalRows([], internal([['00000007', 8, 5], ['00000007', 9, 3]]), []);
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.conflicts[0].detail).toContain('8、9');
  });
  it('單一衝突：未盤點檔內同品號重複；內部複盤檔多儲位多列不算衝突', () => {
    const dup = finalRows([], [], internal([['02000215', -2, -2], ['02000215', -2, 0]]));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.conflicts).toMatchObject([{ code: '02000215', kind: 'duplicate-in-file' }]);
    expect(finalRows([], internal([['00000007', 8, 5], ['00000007', 8, 3]]), []).ok).toBe(true);
  });
  it('多重衝突：三種類型並存，一次全列出、依品號與類型排序且穩定', () => {
    const args = [zero, internal([['00000012', 10, 1], ['00000007', 8, 3], ['00000007', 9, 5]]), internal([['02000215', -2, -2], ['02000215', -2, 0]])] as const;
    const a = finalRows(...args);
    const b = finalRows(...args);
    expect(a).toEqual(b);
    expect(a.ok).toBe(false);
    if (a.ok) return;
    expect(a.conflicts.map((c) => `${c.code}:${c.kind}`)).toEqual(['00000007:stock-mismatch', '00000012:zero-and-recount', '02000215:duplicate-in-file']);
    expect(new Set(a.conflicts.map((c) => c.kind)).size).toBe(3);
  });
  it('同一品號同時中兩種衝突：兩筆都列出，類型順序固定', () => {
    const r = finalRows([{ 品號: '00000012', 庫存量: 10, 實際量: 10 }], internal([['00000012', 11, 1]]), []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.conflicts.map((c) => c.kind)).toEqual(['zero-and-recount']);
    const both = finalRows([{ 品號: '00000012', 庫存量: 10, 實際量: 10 }], internal([['00000012', 11, 1], ['00000012', 12, 1]]), []);
    if (!both.ok) expect(both.conflicts.map((c) => c.kind)).toEqual(['zero-and-recount', 'stock-mismatch']);
  });
  it('衝突清單可轉成可複製文字（每項一行）', () => {
    const r = finalRows(zero, internal([['00000012', 10, 1]]), []);
    if (r.ok) throw new Error('應有衝突');
    const text = conflictsToText(r.conflicts);
    expect(text.split('\n')).toHaveLength(1);
    expect(text).toContain('00000012');
    expect(text).toContain('庫存量 10');
  });
  it('用自造檔：模組二產出 + 改好的檔案 = 5 筆、盤差皆 0；衝突檔 3 項', async () => {
    const base = normalize(await rows('base-1f.xlsx', true), 'base');
    const records = [
      ...normalize(await rows('pre-1.xlsx'), 'pre'),
      ...normalize(await rows('pre-2.xlsx'), 'pre'),
      ...normalize(await rows('fks0701.xlsx'), 'fks'),
    ];
    const m2 = integrate(base, records);
    const ok = finalRows(m2.zero, normalize(await rows('internal-edited.xlsx'), 'internal'), normalize(await rows('missing-edited.xlsx'), 'missing'));
    expect(ok.ok && ok.rows.map((r) => r.品號)).toEqual(['00000012', '00000345', '00000009', '00000007', '02000215']);
    expect(ok.ok && ok.rows.every((r) => r.盤差量 === 0)).toBe(true);
    const bad = finalRows(m2.zero, normalize(await rows('internal-conflict.xlsx'), 'internal'), normalize(await rows('missing-conflict.xlsx'), 'missing'));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.conflicts.map((c) => `${c.code}:${c.kind}`)).toEqual(['00000007:stock-mismatch', '00000012:zero-and-recount', '02000215:duplicate-in-file']);
  });
});

describe('M6-W25 A3 預盤逐檔容錯', () => {
  const entry = (name: string) => ({ name, read: () => rows(name) });
  it('全部成功', async () => {
    const r = await processFilesIndividually([entry('pre-1.xlsx'), entry('pre-2.xlsx')], 'pre');
    expect(r.okFiles.map((f) => f.name)).toEqual(['pre-1.xlsx', 'pre-2.xlsx']);
    expect(r.failedFiles).toEqual([]);
    expect(summarizePerFile(r)).toEqual({ level: 'ok', text: '成功 2/2' });
  });
  it('部分失敗：好檔照收，壞檔列出檔名與原因（缺欄位、空檔、無法解析、數字錯誤）', async () => {
    const r = await processFilesIndividually(
      [entry('pre-1.xlsx'), entry('pre-bad-columns.xlsx'), entry('pre-empty.xlsx'), entry('pre-nonnumeric.xlsx'), { name: 'broken.xlsx', read: async () => { throw new Error('檔案沒有工作表'); } }, entry('pre-2.xlsx')],
      'pre',
    );
    expect(r.okFiles.map((f) => f.name)).toEqual(['pre-1.xlsx', 'pre-2.xlsx']);
    expect(Object.fromEntries(r.failedFiles.map((f) => [f.name, f.reason]))).toEqual({
      'pre-bad-columns.xlsx': '缺少欄位：盤點數量、盤點儲位',
      'pre-empty.xlsx': '檔案沒有資料列',
      'pre-nonnumeric.xlsx': '數量不是有效數字：多少',
      'broken.xlsx': '檔案沒有工作表',
    });
    const s = summarizePerFile(r);
    expect(s.level).toBe('warn');
    expect(s.text).toMatch(/^成功 2\/6，失敗檔案：pre-bad-columns\.xlsx（/);
    expect(s.text).toContain('pre-empty.xlsx（檔案沒有資料列）');
  });
  it('全部失敗：level 為 error，沒有任何檔案被收下', async () => {
    const r = await processFilesIndividually([entry('pre-bad-columns.xlsx'), entry('pre-empty.xlsx')], 'pre');
    expect(r.okFiles).toEqual([]);
    expect(summarizePerFile(r).level).toBe('error');
    expect(summarizePerFile(r).text).toMatch(/^成功 0\/2，失敗檔案：/);
  });
  it('資料列全被濾掉（品號全空）的檔案視為「無資料」', async () => {
    const r = await processFilesIndividually([{ name: 'blank.xlsx', read: () => [{ 品號: '', 盤點數量: 1, 盤點儲位: 'A' }] }], 'pre');
    expect(r.failedFiles).toEqual([{ name: 'blank.xlsx', reason: '無資料' }]);
  });
  it('失敗檔單獨重傳：成功的不需要再傳；重複上傳同一檔以新的取代、不加倍', async () => {
    const first = await processFilesIndividually([entry('pre-1.xlsx'), entry('pre-bad-columns.xlsx')], 'pre');
    let kept = mergeOkFiles({}, first.okFiles);
    expect(Object.keys(kept)).toEqual(['pre-1.xlsx']);
    const retry = await processFilesIndividually([entry('pre-2.xlsx')], 'pre');
    kept = mergeOkFiles(kept, retry.okFiles);
    expect(Object.keys(kept)).toEqual(['pre-1.xlsx', 'pre-2.xlsx']);
    kept = mergeOkFiles(kept, (await processFilesIndividually([entry('pre-1.xlsx')], 'pre')).okFiles);
    expect(Object.values(kept).flat()).toHaveLength(3);
  });
});

describe('M6-W25 A4 提示訊息與外盤重複品號', () => {
  it('外盤檔重複品號：列出全部重複品號，文字沿用舊版', async () => {
    let err: unknown;
    try { normalize(await rows('external-dup.xlsx'), 'external'); } catch (x) { err = x; }
    expect(err).toBeInstanceOf(DuplicateCodesError);
    expect((err as DuplicateCodesError).codes).toEqual(['00000012', '00000007']);
    const m = (err as Error).message;
    expect(m).toContain('匯入失敗：外盤公司原始檔中發現重複品號');
    expect(m).toContain('00000012, 00000007');
    expect(m).toContain('請聯繫外盤公司修正檔案後重新上傳');
    expect(m).toContain('每個品號只能出現一次');
  });
  it('FKS0701 缺欄位：訊息含實際欄位清單（舊版「找不到必要欄位！標題行內容」）', async () => {
    expect(() => normalize([{ 品名: '甲', 條碼: '1', 盤點儲位: 'A' }], 'fks')).toThrow('找不到必要欄位！標題行內容：品名 | 條碼 | 盤點儲位');
  });
  it('1F 商品檔缺欄位：缺儲位、缺庫存、缺品號／品名／條碼各自的完整訊息', async () => {
    await expect(rows('base-1f-missing-location.xlsx', true).then((r) => normalize(r, 'base'))).rejects.toThrow(/找不到「主要儲位」或「主要庫位」欄位[\s\S]*實際檔案中的欄位：\n品號\n品名/);
    await expect(rows('base-1f-missing-stock.xlsx', true).then((r) => normalize(r, 'base'))).rejects.toThrow('找不到「庫存」或「重存」欄位！');
    await expect(rows('base-1f-missing-barcode.xlsx', true).then((r) => normalize(r, 'base'))).rejects.toThrow(/1F當日商品資料缺少必要欄位！[\s\S]*缺少的欄位：\n條碼[\s\S]*實際檔案中的欄位：\n品號、品名、庫存/);
  });
  it('其他檔案缺欄位：訊息含缺少的欄位與實際欄位', async () => {
    await expect(Promise.resolve().then(() => normalize([{ 品號: 1 }], 'pre'))).rejects.toThrow(/預盤資料缺少必要欄位！[\s\S]*缺少的欄位：\n盤點數量、盤點儲位[\s\S]*實際檔案中的欄位：\n品號/);
  });
  it('模組一無盤差：用 clean 外盤檔得到空清單（畫面顯示「沒有需要複盤的品項」並不下載）', async () => {
    const base = normalize(await rows('base-1f.xlsx', true), 'base');
    const ext = normalize(await rows('external-clean.xlsx'), 'external');
    const fks = normalize(await rows('fks0701.xlsx'), 'fks');
    const x = integrate(base, [...ext, ...fks]);
    const codes = new Set(x.diff.map((r) => r.品號));
    expect(ext.filter((r) => codes.has(r.品號))).toEqual([]);
  });
});

describe('M6-W25 CSV 前導零', () => {
  const parseCsv = (text: string) =>
    text
      .replace(/^﻿/, '')
      .split('\r\n')
      .map((line) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replaceAll('""', '"')));
  // 模擬 Excel：="00012345" 解讀成文字 00012345
  const excelCell = (cell: string) => cell.replace(/^="(.*)"$/, '$1');
  it('品號 00012345 往返不變（有 BOM、文字格式寫法）', () => {
    const csv = buildCsv([['品號', '品名'], ['00012345', '測試'], ['02000215', '=SUM(A1)']], [0]);
    expect(csv.startsWith('﻿')).toBe(true);
    const parsed = parseCsv(csv);
    expect(excelCell(parsed[1][0])).toBe('00012345');
    expect(excelCell(parsed[2][0])).toBe('02000215');
    expect(parsed[1][1]).toBe('測試');
  });
  it('非品號欄位仍防公式注入；品號含英文字母不加文字格式', () => {
    const parsed = parseCsv(buildCsv([['ABC-77', '=1+1', '+2', '@x', '-3', '正常']], [0]));
    expect(parsed[0]).toEqual(['ABC-77', "'=1+1", "'+2", "'@x", "'-3", '正常']);
  });
  it('雙引號與換行逸出', () => {
    expect(parseCsv(buildCsv([['a"b', 'c']], []))[0]).toEqual(['a"b', 'c']);
  });
});

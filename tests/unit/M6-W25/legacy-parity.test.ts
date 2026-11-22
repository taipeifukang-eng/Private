import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as X from 'xlsx';
import { integrate, normalize, rowsFromBuffer, finalRows, type Row } from '../../../vue-workspace/src/lib/inventory-files';
import {
  firstSheet,
  legacyModule1,
  legacyModule2,
  legacyModule3,
  legacyParseBase,
  legacyParseExternal,
  legacyParseFks,
  legacyParseModified,
  legacyParsePre,
} from '../../support/m6-legacy-inventory';

/**
 * 新舊對跑：同一份自造檔，舊版參照實作（tests/support/m6-legacy-inventory.ts）與新版 lib/inventory-files.ts 逐列比對。
 * 不一致的檔案必須登記在 KNOWN_DIFFS（附說明）；登記表與實際結果不同就失敗。
 * 登記表即「待使用者決定」清單：這裡只如實回報，不自行決定哪一邊是對的。
 */
const FIX = path.resolve(__dirname, '..', '..', 'fixtures', 'm6');
const bytes = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIX, name)));
const sheet = (name: string) => firstSheet(bytes(name));

type Outcome<T> = { ok: true; value: T } | { ok: false; message: string };
async function newBase(name: string): Promise<Outcome<Row[]>> {
  try {
    return { ok: true, value: normalize(await rowsFromBuffer(bytes(name), true), 'base') };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
const pickBase = (r: Row) => ({ 品號: r.品號, 品名: String(r.品名 ?? ''), UN: String(r.UN ?? ''), 條碼: String(r.條碼 ?? ''), 庫存: Number(r.庫存), 主要儲位: String(r.主要儲位 ?? '') });

const BASE_FILES = fs.readdirSync(FIX).filter((f) => f.startsWith('base-1f') && f.endsWith('.xlsx'));

/** 已知不一致（檔名 -> 說明）。新舊結果一致的檔案不能出現在這裡。 */
const KNOWN_BASE_DIFFS: Record<string, string> = {
  'base-1f-spaces.xlsx': '標題前後有空白：舊版把標題去空白後比對，新版不去空白，所以新版找不到「品號」等欄位而拒絕匯入',
  'base-1f-blank-code-row.xlsx': '品號空白但其他欄位有值的列：舊版保留（品號為空字串），新版略過該列',
  'base-1f-nonnumeric-stock.xlsx': '庫存欄位不是數字：舊版變成 NaN 仍匯入，新版直接拒絕並指出數字不正確',
};

describe('M6-W25 1F 商品檔欄位辨識：舊版（header:1 找索引）對新版（range=1 + includes）', () => {
  for (const name of BASE_FILES) {
    it(`${name}`, async () => {
      const legacy = legacyParseBase(sheet(name));
      const next = await newBase(name);
      const same = legacy.ok === next.ok && (!legacy.ok || (next.ok && JSON.stringify(legacy.value) === JSON.stringify(next.value.map(pickBase))));
      if (KNOWN_BASE_DIFFS[name]) expect(same, `已登記為不一致，但結果其實一致：${name}`).toBe(false);
      else {
        expect(legacy.ok, `${name} 舊版 ${JSON.stringify(legacy)}`).toBe(next.ok);
        if (legacy.ok && next.ok) expect(next.value.map(pickBase)).toEqual(legacy.value);
      }
    });
  }
  it('登記表沒有多餘檔名', () => {
    for (const k of Object.keys(KNOWN_BASE_DIFFS)) expect(BASE_FILES).toContain(k);
  });
  it('一致的樣本涵蓋：標題在第二列、欄位順序不同、庫存別名、儲位別名、缺欄位、含「庫存」的兩個欄位、較長欄位名稱、小寫 un', () => {
    for (const n of ['base-1f.xlsx', 'base-1f-reordered.xlsx', 'base-1f-longnames.xlsx', 'base-1f-two-stock-cols.xlsx', 'base-1f-missing-location.xlsx', 'base-1f-missing-stock.xlsx', 'base-1f-missing-barcode.xlsx', 'base-1f-header-row1.xlsx', 'base-1f-un-lowercase.xlsx'])
      expect(BASE_FILES).toContain(n);
  });
  it('不一致點明細（供回報）：標題空白、空品號列、非數字庫存', async () => {
    const report: Record<string, string> = {};
    for (const name of Object.keys(KNOWN_BASE_DIFFS)) {
      const legacy = legacyParseBase(sheet(name));
      const next = await newBase(name);
      report[name] = `舊版 ${legacy.ok ? `成功 ${legacy.value.length} 列` : '失敗'}；新版 ${next.ok ? `成功 ${next.value.length} 列` : '失敗：' + next.message.split('\n')[0]}`;
    }
    expect(Object.keys(report)).toHaveLength(Object.keys(KNOWN_BASE_DIFFS).length);
  });
});

const KNOWN_OTHER_DIFFS: Record<string, string> = {
  'pre-nonnumeric.xlsx': '盤點數量不是數字：舊版變成 NaN 仍收下，新版拒絕並指出數字不正確',
  'pre-empty.xlsx': '只有標題沒有資料列：舊版「檔案沒有資料」、新版「檔案沒有資料列」，皆拒絕（只是文字不同）',
};

async function newRows(name: string, kind: string) {
  try {
    return { ok: true as const, value: normalize(await rowsFromBuffer(bytes(name)), kind) };
  } catch (e) {
    return { ok: false as const, message: (e as Error).message };
  }
}

describe('M6-W25 其他輸入檔：舊版與新版輸出逐列一致', () => {
  it('外盤原始檔：一致；重複品號兩版都拒絕且重複品號清單相同', async () => {
    const l = legacyParseExternal(sheet('external-original.xlsx'));
    const n = await newRows('external-original.xlsx', 'external');
    expect(l.ok && n.ok && n.value.map((r) => [r.品號, r.盤點數量])).toEqual(l.ok && l.value.map((r) => [r.品號, r.盤點數量]));
    const ld = legacyParseExternal(sheet('external-dup.xlsx'));
    const nd = await newRows('external-dup.xlsx', 'external');
    expect(ld.ok).toBe(false);
    expect(nd.ok).toBe(false);
    expect(!ld.ok && ld.message).toContain('00000012, 00000007');
    expect(!nd.ok && nd.message).toContain('00000012, 00000007');
  });
  it('外盤檔缺欄位：兩版都拒絕', async () => {
    expect(legacyParseExternal(sheet('external-missing-col.xlsx')).ok).toBe(false);
    expect((await newRows('external-missing-col.xlsx', 'external')).ok).toBe(false);
  });
  it('FKS0701：標準欄位、含前綴欄位名稱一致；缺欄位兩版都拒絕', async () => {
    for (const name of ['fks0701.xlsx', 'fks0701-module1.xlsx', 'fks0701-prefixed.xlsx']) {
      const l = legacyParseFks(sheet(name));
      const n = await newRows(name, 'fks');
      expect(l.ok && n.ok, name).toBe(true);
      if (l.ok && n.ok) expect(n.value.map((r) => ({ 品號: r.品號, 品名: String(r.品名), 條碼: String(r.條碼), 盤點數量: r.盤點數量, 盤點儲位: r.盤點儲位 }))).toEqual(l.value);
    }
    expect(legacyParseFks(sheet('fks0701-missing-col.xlsx')).ok).toBe(false);
    expect((await newRows('fks0701-missing-col.xlsx', 'fks')).ok).toBe(false);
  });
  for (const name of ['pre-1.xlsx', 'pre-2.xlsx', 'pre-bad-columns.xlsx', 'pre-empty.xlsx', 'pre-nonnumeric.xlsx']) {
    it(`預盤 ${name}`, async () => {
      const l = legacyParsePre(sheet(name));
      const n = await newRows(name, 'pre');
      if (KNOWN_OTHER_DIFFS[name] && name !== 'pre-empty.xlsx') {
        expect(l.ok).toBe(true);
        expect(n.ok).toBe(false);
      } else {
        // pre-empty：兩版都拒絕（文字不同）
        expect(l.ok, name).toBe(n.ok);
        if (l.ok && n.ok) expect(n.value.map((r) => ({ 品號: r.品號, 盤點數量: r.盤點數量, 盤點儲位: r.盤點儲位 }))).toEqual(l.value);
      }
    });
  }
  it('外盤 Stock 明細：同品號同儲位加總，儲位為「外貨架-棚板」', async () => {
    const l = legacyParseModified(sheet('external-modified.xlsx'));
    const n = await newRows('external-modified.xlsx', 'modified');
    expect(l.ok && n.ok).toBe(true);
    if (l.ok && n.ok) {
      expect(n.value.map((r) => ({ 品號: r.品號, 盤點數量: r.盤點數量, 盤點儲位: r.盤點儲位 }))).toEqual(l.value.map((r) => ({ 品號: r.品號, 盤點數量: r.盤點數量, 盤點儲位: r.盤點儲位 })));
      expect(l.value.map((r) => [r.盤點儲位, r.盤點數量])).toEqual([['外1-2', 5], ['外2-1', 1]]);
    }
  });
});

describe('M6-W25 三模組端到端對跑（同一組自造檔，輸出逐列相等）', () => {
  async function loadAll() {
    const lb = legacyParseBase(sheet('base-1f.xlsx'));
    const nb = await newBase('base-1f.xlsx');
    if (!lb.ok || !nb.ok) throw new Error('基準檔應可讀');
    return { lb: lb.value, nb: nb.value };
  }
  it('模組一：應複盤清單相同（外盤 + FKS0701）', async () => {
    const { lb, nb } = await loadAll();
    const lExt = legacyParseExternal(sheet('external-original.xlsx'));
    const lFks = legacyParseFks(sheet('fks0701-module1.xlsx'));
    if (!lExt.ok || !lFks.ok) throw new Error('輸入應可讀');
    const legacy = legacyModule1(lb, lExt.value, lFks.value);
    const ext = normalize(await rowsFromBuffer(bytes('external-original.xlsx')), 'external');
    const fks = normalize(await rowsFromBuffer(bytes('fks0701-module1.xlsx')), 'fks');
    const x = integrate(nb, [...ext, ...fks]);
    const codes = new Set(x.diff.map((r) => r.品號));
    const mine = ext.filter((r) => codes.has(r.品號)).map((r) => ({ 品號: r.品號 }));
    expect(mine).toEqual(legacy);
    expect(mine.map((r) => r.品號)).toEqual(['00000009', '00000100']);
  });
  for (const withModified of [false, true]) {
    it(`模組二：有盤差／無盤差／未盤點相同（${withModified ? '含外盤 Stock 明細' : '預盤兩檔 + FKS0701'}）`, async () => {
      const { lb, nb } = await loadAll();
      const lPre = [legacyParsePre(sheet('pre-1.xlsx')), legacyParsePre(sheet('pre-2.xlsx'))].flatMap((r) => (r.ok ? r.value : []));
      const lFks = legacyParseFks(sheet('fks0701.xlsx'));
      const lMod = withModified ? legacyParseModified(sheet('external-modified.xlsx')) : { ok: true as const, value: [] };
      if (!lFks.ok || !lMod.ok) throw new Error('輸入應可讀');
      const legacy = legacyModule2(lb, lPre, lFks.value, lMod.value);
      const pre = [...normalize(await rowsFromBuffer(bytes('pre-1.xlsx')), 'pre'), ...normalize(await rowsFromBuffer(bytes('pre-2.xlsx')), 'pre')];
      const fks = normalize(await rowsFromBuffer(bytes('fks0701.xlsx')), 'fks');
      const mod = withModified ? normalize(await rowsFromBuffer(bytes('external-modified.xlsx')), 'modified') : [];
      const mine = integrate(nb, [...pre, ...fks, ...mod]);
      expect(mine.diff).toEqual(legacy.diff);
      // 舊版 zero 以「第一個盤差為 0 的列」去重，新版以品號加總；內容相同，順序以品號首次出現為準。
      expect(mine.zero).toEqual(legacy.zero);
      expect(mine.missing).toEqual(legacy.missing);
      if (!withModified) {
        expect(mine.diff.map((r) => [r.品號, r.盤差量])).toEqual([['00000007', -3]]);
        expect(mine.zero.map((r) => r.品號)).toEqual(['00000012', '00000345', '00000009']);
        expect(mine.missing.map((r) => r.品號)).toEqual(['02000215']);
      }
    });
  }
  it('模組三：改好的檔案合併後 5 筆、與舊版累加結果逐列相同（無衝突時）', async () => {
    const { lb, nb } = await loadAll();
    const lPre = [legacyParsePre(sheet('pre-1.xlsx')), legacyParsePre(sheet('pre-2.xlsx'))].flatMap((r) => (r.ok ? r.value : []));
    const lFks = legacyParseFks(sheet('fks0701.xlsx'));
    if (!lFks.ok) throw new Error('輸入應可讀');
    const l2 = legacyModule2(lb, lPre, lFks.value, []);
    const legacy = legacyModule3(l2.zero, X.utils.sheet_to_json(sheet('internal-edited.xlsx')), X.utils.sheet_to_json(sheet('missing-edited.xlsx')));
    const pre = [...normalize(await rowsFromBuffer(bytes('pre-1.xlsx')), 'pre'), ...normalize(await rowsFromBuffer(bytes('pre-2.xlsx')), 'pre')];
    const fks = normalize(await rowsFromBuffer(bytes('fks0701.xlsx')), 'fks');
    const m2 = integrate(nb, [...pre, ...fks]);
    const r = finalRows(m2.zero, normalize(await rowsFromBuffer(bytes('internal-edited.xlsx')), 'internal'), normalize(await rowsFromBuffer(bytes('missing-edited.xlsx')), 'missing'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toEqual(legacy);
    expect(legacy).toHaveLength(5);
  });
  it('模組三有衝突時：舊版不驗證直接累加（給出可疑結果），新版擋下（A2 核可差異）', async () => {
    const { lb, nb } = await loadAll();
    const lPre = [legacyParsePre(sheet('pre-1.xlsx')), legacyParsePre(sheet('pre-2.xlsx'))].flatMap((r) => (r.ok ? r.value : []));
    const lFks = legacyParseFks(sheet('fks0701.xlsx'));
    if (!lFks.ok) throw new Error('輸入應可讀');
    const l2 = legacyModule2(lb, lPre, lFks.value, []);
    const legacy = legacyModule3(l2.zero, X.utils.sheet_to_json(sheet('internal-conflict.xlsx')), X.utils.sheet_to_json(sheet('missing-conflict.xlsx')));
    expect(legacy.find((r) => r.品號 === '00000012')).toMatchObject({ 庫存量: 10, 實際量: 11, 盤差量: 1 });
    const pre = [...normalize(await rowsFromBuffer(bytes('pre-1.xlsx')), 'pre'), ...normalize(await rowsFromBuffer(bytes('pre-2.xlsx')), 'pre')];
    const fks = normalize(await rowsFromBuffer(bytes('fks0701.xlsx')), 'fks');
    const m2 = integrate(nb, [...pre, ...fks]);
    const r = finalRows(m2.zero, normalize(await rowsFromBuffer(bytes('internal-conflict.xlsx')), 'internal'), normalize(await rowsFromBuffer(bytes('missing-conflict.xlsx')), 'missing'));
    expect(r.ok).toBe(false);
  });
});

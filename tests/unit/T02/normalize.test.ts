import { describe, expect, it } from 'vitest';
import {
  compareRowSets,
  diffNormalized,
  matchesPattern,
  normalize,
  normalizeRows,
  pick,
  stableStringify,
  toBoolean,
  toDateString,
  toInstantString,
  toNumber,
} from '../../support/normalize';

describe('matchesPattern', () => {
  it('不含點的樣式比對任何層級的同名欄位', () => {
    expect(matchesPattern('updated_at', 'a.b.updated_at')).toBe(true);
    expect(matchesPattern('updated_at', 'updated_at')).toBe(true);
    expect(matchesPattern('updated_at', 'a.updated_at_x')).toBe(false);
  });
  it('含點的樣式從根完整比對，* 代表單層', () => {
    expect(matchesPattern('user.*.token', 'user.a.token')).toBe(true);
    expect(matchesPattern('user.*.token', 'x.user.a.token')).toBe(false);
    expect(matchesPattern('user.token', 'user.token')).toBe(true);
  });
});

describe('toDateString', () => {
  it('純日期格式一律轉 YYYY-MM-DD，不做時區位移', () => {
    expect(toDateString('2026-11-02')).toBe('2026-11-02');
    expect(toDateString('2026/11/2')).toBe('2026-11-02');
    expect(toDateString('20261102')).toBe('2026-11-02');
    expect(toDateString('２０２６-１１-０２')).toBe('2026-11-02');
    expect(toDateString('2026-11-02 09:30:00')).toBe('2026-11-02');
  });
  it('帶時區的時間點換算到 Asia/Taipei 的日曆日', () => {
    expect(toDateString('2026-11-01T16:30:00Z')).toBe('2026-11-02');
    expect(toDateString('2026-11-02T00:30:00+08:00')).toBe('2026-11-02');
    expect(toDateString('2026-11-02T00:30:00+0800')).toBe('2026-11-02');
    expect(toDateString('2026-11-01T16:30:00Z', 'UTC')).toBe('2026-11-01');
    expect(toDateString(new Date('2026-11-01T16:30:00Z'))).toBe('2026-11-02');
  });
  it('無法解析回傳 null', () => {
    expect(toDateString('not a date')).toBeNull();
    expect(toDateString('')).toBeNull();
    expect(toDateString(null)).toBeNull();
  });
});

describe('toInstantString', () => {
  it('不同表示法的同一時間點相等，毫秒捨去', () => {
    const a = toInstantString('2026-11-02T08:00:00.123+08:00');
    const b = toInstantString('2026-11-02T00:00:00Z');
    expect(a).toBe('2026-11-02T00:00:00Z');
    expect(b).toBe(a);
  });
  it('不帶時區視為台北當地時間', () => {
    expect(toInstantString('2026-11-02 08:00:00')).toBe('2026-11-02T00:00:00Z');
  });
});

describe('toNumber / toBoolean', () => {
  it('千分位、空白、全形、精度', () => {
    expect(toNumber('1,234.50')).toBe(1234.5);
    expect(toNumber(' １２３ ')).toBe(123);
    expect(toNumber(0.1 + 0.2)).toBe(0.3);
    expect(toNumber('-0')).toBe(0);
    expect(toNumber(10.126, 2)).toBe(10.13);
  });
  it('非數字回傳 null', () => {
    expect(toNumber('abc')).toBeNull();
    expect(toNumber('')).toBeNull();
    expect(toNumber(NaN)).toBeNull();
  });
  it('布林常見寫法', () => {
    expect(toBoolean('是')).toBe(true);
    expect(toBoolean('F')).toBe(false);
    expect(toBoolean(1)).toBe(true);
    expect(toBoolean('maybe')).toBeNull();
  });
});

describe('normalize', () => {
  it('undefined / 空字串 / 純空白視為 null（預設），可關閉', () => {
    expect(normalize({ a: '', b: '  ', c: undefined, d: null })).toEqual({ a: null, b: null, c: null, d: null });
    expect(normalize({ a: '' }, { emptyAsNull: false })).toEqual({ a: '' });
  });

  it('欄位改名與忽略（含巢狀、* 與同名欄位）', () => {
    const legacy = { store_code: 'VW001', updated_at: 'x', nested: { workspace_version: 3, v: 1 } };
    const native = { storeCode: 'VW001', updated_at: 'y', nested: { workspace_version: 4, v: 1 } };
    const rules = { rename: { storeCode: 'store_code' }, ignore: ['updated_at', 'workspace_version'] };
    expect(normalize(legacy, rules)).toEqual(normalize(native, rules));
    expect(normalize(legacy, rules)).toEqual({ nested: { v: 1 }, store_code: 'VW001' });
  });

  it('日期、時間點、數字、布林欄位依規則正規化（陣列內亦同）', () => {
    const rows = [{ id: 1, d: '2026/11/2', t: '2026-11-02T08:00:00+08:00', n: '1,000', ok: 't', free: 'keep' }];
    const out = normalize<Record<string, unknown>[]>(rows, {
      dateFields: ['d'],
      datetimeFields: ['t'],
      numberFields: ['n'],
      booleanFields: ['ok'],
    });
    expect(out[0]).toEqual({ id: 1, d: '2026-11-02', t: '2026-11-02T00:00:00Z', n: 1000, ok: true, free: 'keep' });
  });

  it('無法解析的日期與數字保留原值（交給比對顯示差異），不丟資料', () => {
    expect(normalize({ d: '未定', n: 'N/A' }, { dateFields: ['d'], numberFields: ['n'] })).toEqual({ d: '未定', n: 'N/A' });
  });

  it('未宣告的欄位不會把字串數字轉型（例如員編 007）', () => {
    expect(normalize({ code: '007' })).toEqual({ code: '007' });
  });

  it('陣列排序：sortBy 鍵、無鍵的物件陣列、純量陣列；keepOrder 保留順序', () => {
    const a = { rows: [{ id: 2 }, { id: 1 }], tags: ['b', 'a'], steps: ['x', 'a'] };
    const b = { rows: [{ id: 1 }, { id: 2 }], tags: ['a', 'b'], steps: ['x', 'a'] };
    const rules = { sortBy: { rows: 'id' }, keepOrder: ['steps'] };
    expect(normalize(a, rules)).toEqual(normalize(b, rules));
    expect(normalize({ steps: ['x', 'a'] }, { keepOrder: ['steps'] })).toEqual({ steps: ['x', 'a'] });
    expect(normalize([{ b: 1 }, { a: 1 }])).toEqual(normalize([{ a: 1 }, { b: 1 }]));
    expect(normalize([3, 1, 2])).toEqual([1, 2, 3]);
    expect(normalize([3, 1, 2], { keepAllOrder: true })).toEqual([3, 1, 2]);
  });

  it('根陣列用 sortBy 的空字串鍵指定排序欄位', () => {
    expect(normalize([{ k: 'b' }, { k: 'a' }], { sortBy: { '': 'k' } })).toEqual([{ k: 'a' }, { k: 'b' }]);
  });

  it('不修改輸入', () => {
    const input = { a: [{ n: '1' }], z: 1 };
    const copy = JSON.parse(JSON.stringify(input));
    normalize(input, { numberFields: ['n'] });
    expect(input).toEqual(copy);
  });

  it('normalizeRows 要求陣列', () => {
    expect(() => normalizeRows({} as unknown)).toThrow(TypeError);
  });
});

describe('diffNormalized', () => {
  it('相同回傳空；列出 changed / only-legacy / only-native / count / type', () => {
    expect(diffNormalized({ a: 1 }, { a: 1 })).toEqual([]);
    const d = diffNormalized({ a: 1, b: 2, c: [1, 2], t: [] }, { a: 9, d: 4, c: [1], t: {} });
    const kinds = Object.fromEntries(d.map((x) => [x.path, x.kind]));
    expect(kinds).toEqual({ a: 'changed', b: 'only-legacy', c: 'count', d: 'only-native', t: 'type' });
  });
  it('null 與 undefined 經正規化後相等', () => {
    expect(diffNormalized(normalize({ a: undefined }), normalize({ a: null }))).toEqual([]);
  });
});

describe('compareRowSets', () => {
  const l = [{ id: 'A', v: 1 }, { id: 'B', v: 2 }, { id: 'C', v: 3 }];
  const n = [{ id: 'A', v: 1 }, { id: 'B', v: 9 }, { id: 'D', v: 4 }];
  it('以鍵配對：僅一邊有、欄位差異、筆數', () => {
    const r = compareRowSets(l, n, 'id');
    expect(r.onlyLegacy).toEqual(['C']);
    expect(r.onlyNative).toEqual(['D']);
    expect(r.fieldDiffs).toEqual([{ key: 'B', diffs: [{ kind: 'changed', path: 'v', legacy: 2, native: 9 }] }]);
    expect(r.legacyCount).toBe(3);
  });
  it('複合鍵與重複鍵偵測', () => {
    const r = compareRowSets([{ a: 1, b: 2 }, { a: 1, b: 2 }], [{ a: 1, b: 2 }], ['a', 'b']);
    expect(r.duplicateKeys).toEqual([{ side: 'legacy', key: '1|2' }]);
  });
});

describe('其他', () => {
  it('stableStringify 與鍵順序無關', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [1, { c: 2, d: 1 }], b: 1 }));
  });
  it('pick 取點路徑', () => {
    expect(pick({ a: { b: [1] } }, 'a.b')).toEqual([1]);
    expect(pick({ a: null }, 'a.b')).toBeUndefined();
    expect(pick(5)).toBe(5);
  });
});

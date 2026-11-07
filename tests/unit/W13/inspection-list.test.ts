import { describe, expect, it } from 'vitest';
import {
  FINISHED_STATUSES,
  inspectionStats,
  latestDataMonth,
  legacyRlsAllows,
  listScopeFor,
  rowInListScope,
} from '@/lib/workspace/inspection-list';
import { inspectionCoverage } from '@/lib/workspace/inspection-coverage';

// W13 單元層（M4 Q1–Q4）：統計口徑、預設月份、可見範圍（舊版聯集）、已巡店／尚未巡店名單。

const rec = (status: string, grade: string | number | null) => ({ status, grade });

describe('Q2 統計只算已完成（等級分段新舊相同）', () => {
  const rows = [rec('completed', '10'), rec('completed', '8'), rec('completed', '7'), rec('completed', '6'), rec('completed', '5'), rec('closed', '0'), rec('draft', null), rec('in_progress', '3')];
  it('新版：草稿與進行中不列入任何一格', () => {
    expect(inspectionStats(rows)).toEqual({ total: 6, excellent: 2, good: 2, improve: 2 });
  });
  it('舊版口徑（includeDrafts）：草稿 grade 空值被當 0 算進「需改善」', () => {
    expect(inspectionStats(rows, true)).toEqual({ total: 8, excellent: 2, good: 2, improve: 4 });
  });
  it('只有已完成的資料時，新舊同輸入同輸出', () => {
    const done = rows.filter((r) => (FINISHED_STATUSES as readonly string[]).includes(r.status));
    expect(inspectionStats(done)).toEqual(inspectionStats(done, true));
  });
  it('等級邊界：8、6 歸上一段；5 歸需改善', () => {
    expect(inspectionStats([rec('completed', 8)]).excellent).toBe(1);
    expect(inspectionStats([rec('completed', '7')]).good).toBe(1);
    expect(inspectionStats([rec('completed', 6)]).good).toBe(1);
    expect(inspectionStats([rec('completed', 5)]).improve).toBe(1);
  });
});

describe('Q4 預設最新有資料的月份', () => {
  const now = new Date('2026-11-02T01:00:00Z'); // 台灣 2026-11-02
  it('取最新一筆所在月份（月初也停在上個月）', () => {
    expect(latestDataMonth(['2026-09-30', '2026-10-28', '2026-08-01'], now)).toBe('2026-10');
  });
  it('完全沒資料才用本月（台灣日期）', () => {
    expect(latestDataMonth([], now)).toBe('2026-11');
    expect(latestDataMonth([null, undefined, ''], now)).toBe('2026-11');
    expect(latestDataMonth([], new Date('2026-10-31T17:00:00Z'))).toBe('2026-11'); // 台灣已跨月
  });
  it('日期帶時間字串也能取月份', () => {
    expect(latestDataMonth(['2026-10-05T00:00:00+00:00'], now)).toBe('2026-10');
  });
});

describe('Q3 可見範圍＝舊版 RLS 聯集（逐一組合對照）', () => {
  const me = 'user-me';
  const assigned = ['s-assigned'];
  const rows = [
    { name: '自己建立（指派門市）', inspector_id: me, store_id: 's-assigned' },
    { name: '自己建立（非指派門市）', inspector_id: me, store_id: 's-other' },
    { name: '他人建立（指派門市）', inspector_id: 'u2', store_id: 's-assigned' },
    { name: '他人建立（非指派門市）', inspector_id: 'u2', store_id: 's-other' },
    { name: '沒有巡店人（指派門市）', inspector_id: null, store_id: 's-assigned' },
  ];
  for (const viewAll of [false, true])
    for (const viewStore of [false, true])
      for (const viewOwn of [false, true]) {
        const label = `view_all=${viewAll} view_store=${viewStore} view_own=${viewOwn}`;
        it(label, () => {
          const has = (c: string) => ({ 'inspection.view_all': viewAll, 'inspection.view_store': viewStore, 'inspection.view_own': viewOwn } as Record<string, boolean>)[c] || false;
          const scope = listScopeFor(has, assigned);
          for (const row of rows) {
            expect(rowInListScope(scope, row, me), `${label}：${row.name}`).toBe(
              legacyRlsAllows({ viewAll, viewStore, viewOwn }, assigned, row, me),
            );
          }
        });
      }
  it('重點：只有「查看自己」也看得到被指派門市他人的單；只有「查看門市」也看得到自己在非指派門市建立的單', () => {
    const ownOnly = listScopeFor((c) => c === 'inspection.view_own', assigned);
    expect(rowInListScope(ownOnly, rows[2], me)).toBe(true);
    expect(rowInListScope(ownOnly, rows[3], me)).toBe(false);
    const storeOnly = listScopeFor((c) => c === 'inspection.view_store', assigned);
    expect(rowInListScope(storeOnly, rows[1], me)).toBe(true);
  });
});

describe('已巡店／尚未巡店（Q2：草稿不算已巡店，另標有草稿未送出）', () => {
  const stores = [
    { id: 'a', store_name: '甲店' },
    { id: 'b', store_name: '乙店' },
    { id: 'c', store_name: '丙店' },
  ];
  const lineage = stores.map((s) => ({ id: s.id, source_store_id: null }));
  const history = [
    { store_id: 'a', status: 'completed', store: { store_name: '甲店' } },
    { store_id: 'b', status: 'draft', store: { store_name: '乙店' } },
    { store_id: 'b', status: 'in_progress', store: { store_name: '乙店' } },
  ];
  it('新版：乙店只有草稿 → 留在尚未巡店並標 has_draft', () => {
    const r = inspectionCoverage(stores, history, lineage);
    expect(r.visited.map((s) => s.id)).toEqual(['a']);
    expect(r.unvisited.map((s) => [s.id, s.has_draft])).toEqual([['b', true], ['c', false]]);
  });
  it('舊版口徑（includeDrafts）：乙店被當成已巡店', () => {
    const r = inspectionCoverage(stores, history, lineage, true);
    expect(r.visited.map((s) => s.id)).toEqual(['a', 'b']);
    expect(r.unvisited.map((s) => s.id)).toEqual(['c']);
  });
  it('乙店既有已完成又有草稿：算已巡店', () => {
    const r = inspectionCoverage(stores, [...history, { store_id: 'b', status: 'closed', store: { store_name: '乙店' } }], lineage);
    expect(r.visited.map((s) => s.id)).toEqual(['a', 'b']);
  });
  it('沿革追溯（source_store_id）與同名備援照舊', () => {
    const r = inspectionCoverage(
      [{ id: 'new', store_name: '新址店' }],
      [{ store_id: 'old', status: 'completed', store: { store_name: '舊名' } }],
      [{ id: 'new', source_store_id: 'old' }, { id: 'old', source_store_id: null }],
    );
    expect(r.visited.map((s) => s.id)).toEqual(['new']);
    const byName = inspectionCoverage(
      [{ id: 'x', store_name: '同 名店' }],
      [{ store_id: 'y', status: 'completed', store: { store_name: '同名店' } }],
      [],
    );
    expect(byName.visited.map((s) => s.id)).toEqual(['x']);
  });
});

import { describe, expect, it } from 'vitest';
import { sweeper } from '../T00/helpers';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(__filename);
const targets = nodeRequire('../../support/sweep-targets.cjs') as {
  RESERVED_PERFORMANCE_YEAR: number;
  RESERVED_YEAR_TABLES: { table: string; column: string; op: string; value: unknown }[];
  TEST_STORE_SETTING_TABLES: { table: string }[];
};

// W03：2038 年績效測試資料的清除（sweeper 目標）。
//  - 測試門市（VW/ZT）的 store_performance(year=2038)、monthly_prescription_reports／monthly_bonus_records(2038-xx)、
//    store_performance_thresholds 一律清除；
//  - 非測試門市出現 2038 年資料：整體中止、不刪除；
//  - 非測試門市的閾值設定（真實設定）完全不碰。

type Row = { store_id: string | null };
interface Op {
  table: string;
  kind: 'select' | 'delete';
  filters: [string, unknown[]][];
}

function db(rows: Record<string, Row[]>) {
  const ops: Op[] = [];
  const stores = [
    { id: 'id-zt1', store_code: 'ZT01' },
    { id: 'id-vw1', store_code: 'VW001' },
  ];
  return {
    ops,
    db: {
      from(table: string) {
        const op: Op = { table, kind: 'select', filters: [] };
        ops.push(op);
        const proxy: unknown = new Proxy({}, {
          get(_t, prop: string) {
            if (prop === 'then') {
              return (resolve: (v: unknown) => void) => {
                if (table === 'stores') return resolve({ data: stores, error: null });
                const inFilter = op.filters.find(([n]) => n === 'in');
                const set = inFilter ? new Set(inFilter[1][1] as string[]) : null;
                const data = (rows[table] ?? []).filter((r) => !set || set.has(r.store_id as string));
                return resolve({ data, error: null });
              };
            }
            return (...args: unknown[]) => {
              if (prop === 'delete') op.kind = 'delete';
              else op.filters.push([prop, args]);
              return proxy;
            };
          },
        });
        return proxy;
      },
    },
  };
}

describe('保留年份 2038 的 sweeper 目標', () => {
  it('目標表與條件', () => {
    expect(targets.RESERVED_PERFORMANCE_YEAR).toBe(2038);
    expect(targets.RESERVED_YEAR_TABLES.map((t) => `${t.table}:${t.column}:${t.op}:${t.value}`)).toEqual([
      'store_performance:year:eq:2038',
      'monthly_prescription_reports:year_month:like:2038-%',
      'monthly_bonus_records:year_month:like:2038-%',
    ]);
    expect(targets.TEST_STORE_SETTING_TABLES.map((t) => t.table)).toEqual(['store_performance_thresholds']);
  });

  it('只有測試門市：刪除，且刪除條件帶年份與測試門市 id', async () => {
    const f = db({
      store_performance: [{ store_id: 'id-zt1' }, { store_id: 'id-zt1' }],
      monthly_prescription_reports: [{ store_id: 'id-vw1' }],
      store_performance_thresholds: [{ store_id: 'id-zt1' }],
    });
    const r = await sweeper.sweepReservedMonths(f.db);
    expect(r.foreign).toEqual([]);
    expect(r.deleted).toBe(4);
    const del = f.ops.filter((o) => o.kind === 'delete');
    expect(del.map((o) => o.table).sort()).toEqual(['monthly_prescription_reports', 'store_performance', 'store_performance_thresholds']);
    const perf = del.find((o) => o.table === 'store_performance')!;
    expect(perf.filters).toContainEqual(['eq', ['year', 2038]]);
    expect(perf.filters).toContainEqual(['in', ['store_id', ['id-zt1', 'id-vw1']]]);
    const rx = del.find((o) => o.table === 'monthly_prescription_reports')!;
    expect(rx.filters).toContainEqual(['like', ['year_month', '2038-%']]);
  });

  it('2038 年出現非測試門市的績效資料：整體中止，不刪除任何表', async () => {
    const f = db({
      store_performance: [{ store_id: 'id-zt1' }, { store_id: 'real-store' }],
      monthly_bonus_records: [{ store_id: 'id-zt1' }],
    });
    const r = await sweeper.sweepReservedMonths(f.db);
    expect(r.foreign).toEqual([{ table: 'store_performance', rows: 1 }]);
    expect(r.deleted).toBe(0);
    expect(f.ops.some((o) => o.kind === 'delete')).toBe(false);
  });

  it('非測試門市的閾值設定不碰、也不算 foreign（只查測試門市）', async () => {
    const f = db({ store_performance_thresholds: [{ store_id: 'real-store' }] });
    const r = await sweeper.sweepReservedMonths(f.db);
    expect(r.foreign).toEqual([]);
    expect(r.deleted).toBe(0);
    expect(f.ops.some((o) => o.kind === 'delete')).toBe(false);
    const read = f.ops.find((o) => o.table === 'store_performance_thresholds' && o.kind === 'select')!;
    expect(read.filters).toContainEqual(['in', ['store_id', ['id-zt1', 'id-vw1']]]);
  });

  it('dryRun（scan／check）只回報不刪除', async () => {
    const f = db({ store_performance: [{ store_id: 'id-zt1' }] });
    const r = await sweeper.sweepReservedMonths(f.db, { dryRun: true });
    expect(r.tables.find((t: { table: string }) => t.table === 'store_performance').testRows).toBe(1);
    expect(f.ops.some((o) => o.kind === 'delete')).toBe(false);
  });

  it('2038 不得出現在登錄表的 values（仍是長駐基準年度）', () => {
    expect(sweeper.evaluateEntry({ table: 'store_performance', column: 'id', values: [2038], recordedAt: 'x' }).safe).toBe(false);
  });
});

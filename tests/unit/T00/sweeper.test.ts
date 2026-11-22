import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registry, sweeper } from './helpers';

type Call = { table: string; ops: Array<[string, unknown[]]> };

/** 可鏈式的假 Supabase client：每個呼叫都記錄，await 時回傳預設結果。 */
function fakeDb(result: { data?: unknown[]; count?: number; error?: { message: string } | null } = {}) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const chain: Record<string, unknown> = {};
      const proxy: unknown = new Proxy(chain, {
        get(_t, prop: string) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) =>
              resolve({ data: result.data ?? [], count: result.count ?? 0, error: result.error ?? null });
          }
          return (...args: unknown[]) => {
            call.ops.push([prop, args]);
            return proxy;
          };
        },
      });
      return proxy;
    },
  };
  return { db, calls };
}

function tmpReports() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sweeper-'));
}

describe('sweeper 安全規則', () => {
  it('isTestMarker：認得測試標記、拒絕長駐基準資料', () => {
    expect(sweeper.isTestMarker('ZTT20261102-ab12001')).toBe(true);
    expect(sweeper.isTestMarker('[自動測試] 活動')).toBe(true);
    expect(sweeper.isTestMarker('2099-11')).toBe(true);
    expect(sweeper.isTestMarker(2038)).toBe(false);
    expect(sweeper.isTestMarker('2038')).toBe(false);
    for (const baseline of ['VW001', 'VW002', 'ZT01', 'ZT05']) expect(sweeper.isTestMarker(baseline)).toBe(false);
    expect(sweeper.isTestMarker('A12345')).toBe(false);
    expect(sweeper.isTestMarker('2026-11')).toBe(false);
  });

  it('evaluateEntry：非 id 欄位的值必須帶標記；基準資料與不合法名稱一律拒絕', () => {
    const base = { table: 'store_transfer_requests', column: 'employee_code', values: ['ZTT20261102-ab12001'] };
    expect(sweeper.evaluateEntry(base).safe).toBe(true);
    expect(sweeper.evaluateEntry({ ...base, values: ['A12345'] }).safe).toBe(false);
    expect(sweeper.evaluateEntry({ ...base, values: ['ZTT20261102-ab12001', 'A12345'] }).safe).toBe(false);
    expect(sweeper.evaluateEntry({ table: 'store_transfer_requests', column: 'id', values: ['ZT01'], recordedAt: 'x' }).safe).toBe(false);
    expect(sweeper.evaluateEntry({ table: 'stores; drop', column: 'id', values: ['x'] }).safe).toBe(false);
    expect(sweeper.evaluateEntry({ table: 'store_transfer_requests', column: 'id', values: [], recordedAt: 'x' }).safe).toBe(false);
    const okId = { table: 'store_transfer_requests', column: 'id', values: ['11111111-1111-1111-1111-111111111111'] };
    expect(sweeper.evaluateEntry({ ...okId, recordedAt: '2026-11-02T00:00:00Z' }).safe).toBe(true);
    expect(sweeper.evaluateEntry(okId).safe).toBe(false);
  });

  it('evaluateEntry：不在白名單的表（profiles/roles/role_permissions/user_roles）與 2038 一律拒絕', () => {
    for (const table of ['profiles', 'roles', 'role_permissions', 'user_roles']) {
      expect(sweeper.evaluateEntry({ table, column: 'id', values: ['u1'], recordedAt: 'x' }).safe).toBe(false);
    }
    expect(sweeper.evaluateEntry({ table: 'monthly_store_summary', column: 'year', values: [2038] }).safe).toBe(false);
    expect(sweeper.evaluateEntry({ table: 'monthly_store_summary', column: 'id', values: ['2038'], recordedAt: 'x' }).safe).toBe(false);
  });
});

describe('sweeper runSweeper（假 DB，不連線）', () => {
  it('scan 不刪除任何資料，但回報登錄表中的孤兒數', async () => {
    const reportsRoot = tmpReports();
    const reg = registry.createRegistry({ runId: 'T20261102-aaaa', reportsRoot });
    reg.record({ table: 'store_transfer_requests', column: 'id', values: ['u1', 'u2'] });
    const { db, calls } = fakeDb();
    const result = await sweeper.runSweeper({ db, reportsRoot, mode: 'scan' });
    expect(result.registry.entriesPending).toBe(1);
    expect(result.orphanCount).toBeGreaterThanOrEqual(1);
    expect(calls.some((c) => c.ops.some(([op]) => op === 'delete'))).toBe(false);
  });

  it('sweep 依 created.json 刪除並標記 cleaned，之後孤兒歸零', async () => {
    const reportsRoot = tmpReports();
    const reg = registry.createRegistry({ runId: 'T20261102-bbbb', reportsRoot });
    reg.record({ table: 'store_transfer_requests', column: 'id', values: ['u1'] });
    const { db, calls } = fakeDb({ data: [{ id: 'u1' }], count: 0 });
    const result = await sweeper.runSweeper({ db, reportsRoot, mode: 'sweep', phase: 'post' });
    expect(result.registry.deleted).toBeGreaterThanOrEqual(1);
    expect(result.orphanCount).toBe(0);
    expect(calls.some((c) => c.table === 'store_transfer_requests' && c.ops.some(([op]) => op === 'delete'))).toBe(true);
    expect(registry.readCreated(reg.file).entries[0].status).toBe('cleaned');
  });

  it('不帶標記的登錄項目被拒絕、不執行刪除，且計入孤兒', async () => {
    const reportsRoot = tmpReports();
    const reg = registry.createRegistry({ runId: 'T20261102-cccc', reportsRoot });
    reg.record({ table: 'store_transfer_requests', column: 'employee_code', values: ['A12345'] });
    const { db, calls } = fakeDb();
    const result = await sweeper.runSweeper({ db, reportsRoot, mode: 'sweep' });
    expect(result.registry.refused).toBe(1);
    expect(result.orphanCount).toBeGreaterThanOrEqual(1);
    expect(calls.some((c) => c.table === 'store_transfer_requests' && c.ops.some(([op]) => op === 'delete'))).toBe(false);
    expect(registry.readCreated(reg.file).entries[0].status).toBe('refused');
  });

  it('標記掃描的查詢一律排除長駐基準資料', async () => {
    const { db, calls } = fakeDb({ count: 2 });
    const result = await sweeper.runSweeper({ db, reportsRoot: tmpReports(), mode: 'scan' });
    expect(result.markers.length).toBeGreaterThan(0);
    const notOps = calls.flatMap((c) => c.ops).filter(([op]) => op === 'not');
    expect(notOps.length).toBeGreaterThan(0);
    for (const [, args] of notOps) expect(String(args[2])).toContain('VW001');
  });

  it('registry.record 拒絕不合法的 table 與空 values', () => {
    const reg = registry.createRegistry({ runId: 'T20261102-dddd', reportsRoot: tmpReports() });
    expect(() => reg.record({ table: 'a b', values: ['x'] })).toThrow();
    expect(() => reg.record({ table: 'store_transfer_requests', values: [] })).toThrow();
    expect(() => reg.record({ table: 'profiles', values: ['u1'] })).toThrow();
    expect(() => reg.record({ table: 'user_roles', column: 'id', values: ['u1'] })).toThrow();
    expect(() => registry.createRegistry({ runId: 'bad', reportsRoot: tmpReports() })).toThrow();
  });
});

/** 依表名回傳不同資料的假 DB，並記錄 delete 的表與 in() 條件。 */
function reservedDb(opts: { stores?: Array<{ id: string; store_code: string }>; rows: Record<string, Array<{ store_id: string | null }>> }) {
  const deletes: Array<{ table: string; inArgs: unknown[] }> = [];
  const stores = opts.stores ?? [
    { id: 'id-vw1', store_code: 'VW001' },
    { id: 'id-zt1', store_code: 'ZT01' },
  ];
  const db = {
    from(table: string) {
      let isDelete = false;
      const inArgs: unknown[] = [];
      const proxy: unknown = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => {
              if (table === 'stores') return resolve({ data: stores, error: null });
              if (isDelete) {
                deletes.push({ table, inArgs });
                const set = new Set(inArgs[1] as string[]);
                return resolve({ data: (opts.rows[table] ?? []).filter((r) => set.has(r.store_id as string)), error: null });
              }
              return resolve({ data: opts.rows[table] ?? [], error: null });
            };
          }
          return (...args: unknown[]) => {
            if (prop === 'delete') isDelete = true;
            if (prop === 'in' && isDelete) inArgs.push(...args);
            return proxy;
          };
        },
      });
      return proxy;
    },
  };
  return { db, deletes };
}

describe('保留月份 2099-xx 清除', () => {
  it('只有測試門市的資料：刪除並回報筆數，只以測試門市 id 為條件', async () => {
    const { db, deletes } = reservedDb({
      rows: {
        monthly_store_summary: [{ store_id: 'id-vw1' }, { store_id: 'id-zt1' }],
        support_staff_bonus: [{ store_id: 'id-zt1' }],
      },
    });
    const r = await sweeper.sweepReservedMonths(db);
    expect(r.foreign).toEqual([]);
    expect(r.deleted).toBe(3);
    expect(deletes.map((d) => d.table).sort()).toEqual(['monthly_store_summary', 'support_staff_bonus']);
    for (const d of deletes) expect(d.inArgs).toEqual(['store_id', ['id-vw1', 'id-zt1']]);
  });

  it('出現非測試門市（含 store_id 為空）的資料：不刪除任何表並列出表名與筆數', async () => {
    const { db, deletes } = reservedDb({
      rows: {
        monthly_store_summary: [{ store_id: 'id-vw1' }],
        meal_allowance_records: [{ store_id: 'real-store' }, { store_id: null }, { store_id: 'id-zt1' }],
      },
    });
    const r = await sweeper.sweepReservedMonths(db);
    expect(r.foreign).toEqual([{ table: 'meal_allowance_records', rows: 2 }]);
    expect(r.deleted).toBe(0);
    expect(deletes).toEqual([]);
  });

  it('dryRun 只回報不刪除', async () => {
    const { db, deletes } = reservedDb({ rows: { monthly_store_summary: [{ store_id: 'id-vw1' }] } });
    const r = await sweeper.sweepReservedMonths(db, { dryRun: true });
    expect(r.tables.find((t: { table: string }) => t.table === 'monthly_store_summary').testRows).toBe(1);
    expect(deletes).toEqual([]);
  });

  it('runSweeper(sweep)：測試門市資料被清除並寫入 reservedMonthsDeleted；有非測試門市資料時 reservedMonthsNonEmpty', async () => {
    const ok = reservedDb({ rows: { talent_cultivation_bonus: [{ store_id: 'id-zt1' }] } });
    const r1 = await sweeper.runSweeper({ db: ok.db, reportsRoot: tmpReports(), mode: 'sweep', phase: 'pre' });
    expect(r1.reservedMonthsDeleted).toBe(1);
    expect(r1.reservedMonthsNonEmpty).toBe(false);

    const bad = reservedDb({ rows: { talent_cultivation_bonus: [{ store_id: 'real-store' }] } });
    const r2 = await sweeper.runSweeper({ db: bad.db, reportsRoot: tmpReports(), mode: 'check' });
    expect(r2.reservedMonthsNonEmpty).toBe(true);
    expect(r2.reservedMonthsForeign).toEqual([{ table: 'talent_cultivation_bonus', rows: 1 }]);
    expect(bad.deletes).toEqual([]);
  });
});

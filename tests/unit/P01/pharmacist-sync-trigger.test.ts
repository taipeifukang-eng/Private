import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {
  buildSyncTriggerOrFilter,
  formatTaiwanDateTime,
  hasSyncTriggeringMovement,
  movementTriggersSync,
  taiwanDateOf,
} from '../../../lib/pharmacist/sync-trigger';
import { hasMissingPharmacistCarry } from '../../../lib/pharmacist-snapshot-carry';

// P01 藥師同步漏同步修正（對齊舊版 fix/pharmacist-sync-triggers）：
//  - 三條件（新登錄、事後修改、生效日到了）任一成立就重新同步；沒變動就跳過；關帳月份不動。
//  - sync log 記同步開始時間；判斷查詢失敗時降級為同步；快照備註不重複累加。
// 這裡直接取出 Vue 工作台 lib/workspace/pharmacist-overview.ts 的 ensureSnapshotForMonth 原始碼，用假資料庫執行。

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const LAST = '2026-10-30T11:44:00Z'; // 台灣 10/30 19:44
const base = { created_at: '2026-10-30T02:11:00Z', updated_at: '2026-10-30T02:11:00Z', movement_date: '2026-11-02' };

describe('純函式：台灣日期與三條件', () => {
  it('taiwanDateOf 跨 UTC 午夜、formatTaiwanDateTime 顯示台灣時間', () => {
    expect(taiwanDateOf('2026-10-30T15:59:59Z')).toBe('2026-10-30');
    expect(taiwanDateOf('2026-10-30T16:00:00Z')).toBe('2026-10-31');
    expect(formatTaiwanDateTime('2026-10-30T20:05:00+00:00')).toBe('2026-10-31 04:05');
    expect(formatTaiwanDateTime('garbage')).toBe('');
  });
  it('提前登錄：生效日當天才觸發，之前不觸發', () => {
    expect(movementTriggersSync(base, LAST, '2026-11-01')).toBe(false);
    expect(movementTriggersSync(base, LAST, '2026-11-02')).toBe(true);
  });
  it('(a) 新登錄、(b) 事後修改各自觸發', () => {
    expect(movementTriggersSync({ ...base, created_at: '2026-10-30T12:00:00Z', movement_date: '2026-10-01' }, LAST, '2026-11-06')).toBe(true);
    expect(movementTriggersSync({ ...base, updated_at: '2026-10-31T00:00:00Z', movement_date: '2026-10-01' }, LAST, '2026-11-06')).toBe(true);
  });
  it('(c) 邊界：上次同步的台灣日期不含、今天含、明天不含', () => {
    const old = { created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' };
    expect(movementTriggersSync({ ...old, movement_date: '2026-10-30' }, LAST, '2026-11-06')).toBe(false);
    expect(movementTriggersSync({ ...old, movement_date: '2026-10-31' }, LAST, '2026-11-06')).toBe(true);
    expect(movementTriggersSync({ ...old, movement_date: '2026-11-06' }, LAST, '2026-11-06')).toBe(true);
    expect(movementTriggersSync({ ...old, movement_date: '2026-11-07' }, LAST, '2026-11-06')).toBe(false);
  });
  it('沒有變動就跳過', () => {
    expect(movementTriggersSync({ ...base, movement_date: '2026-10-20' }, LAST, '2026-11-06')).toBe(false);
  });
  it('or 字串與時區無關（+00:00 會轉成 Z）', () => {
    expect(buildSyncTriggerOrFilter('2026-10-30T11:44:00+00:00', '2026-11-06')).toBe(
      'created_at.gt.2026-10-30T11:44:00.000Z,updated_at.gt.2026-10-30T11:44:00.000Z,and(movement_date.gt.2026-10-30,movement_date.lte.2026-11-06)',
    );
  });
});

describe('hasSyncTriggeringMovement：查詢組成與錯誤處理', () => {
  function recorder(result: { count?: number | null; error?: unknown }) {
    const calls: [string, ...unknown[]][] = [];
    const q: any = new Proxy({}, {
      get(_t, name: string) {
        if (name === 'then') return (res: any) => Promise.resolve(result).then(res);
        return (...args: unknown[]) => { calls.push([name, ...args]); return q; };
      },
    });
    return { client: { from: (t: string) => { calls.push(['from', t]); return q; } }, calls };
  }
  const opts = { lastSyncedAt: LAST, today: '2026-11-06', movementTypes: ['resignation'], rangeStart: '2026-01-01', rangeEnd: '2026-11-06' };
  it('帶入類型、範圍、or 條件；有門市／員編範圍才加 in', async () => {
    const a = recorder({ count: 1 });
    expect(await hasSyncTriggeringMovement(a.client, opts)).toBe(true);
    expect(a.calls).toContainEqual(['or', buildSyncTriggerOrFilter(LAST, '2026-11-06')]);
    expect(a.calls.some((c) => c[0] === 'in' && c[1] === 'store_id')).toBe(false);
    const b = recorder({ count: 0 });
    expect(await hasSyncTriggeringMovement(b.client, { ...opts, storeIds: ['s1'], employeeCodes: ['E1'] })).toBe(false);
    expect(b.calls).toContainEqual(['in', 'store_id', ['s1']]);
    expect(b.calls).toContainEqual(['in', 'employee_code', ['E1']]);
  });
  it('查詢錯誤往上丟（由呼叫端降級為同步）', async () => {
    const c = recorder({ error: new Error('boom') });
    await expect(hasSyncTriggeringMovement(c.client, opts)).rejects.toThrow('boom');
  });
});

describe('Vue 工作台 ensureSnapshotForMonth：行為（假資料庫）', () => {
  const source = read('lib/workspace/pharmacist-overview.ts');
  const strip = (s: string) => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const fnStart = source.indexOf('  async function ensureSnapshotForMonth(');
  const fnEnd = source.indexOf('\n  let currentRowsRaw:', fnStart);
  const noteStart = source.indexOf('export function appendNote(');
  const noteSrc = strip(source.slice(noteStart + 'export '.length).match(/^[\s\S]*?\n\}/)![0]);
  const fnSrc = strip(source.slice(fnStart, fnEnd));

  const MONTH = '2026-09';
  const SYNC0 = '2026-09-10T04:00:00Z'; // 台灣 9/10 12:00
  const OLD = '2026-09-05T02:00:00Z';

  type Opts = { movements?: any[]; locked?: boolean; triggerError?: boolean; advanceOnWrite?: number };
  function fixture(o: Opts = {}) {
    const tables: Record<string, any[]> = {
      pharmacist_monthly_snapshot: [
        { id: 'aug', year_month: '2026-08', store_id: '0008', employee_code: 'FKPT096', employee_name: 'T', is_active: true, position: '藥師', notes: '' },
        { id: 'sep', year_month: MONTH, store_id: '0008', employee_code: 'FKPT096', employee_name: 'T', is_active: true, position: '藥師', notes: 'seed', source: 'movement' },
      ],
      pharmacist_monthly_snapshot_sync_log: [{ year_month: MONTH, last_synced_at: SYNC0 }],
      store_employees: [{ employee_code: 'FKPT096', store_id: '0008', is_pharmacist: true }],
      employee_movement_history: o.movements ?? [],
    };
    let writes = 0;
    // 解析 buildSyncTriggerOrFilter 產生的三條件字串，等同 PostgREST 的 or(...)。
    const evalOr = (expr: string, row: any) => {
      const parts = expr.split(',');
      const gt = (k: string, term: string) => new Date(row[k]).getTime() > new Date(term.split('.gt.')[1]).getTime();
      const m = expr.match(/movement_date\.gt\.([\d-]+),movement_date\.lte\.([\d-]+)/)!;
      const md = String(row.movement_date).slice(0, 10);
      return gt('created_at', parts[0]) || gt('updated_at', parts[1]) || (md > m[1] && md <= m[2]);
    };
    const client = {
      from(table: string) {
        const filters: ((r: any) => boolean)[] = [];
        let range: number[] | null = null, mode = 'read', payload: any[] = [], failed = false;
        const q: any = {
          select() { return q; },
          eq(k: string, v: any) { filters.push((r) => r[k] === v); return q; },
          in(k: string, vs: any[]) { filters.push((r) => vs.includes(r[k])); return q; },
          gt(k: string, v: any) { filters.push((r) => r[k] > v); return q; },
          gte(k: string, v: any) { filters.push((r) => r[k] >= v); return q; },
          lte(k: string, v: any) { filters.push((r) => r[k] <= v); return q; },
          or(expr: string) {
            if (/created_at\.gt\./.test(expr)) {
              if (o.triggerError) failed = true;
              else filters.push((r) => evalOr(expr, r));
            }
            return q;
          },
          order() { return q; },
          range(a: number, b: number) { range = [a, b]; return q; },
          maybeSingle() { mode = 'single'; return q; },
          delete() { mode = 'delete'; return q; },
          upsert(v: any) { mode = 'upsert'; payload = Array.isArray(v) ? v : [v]; return q; },
          then(resolve: any, reject: any) {
            return Promise.resolve().then(() => {
              if (failed) return { data: null, count: null, error: new Error('trigger query failed') };
              let data = tables[table].filter((r) => filters.every((f) => f(r)));
              if (mode === 'upsert') {
                writes++;
                for (const row of payload) {
                  const key = table === 'pharmacist_monthly_snapshot' ? ['year_month', 'store_id', 'employee_code'] : ['year_month'];
                  const old = tables[table].find((r) => key.every((k) => r[k] === row[k]));
                  if (old) Object.assign(old, row); else tables[table].push({ ...row });
                }
                if (o.advanceOnWrite && table === 'pharmacist_monthly_snapshot') vi.setSystemTime(Date.now() + o.advanceOnWrite);
                return { error: null };
              }
              if (mode === 'delete') { tables[table] = tables[table].filter((r) => !data.includes(r)); return { error: null }; }
              if (range) data = data.slice(range[0], range[1] + 1);
              return { data: mode === 'single' ? data[0] || null : data, count: data.length, error: null };
            }).then(resolve, reject);
          },
        };
        return q;
      },
    };
    const context: any = {
      adminSupabase: client, canUseSnapshot: true, lockedMonthSet: new Set(o.locked ? [MONTH] : []), storeIds: ['0008'],
      getPreviousYearMonth: () => '2026-08', hasMissingPharmacistCarry, hasSyncTriggeringMovement, taiwanDateOf,
      console, Date, Number, String, Set, Map, Array, Promise,
    };
    vm.createContext(context);
    vm.runInContext(noteSrc, context);
    vm.runInContext(fnSrc, context);
    return { run: () => context.ensureSnapshotForMonth(MONTH), tables, writes: () => writes, log: () => tables.pharmacist_monthly_snapshot_sync_log[0].last_synced_at };
  }
  const resign = (extra: Record<string, unknown> = {}) => ({
    id: 'm1', employee_code: 'FKPT096', movement_type: 'resignation', store_id: '0008', movement_date: '2026-09-15',
    created_at: OLD, updated_at: OLD, ...extra,
  });

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-20T02:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('沒有變動：跳過，不寫任何東西、sync log 不動', async () => {
    const f = fixture({ movements: [resign({ movement_date: '2026-09-08' })] });
    await f.run();
    expect(f.writes()).toBe(0);
    expect(f.log()).toBe(SYNC0);
  });
  it('情況 (a) 上次同步後才登錄：重新同步並更新 log', async () => {
    const f = fixture({ movements: [resign({ movement_date: '2026-09-08', created_at: '2026-09-11T00:00:00Z' })] });
    await f.run();
    expect(f.writes()).toBeGreaterThan(0);
    expect(f.log()).toBe('2026-09-20T02:00:00.000Z');
    expect(f.tables.pharmacist_monthly_snapshot.find((r) => r.id === 'sep').is_active).toBe(false);
  });
  it('情況 (b) 上次同步後被修改（updated_at 變新）：重新同步', async () => {
    const f = fixture({ movements: [resign({ movement_date: '2026-09-08', updated_at: '2026-09-12T00:00:00Z' })] });
    await f.run();
    expect(f.writes()).toBeGreaterThan(0);
    expect(f.tables.pharmacist_monthly_snapshot.find((r) => r.id === 'sep').is_active).toBe(false);
  });
  it('情況 (c) 提前登錄，生效日（9/15）到了才重新同步；之前仍跳過', async () => {
    const early = fixture({ movements: [resign()] });
    vi.setSystemTime(new Date('2026-09-12T02:00:00Z'));
    await early.run();
    expect(early.writes()).toBe(0);
    expect(early.tables.pharmacist_monthly_snapshot.find((r) => r.id === 'sep').is_active).toBe(true);

    const due = fixture({ movements: [resign()] });
    vi.setSystemTime(new Date('2026-09-20T02:00:00Z'));
    await due.run();
    expect(due.writes()).toBeGreaterThan(0);
    expect(due.tables.pharmacist_monthly_snapshot.find((r) => r.id === 'sep').is_active).toBe(false);
  });
  it('生效日以台灣日期判斷：台灣 9/15 清晨（UTC 9/14 17:00）已算到期', async () => {
    const f = fixture({ movements: [resign()] });
    vi.setSystemTime(new Date('2026-09-14T17:00:00Z'));
    await f.run();
    expect(f.writes()).toBeGreaterThan(0);
  });
  it('判斷查詢失敗：降級為直接同步並記錄錯誤，不丟例外', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = fixture({ movements: [resign({ movement_date: '2026-09-08' })], triggerError: true });
    await expect(f.run()).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    expect(f.log()).toBe('2026-09-20T02:00:00.000Z');
  });
  it('sync log 記的是同步「開始」時間，不是結束時間', async () => {
    const f = fixture({ movements: [resign({ created_at: '2026-09-11T00:00:00Z' })], advanceOnWrite: 5 * 60 * 1000 });
    await f.run();
    expect(f.writes()).toBeGreaterThan(0);
    expect(f.log()).toBe('2026-09-20T02:00:00.000Z');
  });
  it('快照備註不重複累加：連續重新同步兩次，resignation 備註只出現一次', async () => {
    const f = fixture({ movements: [resign({ created_at: '2026-09-11T00:00:00Z' })] });
    await f.run();
    vi.setSystemTime(new Date('2026-09-21T02:00:00Z'));
    f.tables.employee_movement_history[0].updated_at = '2026-09-20T12:00:00Z';
    await f.run();
    const notes: string = f.tables.pharmacist_monthly_snapshot.find((r) => r.id === 'sep').notes;
    expect(notes.match(/resignation/g)).toHaveLength(1);
  });
  it('關帳月份：完全不動（沒有寫入、log 不變）', async () => {
    const f = fixture({ locked: true, movements: [resign({ created_at: '2026-09-11T00:00:00Z' })] });
    await f.run();
    expect(f.writes()).toBe(0);
    expect(f.log()).toBe(SYNC0);
  });
});

describe('接線：Vue 工作台與年度主檔 route 共用同一套判斷', () => {
  it('pharmacist-overview 不再只看 created_at；用共用 helper、同步開始時間與台灣今天', () => {
    const s = read('lib/workspace/pharmacist-overview.ts');
    expect(s).toMatch(/from ['"]@\/lib\/pharmacist\/sync-trigger['"]/);
    expect(s).toMatch(/hasSyncTriggeringMovement\(adminSupabase/);
    expect(s).not.toMatch(/\.gt\(\s*["']created_at["']/);
    expect(s).toMatch(/last_synced_at: syncStartedAt/);
    expect(s).not.toMatch(/last_synced_at: new Date\(\)\.toISOString\(\)/);
  });
  it('年度主檔 sync route：共用 helper、台灣今天、回傳真正最後同步時間、關帳年度略過', () => {
    const r = read('app/api/pharmacist-annual-master/sync/route.ts');
    expect(r).toMatch(/hasSyncTriggeringMovement\(/);
    expect(r).toMatch(/taiwanDateOf\(new Date\(\)\)/);
    expect(r).toMatch(/syncedAt: isLocked \? null : lastSyncedAt/);
    expect(r).toMatch(/if \(!isLocked && !readOnly\) \{/);
    expect(r).toMatch(/last_synced_at: syncStartedAt/);
  });
  it('Vue 畫面以台灣時間顯示同步時間', () => {
    const v = read('vue-workspace/src/pages/Pharmacists.vue');
    expect(v).toMatch(/timeZone: "Asia\/Taipei"/);
    expect(v).toMatch(/fmt\(master\.syncedAt\)/);
  });
});

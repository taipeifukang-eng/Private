import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertNoUnlistedDiffs,
  classify,
  compareApiRead,
  compareSideEffects,
  compareTables,
  listMaps,
  loadAllowlist,
  loadMap,
  mapColumns,
  ParityRecorder,
  readRowsAsServiceRole,
  readWorkbookRows,
  validateAllowlist,
  validateMap,
  type AllowlistEntry,
  type ApiLike,
  type ParityMap,
  type ParityReport,
  type SupabaseReadClient,
} from '../../support/parity';

const RUN_ID = 'T20261102-zz01';

function tmpReports() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'parity-test-'));
}

function readReport(dir: string): ParityReport {
  return JSON.parse(fs.readFileSync(path.join(dir, RUN_ID, 'parity-report.json'), 'utf8'));
}

const pendingEntry: AllowlistEntry = {
  id: 'x-pending',
  page: 'demo',
  description: 'd',
  reason: 'r',
  approvedBy: null,
  match: { mechanism: 'api-read', kind: 'only-native', key: 'extra' },
};
const approvedEntry: AllowlistEntry = { ...pendingEntry, id: 'x-approved', approvedBy: '使用者', match: { mechanism: 'api-read', kind: 'changed', key: 'name' } };

function fakeApi(responses: Record<string, { status: number; body: unknown }>): ApiLike {
  return {
    async fetch(url) {
      const r = responses[url];
      if (!r) throw new Error(`unexpected ${url}`);
      return { status: () => r.status, text: async () => JSON.stringify(r.body) };
    },
  };
}

describe('白名單驗證與分類', () => {
  it('正式 allowlist.json 與所有 parity map 都合法', () => {
    expect(() => loadAllowlist()).not.toThrow();
    for (const name of listMaps()) expect(() => loadMap(name)).not.toThrow();
    expect(listMaps()).toContain('navigation');
  });

  it('正式 allowlist：未核可的條目只能是 decision=fix 或明列的待核可清單；已核可者的 reason 不得再寫「待使用者核可」', () => {
    const STILL_PENDING = new Set(['p01-pharmacist-status-filter-control', 'p02-transfer-confirm-master-store', 'p02-batch-transfer-master-store']); // 修正規格 F2 之外、本輪新增的控制型態差異
    const list = loadAllowlist();
    const unapproved = list.filter((e) => !e.approvedBy && e.decision !== 'fix' && !STILL_PENDING.has(e.id)).map((e) => e.id);
    expect(unapproved, `這些條目沒有 approvedBy：${unapproved.join(', ')}`).toEqual([]);
    const stale = list.filter((e) => e.approvedBy && /待使用者核可|待主迴圈/.test(e.reason)).map((e) => e.id);
    expect(stale, `已核可但 reason 仍寫待核可：${stale.join(', ')}`).toEqual([]);
    for (const id of ['inventory-view-implies-import-delete', 'nav-archived-feature-gate']) {
      expect(list.find((e) => e.id === id)).toMatchObject({ decision: 'fix', approvedBy: null });
    }
  });

  it('每筆都有 id/page/description/reason/approvedBy 欄位', () => {
    const errors = validateAllowlist([{ id: 'a', page: 'p', description: 'd', reason: 'r' }, { id: 'a', page: 'p', description: '', reason: 'r', approvedBy: null }]);
    expect(errors.join('\n')).toContain('缺少 approvedBy');
    expect(errors.join('\n')).toContain('缺少 description');
    expect(errors.join('\n')).toContain('id 重複');
    expect(validateAllowlist([{ id: 'a', page: 'p', description: 'd', reason: 'r', approvedBy: '' }]).join()).toContain('approvedBy');
    expect(validateAllowlist([{ id: 'a', page: 'p', description: 'd', reason: 'r', approvedBy: null, match: {} }]).join()).toContain('至少要有');
  });

  it('未命中白名單 = fail；命中但 approvedBy 為 null = pending-approval；核可後 = allowed', () => {
    const ctx = { page: 'demo', mechanism: 'api-read' as const, role: 'admin' };
    expect(classify([{ kind: 'changed', key: 'zzz' }], ctx, [pendingEntry]).status).toBe('fail');
    expect(classify([{ kind: 'only-native', key: 'extra' }], ctx, [pendingEntry]).status).toBe('pending-approval');
    expect(classify([{ kind: 'changed', key: 'name' }], ctx, [approvedEntry]).status).toBe('allowed');
    expect(classify([], ctx, [pendingEntry]).status).toBe('pass');
    // 混合：只要有一項未列白名單就是 fail
    expect(classify([{ kind: 'only-native', key: 'extra' }, { kind: 'changed', key: 'q' }], ctx, [pendingEntry]).status).toBe('fail');
  });

  it('白名單限定頁面、機制與角色；沒有 match 的條目不會自動套用', () => {
    const ctx = { page: 'demo', mechanism: 'api-read' as const, role: 'admin' };
    const d = [{ kind: 'only-native', key: 'extra' }];
    expect(classify(d, { ...ctx, page: 'other' }, [pendingEntry]).status).toBe('fail');
    expect(classify(d, { ...ctx, mechanism: 'navigation' }, [pendingEntry]).status).toBe('fail');
    const roleScoped = { ...pendingEntry, match: { ...pendingEntry.match, roles: ['employee'] } };
    expect(classify(d, ctx, [roleScoped]).status).toBe('fail');
    expect(classify(d, { ...ctx, role: 'employee' }, [roleScoped]).status).toBe('pending-approval');
    const { match: _m, ...noMatch } = pendingEntry;
    void _m;
    expect(classify(d, ctx, [noMatch]).status).toBe('fail');
  });
});

describe('parity map 驗證', () => {
  const ok: ParityMap = {
    page: 'demo',
    entries: [
      { id: 'e1', mechanism: 'api-read', legacy: { api: { path: '/api/roles' } }, native: { api: { path: '/api/workspace/roles' } } },
    ],
  };
  it('合法 map 通過', () => expect(validateMap(ok, 'demo')).toEqual([]));
  it('舊版路徑不可是 workspace、新版必須是 workspace、機制必須合法、id 不重複', () => {
    const bad: ParityMap = {
      page: 'demo',
      entries: [
        { id: 'e1', mechanism: 'api-read', legacy: { api: { path: '/api/workspace/x' } }, native: { api: { path: '/api/roles' } } },
        { id: 'e1', mechanism: 'bogus' as never, legacy: {}, native: {} },
      ],
    };
    const text = validateMap(bad, 'demo').join('\n');
    expect(text).toContain('不可是 /api/workspace/');
    expect(text).toContain('必須以 /api/workspace/ 開頭');
    expect(text).toContain('mechanism 不合法');
    expect(text).toContain('id 重複');
  });
  it('api-read 只允許 GET', () => {
    const m: ParityMap = { page: 'demo', entries: [{ ...ok.entries[0], legacy: { api: { method: 'POST', path: '/api/x' } } }] };
    expect(validateMap(m, 'demo').join()).toContain('只允許 GET');
  });
  it('page 與檔名不一致', () => expect(validateMap(ok, 'other').join()).toContain('不一致'));
  it('loadMap 拒絕路徑穿越', () => expect(() => loadMap('../allowlist')).toThrow());
});

describe('parity-report.json', () => {
  it('寫入 tests/reports/<runId>/parity-report.json，含 verdict 與待核可清單；同 id 覆蓋、不同 id 累積', async () => {
    const dir = tmpReports();
    const recorder = new ParityRecorder('demo', { runId: RUN_ID, reportsDir: dir, allowlist: [pendingEntry, approvedEntry] });
    const same = { '/a': { status: 200, body: { items: [{ id: 1, name: 'A', extra: undefined }] } } };
    const r1 = await compareApiRead({
      recorder,
      entry: 'list',
      title: 't',
      role: 'admin',
      legacyApi: fakeApi(same),
      legacy: { path: '/a', pick: 'items' },
      native: { path: '/a', pick: 'items' },
    });
    expect(r1.status).toBe('pass');
    let report = readReport(dir);
    expect(report.verdict).toBe('PASS');
    expect(report.environment).toBe('DEV');

    await compareApiRead({
      recorder,
      entry: 'list2',
      title: 't',
      role: 'admin',
      legacyApi: fakeApi({ '/l': { status: 200, body: { items: [{ id: 1 }] } }, '/n': { status: 200, body: { items: [{ id: 1, extra: 'x' }] } } }),
      legacy: { path: '/l', pick: 'items' },
      native: { path: '/n', pick: 'items' },
      compareKey: 'id',
    });
    report = readReport(dir);
    expect(report.entries.map((e) => e.id)).toEqual(['demo/list/admin', 'demo/list2/admin']);
    expect(report.verdict).toBe('PENDING_APPROVAL');
    expect(report.summary).toMatchObject({ total: 2, pass: 1, pendingApproval: 1, fail: 0 });
    expect(report.pendingAllowlist).toEqual([{ id: 'x-pending', page: 'demo', description: 'd', hits: 1 }]);

    // 再跑一次同 id：覆蓋而非新增
    await compareApiRead({
      recorder,
      entry: 'list',
      title: 't',
      role: 'admin',
      legacyApi: fakeApi({ '/a': { status: 200, body: { items: [{ id: 1 }] } }, '/b': { status: 200, body: { items: [{ id: 2 }] } } }),
      nativeApi: fakeApi({ '/b': { status: 200, body: { items: [{ id: 2 }] } } }),
      legacy: { path: '/a', pick: 'items' },
      native: { path: '/b', pick: 'items' },
    });
    report = readReport(dir);
    expect(report.entries).toHaveLength(2);
    expect(report.verdict).toBe('FAIL');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('runId 格式不正確時拒絕寫入', () => {
    const recorder = new ParityRecorder('demo', { runId: '../evil', reportsDir: tmpReports(), allowlist: [] });
    expect(() => recorder.record({ entry: 'e', mechanism: 'api-read', title: 't', legacy: { endpoint: 'a' }, native: { endpoint: 'b' }, compared: {}, diffs: [] })).toThrow(/runId/);
  });
});

describe('機制一：API 讀取對等', () => {
  const mk = () => {
    const dir = tmpReports();
    return { dir, recorder: new ParityRecorder('demo', { runId: RUN_ID, reportsDir: dir, allowlist: [] }) };
  };

  it('狀態碼不一致視為差異（例如舊版 200、新版 403）', async () => {
    const { dir, recorder } = mk();
    const r = await compareApiRead({
      recorder,
      entry: 'e',
      title: 't',
      role: 'employee',
      legacyApi: fakeApi({ '/l': { status: 200, body: { a: 1 } }, '/n': { status: 403, body: { error: 'no' } } }),
      legacy: { path: '/l' },
      native: { path: '/n' },
    });
    expect(r.status).toBe('fail');
    expect(r.diffs[0]).toMatchObject({ kind: 'status', legacy: 200, native: 403 });
    expect(() => assertNoUnlistedDiffs(r)).toThrow(/對等比對失敗/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('純值陣列（權限碼）以集合比對：一邊少兩項時只回報那兩項，不會讓後面整段索引錯位', async () => {
    const { dir, recorder } = mk();
    const all = ['a.view', 'a.view_all', 'a.view_own', 'b.x', 'c.y', 'd.z'];
    const r = await compareApiRead({
      recorder,
      entry: 'perm',
      title: 't',
      role: 'admin',
      legacyApi: fakeApi({
        '/l': { status: 200, body: { permissions: all } },
        '/n': { status: 200, body: { permissions: all.filter((c) => c !== 'a.view' && c !== 'a.view_own') } },
      }),
      legacy: { path: '/l', pick: 'permissions' },
      native: { path: '/n', pick: 'permissions' },
    });
    expect(r.diffs).toEqual([
      { kind: 'only-legacy', key: 'a.view', legacy: 'a.view' },
      { kind: 'only-legacy', key: 'a.view_own', legacy: 'a.view_own' },
    ]);
    expect(r.compared).toMatchObject({ legacyRows: 6, nativeRows: 4 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('兩邊同為 403 視為一致，不比內容', async () => {
    const { dir, recorder } = mk();
    const r = await compareApiRead({
      recorder,
      entry: 'e',
      title: 't',
      role: 'denied',
      legacyApi: fakeApi({ '/l': { status: 403, body: { error: 'a' } }, '/n': { status: 403, body: { message: 'b' } } }),
      legacy: { path: '/l' },
      native: { path: '/n' },
    });
    expect(r.status).toBe('pass');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('套用正規化（改名、忽略、排序、日期）後比對，並依比較鍵配對逐欄比對', async () => {
    const { dir, recorder } = mk();
    const r = await compareApiRead({
      recorder,
      entry: 'e',
      title: 't',
      role: 'admin',
      legacyApi: fakeApi({
        '/l': { status: 200, body: { rows: [{ code: 'B', joined: '2026/11/2', updated_at: 'a' }, { code: 'A', joined: '2026-11-01', updated_at: 'a' }] } },
        '/n': { status: 200, body: { data: [{ storeCode: 'A', joined: '2026-11-01T00:00:00+08:00', updated_at: 'z' }, { storeCode: 'B', joined: '2026-11-03', updated_at: 'z' }] } },
      }),
      legacy: { path: '/l', pick: 'rows' },
      native: { path: '/n', pick: 'data' },
      compareKey: 'code',
      rules: { rename: { storeCode: 'code' }, ignore: ['updated_at'], dateFields: ['joined'] },
    });
    expect(r.status).toBe('fail');
    expect(r.diffs).toEqual([{ kind: 'changed', key: 'B#joined', legacy: '2026-11-02', native: '2026-11-03' }]);
    expect(r.compared).toMatchObject({ legacyRows: 2, nativeRows: 2 });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('機制二：副作用比對與只讀回讀', () => {
  it('兩份 fixture 的業務欄位與歷程表比對；忽略 fixture 專屬欄位；筆數不同會被抓到', () => {
    const dir = tmpReports();
    const recorder = new ParityRecorder('demo', { runId: RUN_ID, reportsDir: dir, allowlist: [] });
    const r = compareSideEffects({
      recorder,
      entry: 'create-employee',
      title: 't',
      legacyAction: 'POST /api/x',
      nativeAction: 'POST /api/workspace/x',
      tables: [
        {
          table: 'employees',
          key: 'suffix',
          rules: { ignore: ['id', 'created_at'] },
          legacyRows: [{ id: 'u1', suffix: '001', name: '甲', created_at: '1' }],
          nativeRows: [{ id: 'u2', suffix: '001', name: '甲', created_at: '2' }],
        },
        {
          table: 'employee_movement_history',
          key: 'suffix',
          rules: { ignore: ['id'] },
          legacyRows: [{ id: 1, suffix: '001', type: 'hire' }],
          nativeRows: [],
        },
      ],
    });
    expect(r.mechanism).toBe('write-readback');
    expect(r.status).toBe('fail');
    expect(r.diffs.map((d) => `${d.kind}:${d.key}`)).toEqual(['count:employee_movement_history:(rows)', 'only-legacy:employee_movement_history:001']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('readRowsAsServiceRole 只允許 SELECT，並檢查表名、欄位名與條件', async () => {
    const calls: string[] = [];
    const q: Record<string, unknown> = {
      eq: (c: string, v: unknown) => (calls.push(`eq ${c}=${String(v)}`), q),
      in: () => q,
      like: (c: string, v: string) => (calls.push(`like ${c} ${v}`), q),
      order: () => q,
      limit: () => q,
      then: (res: (v: unknown) => unknown) => res({ data: [{ a: 1 }], error: null }),
    };
    const client = { from: (t: string) => (calls.push(`from ${t}`), { select: () => q }) } as unknown as SupabaseReadClient;
    await expect(readRowsAsServiceRole('employees', { like: { employee_id: 'ZT2026%' }, client })).resolves.toEqual([{ a: 1 }]);
    expect(calls).toEqual(['from employees', 'like employee_id ZT2026%']);
    await expect(readRowsAsServiceRole('employees; drop table x', { eq: { a: 1 }, client })).rejects.toThrow(/表名/);
    await expect(readRowsAsServiceRole('employees', { eq: { 'a;b': 1 }, client })).rejects.toThrow(/欄位名/);
    await expect(readRowsAsServiceRole('employees', { client })).rejects.toThrow(/條件/);
    await expect(readRowsAsServiceRole('employees', { eq: { a: 1 }, select: '*;', client })).rejects.toThrow(/select/);
  });

  it('readRowsAsServiceRole 回讀列數超過 limit 時 throw，剛好等於 limit 時通過', async () => {
    const make = (n: number) => {
      const seen: number[] = [];
      const q: Record<string, unknown> = {
        eq: () => q,
        limit: (x: number) => (seen.push(x), q),
        then: (res: (v: unknown) => unknown) => res({ data: Array.from({ length: Math.min(n, seen[0] ?? n) }, (_, i) => ({ i })), error: null }),
      };
      return { client: { from: () => ({ select: () => q }) } as unknown as SupabaseReadClient, seen };
    };
    const a = make(5);
    await expect(readRowsAsServiceRole('t', { eq: { a: 1 }, limit: 5, client: a.client })).resolves.toHaveLength(5);
    expect(a.seen).toEqual([6]);
    const b = make(50);
    await expect(readRowsAsServiceRole('t', { eq: { a: 1 }, limit: 5, client: b.client })).rejects.toThrow(/截斷/);
  });
});

describe('機制三：表格 / xlsx 逐欄比對', () => {
  const columns = [
    { canonical: 'code', legacy: '員編', native: '員工編號' },
    { canonical: 'amount', legacy: '金額', native: '獎金', type: 'number' as const },
    { canonical: 'date', legacy: '到職日', type: 'date' as const },
  ];

  it('mapColumns 轉換欄位名並回報缺漏表頭', () => {
    const { rows, missing } = mapColumns([{ 員工編號: 'A' }], columns, 'native');
    expect(rows[0]).toMatchObject({ code: 'A' });
    expect(missing).toEqual(['獎金', '到職日']);
  });

  it('表頭不同、數字與日期格式不同但語意相同 -> pass；數值不同 -> 指出欄位', () => {
    const dir = tmpReports();
    const recorder = new ParityRecorder('demo', { runId: RUN_ID, reportsDir: dir, allowlist: [] });
    const legacyRows = [{ 員編: 'A', 金額: '1,000', 到職日: '2026/11/2' }, { 員編: 'B', 金額: '500', 到職日: '2026-01-01' }];
    const nativeRows = [{ 員工編號: 'A', 獎金: '1000.00', 到職日: '2026-11-02' }, { 員工編號: 'B', 獎金: '501', 到職日: '2026-01-01' }];
    const r = compareTables({ recorder, entry: 'export', title: 't', legacySource: 'old.xlsx', nativeSource: 'new.xlsx', legacyRows, nativeRows, columns, key: 'code' });
    expect(r.diffs).toEqual([{ kind: 'changed', key: 'B#amount', legacy: 500, native: 501 }]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('readWorkbookRows 讀 xlsx / csv Buffer，以第一列為表頭', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const XLSX = require('xlsx') as typeof import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([['員編', '金額'], ['A', 1234.5], ['B', '']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'S1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    expect(readWorkbookRows(buf)).toEqual([{ 員編: 'A', 金額: '1234.5' }, { 員編: 'B', 金額: '' }]);
    const csv = Buffer.from('員編,金額\nA,1\n', 'utf8');
    expect(readWorkbookRows(csv)).toEqual([{ 員編: 'A', 金額: '1' }]);
  });
});

describe('decision: fix（必須改回舊行為）', () => {
  const fixEntry: AllowlistEntry = {
    id: 'fix-nav',
    page: 'demo',
    description: 'd',
    reason: 'r',
    approvedBy: null,
    decision: 'fix',
    fixIn: 'W07',
    match: { mechanism: 'api-read', kind: 'only-legacy', key: 'gone' },
  };
  const ctx = { page: 'demo', mechanism: 'api-read' as const, role: 'admin' };
  const mkResult = (diffs: { kind: string; key: string }[], list = [fixEntry, pendingEntry]) => {
    const { status, diffs: d } = classify(diffs, ctx, list);
    return { id: 'demo/e/admin', page: 'demo', entry: 'e', mechanism: 'api-read' as const, title: 't', legacy: { endpoint: 'a' }, native: { endpoint: 'b' }, compared: {}, status, diffs: d };
  };

  it('validateAllowlist：decision fix 需要非空 fixIn 且 approvedBy 必須為 null', () => {
    const base = { id: 'a', page: 'p', description: 'd', reason: 'r' };
    expect(validateAllowlist([{ ...base, approvedBy: null, decision: 'fix', fixIn: 'W07' }])).toEqual([]);
    expect(validateAllowlist([{ ...base, approvedBy: null, decision: 'fix' }]).join()).toContain('fixIn');
    expect(validateAllowlist([{ ...base, approvedBy: null, decision: 'fix', fixIn: ' ' }]).join()).toContain('fixIn');
    expect(validateAllowlist([{ ...base, approvedBy: '使用者', decision: 'fix', fixIn: 'W07' }]).join()).toContain('approvedBy 必須為 null');
    expect(validateAllowlist([{ ...base, approvedBy: null, decision: 'other' }]).join()).toContain('decision');
    expect(validateAllowlist([{ ...base, approvedBy: null, fixIn: '' }]).join()).toContain('fixIn');
  });

  it('命中 fix 條目 -> allowlistStatus must-fix；排序 fail > must-fix > pending-approval', () => {
    const only = mkResult([{ kind: 'only-legacy', key: 'gone' }]);
    expect(only.status).toBe('must-fix');
    expect(only.diffs[0]).toMatchObject({ allowlistId: 'fix-nav', allowlistStatus: 'must-fix', fixIn: 'W07' });
    expect(mkResult([{ kind: 'only-legacy', key: 'gone' }, { kind: 'only-native', key: 'extra' }]).status).toBe('must-fix');
    expect(mkResult([{ kind: 'only-legacy', key: 'gone' }, { kind: 'changed', key: 'unknown' }]).status).toBe('fail');
  });

  it('沒有 match 的 fix 條目只登記，不自動套用', () => {
    const { match: _m, ...noMatch } = fixEntry;
    void _m;
    expect(mkResult([{ kind: 'only-legacy', key: 'gone' }], [noMatch]).status).toBe('fail');
  });

  it('報告：summary.mustFix、mustFix 清單含 fixIn，verdict 不是 PASS 也不是 FAIL', () => {
    const dir = tmpReports();
    const recorder = new ParityRecorder('demo', { runId: RUN_ID, reportsDir: dir, allowlist: [fixEntry] });
    recorder.record({
      entry: 'e', mechanism: 'api-read', role: 'admin', title: 't', legacy: { endpoint: 'a' }, native: { endpoint: 'b' }, compared: {},
      diffs: [{ kind: 'only-legacy', key: 'gone' }],
    });
    const report = readReport(dir);
    expect(report.verdict).toBe('MUST_FIX');
    expect(report.summary).toMatchObject({ total: 1, mustFix: 1, fail: 0, pendingApproval: 0 });
    expect(report.mustFix).toEqual([{ id: 'fix-nav', page: 'demo', description: 'd', fixIn: 'W07', hits: 1 }]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('斷言：未設 PARITY_ENFORCE_FIX 或不含該 fixIn -> 不失敗但加 annotation', () => {
    const r = mkResult([{ kind: 'only-legacy', key: 'gone' }]);
    for (const enforceFix of ['', 'W25', 'W08,W25']) {
      const notes: { type: string; description: string }[] = [];
      expect(() => assertNoUnlistedDiffs(r, { enforceFix, annotate: (a) => notes.push(a) })).not.toThrow();
      expect(notes).toHaveLength(1);
      expect(notes[0].type).toBe('must-fix');
      expect(notes[0].description).toContain('fix-nav→W07');
    }
  });

  it('斷言：PARITY_ENFORCE_FIX 含該 fixIn（逗號分隔）或 all -> 失敗', () => {
    const r = mkResult([{ kind: 'only-legacy', key: 'gone' }]);
    const notes: unknown[] = [];
    for (const enforceFix of ['W07', 'W25, W07', 'all']) {
      expect(() => assertNoUnlistedDiffs(r, { enforceFix, annotate: (a) => notes.push(a) })).toThrow(/fix-nav[\s\S]*W07/);
    }
    expect(notes).toHaveLength(0);
  });

  it('斷言：fail 仍然失敗；pass / pending-approval 不受影響', () => {
    expect(() => assertNoUnlistedDiffs(mkResult([{ kind: 'changed', key: 'zzz' }]), { enforceFix: '' })).toThrow(/對等比對失敗/);
    expect(() => assertNoUnlistedDiffs(mkResult([{ kind: 'only-native', key: 'extra' }]), { enforceFix: 'all' })).not.toThrow();
    expect(() => assertNoUnlistedDiffs(mkResult([]), { enforceFix: 'all' })).not.toThrow();
  });

  it('正式 allowlist：兩筆 fix 條目都合法，且 inventory 那筆維持只登記（無 match）', () => {
    const list = loadAllowlist();
    const nav = list.find((a) => a.id === 'nav-archived-feature-gate');
    const inv = list.find((a) => a.id === 'inventory-view-implies-import-delete');
    expect(nav).toMatchObject({ decision: 'fix', fixIn: 'W07', approvedBy: null });
    expect(inv).toMatchObject({ decision: 'fix', fixIn: 'W25', approvedBy: null });
    expect(inv?.match).toBeUndefined();
  });
});

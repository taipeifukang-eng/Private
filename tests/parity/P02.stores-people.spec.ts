import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { submitMovements } from '../support/w06-fixtures';
import {
  XLSX_MIME,
  adminDb,
  employeeWorkbook,
  grantTransferSupervisors,
  historyOf,
  masterOf,
  nativePreview,
  nativeSave,
  p02BadCode,
  p02Code,
  p02Stores,
  purgeP02,
  purgeReceipts,
  registerP02,
  seedMaster,
  transferRequestsOf,
  type ImportRow,
} from '../support/p02-fixtures';

// P02 對等層：舊版 11 頁（門市、店長、督導、員工匯入）對新版。
//   門市列表：同一管理員逐店比對欄位與排序（含已停止數量）。
//   員工匯入：同一份 Excel 分別送舊版 POST /api/import-employees 與新版 employee-import（預覽＋儲存），以 service role 回讀員工主檔逐欄比對。
//   調店：舊版任一督導確認即生效；新版要兩側督導都確認（D.2）。批次輸入的調店列：舊版直接生效；新版建立待確認申請（D.2）。
//   地圖：舊版載入所有門市；新版預設只看營運中（F.3）。
// 與舊版不同且使用者已核可的差異（D.1、D.2、F.1、F.3、E.1、E.3）登記在 tests/parity/allowlist.json
// （approvedBy "user (2026-11-05 survey/m2)"，註明規格條號）。舊版與新版各用自己的員編。

const map = loadMap('stores-people');
const recorder = new ParityRecorder('stores-people');
const entry = (id: string) => map.entries.find((e) => e.id === id)!.id;
type Facts = Record<string, unknown>;
const ROOT = path.resolve(__dirname, '..', '..');
const NAME = (tag: string) => `P02對等 ${tag}`;

function record(id: string, title: string, mechanism: 'write-readback' | 'ui-extract', legacyEp: string, nativeEp: string, legacy: Facts, native: Facts) {
  assertNoUnlistedDiffs(
    recorder.record({
      entry: entry(id),
      mechanism,
      role: 'admin',
      title,
      legacy: { endpoint: legacyEp },
      native: { endpoint: nativeEp },
      compared: { facts: Object.keys(legacy).length },
      diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
    }),
  );
}

test.describe('P02 門市列表與地圖對等', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let zt05 = '';
  let wasActive = true;

  test.beforeAll(async () => {
    admin = await apiAs('admin');
    const { data } = await adminDb().from('stores').select('id,is_active').eq('store_code', 'ZT05').single();
    zt05 = data.id;
    wasActive = data.is_active;
    // 暫時停用 ZT05，才看得出「預設只看營運中」與「顯示已停止」的差別；afterAll 還原。
    await adminDb().from('stores').update({ is_active: false }).eq('id', zt05);
  });
  test.afterAll(async () => {
    await adminDb().from('stores').update({ is_active: wasActive }).eq('id', zt05);
    await admin?.dispose();
  });

  const isTest = (code: string) => /^(ZT|VW)/.test(code);

  async function legacyList(browser: any, url: string) {
    const ctx = await loginAs(browser, 'admin');
    try {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForSelector('div.divide-y > div.grid', { timeout: 60_000 });
      return await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('div.divide-y > div.grid')).map((row) => {
          const cells = Array.from(row.children) as HTMLElement[];
          const text = (el?: Element | null) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
          const num = text(cells[6]).replace(/\D/g, '');
          return {
            store_code: text(cells[0]),
            store_name: text(cells[1].querySelector('span.font-semibold')),
            short_name: text(cells[2]),
            manager_name: text(cells[3]),
            address: text(cells[4]),
            phone: text(cells[5]),
            employee_count: num === '' ? 0 : Number(num),
            status: text(cells[7]),
            franchise: text(cells[1]).includes('加盟店'),
          };
        });
        const toggle = Array.from(document.querySelectorAll('a')).map((a) => a.textContent || '').find((t) => /已停止 \(\d+\)/.test(t)) || '';
        return { rows, inactiveCount: Number((/\((\d+)\)/.exec(toggle) || [])[1] ?? -1) };
      });
    } finally {
      await ctx.close();
    }
  }

  function facts(rows: any[], inactiveCount: number): Facts {
    const out: Facts = { order: rows.map((r) => r.store_code).filter(isTest), inactiveCount };
    for (const r of rows) {
      if (!isTest(r.store_code)) continue;
      out[r.store_code] = [r.store_name, r.short_name || '-', r.manager_name || '-', r.address || '-', r.phone || '-', r.employee_count, r.status, r.franchise].join('|');
    }
    return out;
  }
  const nativeRows = (stores: any[]) =>
    stores.map((s) => ({ store_code: s.store_code, store_name: s.store_name, short_name: s.short_name, manager_name: s.manager_name, address: s.address, phone: s.phone, employee_count: s.employee_count ?? 0, status: s.is_active ? '營運中' : '已停止', franchise: !!s.is_franchise }));

  test('門市列表（預設只看營運中）：欄位、員工數、狀態、排序與已停止數量', async ({ browser }) => {
    const legacy = await legacyList(browser, '/admin/stores');
    const res = await admin.get('/api/workspace/stores');
    expect(res.status()).toBe(200);
    const body = await res.json();
    record('stores-list-default', '門市列表（預設）', 'ui-extract', 'GET /admin/stores（DOM）', 'GET /api/workspace/stores', facts(legacy.rows, legacy.inactiveCount), facts(nativeRows(body.stores), body.inactiveCount));
  });

  test('門市列表（顯示已停止）：已停止門市出現且排序相同', async ({ browser }) => {
    const legacy = await legacyList(browser, '/admin/stores?showInactive=true');
    const res = await admin.get('/api/workspace/stores?inactive=true');
    const body = await res.json();
    expect(legacy.rows.some((r) => r.store_code === 'ZT05' && r.status === '已停止')).toBe(true);
    record('stores-list-inactive', '門市列表（顯示已停止）', 'ui-extract', 'GET /admin/stores?showInactive=true（DOM）', 'GET /api/workspace/stores?inactive=true', facts(legacy.rows, legacy.inactiveCount), facts(nativeRows(body.stores), body.inactiveCount));
  });

  test('門市整合地圖：舊版載入所有門市（含已停止），新版預設只看營運中且可勾選（F.3）', async () => {
    const source = fs.readFileSync(path.join(ROOT, 'app/admin/stores/map/page.tsx'), 'utf8');
    const query = /from\('stores'\)[\s\S]*?\.order\('store_code'\)/.exec(source)?.[0] || '';
    expect(query).not.toBe('');
    const def = await (await admin.get('/api/workspace/store-map')).json();
    const withInactive = await (await admin.get('/api/workspace/store-map?inactive=true')).json();
    const legacy: Facts = { defaultIncludesInactive: !/\.eq\(\s*'is_active'/.test(query), inactiveToggle: false, zt05InDefault: true };
    const native: Facts = {
      defaultIncludesInactive: def.stores.some((s: any) => !s.is_active),
      inactiveToggle: def.canInactive === true && withInactive.stores.some((s: any) => s.store_code === 'ZT05'),
      zt05InDefault: def.stores.some((s: any) => s.store_code === 'ZT05'),
    };
    record('map-default-inactive', '門市整合地圖預設範圍', 'ui-extract', 'app/admin/stores/map/page.tsx（原始碼查詢條件）', 'GET /api/workspace/store-map', legacy, native);
  });
});

test.describe('P02 員工匯入對等（同一份 Excel 送新舊匯入 API）', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let st: Record<string, string> = {};
  let storeOf: Record<string, string> = {};
  const started = new Date().toISOString();
  const code = {
    aL: p02Code('FKF', 51), bL: p02Code('FKPT', 52), cL: p02Code('FK', 4),
    aN: p02Code('FKF', 61), bN: p02Code('FKPT', 62), cN: p02Code('FK', 5),
    xL: p02Code('FKF', 53), yL: p02Code('FKF', 54), xN: p02Code('FKF', 63), yN: p02Code('FKF', 64),
    goodL: p02Code('FKF', 55), badL: p02Code('FKF', 56), goodN: p02Code('FKF', 65), badN: p02Code('FKF', 66),
    posL: p02Code('FKF', 57), fmtL: p02BadCode(1), posN: p02Code('FKF', 67), fmtN: p02BadCode(2),
  };
  const all = () => Object.values(code);

  test.beforeAll(async () => {
    admin = await apiAs('admin');
    st = await p02Stores();
    storeOf = Object.fromEntries(Object.entries(st).map(([c, id]) => [id, c]));
    await purgeP02(all());
  });
  test.afterAll(async () => {
    await registerP02(all()).catch(() => undefined);
    await purgeP02(all()).catch(() => undefined);
    await purgeReceipts(started, [st.ZT01]).catch(() => undefined);
    await admin?.dispose();
  });

  async function legacyImport(rows: ImportRow[]) {
    const res = await admin.post('/api/import-employees', { multipart: { file: { name: 'p02-legacy.xlsx', mimeType: XLSX_MIME, buffer: employeeWorkbook(rows) } } });
    const body = await res.json().catch(() => ({}));
    expect(res.status(), JSON.stringify(body)).toBe(200);
    return body as { imported: number; failed: number; errors: { row: number; error: string }[] };
  }
  /** 新版：預覽，通過就儲存；不通過就回傳預覽（含逐列錯誤）。 */
  async function nativeImport(rows: ImportRow[]) {
    const p = await nativePreview(admin, rows);
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    if (!p.body.valid) return { preview: p.body, saved: null as any };
    const s = await nativeSave(admin, p.body);
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    return { preview: p.body, saved: s.body };
  }
  const fact = async (c: string) => {
    const rows = await masterOf(c);
    if (!rows.length) return 'none';
    const r = rows[0];
    return [storeOf[r.store_id], r.employee_name, r.current_position || r.position, r.start_date, r.is_active, r.employment_status].join('|');
  };
  const typeOf = async (c: string) => (await masterOf(c))[0]?.employment_type ?? 'none';

  test('有效列：門市、姓名、職位、到職日、在職狀態對等；FKPT 新版自動兼職（E.3 已核可差異）', async () => {
    const rows = (a: string, b: string, c: string): ImportRow[] => [
      ['ZT01', a, NAME('甲'), '專員', '2026-10-01'],
      ['ZT01', b, NAME('乙'), '兼職助理', '2026-10-02'],
      ['ZT02', c, NAME('丙'), '店長', '2026-10-03'],
    ];
    const l = await legacyImport(rows(code.aL, code.bL, code.cL));
    const n = await nativeImport(rows(code.aN, code.bN, code.cN));
    const legacy: Facts = { importedCount: l.imported, failedCount: l.failed, a: await fact(code.aL), b: await fact(code.bL), c: await fact(code.cL), fkptEmploymentType: await typeOf(code.bL), fullTimeEmploymentType: await typeOf(code.aL) };
    const native: Facts = { importedCount: n.saved?.imported, failedCount: n.preview.errors.length, a: await fact(code.aN), b: await fact(code.bN), c: await fact(code.cN), fkptEmploymentType: await typeOf(code.bN), fullTimeEmploymentType: await typeOf(code.aN) };
    record('import-valid-file', '同一份有效 Excel 匯入後的員工主檔', 'write-readback', 'POST /api/import-employees', 'PUT /api/workspace/employee-import', legacy, native);
  });

  test('含已存在且完全相同的列：舊版回報失敗、新版自動略過並列在結果（D.1 已核可差異）', async () => {
    const first = (x: string): ImportRow[] => [['ZT01', x, NAME('重複'), '專員', '2026-10-04']];
    const second = (x: string, y: string): ImportRow[] => [['ZT01', x, NAME('重複'), '專員', '2026-10-04'], ['ZT01', y, NAME('新列'), '專員', '2026-10-05']];
    await legacyImport(first(code.xL));
    await nativeImport(first(code.xN));
    const l = await legacyImport(second(code.xL, code.yL));
    const n = await nativeImport(second(code.xN, code.yN));
    const legacy: Facts = { importedCount: l.imported, reportedFailures: l.failed, reportedSkipped: 0, newRowStored: await fact(code.yL), existingRowCount: (await masterOf(code.xL)).length };
    const native: Facts = { importedCount: n.saved?.imported, reportedFailures: n.preview.errors.length, reportedSkipped: n.saved?.skipped?.length ?? 0, newRowStored: await fact(code.yN), existingRowCount: (await masterOf(code.xN)).length };
    record('import-dup-rows', '重複列的處理與新列新增', 'write-readback', 'POST /api/import-employees', 'PUT /api/workspace/employee-import', legacy, native);
  });

  test('含一列門市代號不存在：舊版其他列照常新增、新版整批不存（D.1 已核可差異）；錯誤列號相同', async () => {
    const rows = (g: string, b: string): ImportRow[] => [['ZT01', g, NAME('好列'), '專員', '2026-10-06'], ['NOPE99', b, NAME('壞列'), '專員', '2026-10-06']];
    const l = await legacyImport(rows(code.goodL, code.badL));
    const n = await nativeImport(rows(code.goodN, code.badN));
    const legacy: Facts = { importedCount: l.imported, errorRows: l.errors.map((e) => e.row), goodRowStored: (await fact(code.goodL)) !== 'none', badRowStored: (await fact(code.badL)) !== 'none' };
    const native: Facts = { importedCount: n.saved?.imported ?? 0, errorRows: Array.from(new Set<number>(n.preview.errors.map((e: any) => Number(e.row)))).sort(), goodRowStored: (await fact(code.goodN)) !== 'none', badRowStored: (await fact(code.badN)) !== 'none' };
    record('import-partial-error', '部分列錯誤時的儲存結果', 'write-readback', 'POST /api/import-employees', 'POST /api/workspace/employee-import（預覽）', legacy, native);
  });

  test('職位不在公司清單、員編格式不合法：舊版照單全收、新版預覽標示錯誤且不新增（F.1、E.1 已核可差異）', async () => {
    const rows = (p: string, f: string): ImportRow[] => [['ZT01', p, NAME('職位'), '不存在的職位', '2026-10-07'], ['ZT01', f, NAME('格式'), '專員', '2026-10-07']];
    await legacyImport(rows(code.posL, code.fmtL));
    await nativeImport(rows(code.posN, code.fmtN));
    const stored = async (c: string) => (await fact(c)) !== 'none';
    const legacy: Facts = { storedBadPosition: await stored(code.posL), storedBadFormat: await stored(code.fmtL) };
    const native: Facts = { storedBadPosition: await stored(code.posN), storedBadFormat: await stored(code.fmtN) };
    record('import-restrictions', '職位與員編格式限制', 'write-readback', 'POST /api/import-employees', 'POST /api/workspace/employee-import（預覽）', legacy, native);
  });
});

test.describe('P02 調店確認對等（H.1，取代 D.2）', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let sup: APIRequestContext;
  let ops: APIRequestContext;
  let st: Record<string, string> = {};
  let storeOf: Record<string, string> = {};
  let undo: () => Promise<void> = async () => undefined;
  const started = new Date().toISOString();
  const code = { tL: p02Code('FKF', 71), tN: p02Code('FKF', 72), bL: p02Code('FKF', 73), bN: p02Code('FKF', 74) };
  const all = () => Object.values(code);

  test.beforeAll(async () => {
    st = await p02Stores();
    storeOf = Object.fromEntries(Object.entries(st).map(([c, id]) => [id, c]));
    await purgeP02(all());
    undo = await grantTransferSupervisors([
      { roleCode: 'vue_workspace_supervisor', email: 'vue-workspace-supervisor@example.test', stores: [st.ZT01, st.ZT02, st.ZT03] },
      { roleCode: 'vue_workspace_ops_manager', email: 'vue-workspace-ops-manager@example.test', stores: [st.ZT04] },
    ]);
    admin = await apiAs('admin');
    sup = await apiAs('supervisor');
    ops = await apiAs('ops_manager');
  });
  test.afterAll(async () => {
    await registerP02(all()).catch(() => undefined);
    await purgeP02(all()).catch(() => undefined);
    await purgeReceipts(started, [st.ZT01]).catch(() => undefined);
    await undo().catch(() => undefined);
    for (const a of [admin, sup, ops]) await a?.dispose();
  });

  const hist = async (c: string) => (await historyOf(c)).map((h) => [h.movement_type, h.movement_date, h.old_value, h.new_value].join('|'));
  const active = async (c: string) => (await masterOf(c)).filter((m) => m.is_active).map((m) => storeOf[m.store_id]).join(',');

  test('申請確認：舊版與新版都是任一督導（或管理員）確認一次就生效（H.1，取代 D.2 雙方確認）；生效後申請狀態與異動歷史相同', async () => {
    await seedMaster(code.tL, NAME('調店舊'), st.ZT01);
    await seedMaster(code.tN, NAME('調店新'), st.ZT01);
    const created = await admin.post('/api/store-transfer-requests', { data: { employee_code: code.tL, employee_name: NAME('調店舊'), from_store_id: st.ZT01, to_store_id: st.ZT04, notes: '' } });
    expect(created.status(), await created.text()).toBe(200);
    const legacyId = (await created.json()).data.id as string;
    const nativeCreated = await admin.post('/api/workspace/transfers/create', { data: { requestId: randomUUID(), data: { employee_code: code.tN, employee_name: NAME('調店新'), from_store_id: st.ZT01, to_store_id: st.ZT04, notes: '' } } });
    expect(nativeCreated.status(), await nativeCreated.text()).toBe(200);
    const nativeId = (await nativeCreated.json()).id as string;

    // 舊版對未來生效日只記錄、不立刻換主檔門市（新版確認後立即更新，M1 已核可），所以兩邊都用過去日期，只比較督導確認規則。
    const lc = await admin.post(`/api/store-transfer-requests/${legacyId}/confirm`, { data: { effective_date: '2026-10-05' } });
    expect(lc.status(), await lc.text()).toBe(200);
    // 新版：原店督導一個人確認即生效
    const pv = await sup.post('/api/workspace/transfers/preview', { data: { id: nativeId, effective_date: '2026-10-05' } });
    expect(pv.status(), await pv.text()).toBe(200);
    const done = await sup.post('/api/workspace/transfers/confirm', { data: { id: nativeId, effective_date: '2026-10-05', version: (await pv.json()).version } });
    expect(done.status(), await done.text()).toBe(200);
    const fin = async (c: string): Promise<Facts> => ({ finalStatus: (await transferRequestsOf(c))[0]?.status, finalHistory: await hist(c), finalActiveStore: await active(c) });
    record(
      'transfer-confirm-any-supervisor', '調店申請確認：一位督導確認後', 'write-readback',
      'POST /api/store-transfer-requests/[id]/confirm', 'POST /api/workspace/transfers/confirm',
      await fin(code.tL), await fin(code.tN),
    );
  });

  test('批次輸入的調店列：舊版直接生效、新版建立待確認申請（D.2 已核可差異）；確認後結果相同', async () => {
    await seedMaster(code.bL, NAME('批次調店舊'), st.ZT01);
    await seedMaster(code.bN, NAME('批次調店新'), st.ZT01);
    const lb = await admin.post('/api/employee-movements/batch', { data: { movements: [{ employee_code: code.bL, employee_name: NAME('批次調店舊'), store_id: st.ZT04, movement_type: 'store_transfer', from_store_id: st.ZT01, to_store_id: st.ZT04, effective_date: '2026-10-06', notes: '', onboarding_is_pharmacist: false }] } });
    expect(lb.status(), await lb.text()).toBe(200);
    const nb = await submitMovements(admin, [{ employee_code: code.bN, employee_name: NAME('批次調店新'), movement_type: 'store_transfer', from_store_id: st.ZT01, to_store_id: st.ZT04, effective_date: '2026-10-06' }]);
    expect(nb.ok, JSON.stringify(nb.body)).toBe(true);
    const afterBatch = async (c: string): Promise<Facts> => ({ historyAfterBatch: (await hist(c)).length, pendingRequestsAfterBatch: (await transferRequestsOf(c)).filter((r) => r.status === 'pending').length, activeStoreAfterBatch: await active(c) });
    const first = { legacy: await afterBatch(code.bL), native: await afterBatch(code.bN) };
    // 新版：管理員代兩側確認
    const req = (await transferRequestsOf(code.bN))[0];
    const pv = await admin.post('/api/workspace/transfers/preview', { data: { id: req.id, effective_date: '2026-10-06' } });
    expect(pv.status(), await pv.text()).toBe(200);
    const done = await admin.post('/api/workspace/transfers/confirm', { data: { id: req.id, effective_date: '2026-10-06', version: (await pv.json()).version } });
    expect(done.status(), await done.text()).toBe(200);
    const fin = async (c: string): Promise<Facts> => ({ finalHistory: await hist(c), finalActiveStore: await active(c) });
    record(
      'batch-transfer', '批次輸入調店：登記後與確認後', 'write-readback',
      'POST /api/employee-movements/batch', 'POST /api/workspace/movement-submit',
      { ...first.legacy, ...(await fin(code.bL)) }, { ...first.native, ...(await fin(code.bN)) },
    );
  });
});

import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { W06_MONTHS, adminDb, historyOf, insertHistory, masterOf, purgeReceipts, purgeW06, recompute, registerW06, rosterRows, seedMaster, seedRoster, w06Code, w06StoreIds } from '../support/w06-fixtures';

// W06 C 組寫入對等層：同一組測試資料，分別走舊版 PATCH／DELETE /api/employee-movements/[id]
// 與新版 /api/workspace/employee-movements/[id]，以 service role 回讀異動歷史、員工主檔、每月人員狀態逐欄比對。
// 與舊版不同且使用者已核可的差異（C.1 刪除後恢復主檔、只能刪最新一筆、A.2 已送審月份不動）登記在
// tests/parity/allowlist.json（approvedBy "user (2026-11-05 survey/m2)"）。舊版與新版各用自己的員編。

const map = loadMap('movement-sync');
const recorder = new ParityRecorder('movement-sync');
const permMap = loadMap('movement-edit-delete');
const permRecorder = new ParityRecorder('movement-edit-delete');
const entry = (id: string) => map.entries.find((e) => e.id === id)!.id;
const { m1, m2 } = W06_MONTHS;
type Facts = Record<string, unknown>;

test.describe('W06 C 組 歷史異動修改與刪除對等', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let zt01 = '';
  const started = new Date().toISOString();
  const code = {
    editL: w06Code('FKF', 31), editN: w06Code('FKF', 35),
    nameL: w06Code('FKF', 32), nameN: w06Code('FKF', 36),
    delL: w06Code('FKF', 33), delN: w06Code('FKF', 37),
    oldL: w06Code('FKF', 34), oldN: w06Code('FKF', 38),
  };
  const all = () => Object.values(code);

  test.beforeAll(async () => {
    admin = await apiAs('admin');
    zt01 = (await w06StoreIds(admin, m1)).ZT01;
    await purgeW06(all(), [zt01]);
  });
  test.afterAll(async () => {
    await registerW06(all()).catch(() => undefined);
    await purgeW06(all(), [zt01]).catch(() => undefined);
    await purgeReceipts(started, [zt01]).catch(() => undefined);
    await admin?.dispose();
  });

  const legacyUrl = (id: string) => `/api/employee-movements/${id}`;
  const nativeUrl = (id: string) => `/api/workspace/employee-movements/${id}`;
  const at = (rows: Record<string, any>[], month: string) => rows.find((r) => r.year_month === month);
  const hist = async (c: string) => (await historyOf(c)).map((h) => [h.movement_type, h.movement_date, h.employee_name, h.old_value, h.new_value, h.notes].join('|'));

  function record(id: string, title: string, method: string, legacy: Facts, native: Facts) {
    assertNoUnlistedDiffs(
      recorder.record({
        entry: entry(id),
        mechanism: 'write-readback',
        role: 'admin',
        title,
        legacy: { endpoint: `${method} /api/employee-movements/[id]` },
        native: { endpoint: `${method} /api/workspace/employee-movements/[id]` },
        compared: { facts: Object.keys(legacy).length },
        diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
      }),
    );
  }

  async function seedPromotion(c: string, name: string, o: { lockedM2?: boolean } = {}) {
    await seedMaster(c, name, zt01, { position: '專員' });
    await seedRoster(zt01, m1, [{ code: c, name }]);
    await seedRoster(zt01, m2, [{ code: c, name, status: o.lockedM2 ? 'submitted' : 'draft' }]);
    const id = await insertHistory({ code: c, name, store: zt01, type: 'promotion', date: '2025-03-10', old: '專員', new: '組長' });
    await recompute(c, m1, { type: 'promotion' });
    return id;
  }

  test('修改升職職位（草稿月份）：異動歷史、名冊職位對等；主檔職位同步為已核可差異', async () => {
    const ids: Record<string, string> = {};
    for (const c of [code.editL, code.editN]) ids[c] = await seedPromotion(c, 'W06對等 改升職');
    const l = await admin.patch(legacyUrl(ids[code.editL]), { data: { employee_name: 'W06對等 改升職', movement_date: '2025-03-10', new_value: '副店長', notes: '' } });
    expect(l.status(), await l.text()).toBe(200);
    const n = await admin.patch(nativeUrl(ids[code.editN]), { data: { employee_name: 'W06對等 改升職', movement_date: '2025-03-10', position: '副店長', notes: '' } });
    expect(n.status(), await n.text()).toBe(200);
    const facts = async (c: string): Promise<Facts> => {
      const rows = await rosterRows(c);
      return { history: await hist(c), m1Position: at(rows, m1)?.position, m2Position: at(rows, m2)?.position, masterPosition: (await masterOf(c))[0]?.current_position };
    };
    record('edit-promotion', '修改升職職位：異動歷史、名冊職位、主檔職位', 'PATCH', await facts(code.editL), await facts(code.editN));
  });

  test('修改姓名：草稿月份、已送審月份、主檔、歷史全部對等（H.9：姓名同步全部月份，取代 A.2 對姓名的例外）', async () => {
    const ids: Record<string, string> = {};
    for (const c of [code.nameL, code.nameN]) ids[c] = await seedPromotion(c, 'W06對等 原名', { lockedM2: true });
    const body = { employee_name: 'W06對等 新名', movement_date: '2025-03-10', notes: '改名' };
    const l = await admin.patch(legacyUrl(ids[code.nameL]), { data: { ...body, new_value: '組長' } });
    expect(l.status(), await l.text()).toBe(200);
    const n = await admin.patch(nativeUrl(ids[code.nameN]), { data: { ...body, position: '組長' } });
    expect(n.status(), await n.text()).toBe(200);
    const facts = async (c: string): Promise<Facts> => {
      const rows = await rosterRows(c);
      return { history: await hist(c), masterName: (await masterOf(c))[0]?.employee_name, draftName: at(rows, m1)?.employee_name, lockedName: at(rows, m2)?.employee_name };
    };
    record('edit-name', '修改姓名：異動歷史、主檔姓名、草稿月份姓名、已送審月份姓名', 'PATCH', await facts(code.nameL), await facts(code.nameN));
  });

  test('刪除最新一筆升職：異動歷史、名冊職位對等；主檔職位恢復為已核可差異（C.1）', async () => {
    const ids: Record<string, string> = {};
    for (const c of [code.delL, code.delN]) {
      ids[c] = await seedPromotion(c, 'W06對等 刪升職');
      await adminDb().from('store_employees').update({ position: '組長', current_position: '組長' }).eq('employee_code', c); // 升職後主檔的樣子
    }
    const l = await admin.delete(legacyUrl(ids[code.delL]));
    expect(l.status(), await l.text()).toBe(200);
    const n = await admin.delete(nativeUrl(ids[code.delN]));
    expect(n.status(), await n.text()).toBe(200);
    const facts = async (c: string): Promise<Facts> => {
      const rows = await rosterRows(c);
      return { history: await hist(c), m1Position: at(rows, m1)?.position, m2Position: at(rows, m2)?.position, masterPosition: (await masterOf(c))[0]?.current_position };
    };
    record('delete-latest', '刪除最新一筆升職：異動歷史、名冊職位、主檔職位', 'DELETE', await facts(code.delL), await facts(code.delN));
  });

  test('刪除非最新一筆：舊版可刪、新版回 409 並保留歷史（C.1 只能刪最新一筆，已核可差異）', async () => {
    const first: Record<string, string> = {};
    for (const c of [code.oldL, code.oldN]) {
      await seedMaster(c, 'W06對等 非最新', zt01, { position: '專員' });
      first[c] = await insertHistory({ code: c, name: 'W06對等 非最新', store: zt01, type: 'promotion', date: '2025-03-10', old: '專員', new: '組長' });
      await insertHistory({ code: c, name: 'W06對等 非最新', store: zt01, type: 'promotion', date: '2025-05-10', old: '組長', new: '副店長' });
    }
    const l = await admin.delete(legacyUrl(first[code.oldL]));
    const n = await admin.delete(nativeUrl(first[code.oldN]));
    const facts = async (c: string, status: number): Promise<Facts> => ({ ok: status === 200, history: (await hist(c)).join(' ;; ') });
    record('delete-non-latest', '刪除非最新一筆：是否成功、剩餘異動歷史', 'DELETE', await facts(code.oldL, l.status()), await facts(code.oldN, n.status()));
  });

  test('C.2 權限對等：各角色（單一權限、無權限、未登入）呼叫舊版與新版的修改、刪除，狀態碼一致', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    const roles = ['denied', 'employee', 'movement_manage_only', 'employee_manage_only', 'promotion_batch_only', 'promotion_delete_only', 'admin', 'anonymous'];
    const facts: Record<string, { legacy: Facts; native: Facts }> = { PATCH: { legacy: {}, native: {} }, DELETE: { legacy: {}, native: {} } };
    for (const role of roles) {
      const who = role === 'anonymous' ? await playwrightRequest.newContext({ baseURL: 'http://localhost:3002', extraHTTPHeaders: { Origin: 'http://localhost:3002' } }) : await apiAs(role);
      try {
        const lp = await who.patch(legacyUrl(missing), { data: { notes: 'x' } });
        const np = await who.patch(nativeUrl(missing), { data: { notes: 'x' } });
        const ld = await who.delete(legacyUrl(missing));
        const nd = await who.delete(nativeUrl(missing));
        facts.PATCH.legacy[role] = lp.status();
        facts.PATCH.native[role] = np.status();
        facts.DELETE.legacy[role] = ld.status();
        facts.DELETE.native[role] = nd.status();
      } finally {
        await who.dispose();
      }
    }
    for (const [method, id] of [['PATCH', 'patch-permissions'], ['DELETE', 'delete-permissions']] as const) {
      const e = permMap.entries.find((x) => x.id === id)!.id;
      assertNoUnlistedDiffs(
        permRecorder.record({
          entry: e,
          mechanism: 'write-readback',
          role: 'matrix',
          title: `${method} 權限矩陣狀態碼（${roles.join('、')}）`,
          legacy: { endpoint: `${method} /api/employee-movements/[id]` },
          native: { endpoint: `${method} /api/workspace/employee-movements/[id]` },
          compared: { roles: roles.length },
          diffs: valueDiffsToDiffs(diffNormalized(facts[method].legacy, facts[method].native)),
        }),
      );
    }
  });
});

import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import {
  W06_MONTHS,
  adjustmentsOf,
  historyOf,
  masterOf,
  purgeReceipts,
  purgeW06,
  recheckOf,
  registerW06,
  rosterRows,
  seedMaster,
  seedRoster,
  submitMovements,
  w06Code,
  w06StoreIds,
} from '../support/w06-fixtures';

// W06 寫入對等層（M2 規格 A、B 組）：同一組 A/B 測試資料，分別走舊版 POST /api/employee-movements/batch
// 與新版 movement-validation／movement-submit，再以 service role 回讀 employee_movement_history、monthly_staff_status
// （含員工主檔、需重新確認、近期調整紀錄）逐欄比對。與舊版不同且使用者已核可的差異（A.1 四類回寫、A.2、A.3、A.4、B.2、B.3）
// 登記在 tests/parity/allowlist.json（approvedBy "user (2026-11-05 survey/m2)"）。
// 舊版與新版各用自己的員編（同一個資料庫不能共用），只比對與員編無關的事實。

const map = loadMap('movement-sync');
const recorder = new ParityRecorder('movement-sync');
const entry = (id: string) => map.entries.find((e) => e.id === id)!.id;
const { m1, m2, m3 } = W06_MONTHS;

type Facts = Record<string, unknown>;

test.describe('W06 異動回寫對等', () => {
  test.describe.configure({ mode: 'serial' });
  let admin: APIRequestContext;
  let zt01 = '';
  const started = new Date().toISOString();
  // 每個情境一組員編（舊版、新版各一）。FK 用 0-9 流水：舊版 1-4、新版 5-8，FKF 用於需要第二位員工的情境。
  const code = {
    promoL: w06Code('FK', 1), promoN: w06Code('FK', 5),
    lockL: w06Code('FK', 2), lockN: w06Code('FK', 6),
    rankL: w06Code('FK', 3), rankN: w06Code('FK', 7),
    actL: w06Code('FK', 4), actN: w06Code('FK', 8),
    leaveL: w06Code('FKF', 11), leaveN: w06Code('FKF', 15),
    resL: w06Code('FKF', 12), resN: w06Code('FKF', 16),
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

  async function legacyBatch(movements: Record<string, unknown>[]) {
    const res = await admin.post('/api/employee-movements/batch', { data: { movements } });
    const body = await res.json().catch(() => ({}));
    expect(res.status(), JSON.stringify(body)).toBe(200);
    expect(body.success, JSON.stringify(body)).toBe(true);
  }
  async function nativeBatch(rows: Record<string, unknown>[]) {
    const r = await submitMovements(admin, rows);
    expect(r.ok, JSON.stringify(r.body)).toBe(true);
  }
  const hist = async (c: string) => (await historyOf(c)).map((h) => [h.movement_type, h.movement_date, h.old_value, h.new_value, h.notes].join('|'));
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const at = (rows: Record<string, any>[], month: string) => rows.find((r) => r.year_month === month);

  function record(id: string, title: string, legacy: Facts, native: Facts) {
    assertNoUnlistedDiffs(
      recorder.record({
        entry: entry(id),
        mechanism: 'write-readback',
        role: 'admin',
        title,
        legacy: { endpoint: 'POST /api/employee-movements/batch' },
        native: { endpoint: 'POST /api/workspace/movement-submit' },
        compared: { facts: Object.keys(legacy).length },
        diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
      }),
    );
  }

  test('升職（草稿月份）：異動歷史、名冊職位對等；主檔同步（B.3）與近期調整紀錄（A.3）為已核可差異', async () => {
    for (const c of [code.promoL, code.promoN]) {
      await seedMaster(c, 'W06對等 升職', zt01, { position: '專員' });
      await seedRoster(zt01, m1, [{ code: c, name: 'W06對等 升職' }]);
      await seedRoster(zt01, m2, [{ code: c, name: 'W06對等 升職' }]);
    }
    const input = (c: string) => ({ employee_code: c, employee_name: 'W06對等 升職', store_id: zt01, movement_type: 'promotion', position: '組長', effective_date: '2025-03-10' });
    await legacyBatch([input(code.promoL)]);
    await nativeBatch([input(code.promoN)]);
    const facts = async (c: string): Promise<Facts> => {
      const rows = await rosterRows(c);
      return { m1Position: at(rows, m1)?.position, m2Position: at(rows, m2)?.position, history: await hist(c), masterPosition: (await masterOf(c))[0]?.current_position, adjustmentLogged: (await adjustmentsOf(c)).length > 0 };
    };
    record('promo-unlocked', '升職（草稿）：名冊職位、異動歷史、主檔職位、調整紀錄', await facts(code.promoL), await facts(code.promoN));
  });

  test('升職（已送審月份）：舊版直接改寫；新版不動並記入需重新確認（A.2）', async () => {
    for (const c of [code.lockL, code.lockN]) {
      await seedMaster(c, 'W06對等 鎖月', zt01, { position: '專員' });
      await seedRoster(zt01, m1, [{ code: c, name: 'W06對等 鎖月' }]);
      await seedRoster(zt01, m2, [{ code: c, name: 'W06對等 鎖月', status: 'submitted' }]);
    }
    const input = (c: string) => ({ employee_code: c, employee_name: 'W06對等 鎖月', store_id: zt01, movement_type: 'promotion', position: '組長', effective_date: `${m1}-10` });
    await legacyBatch([input(code.lockL)]);
    await nativeBatch([input(code.lockN)]);
    const facts = async (c: string): Promise<Facts> => {
      const rows = await rosterRows(c);
      return { draftPosition: at(rows, m1)?.position, lockedPosition: at(rows, m2)?.position, lockedStatus: at(rows, m2)?.status, history: await hist(c), recheckPending: (await recheckOf(c)).length };
    };
    record('promo-locked', '升職（已送審月份）：草稿月份職位、已送審月份職位與狀態、需重新確認筆數', await facts(code.lockL), await facts(code.lockN));
  });

  test('初始化後才登錄留停、離職：舊版名冊不變；新版回寫並移出後續月份（A.1、A.4）', async () => {
    for (const c of [code.leaveL, code.leaveN, code.resL, code.resN]) {
      await seedMaster(c, 'W06對等 人員', zt01);
      for (const m of [m1, m2, m3]) await seedRoster(zt01, m, [{ code: c, name: 'W06對等 人員' }]);
    }
    const leave = (c: string) => ({ employee_code: c, employee_name: 'W06對等 人員', store_id: zt01, movement_type: 'leave_without_pay', effective_date: `${m1}-20` });
    const resign = (c: string) => ({ employee_code: c, employee_name: 'W06對等 人員', store_id: zt01, movement_type: 'resignation', effective_date: `${m2}-12` });
    await legacyBatch([leave(code.leaveL), resign(code.resL)]);
    await nativeBatch([leave(code.leaveN), resign(code.resN)]);
    const facts = async (l: string, r: string): Promise<Facts> => {
      const lr = await rosterRows(l);
      const rr = await rosterRows(r);
      return {
        leaveMonthStatus: at(lr, m1)?.monthly_status,
        leaveMonthWorkDays: num(at(lr, m1)?.work_days),
        laterMonthListed: lr.some((x) => x.year_month === m2 || x.year_month === m3),
        resignMonthStatus: at(rr, m2)?.monthly_status,
        resignMonthWorkDays: num(at(rr, m2)?.work_days),
        resignLaterMonthListed: rr.some((x) => x.year_month === m3),
        masterStatus: [(await masterOf(l))[0]?.employment_status, (await masterOf(r))[0]?.employment_status].join('/'),
        history: [...(await hist(l)), ...(await hist(r))],
      };
    };
    record('leave-resign-after-init', '留停、離職（初始化後登錄）：生效月名冊狀態與天數、後續月份是否列名冊、主檔狀態、異動歷史', await facts(code.leaveL, code.resL), await facts(code.leaveN, code.resN));
  });

  test('同日登記新人二階與專員：新版取相對最高職等（B.2）', async () => {
    for (const c of [code.rankL, code.rankN]) {
      await seedMaster(c, 'W06對等 同日', zt01, { position: '新人' });
      await seedRoster(zt01, m1, [{ code: c, name: 'W06對等 同日', position: '新人' }]);
    }
    const inputs = (c: string) => [
      { employee_code: c, employee_name: 'W06對等 同日', store_id: zt01, movement_type: 'promotion', position: '專員', effective_date: '2025-04-10' },
      { employee_code: c, employee_name: 'W06對等 同日', store_id: zt01, movement_type: 'promotion', position: '新人', newbie_level: '二階新人', effective_date: '2025-04-10' },
    ];
    await legacyBatch(inputs(code.rankL));
    await nativeBatch(inputs(code.rankN));
    const facts = async (c: string): Promise<Facts> => {
      const rows = await rosterRows(c);
      return { monthPosition: at(rows, m1)?.position, monthLevel: at(rows, m1)?.newbie_level ?? null, masterPosition: (await masterOf(c))[0]?.current_position, history: (await historyOf(c)).map((h) => [h.movement_type, h.movement_date, h.new_value, h.notes].join('|')).sort() };
    };
    record('same-day-multi-level', '同日兩筆升職：名冊職位與階段、主檔職位、異動歷史', await facts(code.rankL), await facts(code.rankN));
  });

  test('代理店長：生效月起標註記、不改正式職位（舊版與新版一致）', async () => {
    for (const c of [code.actL, code.actN]) {
      await seedMaster(c, 'W06對等 代理', zt01, { position: '副店長' });
      await seedRoster(zt01, m1, [{ code: c, name: 'W06對等 代理', position: '副店長' }]);
      await seedRoster(zt01, m2, [{ code: c, name: 'W06對等 代理', position: '副店長' }]);
    }
    const input = (c: string) => ({ employee_code: c, employee_name: 'W06對等 代理', store_id: zt01, movement_type: 'acting_manager', position: '代理店長', effective_date: `${m2}-12` });
    await legacyBatch([input(code.actL)]);
    await nativeBatch([input(code.actN)]);
    const facts = async (c: string): Promise<Facts> => {
      const rows = await rosterRows(c);
      return { m1Acting: at(rows, m1)?.is_acting_manager, m2Acting: at(rows, m2)?.is_acting_manager, m2Position: at(rows, m2)?.position, history: await hist(c) };
    };
    record('acting-manager', '代理店長：各月份代理標記與正式職位、異動歷史', await facts(code.actL), await facts(code.actN));
  });
});

import { expect, test } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { formatTaipeiDate } from '../../lib/inspection/gps-policy';
import {
  buildBody,
  createInspectionViaApi,
  deleteRunInspections,
  findMasterByNotes,
  fix,
  insertMasterAsServiceRole,
  marker,
  readMaster,
  registerInspection,
  runIdOrThrow,
  storeIdByCode,
  updateMasterAsServiceRole,
} from '../support/i01-fixtures';

// I01 整合層：新增巡店的定位檢查。
//  - API（/api/workspace/inspection-form）：缺定位、座標、精度 >1000、時間窗 → 400 中文訊息；合格 → 200 且寫入 gps_*；
//    巡店日期依定位時間（台北）；編輯忽略 body.gps 與 body.date，不覆蓋。
//  - 資料庫 BEFORE INSERT trigger（舊版直接寫入也被擋）：拒絕與允許；UPDATE 不檢查。
// 測試資料只用測試門市（VW001、VW002、ZT01…），備註帶 ZT<runId> 標記，結束時清除。

const MIN = 60_000;
const HOUR = 60 * MIN;

test.afterAll(async () => {
  await deleteRunInspections();
});

test.describe('API：新增巡店的定位檢查', () => {
  test('缺定位 / 欄位不全 / 座標超出範圍 / 誤差過大 / 時間窗：一律 400 中文訊息，沒有寫入', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const store = await storeIdByCode(admin, 'VW001');
      const cases: Array<{ name: string; gps: unknown; message: RegExp }> = [
        { name: '沒有 gps', gps: undefined, message: /必須先完成定位/ },
        { name: 'gps 為 null', gps: null, message: /必須先完成定位/ },
        { name: '缺 accuracy', gps: { latitude: 25.03, longitude: 121.56, capturedAt: new Date().toISOString() }, message: /定位資料不完整/ },
        { name: '缺 capturedAt', gps: { latitude: 25.03, longitude: 121.56, accuracy: 20 }, message: /定位時間異常/ },
        { name: '緯度超出範圍', gps: fix({ latitude: 91 }), message: /超出範圍/ },
        { name: '經度超出範圍', gps: fix({ longitude: -181 }), message: /超出範圍/ },
        { name: '誤差 1000.5', gps: fix({ accuracy: 1000.5 }), message: /定位誤差過大（±1001 公尺）/ },
        { name: '誤差 1500', gps: fix({ accuracy: 1500 }), message: /定位誤差過大（±1500 公尺）/ },
        { name: '誤差為負數', gps: fix({ accuracy: -1 }), message: /定位資料不完整/ },
        { name: '定位時間早於現在 3 小時', gps: fix({ capturedAt: new Date(Date.now() - 3 * HOUR).toISOString() }), message: /定位時間異常/ },
        { name: '定位時間晚於現在 10 分鐘', gps: fix({ capturedAt: new Date(Date.now() + 10 * MIN).toISOString() }), message: /定位時間異常/ },
        { name: '定位時間不是日期', gps: fix({ capturedAt: 'not-a-date' }), message: /定位時間異常/ },
      ];
      for (const c of cases) {
        const body = await buildBody(admin, store, 'reject', { gps: c.gps });
        if (c.gps === undefined) delete (body as Record<string, unknown>).gps;
        const res = await admin.post('/api/workspace/inspection-form', { data: body });
        const json = await res.json();
        expect(res.status(), `${c.name}：${JSON.stringify(json)}`).toBe(400);
        expect(json.error, c.name).toMatch(c.message);
        expect(json.error, c.name).toMatch(/重新定位/);
      }
      expect(await findMasterByNotes(marker('reject')), '被拒絕的請求不得寫入任何巡店').toHaveLength(0);
    } finally {
      await admin.dispose();
    }
  });

  test('合格定位：200，寫入 gps_*，巡店日期依定位時間（台北），誤差剛好 1000 也通過', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const store = await storeIdByCode(admin, 'VW001');
      // 跨日邊界：定位時間 = 現在往前 90 分鐘（仍在 2 小時內），日期必須取自定位時間而不是 body.date。
      const capturedAt = new Date(Date.now() - 90 * MIN).toISOString();
      const created = await createInspectionViaApi(admin, store, 'ok', {
        gps: fix({ accuracy: 1000, capturedAt }),
        date: '2020-01-01',
      });
      expect(created.res.status(), JSON.stringify(created.json)).toBe(200);
      const id: string = created.json.record.id;
      await registerInspection(id);
      const row = await readMaster(id);
      expect(Number(row!.gps_latitude)).toBeCloseTo(25.033, 4);
      expect(Number(row!.gps_longitude)).toBeCloseTo(121.5654, 4);
      expect(Number(row!.gps_accuracy)).toBe(1000);
      expect(Date.parse(row!.gps_timestamp)).toBe(Date.parse(capturedAt));
      expect(row!.inspection_date).toBe(formatTaipeiDate(capturedAt));
      expect(row!.inspector_id).toBeTruthy();
    } finally {
      await admin.dispose();
    }
  });

  test('編輯忽略 body.gps 與 body.date：gps_* 與巡店日期維持第一次的值', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const store = await storeIdByCode(admin, 'VW002');
      const created = await createInspectionViaApi(admin, store, 'edit');
      expect(created.res.status(), JSON.stringify(created.json)).toBe(200);
      const id: string = created.json.record.id;
      await registerInspection(id);
      const first = await readMaster(id);

      const edited = await buildBody(admin, store, 'edit', {
        id,
        version: created.json.record.workspace_version,
        status: 'draft',
        notes: marker('edit') + '-v2',
        gps: fix({ latitude: 10, longitude: 10, accuracy: 5, capturedAt: new Date(Date.now() - 30 * MIN).toISOString() }),
        date: '2020-02-02',
      });
      const res = await admin.post('/api/workspace/inspection-form', { data: edited });
      const editedJson = await res.json();
      expect(res.status(), JSON.stringify(editedJson)).toBe(200);
      const after = await readMaster(id);
      expect(after!.supervisor_notes).toBe(marker('edit') + '-v2');
      expect(after!.gps_latitude).toBe(first!.gps_latitude);
      expect(after!.gps_longitude).toBe(first!.gps_longitude);
      expect(after!.gps_accuracy).toBe(first!.gps_accuracy);
      expect(Date.parse(after!.gps_timestamp)).toBe(Date.parse(first!.gps_timestamp));
      expect(after!.inspection_date).toBe(first!.inspection_date);

      // 編輯時不帶 gps 也可以儲存（不要求重新定位）。
      const noGps = await buildBody(admin, store, 'edit', { id, version: editedJson.record.workspace_version, status: 'draft', notes: marker('edit') + '-v3' });
      delete (noGps as Record<string, unknown>).gps;
      const res2 = await admin.post('/api/workspace/inspection-form', { data: noGps });
      expect(res2.status(), JSON.stringify(await res2.json())).toBe(200);
      const final = await readMaster(id);
      expect(final!.supervisor_notes).toBe(marker('edit') + '-v3');
      expect(final!.gps_accuracy).toBe(first!.gps_accuracy);
    } finally {
      await admin.dispose();
    }
  });

  test('重送：同 writeId 同 body 在時間窗過後仍回 replayed；新 writeId 重送同一筆回 409 DUPLICATE_DAY', async () => {
    test.setTimeout(90_000);
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const store = await storeIdByCode(admin, 'ZT04');
      // 定位時間距今 2 小時少 15 秒：建立當下合格，16 秒後已逾時間窗。
      const edge = fix({ capturedAt: new Date(Date.now() - (2 * HOUR - 15_000)).toISOString() });
      const created = await createInspectionViaApi(admin, store, 'replay', { gps: edge, date: formatTaipeiDate(edge.capturedAt) });
      expect(created.res.status(), JSON.stringify(created.json)).toBe(200);
      await registerInspection(created.json.record.id);
      await new Promise((r) => setTimeout(r, 16_000));
      const replay = await admin.post('/api/workspace/inspection-form', { data: created.body });
      const replayJson = await replay.json();
      expect(replay.status(), JSON.stringify(replayJson)).toBe(200);
      expect(replayJson.replayed).toBe(true);
      expect(replayJson.record.id).toBe(created.json.record.id);
      // 新 writeId 重送同一筆已存在的新增：時間窗已過會先被 400 擋下，所以改用合格定位重送。
      const again = await buildBody(admin, store, 'replay', { gps: edge, date: formatTaipeiDate(edge.capturedAt) });
      const fresh = fix();
      const res = await admin.post('/api/workspace/inspection-form', {
        data: { ...again, gps: fresh, date: formatTaipeiDate(fresh.capturedAt) },
      });
      const json = await res.json();
      expect(res.status(), JSON.stringify(json)).toBe(409);
    } finally {
      await admin.dispose();
    }
  });

  test('未登入不能寫入：401', async ({ request }) => {
    const res = await request.post(`${TEST_ORIGIN}/api/workspace/inspection-form`, { data: {}, headers: { Origin: TEST_ORIGIN } });
    expect([401, 403]).toContain(res.status());
  });
});

test.describe('資料庫 trigger：BEFORE INSERT 檢查定位（舊版直接寫入也會被擋）', () => {
  const rejects: Array<{ name: string; patch: Record<string, unknown>; message: RegExp }> = [
    { name: '四欄都沒有', patch: {}, message: /缺少定位座標、誤差或時間/ },
    { name: '缺 gps_timestamp', patch: { gps_latitude: 25.03, gps_longitude: 121.56, gps_accuracy: 20 }, message: /缺少定位/ },
    { name: '缺 gps_accuracy', patch: { gps_latitude: 25.03, gps_longitude: 121.56, gps_timestamp: new Date().toISOString() }, message: /缺少定位/ },
    { name: '緯度 91', patch: { gps_latitude: 91, gps_longitude: 121.56, gps_accuracy: 20, gps_timestamp: new Date().toISOString() }, message: /超出範圍/ },
    { name: '經度 181', patch: { gps_latitude: 25, gps_longitude: 181, gps_accuracy: 20, gps_timestamp: new Date().toISOString() }, message: /超出範圍/ },
    { name: '誤差 -1', patch: { gps_latitude: 25, gps_longitude: 121, gps_accuracy: -1, gps_timestamp: new Date().toISOString() }, message: /誤差資料不正確/ },
    { name: '誤差 1500', patch: { gps_latitude: 25, gps_longitude: 121, gps_accuracy: 1500, gps_timestamp: new Date().toISOString() }, message: /定位誤差過大（±1500 公尺）/ },
    { name: '時間早於 3 小時', patch: { gps_latitude: 25, gps_longitude: 121, gps_accuracy: 20, gps_timestamp: new Date(Date.now() - 3 * HOUR).toISOString() }, message: /超過 2 小時/ },
    { name: '時間晚於 10 分鐘', patch: { gps_latitude: 25, gps_longitude: 121, gps_accuracy: 20, gps_timestamp: new Date(Date.now() + 10 * MIN).toISOString() }, message: /晚於伺服器時間/ },
  ];
  for (const c of rejects) {
    test(`拒絕：${c.name}`, async () => {
      runIdOrThrow();
      const admin = await apiAs('admin');
      try {
        const store = await storeIdByCode(admin, 'ZT01');
        const r = await insertMasterAsServiceRole(store, c.patch);
        expect(r.error, '應被 trigger 擋下').toBeTruthy();
        expect(r.error.code).toBe('23514');
        expect(r.error.message).toContain('【巡店定位】');
        expect(r.error.message).toMatch(c.message);
        expect(r.data).toBeNull();
      } finally {
        await admin.dispose();
      }
    });
  }

  test('允許：合格定位可新增，誤差剛好 1000、時間在 2 小時內與未來 5 分鐘內；UPDATE 不檢查', async () => {
    runIdOrThrow();
    const admin = await apiAs('admin');
    try {
      const store = await storeIdByCode(admin, 'ZT01');
      const ok = await insertMasterAsServiceRole(store, { gps_latitude: 25.033, gps_longitude: 121.5654, gps_accuracy: 1000, gps_timestamp: new Date(Date.now() - 119 * MIN).toISOString() });
      expect(ok.error, JSON.stringify(ok.error)).toBeNull();
      await registerInspection(ok.data.id);
      // UPDATE 不檢查：可把定位改成不合格，也可只改備註（不影響既有資料與編輯）。
      const upd = await updateMasterAsServiceRole(ok.data.id, { supervisor_notes: marker('trigger'), gps_accuracy: 5000 });
      expect(upd.error, JSON.stringify(upd.error)).toBeNull();
      expect(Number(upd.data.gps_accuracy)).toBe(5000);
      const future = await insertMasterAsServiceRole(store, { inspection_date: '2099-01-01', gps_latitude: 25.033, gps_longitude: 121.5654, gps_accuracy: 0, gps_timestamp: new Date(Date.now() + 4 * MIN).toISOString() });
      expect(future.error, JSON.stringify(future.error)).toBeNull();
      await registerInspection(future.data.id);
    } finally {
      await admin.dispose();
    }
  });
});

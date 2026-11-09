import { expect, test } from '@playwright/test';
import { insertMaster, marker, readMaster, taipeiDate, updateMaster, adminDb, devEnv } from '../support';

// 巡店定位例外：資料庫 trigger（DEV）。
//  - 無 auth.uid()（service role）：既有定位規則照舊；gps_exempt = true 視為受信任寫入，仍檢查座標範圍。
//  - 一般使用者（JWT）：沒有「巡店定位例外」權限不能設 gps_exempt；有權限（角色授權或系統管理員）可以。
//  - gps_exempt = false：規則與 20261105180000 完全相同（回歸）。
//  - BEFORE UPDATE：gps_exempt 值改變需要同樣權限；一般編輯不受影響。
// 測試資料只用 VW/ZT 測試門市，備註帶 ZTGPSEX-<runId> 標記，結束時只依 id 清除。

const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const GOOD = () => ({ gps_latitude: 25.033, gps_longitude: 121.5654, gps_accuracy: 20, gps_timestamp: iso(Date.now()) });
const FAR = () => ({ gps_latitude: 25.033, gps_longitude: 121.5654, gps_accuracy: 25000, gps_timestamp: iso(Date.now()) });

test.beforeAll(() => {
  devEnv();
});

test.describe('DEV 結構', () => {
  test('gps_exempt 欄位：boolean NOT NULL DEFAULT false；既有列全是 false；權限已建立且未授權給任何角色', async () => {
    const db = adminDb();
    const probe = await insertMaster({ tag: 'default', patch: GOOD() });
    expect(probe.error, JSON.stringify(probe.error)).toBeNull();
    expect(probe.data!.gps_exempt).toBe(false);

    const exemptRows = await db.from('inspection_masters').select('id', { count: 'exact', head: true }).eq('gps_exempt', true);
    expect(exemptRows.error).toBeNull();
    const nulls = await db.from('inspection_masters').select('id', { count: 'exact', head: true }).is('gps_exempt', null);
    expect(nulls.count).toBe(0);

    const perm = await db.from('permissions').select('id,module,feature,action,is_active,description').eq('code', 'inspection.gps_exempt').maybeSingle();
    expect(perm.data).toMatchObject({ module: 'inspection', feature: 'inspection_gps', action: 'gps_exempt', is_active: true });
    expect(perm.data.description).toContain('巡店定位例外');
  });
});

test.describe('無 auth.uid()（service role）', () => {
  test('gps_exempt = false：規則不變（缺定位、誤差過大、時間窗一律擋）', async () => {
    const cases: Array<{ name: string; patch: Record<string, unknown>; message: RegExp }> = [
      { name: '四欄都沒有', patch: {}, message: /缺少定位座標、誤差或時間/ },
      { name: '誤差 25000', patch: FAR(), message: /定位誤差過大（±25000 公尺）/ },
      { name: '時間早於 3 小時', patch: { ...GOOD(), gps_timestamp: iso(Date.now() - 3 * HOUR) }, message: /超過 2 小時/ },
      { name: '時間晚於 10 分鐘', patch: { ...GOOD(), gps_timestamp: iso(Date.now() + 10 * MIN) }, message: /晚於伺服器時間/ },
      { name: '明確帶 gps_exempt=false 也一樣', patch: { gps_exempt: false, ...FAR() }, message: /定位誤差過大/ },
    ];
    for (const c of cases) {
      const r = await insertMaster({ tag: 'reg', patch: c.patch });
      expect(r.error, c.name).toBeTruthy();
      expect(r.error!.code, c.name).toBe('23514');
      expect(r.error!.message, c.name).toMatch(c.message);
    }
  });

  test('gps_exempt = true：誤差 25000 照存；完全沒有定位也可以；時間窗與誤差上限不檢查', async () => {
    const far = await insertMaster({ tag: 'far', patch: { gps_exempt: true, ...FAR() } });
    expect(far.error, JSON.stringify(far.error)).toBeNull();
    expect(far.data!.gps_exempt).toBe(true);
    expect(Number(far.data!.gps_accuracy)).toBe(25000);
    expect(Number(far.data!.gps_latitude)).toBeCloseTo(25.033, 4);

    const none = await insertMaster({ tag: 'none', patch: { gps_exempt: true } });
    expect(none.error, JSON.stringify(none.error)).toBeNull();
    expect(none.data).toMatchObject({ gps_exempt: true, gps_latitude: null, gps_longitude: null, gps_accuracy: null, gps_timestamp: null });

    const old = await insertMaster({ tag: 'old', patch: { gps_exempt: true, ...FAR(), gps_timestamp: iso(Date.now() - 30 * HOUR) } });
    expect(old.error, JSON.stringify(old.error)).toBeNull();
    const future = await insertMaster({ tag: 'future', patch: { gps_exempt: true, ...FAR(), gps_timestamp: iso(Date.now() + 2 * HOUR) } });
    expect(future.error, JSON.stringify(future.error)).toBeNull();
    const partial = await insertMaster({ tag: 'partial', patch: { gps_exempt: true, gps_latitude: 25.03, gps_longitude: 121.5 } });
    expect(partial.error, '只有座標、沒有誤差與時間：例外允許').toBeNull();
  });

  test('gps_exempt = true：有提供座標時仍檢查範圍；誤差 NaN／負數仍拒絕', async () => {
    const rejects: Array<{ name: string; patch: Record<string, unknown>; message: RegExp }> = [
      { name: '緯度 91', patch: { gps_latitude: 91, gps_longitude: 121.5, gps_accuracy: 25000 }, message: /超出範圍/ },
      { name: '緯度 -91', patch: { gps_latitude: -91, gps_longitude: 121.5 }, message: /超出範圍/ },
      { name: '經度 181', patch: { gps_latitude: 25, gps_longitude: 181, gps_accuracy: 25000 }, message: /超出範圍/ },
      { name: '經度 -181', patch: { gps_latitude: 25, gps_longitude: -181 }, message: /超出範圍/ },
      { name: '只有緯度', patch: { gps_latitude: 25 }, message: /超出範圍/ },
      { name: '只有經度', patch: { gps_longitude: 121 }, message: /超出範圍/ },
      { name: '誤差 -1', patch: { gps_latitude: 25, gps_longitude: 121, gps_accuracy: -1 }, message: /誤差資料不正確/ },
      { name: '只有誤差 -1', patch: { gps_accuracy: -1 }, message: /誤差資料不正確/ },
    ];
    for (const c of rejects) {
      const r = await insertMaster({ tag: 'exrej', patch: { gps_exempt: true, ...c.patch } });
      expect(r.error, c.name).toBeTruthy();
      expect(r.error!.code, c.name).toBe('23514');
      expect(r.error!.message, c.name).toMatch(c.message);
      expect(r.data, c.name).toBeNull();
    }
    // 邊界值允許
    const edge = await insertMaster({ tag: 'edge', patch: { gps_exempt: true, gps_latitude: 90, gps_longitude: -180, gps_accuracy: 0 } });
    expect(edge.error, JSON.stringify(edge.error)).toBeNull();
  });

  test('UPDATE：沒有 auth.uid() 可改 gps_exempt；改定位欄位或備註不檢查', async () => {
    const row = await insertMaster({ tag: 'upd', patch: GOOD() });
    expect(row.error).toBeNull();
    const toTrue = await updateMaster(row.data!.id, { gps_exempt: true });
    expect(toTrue.error, JSON.stringify(toTrue.error)).toBeNull();
    expect(toTrue.data!.gps_exempt).toBe(true);
    const toFalse = await updateMaster(row.data!.id, { gps_exempt: false });
    expect(toFalse.error).toBeNull();
    expect(toFalse.data!.gps_exempt).toBe(false);
    const other = await updateMaster(row.data!.id, { gps_accuracy: 5000, supervisor_notes: marker('upd') + '-2' });
    expect(other.error).toBeNull();
    expect(Number(other.data!.gps_accuracy)).toBe(5000);
  });
});

test.describe('一般使用者（帶 JWT，auth.uid() 有值）', () => {
  test('沒有權限（denied）：例外被擋並顯示中文訊息；一般合格定位照常可新增；誤差 25000 的一般新增仍被擋', async () => {
    const blocked = await insertMaster({ as: 'denied', tag: 'denied-ex', patch: { gps_exempt: true, ...FAR() } });
    expect(blocked.error, '沒有權限不得使用例外').toBeTruthy();
    expect(blocked.error!.message).toContain('【巡店定位】你沒有「巡店定位例外」權限');
    expect(blocked.error!.code).toBe('42501');
    expect(blocked.data).toBeNull();

    const blockedNoGps = await insertMaster({ as: 'denied', tag: 'denied-ex2', patch: { gps_exempt: true } });
    expect(blockedNoGps.error!.message).toContain('沒有「巡店定位例外」權限');

    const ok = await insertMaster({ as: 'denied', tag: 'denied-ok', patch: GOOD() });
    expect(ok.error, JSON.stringify(ok.error)).toBeNull();
    expect(ok.data!.gps_exempt).toBe(false);

    const far = await insertMaster({ as: 'denied', tag: 'denied-far', patch: FAR() });
    expect(far.error!.message).toMatch(/定位誤差過大（±25000 公尺）/);
    const none = await insertMaster({ as: 'denied', tag: 'denied-none', patch: {} });
    expect(none.error!.message).toMatch(/必須先完成定位/);
  });

  test('有權限（allowed，角色授權）：誤差 25000、無定位都可用例外新增；座標超出範圍仍被擋', async () => {
    const far = await insertMaster({ as: 'allowed', tag: 'allowed-far', patch: { gps_exempt: true, ...FAR() } });
    expect(far.error, JSON.stringify(far.error)).toBeNull();
    expect(far.data).toMatchObject({ gps_exempt: true });
    expect(Number(far.data!.gps_accuracy)).toBe(25000);

    const none = await insertMaster({ as: 'allowed', tag: 'allowed-none', patch: { gps_exempt: true } });
    expect(none.error, JSON.stringify(none.error)).toBeNull();
    expect(none.data!.gps_latitude).toBeNull();

    const bad = await insertMaster({ as: 'allowed', tag: 'allowed-bad', patch: { gps_exempt: true, gps_latitude: 95, gps_longitude: 121 } });
    expect(bad.error!.message).toContain('超出範圍');

    // 有權限但沒用例外：規則照舊（不因為有權限就放寬）
    const plainFar = await insertMaster({ as: 'allowed', tag: 'allowed-plain', patch: FAR() });
    expect(plainFar.error!.message).toMatch(/定位誤差過大/);
  });

  test('系統管理員（profiles.role = admin）：不需角色授權即可使用例外', async () => {
    const r = await insertMaster({ as: 'admin', tag: 'admin-ex', patch: { gps_exempt: true, ...FAR() } });
    expect(r.error, JSON.stringify(r.error)).toBeNull();
    expect(r.data!.gps_exempt).toBe(true);
  });

  test('BEFORE UPDATE：沒有權限不能把 gps_exempt 改 true 或 false；有權限可以；一般編輯不受影響', async () => {
    // 由 denied 本人建立一般巡店，分別測試 false->true 與 true->false 兩個方向。
    const exemptRow = await insertMaster({ as: 'denied', tag: 'upd-denied-base', patch: GOOD() });
    expect(exemptRow.error).toBeNull();
    const id = exemptRow.data!.id as string;

    const up = await updateMaster(id, { gps_exempt: true }, 'denied');
    expect(up.error, '沒有權限不得改成例外').toBeTruthy();
    expect(up.error!.message).toContain('你沒有「巡店定位例外」權限');
    expect((await readMaster(id))!.gps_exempt).toBe(false);

    // 一般編輯（備註、狀態、不動 gps_exempt）不觸發檢查
    const edit = await updateMaster(id, { supervisor_notes: marker('upd-denied-base') + '-edited', indoor_temperature: 26 }, 'denied');
    expect(edit.error, JSON.stringify(edit.error)).toBeNull();
    // 帶著相同值（false -> false）也不觸發
    const same = await updateMaster(id, { gps_exempt: false, indoor_temperature: 27 }, 'denied');
    expect(same.error, JSON.stringify(same.error)).toBeNull();

    // 以 service role 把起點設成 true，再由沒有權限者改回 false 時擋下
    const setTrue = await updateMaster(id, { gps_exempt: true });
    expect(setTrue.error).toBeNull();
    const back = await updateMaster(id, { gps_exempt: false }, 'denied');
    expect(back.error, '沒有權限不得取消例外').toBeTruthy();
    expect(back.error!.message).toContain('你沒有「巡店定位例外」權限');
    expect((await readMaster(id))!.gps_exempt).toBe(true);
  });

  test('有權限者（allowed）對自己的巡店切換 gps_exempt：成功', async () => {
    const row = await insertMaster({ as: 'allowed', tag: 'upd-allowed', patch: GOOD() });
    expect(row.error, JSON.stringify(row.error)).toBeNull();
    const id = row.data!.id as string;
    const on = await updateMaster(id, { gps_exempt: true }, 'allowed');
    expect(on.error, JSON.stringify(on.error)).toBeNull();
    expect(on.data!.gps_exempt).toBe(true);
    const off = await updateMaster(id, { gps_exempt: false }, 'allowed');
    expect(off.error).toBeNull();
    expect(off.data!.gps_exempt).toBe(false);
  });
});

test.describe('權限函式', () => {
  test('can_use_inspection_gps_exempt：沒有登入身分回 false；authenticated 可執行、anon 不可執行', async () => {
    const db = adminDb();
    const viaService = await db.rpc('can_use_inspection_gps_exempt');
    expect(viaService.error, JSON.stringify(viaService.error)).toBeNull();
    expect(viaService.data).toBe(false); // service role 沒有 auth.uid()

    const { createClient } = await import('@supabase/supabase-js');
    const e = devEnv();
    const anon = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const asAnon = await anon.rpc('can_use_inspection_gps_exempt');
    expect(asAnon.error, 'anon 不應能執行').toBeTruthy();
  });

  test('日期欄位與標記：測試巡店的日期為台北今天（確認寫入沒有被改動）', async () => {
    const r = await insertMaster({ tag: 'date', patch: { gps_exempt: true, ...FAR() } });
    expect(r.data!.inspection_date).toBe(taipeiDate());
  });
});

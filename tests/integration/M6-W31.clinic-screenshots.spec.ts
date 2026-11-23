import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import { apiForUser, cleanupM6Clinic, clinicFileName, runIdOrThrow, setupM6Users, testStoreIds, type M6User } from '../support/m6-fixtures';
import { batchesOf, claimForm, countObjects, db, NEW, objectExists, priceForm, screenshotPaths, send, shot, shots } from '../support/clinic-api';
import { TINY_PNG } from '../support/clinic-selfpay-fixtures';

/**
 * M6 第三批 W31 診所截圖：上傳（多張、順序、路徑前綴）、簽名網址（60 分鐘、可讀、桶為私有）、舊版單張路徑相容、刪批次清儲存物件。
 * 帳號：cs_title_mgr（區經理，匯入價格）、cs_calc_a（店長，綁 VW001）、cs_calc_b（別店）、cs_delete_only（只有刪批次權限）。
 * 資料：測試門市 VW001、期間 2038-11；只刪自己的（含儲存物件）。
 */
const KEYS = ['cs_title_mgr', 'cs_calc_a', 'cs_calc_b', 'cs_delete_only'];
let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
let sid: Record<string, string>;
const apis: Record<string, APIRequestContext> = {};
const Y11 = '2038-11';
const f = (tag: string) => clinicFileName(tag);

test.beforeAll(async () => {
  runIdOrThrow();
  await cleanupM6Clinic();
  ({ users, teardown } = await setupM6Users(KEYS));
  sid = await testStoreIds();
  for (const k of Object.keys(users)) apis[k] = await apiForUser(users[k]);
  const price = await send(apis.cs_title_mgr, 'post', `${NEW}/prices/import`, { multipart: priceForm({ store: sid.VW001, month: Y11, fixture: 'price-multi-month.xlsx', fileName: f('w31-price') }) });
  expect(price.status, JSON.stringify(price.body)).toBe(200);
});
test.afterAll(async () => {
  for (const a of Object.values(apis)) await a.dispose();
  const r = await cleanupM6Clinic(db(), Object.values(users || {}).map((u) => u.id));
  const left = await teardown();
  expect(left, `清除臨時帳號：${left.join('; ')}`).toEqual([]);
  expect(r.leftoverObjects, '桶內不應留下測試截圖').toEqual([]);
});
test.beforeEach(() => test.setTimeout(180_000));

const importClaim = (fixture: string, tag: string, s = shots(1), flags: Record<string, string> = {}) =>
  send(apis.cs_calc_a, 'post', `${NEW}/batches/import`, { multipart: claimForm({ store: sid.VW001, month: Y11, fixture, fileName: f(tag), shots: s, flags }) });
const jwtExp = (url: string): number => {
  const token = new URL(url).searchParams.get('token') || '';
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp as number;
};

test.describe.serial('截圖上傳、簽名網址、刪除', () => {
  let tenId: string;
  let tenPaths: string[];
  let twoId: string;
  let twoPaths: string[];

  test('多張上傳（含 webp、jpeg）：路徑在「門市／年月」底下、全部是不重複的物件、順序保留、存成 JSON 陣列字串', async () => {
    const mixed = [shot(1), shot(2, 'image/webp'), shot(3, 'image/jpeg'), ...[4, 5, 6, 7, 8, 9, 10].map((n) => shot(n))];
    const r = await importClaim('claim-basic.xlsx', 'w31-ten', mixed);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.screenshotCount).toBe(10);
    tenId = r.body.batchId;
    const row = (await batchesOf(sid.VW001, f('w31-ten')))[0];
    tenPaths = screenshotPaths(row.screenshot_path);
    expect(tenPaths).toHaveLength(10);
    expect(new Set(tenPaths).size).toBe(10);
    expect(row.screenshot_path.startsWith('[')).toBe(true);
    for (const p of tenPaths) {
      expect(p.startsWith(`${sid.VW001}/${Y11}/`), p).toBe(true);
      expect(await objectExists(p), p).toBe(true);
    }
    expect(tenPaths[1].endsWith('.webp')).toBe(true);
    expect(tenPaths[2].endsWith('.jpg')).toBe(true);
    expect(tenPaths[0].endsWith('.png')).toBe(true);
  });

  test('明細回傳 10 個簽名網址：順序與路徑一致、有效期限約 60 分鐘、圖片位元組與上傳的相同；桶是私有的（不帶簽名讀不到）', async () => {
    const d = await send(apis.cs_calc_a, 'get', `${NEW}/batches/${tenId}`);
    expect(d.status).toBe(200);
    const urls: string[] = d.body.screenshotUrls;
    expect(urls).toHaveLength(10);
    const nowSec = Math.floor(Date.now() / 1000);
    for (const u of urls) {
      const left = jwtExp(u) - nowSec;
      expect(left, `簽名網址剩餘秒數 ${left}`).toBeGreaterThan(3500);
      expect(left).toBeLessThanOrEqual(3600 + 30);
    }
    urls.forEach((u, i) => expect(decodeURIComponent(new URL(u).pathname)).toContain(tenPaths[i]));
    const anon = await pwRequest.newContext();
    try {
      const first = await anon.get(urls[0]);
      expect(first.status()).toBe(200);
      expect(first.headers()['content-type']).toContain('image/png');
      expect(Buffer.compare(await first.body(), Buffer.concat([TINY_PNG, Buffer.from('-1')]))).toBe(0);
      const webp = await anon.get(urls[1]);
      expect(webp.status()).toBe(200);
      expect(webp.headers()['content-type']).toContain('image/webp');
      // 不帶簽名直接讀儲存路徑：讀不到
      const bare = urls[0].split('?')[0].replace('/object/sign/', '/object/public/');
      expect((await anon.get(bare)).status(), '私有桶不可公開讀').not.toBe(200);
    } finally {
      await anon.dispose();
    }
  });

  test('簽名網址只給有門市權限的人：別店店長與只有刪批次權限者拿不到明細，也就拿不到網址', async () => {
    expect((await send(apis.cs_calc_b, 'get', `${NEW}/batches/${tenId}`)).status).toBe(403);
    expect((await send(apis.cs_delete_only, 'get', `${NEW}/batches/${tenId}`)).status).toBe(403);
    const list = await send(apis.cs_calc_b, 'get', `${NEW}/batches`, { params: { store_id: sid.VW001 } });
    expect(JSON.stringify(list.body)).not.toContain('token=');
  });

  test('第 11 張與沒有截圖：400，不建批次、不留物件；單張舊版欄位 screenshot 仍被接受', async () => {
    const before = (await batchesOf(sid.VW001)).length;
    const objects = await countObjects(sid.VW001, Y11);
    const eleven = await importClaim('claim-clinic-b.xlsx', 'w31-11', shots(11));
    expect(eleven.status).toBe(400);
    expect(eleven.body.error).toContain('最多上傳 10 張');
    const none = await importClaim('claim-clinic-b.xlsx', 'w31-none', []);
    expect(none.status).toBe(400);
    expect(none.body.error).toContain('至少');
    expect((await batchesOf(sid.VW001)).length).toBe(before);
    expect(await countObjects(sid.VW001, Y11)).toBe(objects);
    // 舊版欄位名稱 screenshot（單張）
    const fd = claimForm({ store: sid.VW001, month: Y11, fixture: 'claim-clinic-b.xlsx', fileName: f('w31-legacy-field'), shots: [] });
    fd.append('screenshot', new Blob([new Uint8Array(TINY_PNG)], { type: 'image/png' }), 'legacy.png');
    const legacy = await send(apis.cs_calc_a, 'post', `${NEW}/batches/import`, { multipart: fd });
    expect(legacy.status, JSON.stringify(legacy.body)).toBe(200);
    expect(legacy.body.screenshotCount).toBe(1);
    twoId = legacy.body.batchId;
  });

  test('舊版相容：資料表裡若是舊版「單一路徑字串」，明細仍給 1 個網址，刪批次也清得掉物件', async () => {
    const row = (await batchesOf(sid.VW001, f('w31-legacy-field')))[0];
    const [only] = screenshotPaths(row.screenshot_path);
    expect(only).toBeTruthy();
    const up = await db().from('clinic_selfpay_claim_batches').update({ screenshot_path: only }).eq('id', twoId);
    expect(up.error).toBeNull();
    twoPaths = [only];
    const d = await send(apis.cs_calc_a, 'get', `${NEW}/batches/${twoId}`);
    expect(d.status).toBe(200);
    expect(d.body.screenshotUrls).toHaveLength(1);
  });

  test('刪批次只刪該批的截圖物件，別批的不動；沒有刪除權限的人不能刪；刪除後簽名網址讀不到', async () => {
    const d = await send(apis.cs_calc_a, 'get', `${NEW}/batches/${tenId}`);
    const urls: string[] = d.body.screenshotUrls;
    expect((await send(apis.cs_calc_a, 'delete', `${NEW}/batches/${tenId}`)).status).toBe(403);
    for (const p of tenPaths) expect(await objectExists(p)).toBe(true);
    // 先刪單一路徑的批次
    const delTwo = await send(apis.cs_delete_only, 'delete', `${NEW}/batches/${twoId}`);
    expect(delTwo.status, JSON.stringify(delTwo.body)).toBe(200);
    expect(delTwo.body.removedScreenshots).toBe(1);
    for (const p of twoPaths) expect(await objectExists(p)).toBe(false);
    for (const p of tenPaths) expect(await objectExists(p), '別批截圖不受影響').toBe(true);
    // 再刪十張的批次
    const delTen = await send(apis.cs_delete_only, 'delete', `${NEW}/batches/${tenId}`);
    expect(delTen.status, JSON.stringify(delTen.body)).toBe(200);
    expect(delTen.body.removedScreenshots).toBe(10);
    for (const p of tenPaths) expect(await objectExists(p), `${p} 應已刪除`).toBe(false);
    const anon = await pwRequest.newContext();
    try {
      expect((await anon.get(urls[0])).status(), '物件已刪，舊簽名網址讀不到').not.toBe(200);
    } finally {
      await anon.dispose();
    }
    expect((await batchesOf(sid.VW001, f('w31-%'))).map((b) => b.id)).not.toContain(tenId);
  });
});

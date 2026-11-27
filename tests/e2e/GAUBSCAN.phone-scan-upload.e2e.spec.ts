import crypto from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { BYPASS_HEADERS, TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import { gaNavToIn, noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, visibleHeading } from '../support/g01-ui';
import { adminDb, assertGaBaseline, cleanupM7M8, M7_FILE_PREFIX, stores } from '../support/m7m8-fixtures';
import { addBillAttachment, cleanupGaup, mkBill, seedPayee, setupGaupUsers, type GaupKey, type GaupUser } from '../support/g46-fixtures';
import { makePng } from '../support/png';

// GAUBSCAN 手機掃 QR 拍照上傳 e2e（DEV；資料只用 VW 門市、2038 年；結束清掉自己建立的資料）。
//   劇本 1（API 與安全）：發 QR 權限、權杖只存雜湊、公開上傳（不帶登入）只能寫入這張帳單、錯誤／過期／超量／鎖定都被拒、檔案內容檢查、不能讀檔列舉、猜權杖被封鎖。
//   劇本 2（畫面）：桌機開帳單→產生 QR→第二個不帶登入的瀏覽器 context 開 QR 網址上傳一張測試圖片→桌機自動出現該檔→請款單「看掃描檔」。
const P = '/api/workspace/general-affairs';
const PUB = '/api/workspace/bill-scan-upload';
const KEYS: GaupKey[] = ['clerk', 'accountant', 'ubview', 'nobody'];
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });
test.setTimeout(360_000);
let users: Record<string, GaupUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const apis: Record<string, any> = {};
const states: Record<string, any> = {};
const db = () => adminDb();
const real = (errs: string[]) => errs.filter((x) => !/Failed to load resource: the server responded with a status of 4[0-9][0-9]/.test(x));
const vis = (page: Page, id: string) => page.getByTestId(id).locator('visible=true');
/** 每次執行用不同的假 IP 前綴（伺服器若沿用上一輪的流量限制狀態，也不會互相影響）。 */
const NET = `10.${Math.floor(Math.random() * 200) + 20}`;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const ident = () => `QA-GAUP-${String(Date.now()).slice(-6)}-${Math.floor(Math.random() * 9000 + 1000)}`;
const png = (n = 0) => makePng({ width: 120 + n, height: 80, inkPixels: 20 + n });

/** 公開上傳 API（不帶任何登入）：每組測試用自己的假 IP，避免互相佔用流量限制。 */
async function pub(ip: string, token: string | null, files?: Array<{ name: string; type: string; data: Buffer | Uint8Array }>, method = files ? 'POST' : 'GET') {
  const headers: Record<string, string> = { ...BYPASS_HEADERS, 'x-forwarded-for': ip };
  if (token !== null) headers['x-scan-token'] = token;
  let body: FormData | undefined;
  if (files) {
    body = new FormData();
    for (const f of files) body.append('files', new Blob([f.data as BlobPart], { type: f.type }), f.name);
  }
  const res = await fetch(TEST_ORIGIN + PUB, { method, headers, body });
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, json, text };
}
const okPng = (n = 0) => ({ name: `${M7_FILE_PREFIX}scan-${n}.png`, type: 'image/png', data: png(n) });
async function issue(who: string, billId: string) {
  const r = await apis[who].post(`${P}/utility-bills/${billId}/scan-token`, { data: {} });
  return { status: r.status(), body: await r.json().catch(() => ({})) } as { status: number; body: any };
}
const attRows = async (billId: string) => ((await db().from('ga_resource_attachments').select('*').eq('resource_type', 'UTILITY_BILL').eq('resource_id', billId).is('deleted_at', null)).data || []) as any[];
const tokenRow = async (token: string) => (await db().from('ga_ub_scan_tokens').select('*').eq('token_hash', sha(token)).maybeSingle()).data as any;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = [...(await cleanupGaup()), ...(await cleanupM7M8())];
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGaupUsers(KEYS);
  users = made.users;
  teardown = made.teardown;
  for (const k of KEYS) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupGaup(), '清除水電請款測試資料').toEqual([]);
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  const ids = ((await db().from('ga_utility_bills').select('id').like('provider_name', 'QA-GAUP-%')).data || []).length;
  expect(ids, '帳單已清乾淨').toBe(0);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('劇本 1 API 與安全：權限、只存雜湊、只能寫入這張帳單、錯誤／過期／超量／鎖定被拒、檔案內容檢查、不能讀檔、猜權杖被封鎖', async () => {
  const st = await stores();
  const payee = await seedPayee('SC1');
  const billA = await mkBill(users.clerk.client, { payee_vendor_id: payee.id, store_id: st.VW001.id, service_identifier: ident() });
  const billB = await mkBill(users.clerk.client, { payee_vendor_id: payee.id, store_id: st.VW002.id, service_identifier: ident() });

  // --- 發 QR：權限與格式
  expect((await issue('ubview', billA.id)).status, '只有水電檢視不能發').toBe(403);
  expect((await issue('nobody', billA.id)).status).toBe(403);
  const bad = await apis.clerk.post(`${P}/utility-bills/not-a-uuid/scan-token`, { data: {} });
  expect(bad.status()).toBe(400);
  const missing = await issue('clerk', crypto.randomUUID());
  expect(missing.status).toBe(404);
  const anon = await fetch(TEST_ORIGIN + `${P}/utility-bills/${billA.id}/scan-token`, { method: 'POST', headers: { ...BYPASS_HEADERS, Origin: TEST_ORIGIN } });
  expect(anon.status, '沒登入不能發').toBe(401);

  const a = await issue('clerk', billA.id);
  expect(a.status, JSON.stringify(a.body)).toBe(201);
  const tokenA: string = a.body.data.token;
  expect(tokenA).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(a.body.data.url).toContain('#/bill-scan/' + tokenA);
  expect(a.body.data.max_files).toBe(10);
  // 資料庫只存雜湊：資料表任何欄位都找不到明文權杖
  const row = await tokenRow(tokenA);
  expect(row).toMatchObject({ bill_id: billA.id, issued_by: users.clerk.id, max_files: 10, used_count: 0, revoked_at: null });
  expect(JSON.stringify((await db().from('ga_ub_scan_tokens').select('*')).data)).not.toContain(tokenA);
  const life = new Date(row.expires_at).getTime() - new Date(row.created_at).getTime();
  expect(life).toBe(15 * 60 * 1000);
  // 一般登入者不能直接讀權杖表或呼叫公開用函式
  expect((await users.clerk.client.from('ga_ub_scan_tokens').select('*')).data || []).toHaveLength(0);
  expect((await users.clerk.client.rpc('ga_ub_scan_token_status', { p_token_hash: sha(tokenA) })).error).not.toBeNull();
  expect((await users.clerk.client.rpc('ga_ub_scan_token_commit', { p_token_hash: sha(tokenA), p_records: [] })).error).not.toBeNull();

  // --- 公開：權杖狀態與錯誤權杖（同一句話，不洩漏差別）
  const ip1 = `${NET}.1.1`;
  const s0 = await pub(ip1, tokenA);
  expect(s0.status).toBe(200);
  expect(s0.json).toMatchObject({ ok: true, remaining: 10, max_files: 10 });
  expect(Object.keys(s0.json).sort()).toEqual(['expires_at', 'max_files', 'ok', 'remaining']); // 不回帳單任何資料
  const wrongs = [await pub(ip1, crypto.randomBytes(32).toString('base64url')), await pub(ip1, 'short'), await pub(ip1, null)];
  for (const w of wrongs) {
    expect(w.status).toBe(403);
    expect(w.json.error).toBe(wrongs[0].json.error);
    expect(w.json.code).toBe('INVALID');
  }

  // --- 上傳一張：寫入這張帳單、用途 BILL_DOCUMENT、上傳者＝發出者
  const up = await pub(ip1, tokenA, [okPng(1)]);
  expect(up.status, up.text).toBe(201);
  expect(up.json).toMatchObject({ ok: true, added: 1, remaining: 9 });
  let rows = await attRows(billA.id);
  const mine = rows.filter((r) => r.file_name === `${M7_FILE_PREFIX}scan-1.png`);
  expect(mine).toHaveLength(1);
  expect(mine[0]).toMatchObject({ purpose: 'BILL_DOCUMENT', uploaded_by: users.clerk.id, content_type: 'image/png' });
  expect(mine[0].metadata).toMatchObject({ via: 'phone_scan' });
  expect(mine[0].storage_path.startsWith(`utility_bill/${billA.id}/bill_document/`)).toBe(true);
  expect((await db().storage.from('general-affairs-attachments').download(mine[0].storage_path)).error).toBeNull();
  expect(await attRows(billB.id)).toHaveLength(0); // 沒有跑到別張帳單
  expect(await tokenRow(tokenA)).toMatchObject({ used_count: 1 });
  // 桌機（登入）看得到這個檔
  const listed = await apis.clerk.get(`${P}/attachments?resourceType=UTILITY_BILL&resourceId=${billA.id}&purpose=BILL_DOCUMENT`);
  expect((await listed.json()).data.some((x: any) => x.file_name === `${M7_FILE_PREFIX}scan-1.png`)).toBe(true);

  // --- 檔案檢查：內容不是圖片、不支援的類型、空檔、超過 4MB、同一次太多張
  const html = await pub(ip1, tokenA, [{ name: 'evil.png', type: 'image/png', data: Buffer.from('<html><script>alert(1)</script></html>') }]);
  expect(html.status).toBe(400);
  expect(html.json.error).toContain('內容與格式不符');
  expect((await pub(ip1, tokenA, [{ name: 'a.exe', type: 'application/x-msdownload', data: Buffer.from('MZ') }])).status).toBe(400);
  expect((await pub(ip1, tokenA, [{ name: 'empty.png', type: 'image/png', data: Buffer.alloc(0) }])).status).toBe(400);
  const big = Buffer.concat([png(), Buffer.alloc(4 * 1024 * 1024 + 10)]);
  expect([400, 413]).toContain((await pub(ip1, tokenA, [{ name: 'big.png', type: 'image/png', data: big }])).status);
  expect((await pub(ip1, tokenA, Array.from({ length: 11 }, (_, i) => okPng(100 + i)))).status).toBe(400);
  expect((await attRows(billA.id)).length, '被拒的上傳不留紀錄').toBe(rows.length);
  expect(await tokenRow(tokenA)).toMatchObject({ used_count: 1 });

  // --- 不能讀檔、列舉、刪除、換帳單：公開路由只有 GET 狀態與 POST 上傳
  for (const m of ['DELETE', 'PUT', 'PATCH']) expect((await pub(ip1, tokenA, undefined, m)).status, m).toBe(405);
  const probe = await fetch(TEST_ORIGIN + `${PUB}?resourceId=${billB.id}&resourceType=UTILITY_BILL&list=1`, { headers: { ...BYPASS_HEADERS, 'x-forwarded-for': ip1, 'x-scan-token': tokenA } });
  const probeJson = await probe.json();
  expect(Object.keys(probeJson).sort()).toEqual(['expires_at', 'max_files', 'ok', 'remaining']);
  expect(JSON.stringify(probeJson)).not.toContain(billA.id);
  const noCookie = await fetch(TEST_ORIGIN + `${P}/attachments?resourceType=UTILITY_BILL&resourceId=${billA.id}`, { headers: BYPASS_HEADERS });
  expect(noCookie.status, '權杖不能拿來讀一般附件 API').toBe(401);
  const viaHeader = await fetch(TEST_ORIGIN + `${P}/attachments?resourceType=UTILITY_BILL&resourceId=${billA.id}`, { headers: { ...BYPASS_HEADERS, 'x-scan-token': tokenA } });
  expect(viaHeader.status).toBe(401);
  // 帶 resource_id 想傳到別張帳單：欄位被忽略，檔案仍只進 A
  const sneakForm = new FormData();
  sneakForm.append('files', new Blob([png(7) as BlobPart], { type: 'image/png' }), `${M7_FILE_PREFIX}sneak.png`);
  sneakForm.append('resource_id', billB.id);
  sneakForm.append('resource_type', 'UTILITY_BILL');
  const sneak = await fetch(TEST_ORIGIN + PUB, { method: 'POST', headers: { ...BYPASS_HEADERS, 'x-forwarded-for': ip1, 'x-scan-token': tokenA }, body: sneakForm });
  expect(sneak.status).toBe(201);
  expect(await attRows(billB.id)).toHaveLength(0);
  expect((await attRows(billA.id)).some((r) => r.file_name === `${M7_FILE_PREFIX}sneak.png`)).toBe(true);

  // --- 超量：每個權杖最多 10 張（已用 2；再傳 8 張剛好滿，再多被拒，一次多過剩餘也被拒且不留檔）
  const tooMany = await pub(ip1, tokenA, Array.from({ length: 9 }, (_, i) => okPng(200 + i)));
  expect(tooMany.status).toBe(409);
  expect(tooMany.json.code).toBe('FULL');
  expect(await tokenRow(tokenA)).toMatchObject({ used_count: 2 });
  const fill = await pub(ip1, tokenA, Array.from({ length: 8 }, (_, i) => okPng(300 + i)));
  expect(fill.status, fill.text).toBe(201);
  expect(fill.json).toMatchObject({ added: 8, remaining: 0 });
  expect(await tokenRow(tokenA)).toMatchObject({ used_count: 10 });
  const over = await pub(ip1, tokenA, [okPng(400)]);
  expect(over.status).toBe(409);
  expect(over.json.code).toBe('FULL');
  expect((await pub(ip1, tokenA)).status).toBe(409);
  expect(await attRows(billA.id)).toHaveLength(10);

  // --- 過期：與錯誤權杖同一個回應
  const e = await issue('clerk', billB.id);
  const tokenE: string = e.body.data.token;
  expect((await pub(`${NET}.1.2`, tokenE)).status).toBe(200);
  const past = new Date(Date.now() - 20 * 60_000).toISOString();
  const pastExp = new Date(Date.now() - 5 * 60_000).toISOString();
  const upd = await db().from('ga_ub_scan_tokens').update({ created_at: past, expires_at: pastExp }).eq('token_hash', sha(tokenE));
  expect(upd.error).toBeNull();
  const expired = await pub(`${NET}.1.2`, tokenE, [okPng(500)]);
  expect(expired.status).toBe(403);
  expect(expired.json).toEqual(wrongs[0].json);
  expect((await pub(`${NET}.1.2`, tokenE)).json).toEqual(wrongs[0].json);
  expect(await attRows(billB.id)).toHaveLength(0);

  // --- 鎖定：帳單進了已送出的請款單就不能發新 QR、已發的 QR 也不能再傳；草稿內的帳單不鎖
  const f = await issue('clerk', billB.id);
  const tokenF: string = f.body.data.token;
  await addBillAttachment(users.clerk.client, billB.id, users.clerk.id);
  const created = await apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', bill_ids: [billB.id], auto_mark_paid: false, idempotency_key: crypto.randomUUID() } });
  expect(created.status(), await created.text()).toBe(201);
  const draft = (await created.json()).data;
  expect((await pub(`${NET}.1.3`, tokenF, [okPng(600)])).status, '草稿請款單內的帳單不鎖').toBe(201);
  const sub = await apis.clerk.post(`${P}/payment-requests/${draft.id}/actions`, { data: { action: 'submit', expected_updated_at: (await db().from('ga_payment_requests').select('updated_at').eq('id', draft.id).single()).data!.updated_at, idempotency_key: crypto.randomUUID() } });
  expect(sub.status(), await sub.text()).toBe(200);
  const locked = await issue('clerk', billB.id);
  expect(locked.status).toBe(409);
  expect(locked.body.code).toBe('BILL_LOCKED');
  const lockedUp = await pub(`${NET}.1.3`, tokenF, [okPng(601)]);
  expect(lockedUp.status).toBe(409);
  expect(lockedUp.json.code).toBe('BILL_LOCKED');
  expect(await attRows(billB.id)).toHaveLength(2); // 先前那張假紀錄＋草稿期間傳的一張
  // 已刪除的帳單：發不出 QR
  const gone = await mkBill(users.clerk.client, { payee_vendor_id: payee.id, store_id: st.VW001.id, service_identifier: ident() });
  const tokenG: string = (await issue('clerk', gone.id)).body.data.token;
  const del = await users.clerk.client.rpc('ga_ws_ub_delete', { p_id: gone.id, p_reason: '測試刪除', p_confirm_paid_change: false, p_expected_updated_at: gone.updated_at });
  expect(del.data?.ok, JSON.stringify(del)).toBe(true);
  expect((await pub(`${NET}.1.4`, tokenG, [okPng(700)])).status).toBe(409);
  expect((await issue('clerk', gone.id)).status).toBe(404);

  // --- 猜權杖：同一個 IP 連續錯 8 次後被封鎖（429），之後連正確權杖也先擋 15 分鐘
  const probeIp = `${NET}.9.9`;
  const good = await issue('clerk', billA.id);
  const codes: number[] = [];
  for (let i = 0; i < 10; i += 1) codes.push((await pub(probeIp, crypto.randomBytes(32).toString('base64url'))).status);
  expect(codes.slice(0, 8).every((c) => c === 403)).toBe(true);
  expect(codes.slice(8)).toEqual([429, 429]);
  const blockedGood = await pub(probeIp, good.body.data.token);
  expect(blockedGood.status).toBe(429);
  expect((await pub(`${NET}.9.10`, good.body.data.token)).status, '別的 IP 不受影響').toBe(200);
});

test('劇本 2 畫面：桌機開帳單→產生 QR→另一個沒登入的瀏覽器掃 QR 網址上傳→桌機自動出現新檔；過期 QR 顯示失效；請款單「看掃描檔」', async ({ browser }, testInfo) => {
  const st = await stores();
  const payee = await seedPayee('SC2');
  const id = ident();
  const bill = await mkBill(users.clerk.client, { payee_vendor_id: payee.id, store_id: st.VW001.id, service_identifier: id });
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  const phone = await browser.newContext({ serviceWorkers: 'block', extraHTTPHeaders: BYPASS_HEADERS, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    // 桌機：帳單列表 → 詳情
    await openGaCenter(page);
    await gaNavToIn(page, '水電電話網路費', '帳單列表');
    await expect(visibleHeading(page, '水電電話網路費')).toBeVisible();
    await vis(page, 'filter-month').fill('');
    await vis(page, 'bill-search').fill(id);
    await page.locator('[data-testid="bill-card"]:visible').first().getByTestId('open-bill').click();
    const panel = page.locator('.attachment-panel:visible').first();
    await expect(panel).toContainText('目前沒有附件');
    await vis(page, 'phone-upload-open').click();
    await expect(vis(page, 'phone-qr')).toBeVisible();
    await expect(vis(page, 'phone-left')).toContainText('有效時間剩');
    const url = await vis(page, 'phone-url').inputValue();
    expect(url).toMatch(/#\/bill-scan\/[A-Za-z0-9_-]{43}$/);
    const token = url.split('/').pop() as string;
    expect(await tokenRow(token)).toMatchObject({ bill_id: bill.id, issued_by: users.clerk.id, used_count: 0 });

    // 手機（第二個不帶登入的瀏覽器 context）開 QR 網址；若網址網域不是測試站就換成測試站（網域由 WORKSPACE_ORIGIN 設定）
    const phoneUrl = TEST_ORIGIN + '/workspace/index.html' + url.slice(url.indexOf('#'));
    const m = await phone.newPage();
    const mErrors: string[] = [];
    m.on('pageerror', (e) => mErrors.push(String(e)));
    m.on('console', (c) => c.type() === 'error' && mErrors.push(c.text()));
    await m.goto(phoneUrl);
    await expect(m.getByTestId('scan-page')).toBeVisible();
    await expect(m.getByTestId('scan-remaining')).toHaveText('10');
    // 沒有任何登入資訊、也看不到帳單資料
    expect(await phone.cookies()).toEqual([]);
    await expect(m.locator('body')).not.toContainText(id);
    await m.getByTestId('scan-input').setInputFiles({ name: `${M7_FILE_PREFIX}phone.png`, mimeType: 'image/png', buffer: png(9) });
    await expect(m.getByTestId('scan-send')).toContainText('上傳 1 張');
    expect(await noPageOverflow(m)).toBe(true);
    await m.getByTestId('scan-send').click();
    await expect(m.getByTestId('scan-done')).toContainText('已上傳 1 張');
    await expect(m.getByTestId('scan-remaining')).toHaveText('9');

    // 桌機自動出現新檔（不重新整理、不按任何鈕；輪詢 3 秒）
    await expect(vis(page, 'phone-added')).toContainText('手機已上傳 1 張', { timeout: 15_000 });
    await vis(page, 'phone-close').click();
    await expect(panel.locator('.attachment-grid li')).toHaveCount(1);
    await expect(panel.locator('.attachment-grid li').first()).toContainText(`${M7_FILE_PREFIX}phone.png`);
    const rows = await attRows(bill.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ uploaded_by: users.clerk.id, purpose: 'BILL_DOCUMENT' });

    // 過期後：手機頁顯示失效，桌機 QR 對話框顯示過期並可重新產生
    await db().from('ga_ub_scan_tokens').update({ created_at: new Date(Date.now() - 20 * 60_000).toISOString(), expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('token_hash', sha(token));
    await m.reload();
    await expect(m.getByTestId('scan-invalid')).toContainText('無效或已過期');
    await expect(m.getByTestId('scan-camera')).toHaveCount(0);
    expect(real(mErrors), mErrors.join('\n')).toEqual([]);

    // 請款單「看掃描檔」：建立並送出請款單，詳情每張帳單旁有「看掃描檔」，開出剛才手機傳的檔案
    const created = await apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', bill_ids: [bill.id], auto_mark_paid: false, idempotency_key: crypto.randomUUID() } });
    expect(created.status(), await created.text()).toBe(201);
    const pr = (await created.json()).data;
    const sub = await apis.clerk.post(`${P}/payment-requests/${pr.id}/actions`, { data: { action: 'submit', expected_updated_at: pr.updated_at, idempotency_key: crypto.randomUUID() } });
    expect(sub.status(), await sub.text()).toBe(200);
    await page.reload();
    await openGaCenter(page);
    await openGaSide(page);
    await shell(page).locator('aside').getByRole('button', { name: '請款單', exact: true }).locator('visible=true').first().click();
    await vis(page, 'pr-search').fill(pr.pr_no);
    await vis(page, 'open-pr').click();
    const line = vis(page, 'pu-line');
    await expect(line).toBeVisible();
    await line.getByTestId('bill-scan-open').click();
    const dlg = page.locator('dialog[open]').last();
    await expect(dlg.locator('.attachment-grid li')).toHaveCount(1);
    await expect(dlg).toContainText(`${M7_FILE_PREFIX}phone.png`);
    await expect(dlg.getByTestId('upload-input')).toHaveCount(0); // 只讀
    const [popup] = await Promise.all([page.waitForEvent('popup'), dlg.getByRole('button', { name: /開啟/ }).first().click()]);
    expect(popup.url()).toMatch(/\/storage\/v1\/object\/sign\//);
    await popup.close();
    await dlg.getByTestId('bill-scan-close').click();
    // 帳單已進已送出的請款單：桌機詳情再按「用手機拍照上傳」會被擋並說明
    expect(real(errors), errors.join('\n')).toEqual([]);
  } finally {
    await phone.close();
    await ctx.close();
  }
});

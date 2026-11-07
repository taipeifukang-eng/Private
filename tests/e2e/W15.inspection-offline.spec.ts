import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { apiAs, loginAs, TEST_ORIGIN } from '../support/auth';
import {
  GPS_BASE,
  applyProjectViewport,
  buildBody,
  deleteInspections,
  grantGeolocation,
  marker,
  noPageOverflow,
  openNativeEdit,
  openNativeNew,
  readMaster,
  registerInspection,
  runIdOrThrow,
  storeCodeFor,
  storeIdByCode,
} from '../support/i01-fixtures';
import { draftCount, ed, idbAll, idbClear, idbPut, item, photoInput, png, selectStore, sessionUserId, shot, sign, switchAccount, thumbs, waitUnlocked } from '../support/w14-ui';

// W15 離線暫存 e2e（桌機 1440、手機 390）：
//  Q14 新增與編輯都暫存（含照片與簽名），重新整理後還原；編輯頁若伺服器草稿已被更新，還原時提示；
//  Q15 依帳號隔離：換帳號看不到他人暫存，換回來仍可還原；
//  Q16 保留 15 天（14 天仍在、15 天又 1 分鐘清除）；「不還原」要再確認一次才刪；已送出自動清除；
//  網路中斷時送出：顯示「已暫存在本機，連線後請再按送出」，恢復連線後手動再送。
// 測試資料：測試門市（每個 project 各用自己的門市）、備註帶 ZT<runId> 標記，測試結束只刪自己建立的單。

const DAY = 24 * 3600 * 1000;
const created: string[] = [];
const purge = async () => deleteInspections(created.splice(0));
test.afterAll(purge);

async function start(browser: any, testInfo: any, role = 'admin') {
  runIdOrThrow();
  const ctx = await loginAs(browser, role);
  await grantGeolocation(ctx, TEST_ORIGIN, GPS_BASE);
  const page: Page = await ctx.newPage();
  await applyProjectViewport(page, testInfo);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/geolocation|Failed to load resource|net::ERR/i.test(m.text()) && errors.push(m.text()));
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await idbClear(page);
  return { ctx, page, errors };
}
async function fillNew(page: Page, testInfo: any, tag: string, slot = 0) {
  await openNativeNew(page);
  await waitUnlocked(page);
  await selectStore(page, storeCodeFor(testInfo, slot));
  await ed(page).getByLabel(/室內溫度/).fill('27.5');
  await ed(page).getByLabel('巡店備註').fill(marker(tag));
  await item(page, 0).locator('.inspection-check input[type=checkbox]').first().check();
  await item(page, 0).getByLabel(/備註$/).fill('ZT 暫存項目備註');
  await photoInput(page, 0).setInputFiles(png(1));
  await expect(thumbs(page, 0)).toHaveCount(1, { timeout: 30_000 });
  await sign(page, 0);
  await sign(page, 1);
}
const newKey = (uid: string) => `${uid}|supervisor|new`;

test('Q14：新增巡店暫存含照片與簽名；重新整理後還原；儲存草稿後暫存清除', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await start(browser, testInfo);
  try {
    const uid = await sessionUserId(page);
    await fillNew(page, testInfo, 'w15-restore');
    await expect.poll(() => draftCount(page, uid), { timeout: 15_000 }).toBe(1);
    const saved = (await idbAll(page))[0];
    expect(saved.key).toBe(newKey(uid));
    expect(Number(saved.form.temperature)).toBe(27.5);
    expect(saved.form.signature).toMatch(/^data:image\/png/);
    expect(saved.form.supervisorSignature).toMatch(/^data:image\/png/);
    expect(saved.form.scores[0].photos).toHaveLength(1);
    // 重新整理（模擬誤關頁、當機）：重新開新增頁會詢問是否還原
    await page.reload({ waitUntil: 'networkidle' });
    await openNativeNew(page);
    const dialog = page.getByRole('dialog', { name: '發現未完成的暫存內容' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByTestId('restore-info')).toContainText('15 天');
    await shot(page, testInfo, 'w15-restore-dialog');
    await dialog.getByTestId('restore-yes').click();
    await waitUnlocked(page);
    await expect(ed(page).getByLabel(/室內溫度/)).toHaveValue('27.5');
    await expect(ed(page).getByLabel('巡店備註')).toHaveValue(marker('w15-restore'));
    await expect(item(page, 0).getByLabel(/備註$/)).toHaveValue('ZT 暫存項目備註');
    await expect(thumbs(page, 0)).toHaveCount(1);
    await expect(item(page, 0).locator('.inspection-check input[type=checkbox]:checked')).toHaveCount(1);
    await expect(ed(page).getByAltText('店長／當班主管確認簽名')).toBeVisible();
    await expect(ed(page).getByAltText('督導簽名')).toBeVisible();
    await expect(ed(page).getByLabel('巡店門市').locator('option:checked')).toContainText(storeCodeFor(testInfo));
    expect(await noPageOverflow(page)).toBe(true);
    // 儲存草稿（伺服器儲存成功）→ 本機暫存清除
    await ed(page).getByRole('button', { name: '儲存草稿' }).click();
    await expect(ed(page).getByText('草稿已儲存')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => draftCount(page, uid), { timeout: 15_000 }).toBe(0);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    // 取回建立的單並登錄刪除
    await registerCreated(testInfo, 'w15-restore');
    await purge();
    await ctx.close();
  }
});
async function registerCreated(testInfo: any, tag: string) {
  const { findMasterByNotes } = await import('../support/i01-fixtures');
  for (const r of await findMasterByNotes(marker(tag))) {
    await registerInspection(r.id);
    created.push(r.id);
  }
}

test('Q16：不還原要再確認一次才刪除；返回可再選還原', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page } = await start(browser, testInfo);
  try {
    const uid = await sessionUserId(page);
    await fillNew(page, testInfo, 'w15-confirm');
    await expect.poll(() => draftCount(page, uid), { timeout: 15_000 }).toBe(1);
    await page.reload({ waitUntil: 'networkidle' });
    await openNativeNew(page);
    const first = page.getByRole('dialog', { name: '發現未完成的暫存內容' });
    await expect(first).toBeVisible({ timeout: 30_000 });
    await first.getByTestId('restore-no').click();
    const second = page.getByRole('dialog', { name: '確定刪除暫存？' });
    await expect(second).toBeVisible();
    expect(await draftCount(page, uid), '還沒確認前暫存仍在').toBe(1);
    // 返回 → 回到第一個詢問，暫存仍在
    await second.getByTestId('restore-back').click();
    await expect(first).toBeVisible();
    expect(await draftCount(page, uid)).toBe(1);
    // 再按不還原並確認刪除
    await first.getByTestId('restore-no').click();
    await page.getByTestId('restore-delete').click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect.poll(() => draftCount(page, uid)).toBe(0);
    await waitUnlocked(page);
    await expect(ed(page).getByLabel(/室內溫度/)).toHaveValue('');
    await expect(thumbs(page, 0)).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('Q15：依帳號隔離——換帳號看不到他人暫存，換回來仍可還原', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page } = await start(browser, testInfo);
  try {
    const adminId = await sessionUserId(page);
    await fillNew(page, testInfo, 'w15-isolate');
    await expect.poll(() => draftCount(page, adminId), { timeout: 15_000 }).toBe(1);
    // 同一台裝置換成督導登入
    await switchAccount(ctx as BrowserContext, 'supervisor');
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const supId = await sessionUserId(page);
    expect(supId).not.toBe(adminId);
    await openNativeNew(page);
    await waitUnlocked(page);
    await expect(page.getByRole('dialog', { name: '發現未完成的暫存內容' })).toHaveCount(0);
    await expect(ed(page).getByLabel(/室內溫度/)).toHaveValue('');
    await expect(ed(page).getByLabel('巡店備註')).toHaveValue('');
    // 督導自己也暫存一份：key 分開，互不覆蓋
    await ed(page).getByLabel(/室內溫度/).fill('21');
    await expect.poll(() => draftCount(page, supId), { timeout: 15_000 }).toBe(1);
    const all = await idbAll(page);
    expect(all.map((d) => d.key).sort()).toEqual([newKey(adminId), newKey(supId)].sort());
    expect(Number(all.find((d) => d.userId === adminId).form.temperature)).toBe(27.5);
    // 換回管理員：仍可還原自己的
    await switchAccount(ctx as BrowserContext, 'admin');
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await openNativeNew(page);
    const dialog = page.getByRole('dialog', { name: '發現未完成的暫存內容' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByTestId('restore-yes').click();
    await waitUnlocked(page);
    await expect(ed(page).getByLabel(/室內溫度/)).toHaveValue('27.5');
  } finally {
    await ctx.close();
  }
});

test('Q16：保留 15 天——14 天又 23 小時的還能還原；超過 15 天的自動清除、不詢問', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page } = await start(browser, testInfo);
  try {
    const uid = await sessionUserId(page);
    const base = (savedAt: number, key = newKey(uid), temperature = '23') => ({
      key, userId: uid, type: 'supervisor', recordId: null, savedAt, serverVersion: 0, templateHash: 'x', templates: [],
      form: { store: '', type: 'supervisor', date: null, temperature, notes: '', gps: null, signature: '', supervisorSignature: '', scores: [], staff: [] },
    });
    // 超過 15 天：不詢問，並且被清除
    await idbPut(page, base(Date.now() - 15 * DAY - 60_000));
    await openNativeNew(page);
    await waitUnlocked(page);
    await expect(page.getByRole('dialog', { name: '發現未完成的暫存內容' })).toHaveCount(0);
    await expect.poll(() => draftCount(page, uid), { timeout: 15_000 }).toBe(0);
    // 14 天又 23 小時：仍會詢問，內容還原
    await page.reload({ waitUntil: 'networkidle' });
    await idbPut(page, base(Date.now() - 14 * DAY - 23 * 3600 * 1000));
    await openNativeNew(page);
    const dialog = page.getByRole('dialog', { name: '發現未完成的暫存內容' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await dialog.getByTestId('restore-yes').click();
    await waitUnlocked(page);
    await expect(ed(page).getByLabel(/室內溫度/)).toHaveValue('23');
    // 其他帳號過期的暫存也會在進頁時一併清掉
    await idbPut(page, base(Date.now() - 20 * DAY, 'someone-else|supervisor|new'));
    await page.reload({ waitUntil: 'networkidle' });
    await openNativeNew(page);
    await expect.poll(async () => (await idbAll(page)).some((d) => d.key === 'someone-else|supervisor|new')).toBe(false);
  } finally {
    await ctx.close();
  }
});

test('Q14 編輯草稿也暫存；伺服器上的草稿被其他裝置更新後，還原時提示', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page } = await start(browser, testInfo);
  const admin = await apiAs('admin');
  try {
    const uid = await sessionUserId(page);
    const store = await storeIdByCode(admin, storeCodeFor(testInfo, 1));
    const body = await buildBody(admin, store, 'w15-edit');
    const res = await admin.post('/api/workspace/inspection-form', { data: body });
    expect(res.status(), (await res.text()).slice(0, 200)).toBe(200);
    const rec = (await res.json()).record;
    await registerInspection(rec.id);
    created.push(rec.id);
    await openNativeEdit(page, rec.id);
    await ed(page).getByLabel('巡店備註').fill(marker('w15-edit') + '-本機修改');
    await item(page, 0).getByLabel(/備註$/).fill('ZT 編輯暫存');
    await photoInput(page, 0).setInputFiles(png(2));
    await expect(thumbs(page, 0)).toHaveCount(1, { timeout: 30_000 });
    const key = `${uid}|supervisor|${rec.id}`;
    await expect.poll(async () => (await idbAll(page)).some((d) => d.key === key), { timeout: 15_000 }).toBe(true);
    // 另一個裝置更新同一張草稿（版本 +1）
    const form = await (await admin.get('/api/workspace/inspection-form', { params: { type: 'supervisor', id: rec.id } })).json();
    const upd = await admin.post('/api/workspace/inspection-form', {
      data: {
        id: rec.id, version: rec.workspace_version, writeId: randomUUID(), store, type: 'supervisor', status: 'draft', date: rec.inspection_date, temperature: 22,
        notes: marker('w15-edit'), signature: '', supervisorSignature: '', staff: [], templateHash: form.templateHash,
        scores: (form.templates as { id: string }[]).map((t) => ({ template_id: t.id, checked_items: [], quantities: {}, notes: '', photos: [] })),
      },
    });
    expect(upd.status(), (await upd.text()).slice(0, 200)).toBe(200);
    // 重新整理後再開編輯頁：還原詢問，並提示伺服器草稿已被更新
    await page.reload({ waitUntil: 'networkidle' });
    await openNativeEdit(page, rec.id);
    const dialog = page.getByRole('dialog', { name: '發現未完成的暫存內容' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toContainText('已被其他裝置更新');
    await dialog.getByTestId('restore-yes').click();
    await expect(ed(page).getByLabel('巡店備註')).toHaveValue(marker('w15-edit') + '-本機修改');
    await expect(item(page, 0).getByLabel(/備註$/)).toHaveValue('ZT 編輯暫存');
    await expect(thumbs(page, 0)).toHaveCount(1);
    await shot(page, testInfo, 'w15-edit-restore');
  } finally {
    await purge();
    await admin.dispose();
    await ctx.close();
  }
});

test('已送出自動清除；網路中斷時送出顯示手動重送、連線後再按送出才成功', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await start(browser, testInfo);
  try {
    const uid = await sessionUserId(page);
    await fillNew(page, testInfo, 'w15-offline', 2);
    await expect.poll(() => draftCount(page, uid), { timeout: 15_000 }).toBe(1);
    // 斷線後送出
    await ctx.setOffline(true);
    await ed(page).getByRole('button', { name: '提交巡店' }).click();
    await page.getByRole('button', { name: '確認提交' }).click();
    await expect(ed(page).getByText('已暫存在本機，連線後請再按送出')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByRole('dialog', { name: '巡店尚未儲存' })).toHaveCount(0);
    expect(await draftCount(page, uid), '送出失敗時暫存必須保留').toBe(1);
    await shot(page, testInfo, 'w15-offline-message');
    // 不自動補送：恢復連線後，伺服器仍沒有這張單
    await ctx.setOffline(false);
    await page.waitForTimeout(2500);
    const { findMasterByNotes } = await import('../support/i01-fixtures');
    expect(await findMasterByNotes(marker('w15-offline')), '不得自動補送').toHaveLength(0);
    // 手動再按送出
    await ed(page).getByRole('button', { name: '提交巡店' }).click();
    await page.getByRole('button', { name: '確認提交' }).click();
    await expect(ed(page).getByText('巡店已完成提交')).toBeVisible({ timeout: 40_000 });
    const rows = await findMasterByNotes(marker('w15-offline'));
    expect(rows).toHaveLength(1);
    created.push(rows[0].id);
    await registerInspection(rows[0].id);
    expect((await readMaster(rows[0].id))?.status).toBe('completed');
    // 已送出 → 本機暫存清除
    await expect.poll(() => draftCount(page, uid), { timeout: 15_000 }).toBe(0);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.setOffline(false).catch(() => {});
    await registerCreated(testInfo, 'w15-offline');
    await purge();
    await ctx.close();
  }
});

test('編輯頁：伺服器上已是完成的單，本機舊暫存自動清除', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page } = await start(browser, testInfo);
  const admin = await apiAs('admin');
  try {
    const uid = await sessionUserId(page);
    const store = await storeIdByCode(admin, storeCodeFor(testInfo, 0));
    const res = await admin.post('/api/workspace/inspection-form', { data: await buildBody(admin, store, 'w15-done') });
    expect(res.status(), (await res.text()).slice(0, 200)).toBe(200);
    const rec = (await res.json()).record;
    await registerInspection(rec.id);
    created.push(rec.id);
    // 草稿期間有本機暫存；之後在別處已完成送出
    await idbPut(page, {
      key: `${uid}|supervisor|${rec.id}`, userId: uid, type: 'supervisor', recordId: rec.id, savedAt: Date.now(), serverVersion: rec.workspace_version,
      templateHash: 'x', templates: [], form: { store, type: 'supervisor', temperature: '30', notes: '', scores: [], staff: [], signature: '', supervisorSignature: '' },
    });
    const form = await (await admin.get('/api/workspace/inspection-form', { params: { type: 'supervisor', id: rec.id } })).json();
    const { SIGNED } = await import('../support/png');
    const done = await admin.post('/api/workspace/inspection-form', {
      data: {
        id: rec.id, version: rec.workspace_version, writeId: randomUUID(), store, type: 'supervisor', status: 'completed', date: rec.inspection_date, temperature: 22,
        notes: marker('w15-done'), signature: SIGNED(), supervisorSignature: SIGNED(), staff: [], templateHash: form.templateHash,
        scores: (form.templates as { id: string }[]).map((t) => ({ template_id: t.id, checked_items: [], quantities: {}, notes: '', photos: [] })),
      },
    });
    expect(done.status(), (await done.text()).slice(0, 200)).toBe(200);
    // 直接以編輯分頁開啟（透過工作台開啟編輯會得到 409 並清除暫存）
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await page.evaluate(
      ([id, store]) => {
        // 使用應用程式的 pinia store 開啟編輯分頁
        const app = (document.querySelector('#app') as any)?.__vue_app__;
        const pinia = app?.config.globalProperties.$pinia;
        const work = pinia._s.get('workspace');
        work.open('inspection-editor', store, id);
      },
      [rec.id, store] as const,
    );
    await expect.poll(async () => (await idbAll(page)).some((d) => d.recordId === rec.id), { timeout: 30_000 }).toBe(false);
    await expect(ed(page).getByText('已完成或已結案的巡店不能編輯')).toBeVisible();
  } finally {
    await purge();
    await admin.dispose();
    await ctx.close();
  }
});

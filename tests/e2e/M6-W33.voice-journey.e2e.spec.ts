import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { storageStateFor, TEST_ORIGIN } from '../support/auth';
import { adminDb, apiForUser, cleanupM6Supervisor, runIdOrThrow, setupM6Users, slName, testStoreIds, type M6User } from '../support/m6-fixtures';
import { arrangeMonth, assertMockOpenAi, clearAlerts, clearSeeds, currentMonthKey, mockAudio, upload, ledgerCount, restoreVoiceState, setCapDb, snapshotVoiceState, VOICE_API, type Snapshot } from '../support/m6-voice';
import { apiAs } from '../support/auth';
import { NOTICE_VERSION } from '../../lib/supervisor-management-log/voice-ai-rules';

/**
 * M6 第三批 3b W33：督導語音與 AI 摘要多角色劇本（桌機 1440、手機 390 各跑一次；測站用假的 OpenAI，瀏覽器的麥克風與錄音器用假的，不連真實 OpenAI、不需要真麥克風）。
 * 劇本一：督導首次使用（先看告知並同意）-> 錄音（重新錄音、上傳失敗重試）-> 文字稿 -> AI 草稿審核（缺欄位不能套用）-> 套用到紀錄表單（還沒儲存）-> 人工儲存 -> 逐字稿；
 *         AI 失敗改手動文字稿 -> 草稿標示「這份草稿未經 AI 整理」-> 人工儲存（不標 AI）。
 * 劇本二：月額度 100% 自動停用（督導畫面沒有錄音、退回手動文字稿與本機規則）、首頁只有系統管理員看到提醒（80% 與 100%）、管理員在「AI 用量」調整上限後恢復。
 * 劇本三：逐字稿可見範圍：團隊檢視者看得到紀錄但沒有語音入口也沒有逐字稿；管理者看得到逐字稿；沒有權限者沒有入口。
 */
const db = adminDb();
let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
let sid: Record<string, string>;
let snap: Snapshot;

test.beforeAll(async () => {
  runIdOrThrow();
  snap = await snapshotVoiceState(db);
  await cleanupM6Supervisor();
  ({ users, teardown } = await setupM6Users(['sl_none', 'sl_sup_a', 'sl_team', 'sl_manager']));
  sid = await testStoreIds();
  const admin = await apiAs('admin');
  try {
    await assertMockOpenAi(admin);
  } finally {
    await admin.dispose();
  }
});
test.afterAll(async () => {
  await cleanupM6Supervisor(db, Object.values(users || {}).map((u) => u.id));
  if (snap) await restoreVoiceState(snap, db);
  const left = await teardown();
  expect(left).toEqual([]);
});
test.beforeEach(() => test.setTimeout(420_000));

// 假的麥克風與錄音器：停止錄音時產生內容為 window.__speech 的音檔（測站的假 OpenAI 會把 MOCK-TRANSCRIPT: 後面的文字當成轉出來的文字稿）。
const MIC_STUB = `(() => {
  window.__speech = 'MOCK-TRANSCRIPT:今天到 VW001 測試門市巡店，發現陳列不整齊。已提醒店長，下週再追蹤。';
  window.__stopped = 0;
  const md = navigator.mediaDevices;
  md.getUserMedia = async () => ({ getTracks: () => [{ stop() { window.__stopped += 1; } }] });
  class FakeRecorder {
    constructor(stream, opts) { this.state = 'inactive'; this.mimeType = 'audio/webm'; window.__recorderOpts = opts; }
    start() { this.state = 'recording'; }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      const blob = new Blob([window.__speech], { type: 'audio/webm' });
      if (this.ondataavailable) this.ondataavailable({ data: blob });
      if (this.onstop) this.onstop();
    }
    static isTypeSupported() { return true; }
  }
  window.MediaRecorder = FakeRecorder;
})();`;

async function ctxFor(browser: Browser, who: string): Promise<BrowserContext> {
  const state = who === 'admin' ? await storageStateFor('admin') : await (async () => { const api = await apiForUser(users[who]); const s = await api.storageState(); await api.dispose(); return s; })();
  const ctx = await browser.newContext({ baseURL: TEST_ORIGIN, storageState: state });
  await ctx.addInitScript(MIC_STUB);
  return ctx;
}
async function openMenu(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
}
const menuItem = (page: Page) => page.locator('.workspace-menu button.catalog-item[title="督導管理日誌"]');
async function openLog(page: Page) {
  await openMenu(page);
  await menuItem(page).click();
  await expect(page.getByRole('heading', { name: '督導管理日誌', exact: true })).toBeVisible();
  await expect(page.locator('.sml-page [data-testid=tier]')).toBeVisible();
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const root = (page: Page) => page.locator('.sml-page');
const message = (page: Page, text: string) => expect(root(page).locator('[data-testid=message]')).toContainText(text);
const watch = (page: Page, problems: string[]) => {
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
};
const caseCard = (page: Page, title: string) => root(page).locator(`[data-case="${title}"]`);
const toCases = async (page: Page) => { await root(page).locator('[data-testid=tab-cases]').click(); await expect(root(page).locator('[data-testid=cases]')).toBeVisible(); };
const detailOf = (page: Page, title: string) => page.getByRole('dialog', { name: title, exact: true });
const flow = (page: Page) => page.getByRole('dialog', { name: '語音口述（AI 草稿）' });
const seedCase = async (tag: string) => {
  const api = await apiForUser(users.sl_sup_a);
  try {
    const title = slName(tag);
    const r = await api.post(`${VOICE_API}/cases`, { data: { title, target_type: 'STORE', store_id: sid.VW001, target_name_snapshot: 'VW001 測試門市' } });
    expect(r.status(), await r.text()).toBe(201);
    return { title, id: (await r.json()).data.id as string };
  } finally {
    await api.dispose();
  }
};
const recordsOf = async (caseId: string) => ((await db.from('supervisor_management_records').select('*').eq('case_id', caseId).order('created_at')).data || []) as any[];

test('督導語音口述：先看告知並同意、錄音（重錄、失敗重試）、AI 草稿審核、人工儲存、逐字稿；AI 失敗退回手動並標示未經 AI 整理', async ({ browser }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-390';
  const tag = mobile ? 'M' : 'D';
  const problems: string[] = [];
  await setCapDb(30, db);
  await db.from('workspace_ai_consents').delete().eq('user_id', users.sl_sup_a.id);
  const seeded = await seedCase(`${tag}-VOICE`);
  const ctx = await ctxFor(browser, 'sl_sup_a');
  const page = await ctx.newPage();
  watch(page, problems);
  try {
    await openLog(page);
    await toCases(page);
    await caseCard(page, seeded.title).click();
    const detail = detailOf(page, seeded.title);
    await expect(detail).toBeVisible();
    await expect(page.locator('[data-testid=tab-ai]'), '非系統管理員沒有 AI 用量頁籤').toHaveCount(0);

    // ---- E5：第一次使用先看告知並勾選同意，之後才看得到錄音
    await detail.locator('[data-act=voice-record]').click();
    const f = flow(page);
    await expect(f.locator('[data-testid=voice-consent]')).toBeVisible();
    await expect(f.locator('[data-testid=voice-notice]')).toContainText('OpenAI');
    await expect(f.locator('[data-testid=voice-notice]')).toContainText('音檔不會存在富康系統');
    await expect(f.locator('[data-testid=voice-recorder]'), '同意前不顯示錄音').toHaveCount(0);
    const submit = f.locator('[data-testid=voice-consent-submit]');
    await expect(submit, '沒勾選不能同意').toBeDisabled();
    if (mobile) expect(await noOverflow(page), '手機告知畫面不橫向溢出').toBe(true);
    await f.locator('[data-testid=voice-agree]').check();
    await submit.click();
    await expect(f.locator('[data-testid=voice-recorder]')).toBeVisible();
    expect(((await db.from('workspace_ai_consents').select('*').eq('user_id', users.sl_sup_a.id)).data || []).length, '同意已記錄').toBe(1);
    await expect(f.locator('details.notice-box summary')).toContainText('隱私告知');

    // ---- 錄音：計時、重新錄音、上傳失敗重試
    const rec = f.locator('[data-testid=voice-recorder]');
    await rec.locator('[data-testid=voice-start]').click();
    await expect(rec.locator('[data-testid=voice-stop]')).toBeVisible();
    await expect(rec.locator('[data-testid=voice-timer]')).toContainText('/ 10:00');
    await expect.poll(async () => (await rec.locator('[data-testid=voice-timer]').innerText()).startsWith('00:00'), { message: '計時會往前走' }).toBe(false);
    await rec.locator('[data-testid=voice-stop]').click();
    await expect(rec.locator('[data-testid=voice-preview]')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__stopped), '停止後麥克風已關閉').toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as any).__recorderOpts?.audioBitsPerSecond), '語音位元率 32kbps').toBe(32000);
    await rec.locator('[data-testid=voice-rerecord]').click();
    await expect(rec.locator('[data-testid=voice-preview]'), '重新錄音會丟掉上一段').toHaveCount(0);
    await expect(rec.locator('[data-testid=voice-start]')).toBeVisible();
    await rec.locator('[data-testid=voice-start]').click();
    await page.waitForTimeout(400);
    await rec.locator('[data-testid=voice-stop]').click();
    const before = await ledgerCount();
    await page.route('**/api/workspace/supervisor-management/voice/transcribe', (r) => r.abort('failed'));
    await rec.locator('[data-testid=voice-upload]').click();
    await expect(rec.locator('[data-testid=voice-error]')).toContainText('連線中斷');
    await expect(rec.locator('[data-testid=voice-retry]'), '失敗後可以重試（錄音仍暫存在這台裝置）').toBeVisible();
    await expect(rec.locator('[data-testid=voice-preview]')).toBeVisible();
    expect(await ledgerCount(), '請求沒到伺服器就不會花費用').toBe(before);
    await page.unroute('**/api/workspace/supervisor-management/voice/transcribe');
    await rec.locator('[data-testid=voice-retry]').click();
    await expect(f.locator('[data-testid=voice-transcript]')).toHaveValue(/今天到 VW001 測試門市巡店/);
    await expect(rec.locator('[data-testid=voice-preview]'), '轉完就丟掉暫存音檔').toHaveCount(0);
    expect(await ledgerCount(), '重試成功只花一次').toBe(before + 1);
    if (mobile) expect(await noOverflow(page), '手機錄音畫面不橫向溢出').toBe(true);

    // ---- AI 草稿審核
    const text = (await f.locator('[data-testid=voice-transcript]').inputValue()).trim();
    await f.locator('[data-testid=voice-make-draft]').click();
    const review = f.locator('[data-testid=voice-review]');
    await expect(review).toBeVisible();
    await expect(review.locator('[data-testid=ai-label]')).toContainText('AI 整理的草稿');
    await expect(review.locator('[data-testid=fallback-label]')).toHaveCount(0);
    await expect(review.locator('[data-testid=draft-observation]')).toHaveValue(/AI 整理/);
    await expect(review.locator('[data-testid=voice-matches]'), '門市比對（僅供參考）').toContainText('VW001');
    expect(((await recordsOf(seeded.id)).length), 'AI 草稿不會自己儲存').toBe(0);
    if (mobile) expect(await noOverflow(page), '手機草稿審核不橫向溢出').toBe(true);
    // 缺欄位不能套用
    await review.locator('[data-testid=draft-judgment]').fill('');
    await expect(review.locator('[data-testid=draft-missing]')).toContainText('管理判斷');
    await expect(review.locator('[data-testid=voice-apply]')).toBeDisabled();
    await review.locator('[data-testid=draft-judgment]').fill('需要持續關注陳列狀況');
    await expect(review.locator('[data-testid=draft-missing]'), 'AI 草稿標了需要追蹤但沒有日期').toContainText('追蹤日期');
    await expect(review.locator('[data-testid=voice-apply]')).toBeDisabled();
    const followDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    await review.locator('input[type=date]').fill(followDate);
    await expect(review.locator('[data-testid=voice-apply]')).toBeEnabled();
    await review.locator('[data-testid=voice-apply]').click();

    // ---- 套用到紀錄表單：帶入內容、標示 AI 草稿、還沒儲存；人工按儲存才會存
    await expect(f).toHaveCount(0);
    const recForm = page.getByRole('dialog', { name: '新增管理紀錄' });
    await expect(recForm.locator('[data-testid=voice-banner]')).toContainText('AI 依語音整理的草稿');
    await expect(recForm.getByLabel('發現或觀察')).toHaveValue(/AI 整理/);
    await expect(recForm.getByLabel('管理判斷')).toHaveValue('需要持續關注陳列狀況');
    expect((await recordsOf(seeded.id)).length, '套用不等於儲存').toBe(0);
    await expect(recForm.locator('input[name=follow_up_date]')).toHaveValue(followDate);
    await expect(recForm.getByLabel('預期結果')).toHaveValue('確認改善');
    await recForm.getByRole('button', { name: '儲存紀錄' }).click();
    await message(page, '管理紀錄已新增');
    await expect(detail.locator('.badge', { hasText: 'AI 草稿已人工確認' })).toBeVisible();
    const rows = await recordsOf(seeded.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ai_generated: true, ai_confirmed_by: users.sl_sup_a.id, created_by: users.sl_sup_a.id, judgment: '需要持續關注陳列狀況' });
    const tr = (await db.from('workspace_supervisor_voice_transcripts').select('*').eq('record_id', rows[0].id).single()).data as any;
    expect(tr).toMatchObject({ source: 'AI', ai_provider: 'OPENAI', created_by: users.sl_sup_a.id });
    expect(tr.transcript).toBe(text);

    // ---- 逐字稿：建立者看得到
    await detail.locator('[data-act=view-transcript]').click();
    await expect(page.locator('[data-testid=transcript-view]')).toContainText('今天到 VW001 測試門市巡店');
    await expect(page.locator('[data-testid=transcript-view]')).toContainText('只有建立者與管理者看得到');
    await page.getByRole('dialog', { name: /逐字稿/ }).getByRole('button', { name: '關閉' }).click();

    // ---- AI 失敗：假的 OpenAI 回 500 -> 退回手動文字稿；草稿標示未經 AI 整理；人工儲存不標 AI
    await detail.locator('[data-act=voice-record]').click();
    const f2 = flow(page);
    await expect(f2.locator('[data-testid=voice-consent]'), '已同意過不再問').toHaveCount(0);
    await page.evaluate(() => { (window as any).__speech = 'MOCK-FAIL'; });
    await f2.locator('[data-testid=voice-start]').click();
    await page.waitForTimeout(300);
    await f2.locator('[data-testid=voice-stop]').click();
    await f2.locator('[data-testid=voice-upload]').click();
    await expect(f2.locator('[data-testid=voice-ai-off]')).toContainText('AI 服務暫時無法使用');
    await expect(f2.locator('[data-testid=voice-recorder]'), 'AI 不可用時改用手動文字稿').toHaveCount(0);
    await f2.locator('[data-testid=voice-transcript]').fill('今天巡店，陳列整齊度尚可。MOCK-AI-FAIL 已提醒店長。');
    await f2.locator('[data-testid=voice-make-draft]').click();
    const review2 = f2.locator('[data-testid=voice-review]');
    await expect(review2.locator('[data-testid=fallback-label]')).toContainText('這份草稿未經 AI 整理');
    await expect(review2.locator('[data-testid=ai-label]')).toHaveCount(0);
    await review2.locator('[data-testid=draft-judgment]').fill('改善中');
    await review2.locator('[data-testid=voice-apply]').click();
    const recForm2 = page.getByRole('dialog', { name: '新增管理紀錄' });
    await expect(recForm2.locator('[data-testid=voice-banner]')).toContainText('這份草稿未經 AI 整理');
    await recForm2.getByRole('button', { name: '儲存紀錄' }).click();
    await message(page, '管理紀錄已新增');
    const rows2 = await recordsOf(seeded.id);
    expect(rows2).toHaveLength(2);
    const manual = rows2[1];
    expect(manual).toMatchObject({ ai_generated: false, ai_confirmed_by: null });
    const tr2 = (await db.from('workspace_supervisor_voice_transcripts').select('*').eq('record_id', manual.id).single()).data as any;
    expect(tr2).toMatchObject({ source: 'MANUAL', ai_provider: 'LOCAL_RULE_FALLBACK' });
    await detail.getByRole('button', { name: '關閉' }).click();
  } finally {
    await ctx.close();
  }
  expect(problems, `頁面錯誤：${problems.join(' | ')}`).toEqual([]);
});

test('月額度：100% 自動停用（督導改手動文字稿）、首頁只有系統管理員看到 80%／100% 提醒、管理員調整上限後恢復', async ({ browser }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-390';
  const tag = mobile ? 'M' : 'D';
  const problems: string[] = [];
  await setCapDb(30, db);
  await clearSeeds(db);
  await db.from('workspace_ai_consents').upsert({ user_id: users.sl_sup_a.id, notice_version: NOTICE_VERSION });
  const seeded = await seedCase(`${tag}-CAP`);
  const card = (p: Page) => p.locator('[data-home-card=ai-usage]');

  // ---- 80%：首頁系統管理員看到提醒
  await arrangeMonth(1, 850_000, db);
  const adminCtx = await ctxFor(browser, 'admin');
  const adminPage = await adminCtx.newPage();
  watch(adminPage, problems);
  const mgrCtx = await ctxFor(browser, 'sl_manager');
  const supCtx = await ctxFor(browser, 'sl_sup_a');
  try {
    await adminPage.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await expect(card(adminPage)).toBeVisible();
    await expect(card(adminPage)).toContainText('本月 AI 費用已達 80%');
    await expect(card(adminPage).locator('[data-home=ai-usage-percent]')).toHaveText(/^8\d(\.\d)?%$/);
    if (mobile) expect(await noOverflow(adminPage), '手機首頁提醒不橫向溢出').toBe(true);
    // 管理者（有督導管理權限但不是系統管理員）看不到
    const mgrPage = await mgrCtx.newPage();
    await mgrPage.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await expect(mgrPage.locator('.home h1')).toBeVisible();
    await expect(card(mgrPage), '非系統管理員看不到').toHaveCount(0);
    await mgrPage.close();

    // ---- 100%：督導的語音入口沒有錄音，只能手動文字稿與本機規則
    // 先調到 99.5%，再讓督導做一次真的語音轉文字（假的 OpenAI）：這一次把累計推過 100%，資料庫函式記下 80%／100% 通知
    await arrangeMonth(1, 995_000, db);
    await clearAlerts(undefined, db);
    const supApi = await apiForUser(users.sl_sup_a);
    try {
      const last = await upload(supApi, mockAudio('最後一次'), { seconds: '5' });
      expect(last.body.data.fallback, '99.5% 時 AI 仍可用').toBe(false);
    } finally {
      await supApi.dispose();
    }
    const sup = await supCtx.newPage();
    watch(sup, problems);
    await openLog(sup);
    await toCases(sup);
    await caseCard(sup, seeded.title).click();
    const detail = detailOf(sup, seeded.title);
    await detail.locator('[data-act=voice-record]').click();
    const f = flow(sup);
    await expect(f.locator('[data-testid=voice-ai-off]')).toContainText('本月 AI 額度已用完');
    await expect(f.locator('[data-testid=voice-recorder]'), '額度用完不顯示錄音').toHaveCount(0);
    if (mobile) expect(await noOverflow(sup), '手機額度用完畫面不橫向溢出').toBe(true);
    const spent = await ledgerCount();
    await f.locator('[data-testid=voice-transcript]').fill('今天巡店，陳列不整齊。已提醒店長。');
    await f.locator('[data-testid=voice-make-draft]').click();
    const review = f.locator('[data-testid=voice-review]');
    await expect(review.locator('[data-testid=fallback-label]')).toContainText('這份草稿未經 AI 整理');
    await expect(review.locator('[data-testid=fallback-label]')).toContainText('本月 AI 額度已用完');
    expect(await ledgerCount(), '停用後不再呼叫 AI、不再增加費用').toBe(spent);
    await review.locator('[data-testid=draft-judgment]').fill('需持續關注');
    await review.locator('[data-testid=voice-apply]').click();
    await expect(sup.getByRole('dialog', { name: '新增管理紀錄' }).locator('[data-testid=voice-banner]')).toContainText('這份草稿未經 AI 整理');
    await sup.getByRole('dialog', { name: '新增管理紀錄' }).getByRole('button', { name: '取消' }).click();
    await detail.getByRole('button', { name: '關閉' }).click();

    // ---- 首頁 100% 提醒（系統管理員）
    await adminPage.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await expect(card(adminPage)).toContainText('本月 AI 額度已用完，語音已自動停用');
    await expect(card(adminPage).locator('[data-home=ai-usage-percent]')).toHaveText(/^100[.0-9]*%$/);
    await expect(card(adminPage)).toContainText('每月 1 日自動恢復');

    // ---- 管理員在「AI 用量」查看並調整上限（點提醒直接開督導日誌）
    await card(adminPage).click();
    await expect(adminPage.getByRole('heading', { name: '督導管理日誌', exact: true })).toBeVisible();
    await adminPage.locator('[data-testid=tab-ai]').click();
    const panel = adminPage.locator('[data-testid=ai-usage]');
    await expect(panel.locator('[data-stat=percent]')).toHaveText(/^100[.0-9]*%$/);
    await expect(panel.locator('[data-stat=level]')).toContainText('AI 已自動停用');
    await expect(panel.locator('[data-stat=cap]')).toHaveText('US$ 1.00');
    await expect(panel.locator('[data-testid=ai-alerts]')).toContainText('達 100%');
    await expect(panel).toContainText('每月 1 日（台北時間）自動歸零');
    await panel.locator('[data-testid=ai-cap-input]').fill('abc');
    await panel.locator('[data-testid=ai-cap-save]').click();
    await expect(panel.getByRole('alert')).toContainText('數字');
    await panel.locator('[data-testid=ai-cap-input]').fill('30');
    await panel.locator('[data-testid=ai-cap-save]').click();
    await expect(panel.locator('[data-testid=ai-usage-message]')).toContainText('每月上限已更新');
    await expect(panel.locator('[data-stat=cap]')).toHaveText('US$ 30.00');
    await expect(panel.locator('[data-stat=level]')).toHaveText('正常');
    if (mobile) expect(await noOverflow(adminPage), '手機 AI 用量不橫向溢出').toBe(true);
    // 恢復：督導重新開語音有錄音；首頁提醒消失
    await sup.reload({ waitUntil: 'networkidle' });
    await openLog(sup);
    await toCases(sup);
    await caseCard(sup, seeded.title).click();
    await detailOf(sup, seeded.title).locator('[data-act=voice-record]').click();
    await expect(flow(sup).locator('[data-testid=voice-recorder]'), '調高上限後恢復').toBeVisible();
    await expect(flow(sup).locator('[data-testid=voice-ai-off]')).toHaveCount(0);
    await adminPage.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await expect(adminPage.locator('.home h1')).toBeVisible();
    await expect(card(adminPage)).toHaveCount(0);
    expect((await db.from('workspace_ai_alerts').select('level').eq('scope', 'supervisor_voice').eq('month_key', currentMonthKey())).data?.length, '通知紀錄保留').toBeGreaterThan(0);
  } finally {
    await adminCtx.close();
    await mgrCtx.close();
    await supCtx.close();
  }
  expect(problems, `頁面錯誤：${problems.join(' | ')}`).toEqual([]);
});

test('逐字稿可見範圍：團隊檢視者沒有語音入口也看不到逐字稿；管理者看得到；沒有權限者沒有入口；非系統管理員沒有 AI 用量', async ({ browser }, testInfo) => {
  const mobile = testInfo.project.name === 'mobile-390';
  const tag = mobile ? 'M' : 'D';
  const problems: string[] = [];
  await setCapDb(30, db);
  const seeded = await seedCase(`${tag}-E6`);
  const supApi = await apiForUser(users.sl_sup_a);
  try {
    await supApi.post(`${VOICE_API}/voice/consent`, { data: { accept: true, version: (await (await supApi.get(`${VOICE_API}/voice/status`)).json()).data.consent.version } });
    const r = await supApi.post(`${VOICE_API}/cases/${seeded.id}/records`, { data: { observation: '發現測試', judgment: '判斷測試', action_summary: '動作E6測試', voice: { transcript: '逐字稿含員工姓名王小明的內容。', ai_provider: 'OPENAI' } } });
    expect(r.status()).toBe(201);
  } finally {
    await supApi.dispose();
  }

  // 團隊檢視者
  const teamCtx = await ctxFor(browser, 'sl_team');
  const team = await teamCtx.newPage();
  watch(team, problems);
  try {
    await openLog(team);
    await toCases(team);
    await caseCard(team, seeded.title).click();
    const d = detailOf(team, seeded.title);
    await expect(d.locator('[data-record="動作E6測試"]')).toBeVisible();
    await expect(d.locator('[data-act=voice-record]'), '團隊檢視者沒有語音入口').toHaveCount(0);
    await expect(d.locator('[data-act=view-transcript]'), '看不到逐字稿').toHaveCount(0);
    await expect(d).not.toContainText('王小明');
    await expect(team.locator('[data-testid=tab-ai]')).toHaveCount(0);
    if (mobile) expect(await noOverflow(team), '手機團隊檢視不橫向溢出').toBe(true);
  } finally {
    await teamCtx.close();
  }
  // 管理者：看得到逐字稿
  const mgrCtx = await ctxFor(browser, 'sl_manager');
  const mgr = await mgrCtx.newPage();
  watch(mgr, problems);
  try {
    await openLog(mgr);
    await toCases(mgr);
    await root(mgr).locator('[data-testid=case-search]').fill(slName(tag));
    await caseCard(mgr, seeded.title).click();
    const d = detailOf(mgr, seeded.title);
    await d.locator('[data-act=view-transcript]').click();
    await expect(mgr.locator('[data-testid=transcript-view]')).toContainText('王小明');
    await expect(mgr.locator('[data-testid=tab-ai]'), '管理者不是系統管理員，沒有 AI 用量').toHaveCount(0);
    expect((await mgrCtx.request.get(`${VOICE_API}/ai-usage`)).status()).toBe(403);
  } finally {
    await mgrCtx.close();
  }
  // 沒有權限者
  const noneCtx = await ctxFor(browser, 'sl_none');
  const none = await noneCtx.newPage();
  try {
    await openMenu(none);
    await expect(none.locator('.workspace-menu button.catalog-item').first()).toBeVisible();
    await expect(menuItem(none)).toHaveCount(0);
    expect((await noneCtx.request.get(`${VOICE_API}/voice/status`)).status()).toBe(403);
    expect((await noneCtx.request.get(`${VOICE_API}/cases/${seeded.id}/records/00000000-0000-4000-8000-000000000000/transcript`)).status()).toBe(403);
  } finally {
    await noneCtx.close();
  }
  expect(problems, `頁面錯誤：${problems.join(' | ')}`).toEqual([]);
});

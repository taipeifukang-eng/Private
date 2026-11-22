import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { GPS_BASE, geoCallSequence, geoCalls, geoFail, geoRespond, installGeoStub, openNativeNew, workPage } from '../support/i01-fixtures';

// I01 對等層：舊版 /inspection/new（該分支改完後的行為）與新版「新增巡店」的定位區塊。
// 兩邊以同一組可控的 navigator.geolocation 模擬走同樣的情境（定位中、成功、誤差 700、誤差 1500、拒絕、逾時），
// 擷取「表單是否鎖住、定位狀態文字、精度提示、重新定位按鈕、教學連結、教學視窗（標題、加註、分頁、步驟、按鈕）、
// 呼叫順序」並逐欄比對。兩邊行為一致，不需要 allowlist；有差異就登記 approvedBy:null 並回報。

const map = loadMap('inspection-gps');
const recorder = new ParityRecorder('inspection-gps');
const entry = (id: string) => map.entries.find((e) => e.id === id)!.id;

type Facts = Record<string, unknown>;
const squash = (s: string | null | undefined) => (s || '').replace(/\s+/g, '');

async function openLegacy(page: Page) {
  await installGeoStub(page);
  await page.goto('/inspection/new?type=supervisor', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('gps-panel')).toBeVisible({ timeout: 60_000 });
}

/** 舊版：擷取定位區塊與教學視窗。 */
async function readLegacy(page: Page): Promise<Facts> {
  return page.evaluate(() => {
    const sq = (s: string | null | undefined) => (s || '').replace(/\s+/g, '');
    const text = (sel: string) => sq(document.querySelector(sel)?.textContent);
    const dialog = document.querySelector('[data-testid=gps-guide-dialog]');
    const status = document.querySelector('[data-testid=gps-panel]')?.getAttribute('data-gps-status') || '';
    return {
      locked: Array.from(document.querySelectorAll('fieldset[data-testid^=inspection-form-lock]')).every((f) => (f as HTMLFieldSetElement).disabled),
      status: status === 'idle' ? 'loading' : status,
      loading: text('[data-testid=gps-loading]'),
      accuracy: text('[data-testid=gps-accuracy]'),
      accuracyWarnClass: /orange/.test(document.querySelector('[data-testid=gps-accuracy]')?.className || ''),
      error: text('[data-testid=gps-error]'),
      retry: text('[data-testid=gps-retry]'),
      hint: text('[data-testid=gps-panel] p.text-gray-500'),
      required: text('[data-testid=gps-panel] span.text-red-500'),
      okColor: (() => { const el = Array.from(document.querySelectorAll('[data-testid=gps-panel] span')).find((e) => /已定位/.test(e.textContent || '')); return el ? getComputedStyle(el).color : ''; })(),
      guideLink: text('[data-testid=gps-guide-link]'),
      guideOpen: !!dialog,
      guideTitle: sq(dialog?.querySelector('h2')?.textContent),
      guideNote: text('[data-testid=gps-guide-note]'),
      guideLineNotice: text('[data-testid=gps-guide-line-notice]'),
      guideTabs: Array.from(dialog?.querySelectorAll('[role=tab]') || []).map((t) => sq(t.textContent)),
      guideActiveTab: Array.from(dialog?.querySelectorAll('[role=tab]') || []).filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => sq(t.textContent)),
      guideSteps: Array.from(dialog?.querySelectorAll('ol li') || []).map((li) => sq(li.textContent)),
      guideRetry: text('[data-testid=gps-guide-retry]'),
    };
  });
}

/** 新版：擷取定位區塊與教學視窗。 */
async function readNative(page: Page): Promise<Facts> {
  return page.evaluate(() => {
    const sq = (s: string | null | undefined) => (s || '').replace(/\s+/g, '');
    const text = (sel: string) => sq(document.querySelector(sel)?.textContent);
    const dialog = document.querySelector('dialog[open]');
    const select = document.querySelector('section.work-page:not([hidden]) select[aria-label="巡店門市"]') as HTMLSelectElement | null;
    return {
      locked: !!select && select.matches(':disabled'),
      status: document.querySelector('[data-testid=gps-panel]')?.getAttribute('data-gps-status') || '',
      loading: text('[data-testid=gps-loading]'),
      accuracy: text('[data-testid=gps-accuracy]'),
      accuracyWarnClass: /warn/.test(document.querySelector('[data-testid=gps-accuracy]')?.className || ''),
      error: text('[data-testid=gps-error]'),
      retry: text('[data-testid=gps-retry]'),
      hint: text('[data-testid=gps-hint]'),
      required: text('[data-testid=gps-panel] strong small'),
      okColor: (() => { const el = document.querySelector('[data-testid=gps-panel] .gps-ok'); return el ? getComputedStyle(el).color : ''; })(),
      guideLink: text('[data-testid=gps-guide-link]'),
      guideOpen: !!dialog,
      guideTitle: sq(dialog?.querySelector('h2')?.textContent),
      guideNote: text('[data-testid=gps-guide-note]'),
      guideLineNotice: text('[data-testid=gps-guide-line-notice]'),
      guideTabs: Array.from(dialog?.querySelectorAll('[role=tab]') || []).map((t) => sq(t.textContent)),
      guideActiveTab: Array.from(dialog?.querySelectorAll('[role=tab]') || []).filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => sq(t.textContent)),
      guideSteps: Array.from(dialog?.querySelectorAll('ol li') || []).map((li) => sq(li.textContent)),
      guideRetry: text('[data-testid=gps-guide-retry]'),
    };
  });
}

type Script = (page: Page) => Promise<void>;
const SCENARIOS: Array<{ id: string; title: string; script: Script }> = [
  { id: 'gps-locating', title: '定位進行中', script: async () => {} },
  { id: 'gps-success', title: '定位成功（誤差 20 公尺）', script: (p) => geoRespond(p, GPS_BASE, true) },
  { id: 'gps-warn-700', title: '誤差 700 公尺', script: (p) => geoRespond(p, { ...GPS_BASE, accuracy: 700 }, true) },
  { id: 'gps-fail-1500', title: '誤差 1500 公尺', script: (p) => geoRespond(p, { ...GPS_BASE, accuracy: 1500 }, true) },
  {
    id: 'gps-denied',
    title: '權限被拒絕',
    script: async (p) => {
      await geoFail(p, 1, true);
      await geoFail(p, 1, false);
    },
  },
  {
    id: 'gps-timeout',
    title: '定位逾時',
    script: async (p) => {
      await geoFail(p, 3, true);
      await geoFail(p, 3, false);
    },
  },
];

for (const s of SCENARIOS) {
  test(`定位對等：${s.title}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await loginAs(browser, 'admin');
    try {
      const legacyPage = await ctx.newPage();
      const nativePage = await ctx.newPage();
      await nativePage.setViewportSize({ width: 1440, height: 900 });
      await legacyPage.setViewportSize({ width: 1440, height: 900 });

      await openLegacy(legacyPage);
      await installGeoStub(nativePage);
      await openNativeNew(nativePage);
      await expect.poll(async () => (await geoCalls(legacyPage)).length).toBeGreaterThanOrEqual(1);
      await expect.poll(async () => (await geoCalls(nativePage)).length).toBeGreaterThanOrEqual(1);

      await s.script(legacyPage);
      await s.script(nativePage);
      // 等兩邊畫面都穩定（有錯誤或成功時出現對應標記）。
      if (s.id !== 'gps-locating') {
        await expect(legacyPage.getByTestId('gps-panel')).not.toHaveAttribute('data-gps-status', /^(loading|idle)$/, { timeout: 20_000 });
        await expect(workPage(nativePage).getByTestId('gps-panel')).not.toHaveAttribute('data-gps-status', 'loading', { timeout: 20_000 });
      }
      const l = await readLegacy(legacyPage);
      const n = await readNative(nativePage);
      const calls = { legacy: await geoCallSequence(legacyPage), native: await geoCallSequence(nativePage) };

      assertNoUnlistedDiffs(
        recorder.record({
          entry: entry(s.id),
          mechanism: 'ui-extract',
          role: 'admin',
          title: `${s.title}：鎖住狀態、定位文字、精度提示、重新定位、教學視窗與呼叫順序`,
          legacy: { endpoint: '/inspection/new?type=supervisor' },
          native: { endpoint: '新增巡店 [data-testid=gps-panel]' },
          compared: { facts: Object.keys(l).length, steps: (l.guideSteps as string[]).length },
          diffs: valueDiffsToDiffs(diffNormalized({ ...l, calls: calls.legacy }, { ...n, calls: calls.native })),
        }),
      );
    } finally {
      await ctx.close();
    }
  });
}

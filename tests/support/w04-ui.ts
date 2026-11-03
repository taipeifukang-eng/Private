import { expect, type Page, type TestInfo } from '@playwright/test';

// W04 版更說明頁的共用操作：開啟新版頁、擷取新舊兩邊的結構化文字。

export const RELEASE_TITLE = '每月版更內容';

/** 依目前 Playwright project 設定頁面大小（loginAs 建立的 context 不會自動套用 project 的 viewport）。 */
export async function applyProjectViewport(page: Page, testInfo: TestInfo) {
  const viewport = (testInfo.project.use as { viewport?: { width: number; height: number } }).viewport;
  if (viewport) await page.setViewportSize(viewport);
}

/** 從全站功能選單開啟新版「每月版更內容」。 */
export async function openNativeRelease(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator(`.workspace-menu button.catalog-item[title="${RELEASE_TITLE}"]`).click();
  await expect(page.getByRole('heading', { name: RELEASE_TITLE, exact: true })).toBeVisible();
}

export async function noPageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

export type ReleaseFacts = {
  slug: string;
  open: boolean;
  eyebrow: string;
  state: string;
  title: string;
  summary: string;
  month: string;
  sections: Array<{ title: string; style: string; paragraphs: string[]; items: string[] }>;
};
export type IndexFacts = {
  heading: string;
  eyebrow: string;
  listTitle: string;
  listHint: string;
  count: string;
  cards: Array<{ month: string; title: string; latest: boolean }>;
};

/** 舊版頁面：以 Tailwind 類別與標籤結構擷取。 */
export async function readLegacyRelease(page: Page): Promise<{ releases: ReleaseFacts[]; index: IndexFacts; backHome: string[] }> {
  return page.evaluate(() => {
    const t = (el: Element | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const releases = Array.from(document.querySelectorAll('details[id]')).map((d) => ({
      slug: d.id,
      open: (d as HTMLDetailsElement).open,
      eyebrow: t(d.querySelector('summary div.inline-flex')),
      state: t(d.querySelector('summary div.mb-4 > span')),
      title: t(d.querySelector('summary h2')),
      summary: t(d.querySelector('summary p')),
      month: t(d.querySelector('summary div[class*="text-white/90"] > span:first-child')),
      sections: Array.from(d.querySelectorAll(':scope > div.space-y-8 > section')).map((s) => {
        const ol = s.querySelector('ol');
        return {
          title: t(s.querySelector('h3')),
          style: s.className.includes('bg-orange-50') ? 'highlight' : ol && ol.className.includes('grid') ? 'cards' : ol ? 'list' : 'plain',
          paragraphs: Array.from(s.querySelectorAll(':scope > p')).map(t),
          items: Array.from(s.querySelectorAll('ol > li')).map(t),
        };
      }),
    }));
    const listSection = Array.from(document.querySelectorAll('section')).find((s) => t(s.querySelector('h2')) === '月份清單')!;
    const index = {
      heading: t(document.querySelector('h1')),
      eyebrow: t(document.querySelector('h1')?.previousElementSibling),
      listTitle: t(listSection.querySelector('h2')),
      listHint: t(listSection.querySelector('h2 + p')),
      count: t(listSection.querySelector('span.rounded-full')),
      cards: Array.from(listSection.querySelectorAll('a[href^="#"]')).map((a) => ({
        month: t(a.querySelector('div.text-sm')),
        title: t(a.querySelector('p')),
        latest: t(a).endsWith('最新'),
      })),
    };
    return { releases, index, backHome: Array.from(document.querySelectorAll('a[href="/"]')).map(t) };
  });
}

/** 新版頁面：以 data 屬性擷取。 */
export async function readNativeRelease(page: Page): Promise<{ releases: ReleaseFacts[]; index: IndexFacts }> {
  return page.evaluate(() => {
    const t = (el: Element | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const releases = Array.from(document.querySelectorAll('details[data-release]')).map((d) => ({
      slug: (d as HTMLElement).dataset.release || '',
      open: (d as HTMLDetailsElement).open,
      eyebrow: t(d.querySelector('[data-release-eyebrow]')),
      state: t(d.querySelector('[data-release-state]')),
      title: t(d.querySelector('[data-release-title]')),
      summary: t(d.querySelector('[data-release-summary]')),
      month: t(d.querySelector('[data-release-month]')),
      sections: Array.from(d.querySelectorAll('[data-release-section]')).map((s) => {
        const ol = s.querySelector('ol');
        return {
          title: t(s.querySelector('[data-section-title]')),
          style: s.classList.contains('highlight') ? 'highlight' : ol ? ((ol as HTMLElement).dataset.sectionStyle as string) : 'plain',
          paragraphs: Array.from(s.querySelectorAll('[data-section-paragraph]')).map(t),
          items: Array.from(s.querySelectorAll('[data-section-item]')).map(t),
        };
      }),
    }));
    const idx = document.querySelector('[data-release-index]')!;
    const index = {
      heading: t(document.querySelector('h1')),
      eyebrow: t(document.querySelector('h1')?.previousElementSibling),
      listTitle: t(idx.querySelector('h2')),
      listHint: t(idx.querySelector('h2 + p')),
      count: t(idx.querySelector('[data-release-count]')),
      cards: Array.from(idx.querySelectorAll('[data-release-link]')).map((a) => ({
        month: t(a.querySelector('strong')),
        title: t(a.querySelector('small')),
        latest: t(a).endsWith('最新'),
      })),
    };
    return { releases, index };
  });
}

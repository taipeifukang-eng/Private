/**
 * 機制四（導覽）的 DOM 擷取版本（T02）。
 *
 * - 舊版：以角色登入後開 http://localhost:3002/ ，等舊 Navbar（components/Navbar.tsx）渲染完成，
 *   桌機寬度逐一展開下拉子選單，擷取所有選單連結的 href 與文字；手機寬度則展開漢堡選單再擷取一次，
 *   用來確認兩種版面入口一致。
 * - 新版：開 /workspace/index.html，打開「全站功能選單」，擷取每個群組的項目。
 *   新版殼層內部功能是按鈕（沒有 href），所以用 session navigation 以「群組 + 名稱」反查 href。
 *
 * 純函式（正規化、差異）與 Playwright 操作分開，前者可在 Vitest 單元測試。
 */
import type { Locator, Page } from '@playwright/test';
import { compareRowSets } from './normalize';
import { rowSetToDiffs, type Diff } from './parity';
import type { NavItem } from './parity-nav';

export interface NativeDomItem {
  group: string;
  label: string;
  /** 外連項目（原測試頁）才有 href；內部功能按鈕為 undefined。 */
  href?: string;
}

export function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 去掉同源前綴、查詢字串與 hash、結尾斜線（根路徑除外）。 */
export function normalizeHref(raw: string): string {
  let h = raw.trim();
  h = h.replace(/^https?:\/\/localhost:3002/i, '');
  h = h.replace(/[?#].*$/, '');
  if (h.length > 1) h = h.replace(/\/+$/, '');
  return h || '/';
}

/** 依 href 去重（保留第一個），並依 href 排序，方便比對與閱讀。 */
export function dedupeItems(items: NavItem[]): NavItem[] {
  const seen = new Map<string, NavItem>();
  for (const i of items) {
    const href = normalizeHref(i.href);
    if (!seen.has(href)) seen.set(href, { href, label: normalizeLabel(i.label) });
  }
  return Array.from(seen.values()).sort((a, b) => a.href.localeCompare(b.href));
}

/** 只比 href（同一入口在桌機頂層與下拉、手機版面的文字本來就可能不同）。 */
function hrefOnly(items: NavItem[]): NavItem[] {
  return dedupeItems(items).map((i) => ({ href: i.href, label: '' }));
}

/** 兩組入口以 href 比對；差異用指定名稱（避免誤套 only-legacy / only-native 白名單）。 */
export function diffItemSets(a: NavItem[], b: NavItem[], kindA: string, kindB: string, detailA: string, detailB: string): Diff[] {
  const cmp = compareRowSets(a as unknown as Record<string, unknown>[], b as unknown as Record<string, unknown>[], 'href');
  return rowSetToDiffs(cmp)
    .filter((d) => !(d.kind === 'count' && d.key === '(rows)'))
    .map((d) => {
      if (d.kind === 'only-legacy') return { ...d, kind: kindA, detail: detailA };
      if (d.kind === 'only-native') return { ...d, kind: kindB, detail: detailB };
      return d;
    });
}

/** 舊版規則表求值 vs 舊版 DOM：不一致代表規則表或證據有問題。 */
export function diffRulesVsDom(rules: NavItem[], dom: NavItem[]): Diff[] {
  return diffItemSets(
    hrefOnly(rules),
    hrefOnly(dom),
    'rule-only',
    'dom-only',
    '規則表求值有、舊 Navbar DOM 沒有',
    '舊 Navbar DOM 有、規則表求值沒有',
  );
}

/** 舊版桌機 vs 手機版面。 */
export function diffDesktopVsMobile(desktop: NavItem[], mobile: NavItem[]): Diff[] {
  return diffItemSets(
    hrefOnly(desktop),
    hrefOnly(mobile),
    'desktop-only',
    'mobile-only',
    '桌機選單有、手機漢堡選單沒有',
    '手機漢堡選單有、桌機選單沒有',
  );
}

/** 新版：DOM 項目以 session navigation 補上 href。找不到時 href 以 (unmapped) 開頭，讓差異可見。 */
export function nativeDomToItems(dom: NativeDomItem[], sessionNavigation: unknown): NavItem[] {
  const groups = (Array.isArray(sessionNavigation) ? sessionNavigation : []) as {
    label?: string;
    items?: { href: string; label: string }[];
  }[];
  const byGroupLabel = new Map<string, string>();
  const byLabel = new Map<string, string[]>();
  for (const g of groups) {
    for (const i of g.items || []) {
      byGroupLabel.set(`${normalizeLabel(g.label || '')}/${normalizeLabel(i.label)}`, i.href);
      const list = byLabel.get(normalizeLabel(i.label)) || [];
      list.push(i.href);
      byLabel.set(normalizeLabel(i.label), list);
    }
  }
  const items = dom.map((d) => {
    const label = normalizeLabel(d.label);
    const unique = byLabel.get(label);
    const href =
      (d.href ? normalizeHref(d.href) : undefined) ||
      byGroupLabel.get(`${normalizeLabel(d.group)}/${label}`) ||
      (unique && unique.length === 1 ? unique[0] : undefined) ||
      `(unmapped)${d.group}/${label}`;
    return { href, label };
  });
  return dedupeItems(items);
}

/** 新版殼層實際渲染的選單 vs session navigation（確認畫面與 API 一致）。 */
export function diffNativeDomVsSession(domItems: NavItem[], sessionNav: NavItem[]): Diff[] {
  return diffItemSets(
    dedupeItems(sessionNav),
    dedupeItems(domItems),
    'session-only',
    'dom-only',
    'session navigation 有、新版殼層選單沒有渲染',
    '新版殼層選單有、session navigation 沒有',
  );
}

// ---------------------------------------------------------------------------
// Playwright 操作
// ---------------------------------------------------------------------------

/** 等到數量連續數次不變（Navbar 的權限是非同步載入，載入前後入口數會變）。 */
async function waitStable(count: () => Promise<number>, { rounds = 4, intervalMs = 300, timeoutMs = 15_000 } = {}): Promise<number> {
  const start = Date.now();
  let last = -1;
  let same = 0;
  while (Date.now() - start < timeoutMs) {
    const n = await count();
    if (n === last && n > 0) {
      same += 1;
      if (same >= rounds) return n;
    } else {
      same = 0;
      last = n;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

async function collectLinks(scope: Locator): Promise<NavItem[]> {
  return scope.locator('a[href]').evaluateAll((els) =>
    els.map((el) => ({
      href: el.getAttribute('href') || '',
      label: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    })),
  );
}

export interface LegacyNavDom {
  items: NavItem[];
  /** 找不到 Navbar（例如被導向登入頁或無權限頁）。 */
  navbarFound: boolean;
  finalUrl: string;
}

/**
 * 舊 Navbar。mode=desktop：寬度需 >= 1024（lg），逐一點開下拉按鈕；mode=mobile：寬度 < 1024，展開漢堡選單。
 * 呼叫端負責設定 viewport。
 */
export async function extractLegacyNavDom(page: Page, mode: 'desktop' | 'mobile'): Promise<LegacyNavDom> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const nav = page.locator('nav.sticky');
  const hasNav = await nav
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!hasNav) return { items: [], navbarFound: false, finalUrl: page.url() };

  if (mode === 'desktop') {
    const menu = nav.locator('div[class*="lg:ml-10"]').first();
    await menu.waitFor({ state: 'visible', timeout: 15_000 });
    await waitStable(async () => (await menu.locator('a[href]').count()) + (await menu.locator('button').count()));
    const base: NavItem[] = await collectLinks(menu);
    const dropdown: NavItem[] = [];
    const buttons = menu.locator('button');
    const total = await buttons.count();
    for (let i = 0; i < total; i += 1) {
      await buttons.nth(i).click();
      await page.waitForTimeout(150);
      dropdown.push(...(await collectLinks(menu.locator('div.absolute'))));
      // 再點一次收合，避免下拉遮擋下一顆按鈕
      if ((await menu.locator('div.absolute a[href]').count()) > 0) await buttons.nth(i).click();
    }
    // 同一 href 同時出現在頂層（例如「總務服務中心」）與下拉（「服務中心首頁」）時，以下拉的名稱為準，與規則表一致。
    return { items: dedupeItems([...dropdown, ...base]), navbarFound: true, finalUrl: page.url() };
  }

  const burger = nav.locator('button[class*="lg:hidden"]').first();
  await burger.waitFor({ state: 'visible', timeout: 15_000 });
  await burger.click();
  const panel = nav.locator('div[class*="lg:hidden"][class*="border-t"]').first();
  await panel.waitFor({ state: 'visible', timeout: 15_000 });
  await waitStable(() => panel.locator('a[href]').count());
  return { items: dedupeItems(await collectLinks(panel)), navbarFound: true, finalUrl: page.url() };
}

export interface NativeNavDom {
  items: NativeDomItem[];
  shellFound: boolean;
}

/** 新版殼層：開啟「全站功能選單」並擷取各群組項目。 */
export async function extractNativeNavDom(page: Page): Promise<NativeNavDom> {
  await page.goto('/workspace/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const toggle = page.locator('button.menu-toggle');
  const ready = await toggle
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!ready) return { items: [], shellFound: false };
  await toggle.click();
  const panel = page.locator('nav#workspace-menu');
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(200);
  const items = await panel.locator('section.catalog-group').evaluateAll((sections) =>
    sections.flatMap((s) => {
      const group = (s.querySelector('h2')?.textContent || '').replace(/\s+/g, ' ').trim();
      return Array.from(s.querySelectorAll('.catalog-item')).map((el) => {
        const label = (el.querySelector('span')?.textContent || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
        return { group, label, href: el.tagName === 'A' ? el.getAttribute('href') || undefined : undefined };
      });
    }),
  );
  return { items, shellFound: true };
}

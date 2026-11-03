import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MONTHLY_RELEASES, validateReleases, type MonthlyRelease } from '../../../lib/workspace/monthly-release';
import { WORKSPACE_NAV_KINDS } from '../../../lib/workspace/page-kinds';
import { WORKSPACE_PAGE_META, isPageAllowed, pageTitle } from '../../../vue-workspace/src/workspace-page-meta';

// W04 單元層：版更期別資料的結構檢查、與舊版原文逐字對照、頁面註冊與「登入即可看」規則。

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const sample = (over: Partial<MonthlyRelease> = {}): MonthlyRelease => ({
  slug: '2026-04',
  eyebrow: 'e',
  monthLabel: 'm',
  title: 't',
  summary: 's',
  sections: [{ title: 'x', paragraphs: ['p'] }],
  ...over,
});

describe('W04 期別資料檢查', () => {
  it('目前的期別資料通過檢查，且最新（第一筆）是 2026-03', () => {
    expect(validateReleases(MONTHLY_RELEASES)).toEqual([]);
    expect(MONTHLY_RELEASES[0].slug).toBe('2026-03');
  });

  it('新增一期放在最前面（較新的 slug）時通過；放在後面會被擋下', () => {
    expect(validateReleases([sample(), ...MONTHLY_RELEASES])).toEqual([]);
    const wrongOrder = validateReleases([...MONTHLY_RELEASES, sample()]);
    expect(wrongOrder.join('\n')).toContain('最新在前');
  });

  it('擋下：slug 格式錯誤、重複、欄位空白、沒有段落、段落沒有內容', () => {
    expect(validateReleases([sample({ slug: '2026-13' })]).join()).toContain('YYYY-MM');
    expect(validateReleases([sample({ slug: '26-03' })]).join()).toContain('YYYY-MM');
    expect(validateReleases([sample(), sample()]).join()).toContain('重複');
    expect(validateReleases([sample({ title: '  ' })]).join()).toContain('缺少 title');
    expect(validateReleases([sample({ sections: [] })]).join()).toContain('至少要有一個段落');
    expect(validateReleases([sample({ sections: [{ title: 'x' }] })]).join()).toContain('沒有內容');
    expect(validateReleases([sample({ sections: [{ title: '', items: ['a'] }] })]).join()).toContain('缺少 title');
  });

  it('多期時 slug 嚴格遞減，每期都能用 slug 當錨點 id', () => {
    const many = [sample({ slug: '2026-05' }), sample({ slug: '2026-04' }), sample({ slug: '2025-12' })];
    expect(validateReleases(many)).toEqual([]);
    expect(new Set(many.map((r) => `release-${r.slug}`)).size).toBe(3);
  });
});

describe('W04 與舊版 app/monthly-release/page.tsx 原文逐字對照（W04-q1）', () => {
  const legacy = read('app/monthly-release/page.tsx');
  const dataBlock = legacy.slice(legacy.indexOf('const monthlyReleases'), legacy.indexOf('export default function'));
  const literals = Array.from(dataBlock.matchAll(/'((?:[^'\\]|\\.)*)'/g), (m) => m[1]).filter((s) => !['highlight', 'cards', 'default'].includes(s));

  function flatten(releases: readonly MonthlyRelease[]) {
    const out: string[] = [];
    for (const r of releases) {
      out.push(r.slug, r.eyebrow, r.monthLabel, r.title, r.summary);
      for (const s of r.sections) out.push(s.title, ...(s.paragraphs || []), ...(s.items || []));
    }
    return out;
  }

  it('所有字串依序完全相同（沒有多、沒有少、沒有改字）', () => {
    expect(flatten(MONTHLY_RELEASES)).toEqual(literals);
  });

  it('舊版共 1 期、3 個段落，樣式與新版一致', () => {
    expect((dataBlock.match(/slug:/g) || []).length).toBe(1);
    expect(MONTHLY_RELEASES).toHaveLength(1);
    expect(MONTHLY_RELEASES[0].sections.map((s) => s.style ?? 'default')).toEqual(['default', 'highlight', 'cards']);
    expect(dataBlock).toContain("style: 'highlight'");
    expect(dataBlock).toContain("style: 'cards'");
  });

  it('條列文字保留舊版自帶的編號（1. 到 6.）與全形標點', () => {
    const items = MONTHLY_RELEASES[0].sections[0].items!;
    expect(items.map((i) => i[0])).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(items[0]).toContain('「當月獎金／津貼 PDF」');
  });
});

describe('W04 頁面註冊與存取規則', () => {
  it('是導覽 kind，標題為「每月版更內容」，只需要 monthlyRelease', () => {
    expect(WORKSPACE_NAV_KINDS).toContain('monthly-release');
    expect(pageTitle('monthly-release')).toBe('每月版更內容');
    expect(WORKSPACE_PAGE_META['monthly-release'].permission).toEqual(['monthlyRelease']);
  });

  it('登入即可看：monthlyRelease 為 true 就能開；未登入或工作階段過期不能開；其他 capability 全開也不影響', () => {
    expect(isPageAllowed('monthly-release', { monthlyRelease: true })).toBe(true);
    expect(isPageAllowed('monthly-release', { monthlyRelease: true }, true)).toBe(false);
    expect(isPageAllowed('monthly-release', undefined)).toBe(false);
    expect(isPageAllowed('monthly-release', { monthly: true, monthlyExport: true })).toBe(false);
  });

  it('session 對所有登入者回傳 monthlyRelease: true，導覽項目不需任何權限碼', () => {
    expect(read('app/api/workspace/session/route.ts')).toMatch(/monthlyRelease:\s*true/);
    expect(read('lib/workspace/navigation.ts')).toContain('item("每月版更內容", "/monthly-release", [], "monthly-release")');
  });

  it('頁面元件讀取期別陣列、最新一期預設展開、可收合，且不發任何資料請求', () => {
    const vue = read('vue-workspace/src/pages/MonthlyRelease.vue');
    expect(vue).toContain('MONTHLY_RELEASES');
    expect(vue).toContain('releases[0].slug');
    expect(vue).toContain('<details');
    expect(vue).not.toMatch(/\bapi\(|fetch\(/);
  });
});

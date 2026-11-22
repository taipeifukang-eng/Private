import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTIVITY_PDF_FORMAT,
  ACTIVITY_PDF_ORIENTATION,
  ACTIVITY_PDF_PAGE,
  PUBLISH_TAG_LABEL,
  activityLegacyTarget,
  activityPdfFilename,
  activityPdfPlacement,
  availableYears,
  campaignInYear,
  computeActivityViewer,
  dedupeStores,
  defaultViewYear,
  emptyYearText,
  isUnpublished,
  pdfExportBlocked,
  publishTags,
  scheduledManaged,
  viewStatusLabel,
  viewerTitle,
  type ManagedStore,
} from '@/lib/workspace/activity-view-rules';

// W20（M5 Q2、Q7、Q8、不需決策項目）的純規則。對照舊版 app/activity-management/page.tsx 與 app/activity-view/[id]/page.tsx。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('狀態標籤（即將開始／進行中／已結束）', () => {
  const c = { start_date: '2099-05-10', end_date: '2099-05-20' };
  it.each([
    ['2099-05-09', '即將開始'],
    ['2099-05-10', '進行中'], // 開始日當天
    ['2099-05-15', '進行中'],
    ['2099-05-20', '進行中'], // 結束日整天都算進行中（舊版用 UTC 零點比較，結束日 08:00 後就變已結束，列入差異清單）
    ['2099-05-21', '已結束'],
  ])('今天 %s -> %s', (today, label) => {
    expect(viewStatusLabel(c, today)).toBe(label);
  });
});

describe('年度按鈕與篩選（照舊版）', () => {
  const rows = [
    { start_date: '2098-12-20', end_date: '2099-01-05' },
    { start_date: '2099-05-01', end_date: '2099-05-31' },
    { start_date: '2100-02-01', end_date: '2100-02-10' },
  ];
  it('年度由開始與結束年份擷取、由小到大、不重複', () => {
    expect(availableYears(rows)).toEqual(['2098', '2099', '2100']);
    expect(availableYears([])).toEqual([]);
  });
  it('跨年活動兩個年度都算；all 表示全部', () => {
    expect(campaignInYear(rows[0], '2098')).toBe(true);
    expect(campaignInYear(rows[0], '2099')).toBe(true);
    expect(campaignInYear(rows[0], '2100')).toBe(false);
    expect(campaignInYear(rows[1], '2098')).toBe(false);
    for (const r of rows) expect(campaignInYear(r, 'all')).toBe(true);
  });
  it('跨三年的活動，中間年度也算（舊版 startYear <= y <= endYear）', () => {
    expect(campaignInYear({ start_date: '2098-12-01', end_date: '2100-01-31' }, '2099')).toBe(true);
  });
  it('預設年度為今年（台灣日曆）', () => {
    expect(defaultViewYear('2099-03-04')).toBe('2099');
  });
  it('空狀態文案依年度不同', () => {
    expect(emptyYearText('all')).toBe('目前沒有已發布的活動');
    expect(emptyYearText('2099')).toBe('2099 年沒有已發布的活動');
  });
  it('與舊版頁面的篩選邏輯逐字等價（200 組隨機資料）', () => {
    // 舊版（app/activity-management/page.tsx）filteredCampaigns 的逐行移植
    const legacy = (c: { start_date?: string; end_date?: string }, selectedYear: string) => {
      if (selectedYear === 'all') return true;
      const startYear = c.start_date?.substring(0, 4);
      const endYear = c.end_date?.substring(0, 4);
      return startYear === selectedYear || endYear === selectedYear || (startYear && endYear && startYear <= selectedYear && endYear >= selectedYear);
    };
    let seed = 20;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    for (let i = 0; i < 200; i += 1) {
      const s = 2096 + rnd(6);
      const e = s + rnd(3);
      const c = { start_date: `${s}-0${1 + rnd(9)}-10`, end_date: `${e}-1${rnd(3)}-20` };
      const y = String(2095 + rnd(10));
      expect(campaignInYear(c, y), JSON.stringify([c, y])).toBe(!!legacy(c, y));
    }
    const src = read('app/activity-management/page.tsx');
    expect(src).toContain('startYear === selectedYear || endYear === selectedYear');
    expect(src).toContain('String(new Date().getFullYear())'); // 預設今年
  });
});

describe('發布對象標籤與未發布', () => {
  it('三種對象標籤文字與舊版相同（盤點組標籤含行銷部、營業部助理）', () => {
    expect(PUBLISH_TAG_LABEL).toEqual({ supervisors: '督導', storeManagers: '店長', inventoryTeam: '盤點組/行銷部/營業部助理' });
    const src = read('app/activity-management/page.tsx');
    for (const label of Object.values(PUBLISH_TAG_LABEL)) expect(src).toContain(label);
  });
  it.each([
    [{ published_to_supervisors: true }, ['督導']],
    [{ published_to_store_managers: true, published_to_inventory_team: true }, ['店長', '盤點組/行銷部/營業部助理']],
    [{ published_to_supervisors: true, published_to_store_managers: true, published_to_inventory_team: true }, ['督導', '店長', '盤點組/行銷部/營業部助理']],
    [{}, []],
    [{ published_to_supervisors: null, published_to_store_managers: false }, []],
  ])('標籤 %j', (c, tags) => {
    expect(publishTags(c)).toEqual(tags);
    expect(isUnpublished(c)).toBe(tags.length === 0);
  });
  it('督導／店長標題', () => {
    expect(viewerTitle(true, true)).toBe('督導與店長');
    expect(viewerTitle(true, false)).toBe('督導');
    expect(viewerTitle(false, true)).toBe('店長');
    expect(viewerTitle(false, false)).toBe('');
  });
});

describe('Q7 活動人力查看、前置 Check List、支援請求按鈕（照舊版）', () => {
  const S = (code: string): ManagedStore => ({ id: `id-${code}`, store_code: code, store_name: `店${code}` });
  const appointed = [S('B'), S('A'), S('A')];
  const all = [S('A'), S('B'), S('C'), S('D')];
  const view = (isAdminRole: boolean, perms: string[], appts = appointed) =>
    computeActivityViewer({ isAdminRole, permissions: new Set(perms), appointedStores: appts, allActiveStores: all });

  it('只有 view_own、沒有支援指派／人力查看權限：不載入管轄門市，三顆按鈕都不出現（含 Check List）', () => {
    const v = view(false, ['activity.campaign.view_own']);
    expect(v.managedStores).toEqual([]);
    expect([v.showSupport, v.showStaffOverview, v.showChecklist]).toEqual([false, false, false]);
  });
  it('有支援指派權：支援請求與 Check List 出現，人力查看不出現', () => {
    const v = view(false, ['activity.support_assign.edit']);
    expect([v.showSupport, v.showStaffOverview, v.showChecklist]).toEqual([true, false, true]);
    expect(v.managedStores.map((s) => s.store_code)).toEqual(['A', 'B']); // 去重、依門市代號排序
  });
  it('有人力查看權：人力查看與 Check List 出現，支援請求不出現', () => {
    const v = view(false, ['activity.staff_overview.view']);
    expect([v.showSupport, v.showStaffOverview, v.showChecklist]).toEqual([false, true, true]);
  });
  it('兩個權限都有：三顆都出現', () => {
    const v = view(false, ['activity.support_assign.edit', 'activity.staff_overview.view']);
    expect([v.showSupport, v.showStaffOverview, v.showChecklist]).toEqual([true, true, true]);
  });
  it('有權限但沒有任何任命門市：按鈕全不出現（需有管轄門市）', () => {
    const v = view(false, ['activity.support_assign.edit', 'activity.staff_overview.view'], []);
    expect([v.showSupport, v.showStaffOverview, v.showChecklist]).toEqual([false, false, false]);
  });
  it('管理員角色：不需權限碼，管轄門市為全部啟用門市', () => {
    const v = view(true, [], []);
    expect(v.managedStores).toHaveLength(4);
    expect([v.showSupport, v.showStaffOverview, v.showChecklist]).toEqual([true, true, true]);
    expect(v.canAssignSupport && v.canViewStaffOverview).toBe(true);
  });
  it('與舊頁 loadData 的條件逐字等價（窮舉：管理員 × 支援權 × 人力權 × 有無任命）', () => {
    // 舊版 app/activity-view/[id]/page.tsx 的條件，逐行移植
    const legacy = (isAdmin: boolean, permSet: Set<string>, managed: number) => {
      const hasAssignPerm = isAdmin || permSet.has('activity.support_assign.edit');
      const hasOverviewPerm = isAdmin || permSet.has('activity.staff_overview.view');
      const managedLen = hasAssignPerm || hasOverviewPerm ? managed : 0;
      return { support: hasAssignPerm && managedLen > 0, staff: hasOverviewPerm && managedLen > 0, checklist: managedLen > 0 };
    };
    for (const admin of [false, true])
      for (const assign of [false, true])
        for (const overview of [false, true])
          for (const hasAppt of [false, true]) {
            const perms = [assign ? 'activity.support_assign.edit' : '', overview ? 'activity.staff_overview.view' : ''].filter(Boolean);
            const appts = hasAppt ? [S('A')] : [];
            const v = computeActivityViewer({ isAdminRole: admin, permissions: new Set(perms), appointedStores: appts, allActiveStores: all });
            // 管理員看全部門市，所以「管轄門市數」是全部啟用門市（不看任命）
            const managedCount = admin ? all.length : appts.length;
            const l = legacy(admin, new Set(perms), managedCount);
            expect({ support: v.showSupport, staff: v.showStaffOverview, checklist: v.showChecklist }, JSON.stringify({ admin, assign, overview, hasAppt })).toEqual(l);
          }
    const src = read('app/activity-view/[id]/page.tsx');
    expect(src).toContain("const hasAssignPerm = isAdmin || permSet.has('activity.support_assign.edit')");
    expect(src).toContain("const hasOverviewPerm = isAdmin || permSet.has('activity.staff_overview.view')");
    expect(src).toContain('if (hasAssignPerm || hasOverviewPerm)');
    expect(src).toContain('{managedStores.length > 0 && (');
  });
  it('人力查看與 Check List 只列自己管轄且有排程的門市', () => {
    expect(scheduledManaged([S('A'), S('B'), S('C')], ['id-B', 'id-C', 'id-Z']).map((s) => s.store_code)).toEqual(['B', 'C']);
    expect(scheduledManaged([], ['id-A'])).toEqual([]);
  });
  it('dedupeStores 忽略缺 id 的列', () => {
    expect(dedupeStores([S('B'), { id: '', store_code: 'X', store_name: 'x' }, S('B'), S('A')]).map((s) => s.store_code)).toEqual(['A', 'B']);
  });
});

describe('PDF：A4 橫式、每月一頁、舊檔名', () => {
  it('常數與舊版一致', () => {
    expect(ACTIVITY_PDF_FORMAT).toBe('a4');
    expect(ACTIVITY_PDF_ORIENTATION).toBe('landscape');
    expect(ACTIVITY_PDF_PAGE).toEqual({ width: 297, height: 210, margin: 5 });
    const src = read('app/activity-view/[id]/page.tsx');
    expect(src).toContain("orientation: 'landscape'");
    expect(src).toContain("format: 'a4'");
    expect(src).toContain('const pdfWidth = 297;');
    expect(src).toContain('const pdfHeight = 210;');
    expect(src).toContain('const margin = 5;');
    expect(src).toContain('`${campaign.name}_活動排程.pdf`');
  });
  it('檔名：活動名稱＋_活動排程.pdf；檔名不允許的字元換成底線', () => {
    expect(activityPdfFilename('母親節檔期')).toBe('母親節檔期_活動排程.pdf');
    expect(activityPdfFilename('A/B:C*D')).toBe('A_B_C_D_活動排程.pdf');
  });
  it('版面：寬度填滿；內容太高時等比縮小並置中（與舊版運算相同）', () => {
    const legacy = (w: number, h: number) => {
      const margin = 5, pdfWidth = 297, pdfHeight = 210;
      const contentWidth = pdfWidth - margin * 2;
      const contentHeight = (h / w) * contentWidth;
      if (contentHeight > pdfHeight - margin * 2) {
        const scaledWidth = ((pdfHeight - margin * 2) / contentHeight) * contentWidth;
        return { x: margin + (contentWidth - scaledWidth) / 2, y: margin, w: scaledWidth, h: pdfHeight - margin * 2 };
      }
      return { x: margin, y: margin, w: contentWidth, h: contentHeight };
    };
    for (const [w, h] of [[2800, 1200], [2800, 3000], [1000, 1000], [3000, 1500]]) {
      const a = activityPdfPlacement(w, h);
      const b = legacy(w, h);
      expect(a.x).toBeCloseTo(b.x, 6);
      expect(a.y).toBeCloseTo(b.y, 6);
      expect(a.w).toBeCloseTo(b.w, 6);
      expect(a.h).toBeCloseTo(b.h, 6);
    }
  });
  it('讀取失敗保護：特殊日期、車次、督導資訊任一失敗就停用匯出', () => {
    expect(pdfExportBlocked({})).toBe(false);
    expect(pdfExportBlocked(null)).toBe(false);
    expect(pdfExportBlocked({ headcount: 'x' })).toBe(false); // 人力類讀取失敗不影響月曆
    for (const k of ['events', 'trips', 'stores']) expect(pdfExportBlocked({ [k]: '讀取失敗' })).toBe(true);
  });
});

describe('Q8 舊網址轉新版', () => {
  it.each([
    ['/activity-management', '', '/workspace/index.html#/open/activity-view'],
    ['/activity-management/', '', '/workspace/index.html#/open/activity-view'],
    ['/activity-view/abc-123_X', '', '/workspace/index.html#/open/activity-view-detail/abc-123_X'],
    ['/activity-view/abc', '?focus=marketing', '/workspace/index.html#/open/activity-view-detail/abc?focus=marketing'],
    ['/activity-view/abc', '?focus=merchandise', '/workspace/index.html#/open/activity-view-detail/abc?focus=merchandise'],
    ['/activity-view/abc', '?focus=<script>', '/workspace/index.html#/open/activity-view-detail/abc'],
    ['/activity-view/abc', '?x=1', '/workspace/index.html#/open/activity-view-detail/abc'],
  ])('%s%s -> %s', (p, s, to) => {
    expect(activityLegacyTarget(p, s)).toBe(to);
  });
  it.each([
    '/admin/activity-management', // 活動管理（編輯端）不轉
    '/admin/activity-management/schedule/abc',
    '/activity-view',
    '/activity-view/a/b',
    '/activity-view/bad%20id',
    '/activity-view/<x>',
    '/activity-managementx',
  ])('不轉址：%s', (p) => {
    expect(activityLegacyTarget(p)).toBeNull();
  });
  it('middleware 有接上，且只在 DEV 工作台環境啟用；舊頁與舊 API 檔案沒有被動到', () => {
    const mw = read('middleware.ts');
    expect(mw).toContain('activityLegacyTarget(request.nextUrl.pathname, request.nextUrl.search)');
    expect(mw.indexOf('activityLegacyTarget(request')).toBeGreaterThan(mw.indexOf('if (isDevWorkspace) {'));
    for (const f of ['app/activity-management/page.tsx', 'app/activity-view/[id]/page.tsx', 'app/api/campaigns/published/route.ts', 'app/api/campaigns/[id]/view/route.ts']) {
      expect(fs.existsSync(path.join(ROOT, f)), f).toBe(true);
    }
    expect(read('app/api/campaigns/published/route.ts')).not.toContain('campaign-rules');
    expect(read('app/api/campaigns/[id]/view/route.ts')).not.toContain('campaign-rules');
  });
});

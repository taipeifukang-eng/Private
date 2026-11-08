import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_DETAIL_KINDS, WORKSPACE_NAV_KINDS } from '@/lib/workspace/page-kinds';
import { WORKSPACE_PAGE_META, isPageAllowed } from '../../../vue-workspace/src/workspace-page-meta';
import { workspaceNavigation } from '@/lib/workspace/navigation';

// W20 畫面與伺服器結構檢查：不啟動瀏覽器，確認 M5 規格要求的元素都在原始碼裡（e2e 另外驗證實際行為）。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const vue = (p: string) => read(`vue-workspace/src/${p}`);

describe('頁面註冊', () => {
  it('活動檢視列表為導覽頁、排程檢視為明細頁；權限只看 campaignView（canEnterCampaignView）', () => {
    expect(WORKSPACE_NAV_KINDS).toContain('activity-view');
    expect(WORKSPACE_DETAIL_KINDS).toContain('activity-view-detail');
    for (const kind of ['activity-view', 'activity-view-detail'] as const) {
      expect(WORKSPACE_PAGE_META[kind].permission).toEqual(['campaignView']);
      expect(isPageAllowed(kind, { campaignView: true })).toBe(true);
      expect(isPageAllowed(kind, { campaigns: true, monthly: true })).toBe(false);
      expect(isPageAllowed(kind, { campaignView: true }, true)).toBe(false);
    }
    expect(vue('workspace-pages.ts')).toContain('"activity-view": ActivityViewList');
    expect(vue('workspace-pages.ts')).toContain('"activity-view-detail": ActivityViewDetail');
  });
  it('導覽「活動檢視」有入口時改開新版頁籤（kind），沒有入口時不出現；網址仍是舊路徑 /activity-management', () => {
    const ctx = (codes: string[]) => ({ has: (...c: string[]) => c.some((x) => codes.includes(x)), roleCodes: new Set<string>() }) as any;
    const item = (view: boolean) => workspaceNavigation(ctx([]), { campaignView: view }).flatMap((g) => g.items).find((i) => i.label === '活動檢視');
    expect(item(true)).toMatchObject({ href: '/activity-management', kind: 'activity-view' });
    expect(item(false)).toBeUndefined(); // 沒有入口的人導覽裡不會出現
  });
});

describe('活動檢視列表 ActivityViewList.vue', () => {
  const s = vue('pages/ActivityViewList.vue');
  it('年度按鈕（全部＋各年度、預設今年）、狀態標籤、發布對象標籤、發布時間、未發布標籤、督導／店長標題', () => {
    for (const x of ['availableYears', 'campaignInYear', 'defaultViewYear', 'viewStatusLabel', 'publishTags', 'isUnpublished', 'viewerTitle', 'emptyYearText']) expect(s).toContain(x);
    for (const t of ['year-all', 'status-tag', 'audience-tag', 'unpublished-tag', 'activity-view-title', 'published_at', '>未發布<']) expect(s).toContain(t);
  });
  it('無權限時顯示無權限頁，不是空白；查看排程開新版明細頁', () => {
    expect(s).toContain('activity-view-denied');
    expect(s).toContain('>無權限<');
    expect(s).toContain('work.open("activity-view-detail"');
  });
});

describe('活動排程檢視 ActivityViewDetail.vue 與 ActivityPlan.vue', () => {
  const d = vue('pages/ActivityViewDetail.vue');
  const p = vue('components/ActivityPlan.vue');
  it('無權限直接輸入網址（403／404）顯示無權限頁，並可返回列表；填報後靜默重新讀取不收掉視窗', () => {
    expect(d).toContain('activity-view-denied');
    expect(d).toContain('[403, 404]');
    expect(d).toContain('loading.value = !data.value');
  });
  it('總門市數／已排程門市數、舊版三顆按鈕條件（Q7）、PDF 讀取失敗保護', () => {
    expect(p).toContain('plan-counts');
    expect(p).toContain('viewer?.showSupport');
    expect(p).toContain('viewer?.showChecklist');
    expect(p).toContain('viewer?.showStaffOverview');
    expect(p).toContain('pdfExportBlocked(plan.value.errors)');
    expect(p).toContain(':disabled="exporting||pdfBlocked"');
    expect(p).toContain('checklist-badge');
  });
  it('人力查看與 Check List 只列管轄且有排程的門市；填報入口只在這兩個視窗，且只開放需要的分區', () => {
    expect(p).toContain("scheduledManaged(managed.value,allScheduledIds.value)");
    expect(p).toContain(':only="t.key===\'staff\'?managedIds:null"');
    expect(p).toContain(':only="managedIds" fillable');
    expect(p).toContain(':sections="[filling.kind]"');
    expect(p).toContain('details:false,requests:false');
  });
  it('?focus=marketing|merchandise 直接開行銷部／商品部視窗（舊版行為）', () => {
    expect(p).toContain("props.focus==='marketing'||props.focus==='merchandise'");
    expect(vue('App.vue')).toContain('focus === "marketing" || focus === "merchandise"');
  });
  it('PDF：A4 橫式、舊檔名都走共用規則', () => {
    const pdf = vue('activity-calendar-pdf.ts');
    expect(pdf).toContain('ACTIVITY_PDF_FORMAT');
    expect(pdf).toContain('activityPdfFilename(name)');
    expect(pdf).toContain('activityPdfPlacement(canvas.width, canvas.height)');
    expect(pdf).not.toContain("format: 'a3'");
    expect(pdf).not.toContain('format: "a3"');
  });
});

describe('填報元件', () => {
  it('支援請求：照舊版列出請求我管轄門市出人的需求、PUT 整批指派帶 version 與 requestId（冪等）', () => {
    const s = vue('components/ActivitySupportAssign.vue');
    expect(s).toContain('supporting_store_id');
    expect(s).toContain('"supportStaff", {}, "PUT"');
    expect(s).toContain('version: e.version');
    expect(s).toContain('requestId: e.requestId');
    expect(s).toContain('canAssign');
  });
  it('門市填報重用活動排程頁的門市編輯元件（本店人員、人力預估、Check List 勾選與備註），未儲存時關閉要確認', () => {
    const s = vue('components/ActivityStoreFill.vue');
    expect(s).toContain('CampaignStoreEditor');
    expect(s).toContain('confirmDiscard');
    const e = vue('components/CampaignStoreEditor.vue');
    expect(e).toContain('sections?:string[]');
    expect(e).toContain("campaignApi('completions',{},'POST'");
    expect(e).toContain("campaignApi('headcount',{},'POST'");
    expect(e).toContain("campaignApi('ownStaff',{},'PUT'");
  });
  it('寫入權限與門市範圍由伺服器依舊版規則判斷：campaign-tools 沒有為檢視端另開例外', () => {
    const t = read('app/api/workspace/campaign-tools/route.ts');
    expect(t).toContain("legacyScopedWrite=request.method!=='PUT'&&['headcount','completions','ownStaff','supportStaff','requests'].includes(resource)");
    expect(t).toContain('authorizeCampaignStoreWrite');
  });
});

describe('深連結（Q8）', () => {
  it('Vue 端只接受白名單頁面、登入後才開；未登入先登入', () => {
    const a = vue('App.vue');
    expect(a).toContain('const OPEN_LINK_KINDS');
    expect(a).toContain('"activity-view", "activity-view-detail"');
    expect(a).toContain('applyPendingOpen()');
    expect(vue('main.ts')).toContain('path: "/open/:kind/:id?"');
  });
});

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_NAV_KINDS, WORKSPACE_TAB_KINDS } from '@/lib/workspace/page-kinds';
import { WORKSPACE_PAGE_META, isPageAllowed } from '../../../vue-workspace/src/workspace-page-meta';
import { workspaceNavigation } from '@/lib/workspace/navigation';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('W23 頁面登錄與導覽（Q17 所有登入者都能看）', () => {
  it('calendar 是導覽可開啟的 kind，登錄了標題與元件', () => {
    expect(WORKSPACE_NAV_KINDS).toContain('calendar');
    expect(WORKSPACE_TAB_KINDS).toContain('calendar');
    expect(WORKSPACE_PAGE_META.calendar).toEqual({ title: '年度行事曆', permission: ['calendar'] });
    expect(read('vue-workspace/src/workspace-pages.ts')).toContain('calendar: OrganizationCalendar,');
  });
  it('session 對所有登入者回 calendar:true；沒有帶其他權限的帳號也進得去', () => {
    expect(read('app/api/workspace/session/route.ts')).toContain('calendar: true');
    expect(isPageAllowed('calendar', { calendar: true }, false)).toBe(true);
    expect(isPageAllowed('calendar', {}, false)).toBe(false); // 沒有 session 資料時不放行
    expect(isPageAllowed('calendar', { calendar: true }, true)).toBe(false); // 登入過期
  });
  it('導覽的「年度行事曆」不需要任何權限，而且是 workspace 分頁（不是另開舊站）', () => {
    const noPermissions = { has: () => false, roleCodes: new Set<string>() } as any;
    const groups = workspaceNavigation(noPermissions, {});
    const item = groups.flatMap((g) => g.items).find((i) => i.label === '年度行事曆')!;
    expect(item).toEqual({ label: '年度行事曆', href: '/organization/calendar', kind: 'calendar' }); // 導覽只列出有權進入的項目（allowed 會被去掉），所以出現就是可進入
  });
});

describe('W23 API 結構：委派舊 handler、舊權限檢查不動', () => {
  const route = read('app/api/workspace/calendar/[[...path]]/route.ts');
  it('公司行事、個人行程、分享、假日發布、假日預覽、Google 同步／檢查／中斷都是委派舊 handler', () => {
    for (const p of [
      'organization/calendar/route', 'organization/calendar/company-events/route', 'organization/calendar/personal-events/route', 'organization/calendar/shares/route',
      'organization/calendar/holidays/route', 'organization/calendar/holidays/preview/route', 'organization/calendar/google/sync/route',
      'organization/calendar/google/diagnose/route', 'organization/calendar/google/disconnect/route',
    ]) expect(route, p).toContain(`@/app/api/${p}`);
    // 沒有自己重寫寫入邏輯：不直接 insert／update 行事曆資料表
    expect(route).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    expect(route).not.toContain('organization_calendar_publish_holiday_import');
  });
  it('只需登入（Q17）：用 context，不要求任何 capability', () => {
    expect(route).toContain('await context({ profile: false })');
    expect(route).not.toContain('requireCapability');
  });
  it('寫入一律檢查站內 Origin；授權連結與回調不經過工作台 API', () => {
    expect(route).toContain('if (method !== "GET") checkOrigin(req);');
    expect(route).not.toContain('google/connect');
    expect(route).not.toContain('google/callback');
  });
  it('mock 控制只在測試站旗標開啟時存在', () => {
    expect(route).toContain('if (!calendarMockEnabled()) throw new WorkspaceError(404');
  });
  it('舊版 handler 的權限檢查沒有被更動（RBAC 不動）', () => {
    const company = read('app/api/organization/calendar/company-events/route.ts');
    expect(company).toContain('ORGANIZATION_CALENDAR_COMPANY_CREATE_PERMISSION');
    expect(company).toContain('ORGANIZATION_CALENDAR_COMPANY_EDIT_PERMISSION');
    expect(company).toContain("'沒有新增公司行事的權限'");
    expect(company).toContain("'沒有修改公司行事的權限'");
    expect(read('app/api/organization/calendar/holidays/route.ts')).toContain('ORGANIZATION_CALENDAR_HOLIDAY_MANAGE_PERMISSION');
    for (const g of ['status', 'sync', 'diagnose', 'disconnect', 'connect']) {
      const src = read(`app/api/organization/calendar/google/${g}/route.ts`);
      expect(src, g).toContain('ORGANIZATION_CALENDAR_GOOGLE_MANAGE_PERMISSION');
      expect(src, g).toContain('hasPermission');
    }
  });
  it('三個權限碼各自獨立（沒有合併或互相蘊含）', () => {
    const lib = read('lib/admin/organization-calendar.ts');
    for (const code of ['organization.calendar.company.create', 'organization.calendar.company.edit', 'organization.calendar.holiday.manage', 'organization.calendar.google.manage']) expect(lib).toContain(`'${code}'`);
    expect(route).toContain('ctx.permissions.has(ORGANIZATION_CALENDAR_COMPANY_CREATE_PERMISSION)');
    expect(route).toContain('ctx.permissions.has(ORGANIZATION_CALENDAR_COMPANY_EDIT_PERMISSION)');
    expect(route).toContain('ctx.permissions.has(ORGANIZATION_CALENDAR_HOLIDAY_MANAGE_PERMISSION)');
  });
  it('Q21：發布前的確認在伺服器端強制（不是只靠畫面）；Q18 搜尋用新規則', () => {
    expect(route).toContain('holidayPublishNeedsConfirm(true, body?.confirm_replace)');
    expect(route).toContain('requiresConfirm: true');
    expect(route).toContain('isSearchableColleague');
    expect(route).toContain('banned_until');
  });
});

describe('W23 測試站設定與 DEV SQL', () => {
  it('測試站啟動時 Google 全部是假設定（含加密金鑰隨機產生），不依賴 .env 內的真實值', () => {
    const s = read('tests/support/start-test-server.cjs');
    expect(s).toContain("process.env.WORKSPACE_CALENDAR_MOCK = 'true'");
    expect(s).toContain("GOOGLE_CALENDAR_CLIENT_ID = 'mock-client-id");
    expect(s).toContain("GOOGLE_CALENDAR_REDIRECT_URI = 'http://localhost:3002/api/organization/calendar/google/callback'");
    expect(s).toContain("randomBytes(32).toString('hex')");
    expect(s).not.toMatch(/GOOGLE_CALENDAR_CLIENT_SECRET = '(?!mock-)/);
  });
  it('DEV 套用腳本：三份 SQL 都有對應的 rollback，rollback 以相反順序執行', () => {
    const apply = read('scripts/apply-workspace-m5-w23-calendar-dev.cjs');
    for (const n of ['20261109110000_m5_w23_annual_calendar', '20261109110100_m5_w24_calendar_google_sync', '20261109110200_m5_w23_personal_event_owner_read']) {
      expect(apply).toContain(n);
      expect(fs.existsSync(path.join(root, `supabase/workspace-dev/${n}.sql`)), n).toBe(true);
      expect(fs.existsSync(path.join(root, `supabase/workspace-dev/${n}.rollback.sql`)), `${n} rollback`).toBe(true);
    }
    expect(apply).toContain('base.slice().reverse()');
    expect(apply).toContain('assertDevEnvironment');
  });
  it('個人行程讀取規則修正只加「本人可讀」，分享判斷不變；rollback 還原原規則', () => {
    const fix = read('supabase/workspace-dev/20261109110200_m5_w23_personal_event_owner_read.sql');
    expect(fix).toContain('USING (owner_id = auth.uid() OR public.organization_calendar_personal_event_can_view(id))');
    const back = read('supabase/workspace-dev/20261109110200_m5_w23_personal_event_owner_read.rollback.sql');
    expect(back).toContain('USING (public.organization_calendar_personal_event_can_view(id))');
    // 其餘規則（建立、更新、刪除）沒有在這份 SQL 裡改
    expect(fix).not.toMatch(/FOR (INSERT|UPDATE|DELETE)/);
  });
  it('W23／W24 DEV 副本與 supabase/migrations 的原檔內容相同（只多 BEGIN／COMMIT 與註解）', () => {
    const strip = (s: string) => s.replace(/^--.*$/gm, '').replace(/^BEGIN;|^COMMIT;/gm, '').replace(/\s+/g, ' ').trim();
    expect(strip(read('supabase/workspace-dev/20261109110000_m5_w23_annual_calendar.sql'))).toBe(strip(read('supabase/migrations/20261008100000_organization_annual_calendar.sql')));
    expect(strip(read('supabase/workspace-dev/20261109110100_m5_w24_calendar_google_sync.sql'))).toBe(strip(read('supabase/migrations/20261010120000_organization_calendar_google_sync.sql')));
  });
  it('sweeper 目標：行事曆標記、假日保留年度連結、mock 連線與離職員工主檔都登錄', () => {
    const t = read('tests/support/sweep-targets.cjs');
    for (const x of ["table: 'organization_calendar_events'", "table: 'organization_personal_calendar_events'", "table: 'organization_calendar_holiday_imports'", "pattern: 'holiday:2099-%'", "pattern: 'mock-google@example.test'", "pattern: 'ZTTW23%'"]) expect(t, x).toContain(x);
    expect(read('tests/support/sweeper.cjs')).toContain("target.cascade === 'calendar-event'");
  });
});

describe('W23 畫面結構', () => {
  const page = read('vue-workspace/src/pages/OrganizationCalendar.vue');
  it('頁頂警示在頁面最上方、role=alert；只有 Google 管理者才有同步區', () => {
    expect(page.indexOf('data-testid="google-banner"')).toBeLessThan(page.indexOf('class="page-heading"'));
    expect(page).toContain('role="alert" data-testid="google-banner"');
    expect(page).toContain('v-if="permissions.manageGoogle"');
  });
  it('按鈕依權限旗標顯示：新增公司行事、修改、取消、匯入假日；個人行程只有建立者能編輯與刪除', () => {
    expect(page).toContain('v-if="permissions.createCompany"');
    expect(page).toContain("e.source === 'company' && permissions.editCompany");
    expect(page).toContain('v-if="permissions.manageHolidays"');
    expect(page).toContain('const isOwner = (e: CalendarEntry) => e.source === "personal" && e.owner_id === currentUserId.value;');
  });
  it('取消公司行事的確認說明 Google 事件會一併刪除（Q19）；刪除個人行程與撤回分享都有確認', () => {
    expect(page).toContain('Google 日曆上對應的事件會一併刪除，且無法在 Google 還原');
    expect(read('vue-workspace/src/components/CalendarShareDialog.vue')).toContain('撤回後，這個分享以及由此轉分享出去的對象都將無法查看');
  });
  it('假日匯入：預覽顯示差異、已有版本時發布前跳二次確認（Q21）', () => {
    const imp = read('vue-workspace/src/components/CalendarHolidayImport.vue');
    expect(imp).toContain('data-testid="holiday-diff"');
    expect(imp).toContain('data-testid="holiday-confirm"');
    expect(imp).toContain('confirm_replace');
    expect(imp).toContain('if (needsConfirm.value) confirming.value = true;');
  });
  it('Google 同步區說明單向與 Q19 加註；中斷連結有確認且說明 Google 上的事件保留', () => {
    const g = read('vue-workspace/src/components/CalendarGooglePanel.vue');
    expect(g).toContain('請勿在此修改，請回系統');
    expect(g).toContain('已同步到 Google 的行程不會刪除');
    expect(g).toContain('單向同步');
  });
  it('分享對象搜尋說明已停用與離職的人不會出現（Q18）', () => {
    expect(read('vue-workspace/src/components/CalendarPeoplePicker.vue')).toContain('已停用或離職的人不會出現');
  });
  it('App 深連結：只接受 calendar 並帶 Google 授權結果（三種固定結果）', () => {
    const app = read('vue-workspace/src/App.vue');
    expect(app).toContain('"calendar", "ga-asset-scan", "ga-inventory-transfers"];'); // G10 掃描頁、G13 調撥單頁也走同一個深連結白名單
    expect(app).toContain('["connected", "connected_with_errors", "error"].includes(googleResult)');
  });
});

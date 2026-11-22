import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceNavigation } from '../../../lib/workspace/navigation';
import { WORKSPACE_NAV_KINDS } from '../../../lib/workspace/page-kinds';
import { WORKSPACE_PAGE_META } from '../../../vue-workspace/src/workspace-page-meta';
import { moduleCodes } from '../../../lib/workspace/modules';
import { SML_ENTRY_CODES } from '../../../lib/supervisor-management-log/workspace-rules';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('M6-W32：導覽、頁面登記與權限碼', () => {
  it('「督導管理日誌」導覽在工作頁內開啟（kind supervisor-log），六個權限碼任一即可看到', () => {
    const none: any = { has: () => false, roleCodes: new Set(), permissions: new Set(), isAdmin: false };
    const only = (code: string): any => ({ ...none, has: (...codes: string[]) => codes.includes(code) });
    const find = (ctx: any) => workspaceNavigation(ctx, {}).flatMap((g: any) => g.items).find((i: any) => i.label === '督導管理日誌');
    expect(find(none)).toBeUndefined();
    expect(SML_ENTRY_CODES).toHaveLength(6);
    for (const code of SML_ENTRY_CODES) expect(find(only(code)), code).toMatchObject({ kind: 'supervisor-log', href: '/supervisor-management-log' });
    expect(WORKSPACE_NAV_KINDS).toContain('supervisor-log');
    expect(WORKSPACE_PAGE_META['supervisor-log']).toMatchObject({ title: '督導管理日誌', permission: ['supervisorLog'] });
  });
  it('導覽與 session 能力使用同一組權限碼（沿用舊版，不新增也不收回）', () => {
    expect(new Set(moduleCodes.supervisorLog)).toEqual(new Set(SML_ENTRY_CODES));
    const legacyAccess = read('lib/supervisor-management-log/access.ts');
    for (const code of SML_ENTRY_CODES) expect(legacyAccess, code).toContain(code);
    expect(read('app/api/workspace/session/route.ts')).toContain('supervisorLog:ctx.has(...moduleCodes.supervisorLog)');
  });
  it('頁面元件已登記，且沒有語音錄音（W33 另案）', () => {
    expect(read('vue-workspace/src/workspace-pages.ts')).toContain('"supervisor-log": SupervisorLog');
    const page = read('vue-workspace/src/pages/SupervisorLog.vue');
    expect(page).not.toMatch(/MediaRecorder|getUserMedia|voice\//);
  });
});

describe('M6-W32：API 重用舊版規則，不另開第二套資料表', () => {
  const lib = read('lib/workspace/supervisor-log.ts');
  const route = read('app/api/workspace/supervisor-management/[[...path]]/route.ts');
  it('驗證函式取自舊版 lib/supervisor-management-log/validation，沒有改寫欄位規則', () => {
    expect(lib).toContain('../supervisor-management-log/validation');
    for (const fn of ['validateCasePayload', 'validateRecordPayload', 'validateFollowupPayload', 'validateDailyPlanPayload', 'validateDeletionReason']) expect(lib, fn).toContain(fn);
  });
  it('只使用舊版既有的資料表，沒有建立新表', () => {
    const tables = Array.from(lib.matchAll(/"(supervisor_management_[a-z_]+)"/g)).map((m) => m[1]);
    for (const t of new Set(tables)) expect(['supervisor_management_cases', 'supervisor_management_records', 'supervisor_management_followups', 'supervisor_management_case_events', 'supervisor_management_daily_plans', 'supervisor_management_categories', 'supervisor_management_soft_delete_daily_plan']).toContain(t);
    for (const f of fs.readdirSync(path.join(root, 'supabase/workspace-dev')).filter((n) => n.includes('supervisor_log'))) expect(read(`supabase/workspace-dev/${f}`)).not.toMatch(/CREATE TABLE/i);
  });
  it('新版 API 不 import 舊版 route，寫入類都檢查 Origin，未登入由 context 擋下', () => {
    expect(lib + route).not.toContain('app/api/supervisor-management-log');
    expect(route).toContain('checkOrigin(r)');
    expect(route).toContain('context({ profile: false })');
  });
  it('寫入以登入者身分（舊版資料表觸發器與 RLS 照常生效），讀取以 admin client 加應用層範圍', () => {
    expect(lib).toContain('ctx.auth.from(T.cases).insert');
    expect(lib).toContain('workspace_supervisor_soft_delete');
    expect(lib).toContain('caseScopeFilter');
    expect(lib).toContain('ctx.admin.from(T.cases)');
  });
  it('每日計畫的軟刪除重用舊版資料庫函式，案件／紀錄／追蹤走新的 workspace 函式（先子後父）', () => {
    expect(lib).toContain('supervisor_management_soft_delete_daily_plan');
    const sql = read('supabase/workspace-dev/20261122130000_m6_supervisor_log_rpc.sql');
    const recordAt = sql.indexOf('UPDATE public.supervisor_management_records');
    const caseAt = sql.indexOf('UPDATE public.supervisor_management_cases');
    expect(recordAt).toBeGreaterThan(0);
    expect(caseAt).toBeGreaterThan(recordAt);
    expect(sql).toContain("'SOFT_DELETE'");
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.workspace_supervisor_soft_delete');
    expect(read('supabase/workspace-dev/20261122130000_m6_supervisor_log_rpc.rollback.sql')).toContain('DROP FUNCTION IF EXISTS public.workspace_supervisor_soft_delete');
    // 正式區草稿與 DEV 檔相同
    expect(read('docs/vue-workspace/parity-plan/m6-sql/20261122130000_m6_supervisor_log_rpc.sql')).toBe(sql);
  });
  it('刪除一律要原因，頁面用工作頁內視窗輸入', () => {
    const page = read('vue-workspace/src/pages/SupervisorLog.vue');
    expect(page).toContain('請輸入刪除原因');
    expect(page).toContain('deletion_reason');
    expect(page).not.toMatch(/window\.prompt|confirm\(/);
  });
});

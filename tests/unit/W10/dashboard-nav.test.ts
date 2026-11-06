import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_NAV_KINDS } from '../../../lib/workspace/page-kinds';
import { workspaceNavigation } from '../../../lib/workspace/navigation';
import { isPageAllowed, pageTitle } from '../../../vue-workspace/src/workspace-page-meta';

// W10 單元層（M3 B.5）：導覽「儀表板」改開工作台內的 dashboard 頁，不再連回舊站；頁面要有權限檢查；背景更新間隔 60 秒。
const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const ctxOf = (codes: string[]) => ({ isAdmin: false, roleCodes: new Set<string>(), has: (...c: string[]) => c.some((x) => codes.includes(x)) }) as any;
const item = (codes: string[]) =>
  workspaceNavigation(ctxOf(codes), {}).flatMap((g: any) => g.items).find((i: any) => i.href === '/dashboard');

describe('導覽與頁面註冊', () => {
  it('dashboard 是導覽 kind，導覽項目帶 kind（工作台內開啟，不是外連舊站）', () => {
    expect(WORKSPACE_NAV_KINDS).toContain('dashboard');
    expect(item(['dashboard.view'])).toMatchObject({ label: '儀表板', kind: 'dashboard' });
  });
  it('沒有 dashboard.view 的人導覽不開放；頁面權限鍵是 dashboard', () => {
    expect(item([])).toBeUndefined();
    expect(isPageAllowed('dashboard', { dashboard: true })).toBe(true);
    expect(isPageAllowed('dashboard', { dashboard: false, tasks: true })).toBe(false);
    expect(pageTitle('dashboard')).toBe('儀表板');
  });
});

describe('Dashboard.vue 與 API 契約', () => {
  const vue = read('vue-workspace/src/pages/Dashboard.vue');
  it('60 秒背景更新、有手動重新整理，不再 2 秒輪詢', () => {
    expect(vue).toMatch(/setInterval\(tick, 60000\)/);
    expect(vue).not.toMatch(/setInterval\([^)]*\b2000\b/);
    expect(vue).toContain('重新整理');
    expect(vue).toContain('clearInterval(timer)');
  });
  it('背景更新只在分頁可見且是前景頁籤時進行', () => {
    expect(vue).toContain('document.visibilityState === "visible"');
    expect(vue).toContain('work.active === props.tab.id');
  });
  it('API 加頁面權限檢查、統計用共用的 statusCounts（勾選進度），不讀 assignments.status', () => {
    const api = read('app/api/workspace/dashboard/route.ts');
    expect(api).toContain('requireCapability(ctx, ["dashboard.view"])');
    expect(api).toContain('statusCounts(records)');
    expect(api).not.toMatch(/\.status\s*===/);
  });
});

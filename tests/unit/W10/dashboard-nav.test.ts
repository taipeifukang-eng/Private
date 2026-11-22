import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
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
    // 用 TypeScript AST（不是字串比對，!==、解構、中括號都繞不過）：
    // 路由裡 r.status 是 task-progress 推算出的整體狀態，所以只禁止「拿 status 欄位做比對／解構／查詢選取」。
    const sf = ts.createSourceFile('route.ts', api, ts.ScriptTarget.Latest, true);
    const hits: string[] = [];
    const isStatusRead = (n: ts.Node) => (ts.isPropertyAccessExpression(n) && n.name.text === 'status') || (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && n.argumentExpression.text === 'status');
    const visit = (n: ts.Node) => {
      if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.operatorToken.kind) && (isStatusRead(n.left) || isStatusRead(n.right))) hits.push(n.getText(sf));
      if (ts.isBindingElement(n) && (n.propertyName ?? n.name).getText(sf) === 'status') hits.push(n.getText(sf));
      if (ts.isStringLiteralLike(n) && /(^|[,\s])status([,\s]|$)/.test(n.text)) hits.push(n.getText(sf));
      ts.forEachChild(n, visit);
    };
    visit(sf);
    // 推算來源：task-progress 的 status 必須由 overallStatus(勾選進度) 算出
    const prog = ts.createSourceFile('p.ts', read('lib/workspace/task-progress.ts'), ts.ScriptTarget.Latest, true);
    let derived = false;
    const find = (n: ts.Node) => {
      if (ts.isPropertyAssignment(n) && n.name.getText(prog) === 'status' && ts.isCallExpression(n.initializer) && n.initializer.expression.getText(prog) === 'overallStatus') derived = true;
      ts.forEachChild(n, find);
    };
    find(prog);
    expect(derived, 'status 由 overallStatus(...) 推算').toBe(true);
    expect(hits).toEqual([]);
  });
});

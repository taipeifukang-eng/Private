import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const build = require('../../../scripts/m9-perm-checklist/build.cjs');
const grant = require('../../../scripts/m9-perm-checklist/grant.cjs');

const inventory = {
  roles: [
    { code: 'admin', name: '系統管理員', active_members: 3 },
    { code: 'general_affairs', name: '總部總務', active_members: 2 },
    { code: 'store_manager_role', name: '店長角色', active_members: 50 },
    { code: 'member', name: '一般成員', active_members: 0 },
  ],
};

const items = [
  { code: 'general_affairs.request.create', plain: '新增需求單', module: '總務-需求單', existsInProd: true, prodHolders: ['admin'], recommendRoles: ['general_affairs', 'store_manager_role'], reason: '店長要用', risk: '不給看不到', sensitive: false },
  { code: 'general_affairs.vendor.view', plain: '看廠商', module: '總務-廠商', existsInProd: true, prodHolders: ['admin'], recommendRoles: ['general_affairs'], reason: '工務沿用', risk: '機密', sensitive: true },
  { code: 'general_affairs.purchase_payment.view', plain: '看請款', module: '總務-請款', existsInProd: false, createdByRunbookStep: '步驟 74', prodHolders: [], recommendRoles: [], reason: '預設不勾', risk: '沒人持有', sensitive: true },
  { code: 'general_affairs.purchase_payment.manage', plain: '管請款', module: '總務-請款', existsInProd: false, createdByRunbookStep: '步驟 74', prodHolders: [], recommendRoles: [], reason: '預設不勾', risk: '沒人持有', sensitive: true },
];
const losses = [
  { role: 'store_manager_role', what: '總務回報：店長只有舊碼。', fixCode: 'general_affairs.request.create' },
  { role: 'store_manager_role', what: '盤點：50 位店長失去匯入（老闆已決定收緊，通常不補）。', fixCode: 'inventory.result_analysis.import' },
];

describe('build.cjs', () => {
  const html: string = build.buildHtml({ items, losses, inventory });

  it('標題與無外部資源', () => {
    expect(html).toContain('<title>新權限勾選</title>');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/fonts\.googleapis|<link[^>]+stylesheet/);
    expect(html).toContain('prefers-color-scheme:dark');
    expect(html).toContain('[data-theme="dark"]');
  });

  it('每個 item 都有一張卡，含說明、理由、風險', () => {
    for (const it of items) {
      expect(html).toContain(`data-code="${it.code}"`);
      expect(html).toContain(it.plain);
      expect(html).toContain(it.reason);
      expect(html).toContain(it.risk);
    }
  });

  it('預設勾選等於建議（卡片）', () => {
    for (const it of items) {
      const card = html.split('<article class="card').find((c) => c.includes(`data-code="${it.code}"`) && c.includes('perm-cb')) as string;
      const checked = [...card.matchAll(/class="perm-cb"[^>]*value="([^"]+)" checked/g)].map((m) => m[1]).sort();
      expect(checked).toEqual([...it.recommendRoles].sort());
    }
    expect(Object.keys(build.defaultAnswers(items))).toHaveLength(items.length);
    expect(build.defaultAnswers(items)['general_affairs.purchase_payment.view'].roles).toEqual([]);
  });

  it('敏感項有標示，非敏感項沒有', () => {
    const card = (code: string) => html.split('<article class="card').find((c) => c.includes(`data-code="${code}"`) && c.includes('perm-cb')) as string;
    expect(card('general_affairs.vendor.view')).toContain('tag sens');
    expect(card('general_affairs.vendor.view')).toContain('sensitive');
    expect(card('general_affairs.request.create')).not.toContain('tag sens');
  });

  it('角色顯示人數；0 人角色收進其他角色', () => {
    expect(html).toContain('50 人');
    const card = html.split('<article class="card').find((c) => c.includes('data-code="general_affairs.vendor.view"') && c.includes('perm-cb')) as string;
    const [mainPart, otherPart] = card.split('<details>');
    expect(mainPart).toContain('value="store_manager_role"');
    expect(mainPart).not.toContain('value="member"');
    expect(otherPart).toContain('value="member"');
  });

  it('損失項預設：建議角色補回、已定收緊不補', () => {
    const l = build.defaultLosses(items, losses);
    expect(l['general_affairs.request.create'].roles).toEqual(['store_manager_role']);
    expect(l['inventory.result_analysis.import']).toBeUndefined();
    expect(html).toMatch(/class="loss-cb" data-code="general_affairs.request.create" value="store_manager_role" checked/);
    expect(html).not.toMatch(/class="loss-cb" data-code="inventory.result_analysis.import" value="store_manager_role" checked/);
  });

  it('送出寫入 survey/m9-permissions，db 為 null 有提示與可複製文字', () => {
    expect(html).toContain("survey/m9-permissions");
    expect(html).toContain('status:\'submitted\'');
    expect(html).toContain('id="fallback-text"');
    expect(html).toContain('id="nodb"');
  });
});

describe('grant.cjs', () => {
  const doc = {
    answers: {
      'general_affairs.request.create': { roles: ['general_affairs', 'store_manager_role'], note: '' },
      'general_affairs.purchase_payment.view': { roles: [], note: '' },
      'general_affairs.purchase_payment.manage': { roles: [], note: '' },
    },
    losses: { 'general_affairs.request.create': { roles: ['store_manager_role'] } },
    general: '',
    submittedAt: '2026-11-24T00:00:00.000Z',
    status: 'submitted',
  };
  const r = grant.generate(doc);

  it('授權可重複執行：只開不關、不 DELETE', () => {
    expect(r.grant).toContain('rp.is_allowed IS NOT TRUE');
    expect(r.grant).toContain('INSERT INTO public.role_permissions');
    expect(r.grant).toContain('SET is_allowed = true');
    expect(r.grant.replace(/ON COMMIT DROP/g, "")).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b|is_allowed\s*=\s*false/i);
    expect(r.grant.match(/\bUPDATE\b/g)).toHaveLength(1);
    expect(r.grant).toContain('CREATE TABLE IF NOT EXISTS public.m9_role_grant_log');
    expect(r.grant).toContain("('general_affairs', 'general_affairs.request.create')");
  });

  it('去重：同一配對只出現一次', () => {
    expect(r.pairs).toHaveLength(2);
    expect(r.grant.match(/'store_manager_role', 'general_affairs\.request\.create'/g)).toHaveLength(2); // 待處理清單與結果查詢各一次
  });

  it('請款預設不出現在授權裡', () => {
    for (const s of [r.grant, r.rollback, r.verify]) expect(s).not.toContain('purchase_payment');
  });

  it('授權後列出每組結果，找不到的角色或權限碼會顯示', () => {
    expect(r.grant).toContain('找不到權限碼');
    expect(r.grant).toContain('找不到角色');
  });

  it('原本被關閉的列：授權時打開、rollback 改回關閉，不刪', () => {
    expect(r.grant).toContain('prev_denied');
    expect(r.rollback).toMatch(/UPDATE public\.role_permissions rp SET is_allowed = false[\s\S]*WHERE l\.prev_denied/);
    expect(r.rollback).toMatch(/DELETE FROM public\.role_permissions[\s\S]*WHERE NOT l\.prev_denied/);
  });

  it('rollback 只動 log 內的列', () => {
    expect(r.rollback).toContain('USING public.m9_role_grant_log');
    expect(r.rollback).toMatch(/DELETE FROM public\.role_permissions/);
    expect(r.rollback).not.toContain('general_affairs.request.create');
  });

  it('verify 只有 SELECT，回傳 role, code, ok', () => {
    const bare = r.verify.replace(/--.*$/gm, '').replace(/'[^']*'/g, "''");
    expect(bare).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b/i);
    expect(r.verify).toMatch(/AS role/);
    expect(r.verify).toMatch(/AS code/);
    expect(r.verify).toMatch(/AS ok/);
  });

  it('空答案產出空授權但檔案仍有效', () => {
    const e = grant.generate({ answers: {}, losses: {}, general: '', status: 'submitted' });
    expect(e.pairs).toHaveLength(0);
    expect(e.grant).not.toContain('INSERT INTO public.role_permissions');
    expect(e.grant).toContain('BEGIN;');
    expect(e.grant).toContain('COMMIT;');
    expect(e.verify).toMatch(/^SELECT/m);
    expect(e.verify).toContain('WHERE false');
    expect(e.rollback).toContain('COMMIT;');
    expect(() => grant.generate({})).not.toThrow();
  });

  it('不合法代碼會被擋（防 SQL 注入）', () => {
    expect(() => grant.generate({ answers: { "x'; DROP TABLE t;--": { roles: ['admin'] } } })).toThrow();
    expect(() => grant.generate({ answers: { 'a.b': { roles: ["ad'min"] } } })).toThrow();
  });

  it('老闆明確勾請款時才會出現', () => {
    const g = grant.generate({ answers: { 'general_affairs.purchase_payment.view': { roles: ['general_affairs'] } } });
    expect(g.grant).toContain('purchase_payment.view');
  });
});

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_DETAIL_KINDS, WORKSPACE_NAV_KINDS, WORKSPACE_TAB_KINDS } from '@/lib/workspace/page-kinds';
import { FALLBACK_SWITCHABLE_KINDS, LEGACY_ROUTE_MAP, NO_LEGACY_REASON, isFallbackSwitchable, legacyRouteFor } from '@/lib/workspace/legacy-routes';
import { workspaceNavigation } from '@/lib/workspace/navigation';
import { GA_PAGE_BY_HREF } from '@/lib/workspace/general-affairs/nav';
import { fallbackFor, legacyUrl, legacyUrlForKind } from '../../../vue-workspace/src/legacy-link';

/**
 * M9 F01S 單元：kind -> 舊版路由「唯一來源」的完整性與一致性，以及 N2 備援開關在導覽與前端純函式的行為。
 */
const root = path.resolve(__dirname, '..', '..', '..');
const routeExists = (href: string) => {
  const p = href.split('?')[0];
  return p === '/' ? fs.existsSync(path.join(root, 'app', 'page.tsx')) : fs.existsSync(path.join(root, 'app', ...p.split('/').filter(Boolean), 'page.tsx'));
};
const allowAll = (over: Record<string, unknown> = {}) => workspaceNavigation({ has: () => true, roleCodes: new Set<string>() } as any, {
  transfers: true, movementDraft: true, movementHistory: true, employees: true, employeeCreate: true, employeeBirthdays: true, employeeImport: true,
  improvements: true, taskArchive: true, taskManagement: true, monthlyExport: true, campaignView: true, gaRosterMember: true, clinicSelfpay: true, ...over,
});

describe('legacy-routes 完整性', () => {
  it('每個頁面種類（導覽 kind 與明細 kind）都登錄在對照表，且沒有多餘的 kind', () => {
    expect(Object.keys(LEGACY_ROUTE_MAP).sort()).toEqual([...WORKSPACE_TAB_KINDS].sort());
  });

  it('每個導覽 kind 都有舊版路由，或在明確的「沒有舊版」清單內（附原因）', () => {
    for (const kind of WORKSPACE_NAV_KINDS) {
      expect(LEGACY_ROUTE_MAP[kind] !== null || NO_LEGACY_REASON[kind], kind).toBeTruthy();
    }
  });

  it('沒有舊版的頁面與「原因表」一一對應（不多不少），原因不是空字串', () => {
    const nulls = WORKSPACE_TAB_KINDS.filter((k) => LEGACY_ROUTE_MAP[k] === null).sort();
    expect(Object.keys(NO_LEGACY_REASON).sort()).toEqual(nulls);
    for (const k of nulls) expect((NO_LEGACY_REASON[k] || '').length, k).toBeGreaterThan(5);
  });

  it('沒有舊版的頁面清單固定（新增或移除要同步更新此測試與 m9-fallback 說明）', () => {
    expect(WORKSPACE_TAB_KINDS.filter((k) => LEGACY_ROUTE_MAP[k] === null).sort()).toEqual([
      'ga-asset-import', 'ga-asset-scan', 'ga-facility-labels', 'ga-onboarding-progress', 'ga-onboarding-review', 'ga-onboarding-tasks',
      'ga-payment-request-edit', 'ga-payment-request-print', 'ga-payment-requests', 'ga-purchase-approvals', 'ga-purchase-invoice-edit',
      'ga-purchase-invoices', 'ga-purchase-order-edit', 'ga-purchase-orders', 'ga-transfers', 'page-fallbacks',
    ]);
  });

  it('每個非 null 的舊版路由，在 app/ 底下真的有對應的 page.tsx，且是站內絕對路徑', () => {
    for (const kind of WORKSPACE_TAB_KINDS) {
      const href = LEGACY_ROUTE_MAP[kind];
      if (!href) continue;
      expect(href.startsWith('/') && !href.startsWith('//') && !href.includes('://'), `${kind} 必須是站內路徑`).toBe(true);
      expect(href.includes('['), `${kind} 不可含動態參數`).toBe(false);
      expect(routeExists(href), `${kind} -> ${href}`).toBe(true);
    }
  });

  it('導覽選單：每個有 kind 的項目，其 href 與對照表一致（選單與「回舊版」永遠指向同一個舊版路由）', () => {
    const items = allowAll().flatMap((g) => g.items).filter((i) => i.kind);
    expect(items.length).toBeGreaterThan(20);
    for (const i of items) expect(legacyRouteFor(i.kind!), `${i.label} (${i.kind})`).toBe(i.href);
  });

  it('總務側欄 GA_PAGE_BY_HREF：舊版真的存在的網址對到相同路由，新版專屬功能的網址對到 null', () => {
    for (const [href, { kind }] of Object.entries(GA_PAGE_BY_HREF)) {
      const p = href.split('?')[0];
      if (routeExists(p)) expect(LEGACY_ROUTE_MAP[kind], `${href} -> ${kind}`).toBe(p);
      else expect(LEGACY_ROUTE_MAP[kind], `${href} 舊版沒有，${kind} 應為 null`).toBeNull();
    }
  });

  it('可切換清單 = 有舊版對應的導覽 kind；明細頁與沒有舊版的頁面不可切換', () => {
    expect([...FALLBACK_SWITCHABLE_KINDS].sort()).toEqual(WORKSPACE_NAV_KINDS.filter((k) => LEGACY_ROUTE_MAP[k] !== null).sort());
    for (const k of WORKSPACE_DETAIL_KINDS) expect(isFallbackSwitchable(k), k).toBe(false);
    expect(isFallbackSwitchable('merchandise')).toBe(true);
    expect(isFallbackSwitchable('not-a-kind')).toBe(false);
  });
});

describe('N2 備援開關：導覽', () => {
  const find = (groups: ReturnType<typeof allowAll>, label: string) => groups.flatMap((g) => g.items).find((i) => i.label === label) as any;
  it('切回舊版的項目拿掉 kind、標記 fallback，label 與 href（舊版路由）不變；其他項目不受影響', () => {
    const base = allowAll();
    const sw = allowAll({ fallbackKinds: new Set(['merchandise', 'inventory']) });
    expect(find(base, '商品部').kind).toBe('merchandise');
    const m = find(sw, '商品部');
    expect(m.kind).toBeUndefined();
    expect(m.fallback).toBe(true);
    expect(m.href).toBe(find(base, '商品部').href);
    expect(find(sw, '盤點管理').kind).toBeUndefined();
    expect(find(sw, '我的任務').kind).toBe('my-tasks');
    expect(find(sw, '我的任務').fallback).toBeUndefined();
    // 項目數、順序、label、href 完全一致
    const flat = (g: ReturnType<typeof allowAll>) => g.flatMap((x) => x.items.map((i) => `${x.label}|${i.label}|${i.href}`));
    expect(flat(sw)).toEqual(flat(base));
  });
  it('沒有備援設定（空集合或未提供）時導覽與先前完全相同', () => {
    expect(allowAll({ fallbackKinds: new Set() })).toEqual(allowAll());
  });
});

describe('前端純函式（回舊版連結、備援判斷）', () => {
  it('整合模式用同網域路徑，獨立預覽模式指向 3002', () => {
    expect(legacyUrl(true, '/inventory')).toBe('/inventory');
    expect(legacyUrl(false, '/inventory')).toBe('http://localhost:3002/inventory');
    expect(legacyUrl(undefined, '/inventory')).toBe('http://localhost:3002/inventory');
  });
  it('legacyUrlForKind：有對應回網址、沒有舊版回 null', () => {
    expect(legacyUrlForKind('merchandise', true)).toBe('/cross-dept/merchandise');
    expect(legacyUrlForKind('inspection-detail', true)).toBe('/inspection');
    expect(legacyUrlForKind('ga-payment-requests', true)).toBeNull();
    expect(legacyUrlForKind('page-fallbacks', true)).toBeNull();
    expect(legacyUrlForKind('nope', true)).toBeNull();
  });
  it('fallbackFor：只有清單內的 kind 回傳舊版網址與原因', () => {
    const list = [{ kind: 'merchandise', reason: '載入很慢', updatedAt: null }];
    expect(fallbackFor('merchandise', list, true)).toEqual({ href: '/cross-dept/merchandise', reason: '載入很慢' });
    expect(fallbackFor('inventory', list, true)).toBeNull();
    expect(fallbackFor('merchandise', undefined, true)).toBeNull();
    expect(fallbackFor('merchandise', [], true)).toBeNull();
    expect(fallbackFor('merchandise', list, false)?.href).toBe('http://localhost:3002/cross-dept/merchandise');
  });
  it('原始碼契約：開頁籤的唯一入口 open() 與 App.vue 都走 fallbackFor；「回舊版」連結另開分頁並帶 rel=noopener', () => {
    const stores = fs.readFileSync(path.join(root, 'vue-workspace/src/stores.ts'), 'utf8');
    expect(stores).toContain('fallbackFor(kind, session.data?.pageFallbacks');
    const app = fs.readFileSync(path.join(root, 'vue-workspace/src/App.vue'), 'utf8');
    expect(app).toMatch(/data-testid="back-to-legacy"[\s\S]{0,200}target="_blank"[\s\S]{0,40}rel="noopener"/);
    expect(app).toContain('void refreshSession()'); // 開選單時重新讀取 session
    expect(app).toContain('setInterval(refreshSession, 60000)'); // 快取上限：最慢 60 秒
  });
});

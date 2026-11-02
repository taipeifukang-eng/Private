import { describe, expect, it } from 'vitest';
import {
  dedupeItems,
  diffDesktopVsMobile,
  diffNativeDomVsSession,
  diffRulesVsDom,
  nativeDomToItems,
  normalizeHref,
} from '../../support/parity-nav-dom';
import { loadAllowlist, matchAllowlist, validateAllowlist } from '../../support/parity';

describe('DOM 擷取的正規化', () => {
  it('normalizeHref 去掉同源前綴、查詢字串、hash 與結尾斜線', () => {
    expect(normalizeHref('http://localhost:3002/admin/stores/?a=1#x')).toBe('/admin/stores');
    expect(normalizeHref('/')).toBe('/');
    expect(normalizeHref('')).toBe('/');
  });

  it('dedupeItems 依 href 去重並排序，文字壓縮空白', () => {
    expect(dedupeItems([{ href: '/b', label: ' B  b ' }, { href: '/a/', label: 'A' }, { href: '/b', label: 'x' }])).toEqual([
      { href: '/a', label: 'A' },
      { href: '/b', label: 'B b' },
    ]);
  });
});

describe('規則表 vs DOM、桌機 vs 手機', () => {
  it('不一致時標出 rule-only / dom-only，且不比文字', () => {
    const d = diffRulesVsDom(
      [{ href: '/a', label: 'A' }, { href: '/b', label: 'B' }],
      [{ href: '/a', label: '不同文字' }, { href: '/c', label: 'C' }],
    );
    expect(d.map((x) => `${x.kind}:${x.key}`)).toEqual(['rule-only:/b', 'dom-only:/c']);
    expect(diffRulesVsDom([{ href: '/a', label: 'A' }], [{ href: '/a', label: 'A2' }])).toEqual([]);
  });

  it('桌機有、手機沒有 -> desktop-only', () => {
    const d = diffDesktopVsMobile([{ href: '/x', label: 'X' }, { href: '/y', label: 'Y' }], [{ href: '/y', label: 'Y' }]);
    expect(d.map((x) => `${x.kind}:${x.key}`)).toEqual(['desktop-only:/x']);
  });
});

describe('新版殼層 DOM', () => {
  const session = [
    { label: '任務', items: [{ href: '/my-tasks', label: '我的任務' }, { href: '/dashboard', label: '儀表板' }] },
    { label: '總務', items: [{ href: '/general-affairs', label: '服務中心首頁' }] },
  ];

  it('以群組 + 名稱反查 href；外連項目直接用 href；找不到者標 (unmapped)', () => {
    const items = nativeDomToItems(
      [
        { group: '任務', label: '我的任務' },
        { group: '總務', label: '服務中心首頁', href: '/general-affairs' },
        { group: '其他', label: '不存在' },
      ],
      session,
    );
    expect(items.map((i) => i.href)).toEqual(['(unmapped)其他/不存在', '/general-affairs', '/my-tasks']);
  });

  it('DOM 與 session 不一致 -> session-only / dom-only', () => {
    const d = diffNativeDomVsSession(
      [{ href: '/my-tasks', label: '我的任務' }, { href: '/new', label: 'N' }],
      [{ href: '/my-tasks', label: '我的任務' }, { href: '/dashboard', label: '儀表板' }],
    );
    expect(d.map((x) => `${x.kind}:${x.key}`)).toEqual(['session-only:/dashboard', 'dom-only:/new']);
  });

  it('內部比對用的差異名稱不會誤套用 only-legacy / only-native 白名單', () => {
    const list = loadAllowlist();
    const diff = { kind: 'desktop-only', key: '/', detail: '' };
    expect(matchAllowlist(diff, { page: 'navigation', mechanism: 'navigation', entry: 'nav-visibility', role: 'admin' }, list)).toBeNull();
    const cross = { kind: 'desktop-only', key: '/cross-dept/maintenance' };
    expect(
      matchAllowlist(cross, { page: 'navigation', mechanism: 'navigation', entry: 'nav-legacy-mobile-vs-desktop', role: 'admin' }, list)?.approvedBy,
    ).toBeNull();
  });
});

describe('allowlist deferredTo', () => {
  it('inventory-view-implies-import-delete 只登記、無 match、deferredTo=W25', () => {
    const e = loadAllowlist().find((x) => x.id === 'inventory-view-implies-import-delete')!;
    expect(e.deferredTo).toBe('W25');
    expect(e.match).toBeUndefined();
  });

  it('deferredTo 必須是非空字串', () => {
    const base = { id: 'a', page: 'p', description: 'd', reason: 'r', approvedBy: null };
    expect(validateAllowlist([{ ...base, deferredTo: 'W25' }])).toEqual([]);
    expect(validateAllowlist([{ ...base, deferredTo: '' }]).join()).toContain('deferredTo');
  });
});

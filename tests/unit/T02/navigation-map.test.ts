import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ORGANIZATION_NAV_PERMISSION_CODES } from '@/lib/admin/organization-management';
import { ROLE_MANAGEMENT_NAV_PERMISSION_CODES, USER_MANAGEMENT_NAV_PERMISSION_CODES } from '@/lib/permissions/rbac-management';
import { GA_MAINTENANCE_MODULE_CODES, GA_WORK_ORDER_MODULE_CODES } from '@/lib/general-affairs/maintenance-permissions';
import { loadMap } from '../../support/parity';
import {
  diffNavItems,
  expandCodes,
  legacyNavItems,
  nativeNavItems,
  navDataFromMap,
  type LegacyNavFacts,
} from '../../support/parity-nav';

const root = path.resolve(__dirname, '..', '..', '..');
const data = navDataFromMap(loadMap('navigation'));
const navbarSource = fs.readFileSync(path.join(root, 'components', 'Navbar.tsx'), 'utf8');
const hookSource = fs.readFileSync(path.join(root, 'hooks', 'useNavbarPermissions.ts'), 'utf8');

const facts = (over: Partial<LegacyNavFacts> = {}): LegacyNavFacts => ({
  permissions: [],
  profileRole: 'member',
  roleCodes: [],
  generalAffairsAccess: false,
  ...over,
});
const hrefs = (f: LegacyNavFacts) => legacyNavItems(f, data).map((i) => i.href);

describe('navigation.json 規則表不得與舊版原始碼漂移', () => {
  it('codeSets 與 lib 內的常數完全一致', () => {
    expect(data.codeSets.ORGANIZATION_NAV).toEqual([...ORGANIZATION_NAV_PERMISSION_CODES]);
    expect(data.codeSets.USER_NAV).toEqual([...USER_MANAGEMENT_NAV_PERMISSION_CODES]);
    expect(data.codeSets.ROLE_NAV).toEqual([...ROLE_MANAGEMENT_NAV_PERMISSION_CODES]);
    expect(data.codeSets.GA_MAINTENANCE).toEqual([...GA_MAINTENANCE_MODULE_CODES]);
    expect(data.codeSets.GA_WORK_ORDER).toEqual([...GA_WORK_ORDER_MODULE_CODES]);
  });

  it('Navbar.tsx 中每個 href: 入口都有規則，規則表沒有多餘入口', () => {
    const inSource = new Set(Array.from(navbarSource.matchAll(/href:\s*'([^']+)'/g)).map((m) => m[1]));
    inSource.add('/supervisor-management-log'); // Navbar 以 <Link href="..."> 直接渲染
    const inMap = new Set(data.navRules.map((r) => r.href));
    expect(Array.from(inSource).filter((h) => !inMap.has(h))).toEqual([]);
    expect(Array.from(inMap).filter((h) => !inSource.has(h))).toEqual([]);
  });

  it('規則表用到的每個權限碼都出現在 useNavbarPermissions.ts（@codeSet 另由 lib 常數對照）', () => {
    const codes = new Set<string>();
    for (const r of [...data.navRules, ...Object.values(data.navFlags)]) {
      for (const c of r.anyOf || []) if (!c.startsWith('@')) codes.add(c); // @codeSet 已由上一個測試對照 lib 常數
    }
    const missing = Array.from(codes).filter((c) => !hookSource.includes(`'${c}'`));
    expect(missing).toEqual([]);
  });

  it('hook 中每個 hasPermissionCode / hasAnyPermissionCode 直接引用的權限碼都在規則表內（防止舊版新增權限碼卻漏更新）', () => {
    const inHook = new Set<string>();
    for (const m of Array.from(hookSource.matchAll(/'([a-z_]+(?:\.[a-z_]+)+)'/g))) inHook.add(m[1]);
    const known = new Set<string>();
    for (const r of [...data.navRules, ...Object.values(data.navFlags)]) for (const c of expandCodes(r.anyOf, data.codeSets)) known.add(c);
    // canCreateInspection(inspection.create)、canManageUsers/Roles 的 mutation / assign 碼不控制任何入口，不需在規則表。
    const notNavEntry = new Set([
      'inspection.create',
      'role.permission.assign',
      'role.user_role.assign',
      'role.user_role.revoke',
      'pharmacist.management.edit',
    ]);
    const missing = Array.from(inHook).filter((c) => !known.has(c) && !notNavEntry.has(c));
    expect(missing).toEqual([]);
  });
});

describe('舊版 Navbar 規則求值', () => {
  it('無權限者只看到首頁與年度行事曆', () => {
    expect(hrefs(facts())).toEqual(['/', '/organization/calendar']);
  });

  it('profiles.role=admin 或系統管理員角色碼看得到全部入口', () => {
    const all = data.navRules.map((r) => r.href);
    expect(hrefs(facts({ profileRole: 'admin' }))).toEqual(all);
    expect(hrefs(facts({ roleCodes: ['dev_full_admin'] }))).toEqual(all);
  });

  it('單一權限碼只開對應入口；門市管理只認 store.manage', () => {
    expect(hrefs(facts({ permissions: ['store.manage'] }))).toEqual(
      expect.arrayContaining(['/admin/stores', '/store/clinic-selfpay-margin']),
    );
    expect(hrefs(facts({ permissions: ['store.store.view'] }))).not.toContain('/admin/stores');
    expect(hrefs(facts({ permissions: ['monthly.status.export'] }))).toEqual(['/', '/organization/calendar', '/admin/export-monthly-status']);
  });

  it('@codeSet 展開；未知 codeSet 會報錯', () => {
    expect(hrefs(facts({ permissions: ['role.role.view'] }))).toContain('/admin/roles');
    expect(() => expandCodes(['@NOPE'], data.codeSets)).toThrow(/codeSet/);
  });

  it('總務服務中心：入口 API、各模組權限與店長捷徑', () => {
    expect(hrefs(facts({ generalAffairsAccess: true }))).toContain('/general-affairs');
    expect(hrefs(facts({ generalAffairsAccess: true }))).not.toContain('/general-affairs/inventory');
    expect(hrefs(facts({ permissions: ['general_affairs.vendor.view'] }))).toContain('/general-affairs');
    const sm = hrefs(facts({ roleCodes: ['store_manager'] }));
    expect(sm).toEqual(expect.arrayContaining(['/general-affairs', '/general-affairs/inventory']));
    const maintenanceOnly = hrefs(facts({ permissions: ['general_affairs.work_order.view_all'] }));
    expect(maintenanceOnly).toContain('/general-affairs');
    expect(maintenanceOnly).not.toContain('/general-affairs/inventory');
  });
});

describe('導覽差異', () => {
  it('nativeNavItems 攤平 session navigation', () => {
    expect(nativeNavItems([{ label: 'g', items: [{ href: '/a', label: 'A' }, { href: '/b', label: 'B' }] }, { label: 'h', items: [] }])).toEqual([
      { href: '/a', label: 'A' },
      { href: '/b', label: 'B' },
    ]);
    expect(nativeNavItems(undefined)).toEqual([]);
  });

  it('diffNavItems 區分 only-legacy / only-native / 名稱不同，且不重複回報筆數', () => {
    const d = diffNavItems(
      [{ href: '/a', label: 'A' }, { href: '/b', label: 'B' }],
      [{ href: '/a', label: 'A2' }, { href: '/c', label: 'C' }],
    );
    expect(d.map((x) => `${x.kind}:${x.key}`)).toEqual(['only-legacy:/b', 'only-native:/c', 'changed:/a#label']);
  });

  it('相同入口 -> 無差異', () => {
    expect(diffNavItems([{ href: '/a', label: 'A' }], [{ href: '/a', label: 'A' }])).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  WORKSPACE_DETAIL_KINDS,
  WORKSPACE_NAV_KINDS,
  WORKSPACE_TAB_KINDS,
  type WorkTabKind,
} from '@/lib/workspace/page-kinds';
import {
  WORKSPACE_PAGE_META,
  isPageAllowed,
  pageTitle,
  pageUsesDefaultStore,
  type Capabilities,
  type CapabilityKey,
} from '../../../vue-workspace/src/workspace-page-meta';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');

// 重構前 App.vue allowed() 的逐字語意（凍結副本，供等價比對；不要「順手整理」）。
function legacyAllowed(kindArg: string, c: Capabilities | undefined, expired: boolean) {
  const tab = { kind: kindArg };
  return (
    !expired &&
    (tab.kind === 'employee-purchases' ? c?.employeePurchases : tab.kind === 'pharmacists' ? c?.pharmacists : tab.kind === 'relationships' ? c?.relationships : tab.kind === 'roles' ? c?.roles : tab.kind === 'users' ? c?.users : tab.kind === 'movement-management' ? (c?.movementDraft || c?.movementHistory || c?.transfers) : tab.kind === 'transfers' ? c?.transfers : tab.kind === 'movement-draft' ? c?.movementDraft : tab.kind === 'movement-history' ? c?.movementHistory : tab.kind === 'employees' || tab.kind === 'employee-history' ? c?.employees : tab.kind === 'employee-create' ? c?.employeeCreate : tab.kind === 'employee-import' ? c?.employeeImport : tab.kind === 'employee-birthdays' ? c?.employeeBirthdays : tab.kind.startsWith('department') ? c?.departments : tab.kind.startsWith('organization') ? c?.organization : tab.kind === 'store-map' ? c?.storeMap : tab.kind === 'store-promotions' || tab.kind === 'store-personnel' || tab.kind === 'store-personnel-history' || tab.kind === 'store-employees' || tab.kind === 'stores' || tab.kind === 'store-editor' || tab.kind === 'store-relocation' || tab.kind === 'store-history-editor' ? c?.storeManagement : tab.kind === 'supervisors' || tab.kind === 'supervisor-edit' ? c?.supervisors : tab.kind === 'store-managers' || tab.kind === 'store-manager-edit' ? c?.storeManagers : tab.kind === 'task-copy' || tab.kind === 'task-assign' || tab.kind === 'task-template-editor' ||
    tab.kind.startsWith('task-management')
      ? c?.taskManagement
      : tab.kind.startsWith('task-archive')
        ? c?.taskArchive
        : tab.kind === 'my-tasks' || tab.kind === 'task-runner'
          ? c?.tasks
          : tab.kind === 'monthly-release'
            ? c?.monthlyRelease // W04 新增 kind：登入即可看（session 對所有登入者回 true）
          : tab.kind === 'monthly-export'
            ? c?.monthlyExport // W02 新增 kind：單品獎金／支援時數照舊版開放，入口 capability 獨立於 monthly
            : tab.kind.startsWith('monthly')
            ? c?.monthly
            : tab.kind.startsWith('performance')
              ? c?.performance
              : tab.kind === 'inventory'
                ? c?.inventory
                : tab.kind.startsWith('inspection-setting')
                  ? c?.inspectionSettings
                  : tab.kind.startsWith('improvement')
                    ? c?.improvements
                    : tab.kind === 'inspection-compare'
                      ? c?.compareInspections
                      : tab.kind === 'inspection-editor'
                        ? c?.createInspections || c?.inspections
                        : tab.kind === 'inspection-print' ||
                            tab.kind === 'inspections' ||
                            tab.kind === 'inspection-detail'
                          ? c?.inspections
                          : c?.campaigns)
  );
}

// 重構前 stores.ts open() 的標題表與「新頁預設門市」清單（凍結副本）。
const LEGACY_TITLES: Record<string, string> = {
  transfers: '調店申請', 'movement-management': '人員異動管理', 'movement-draft': '批次異動驗證', 'movement-history': '人員異動紀錄',
  employees: '員工管理', 'employee-history': '員工異動歷程', 'employee-create': '新增員工', 'employee-birthdays': '員工生日匯入',
  'employee-import': '批次匯入員工', departments: '部門管理', 'department-detail': '部門工作頁', 'department-work-editor': '工作職掌',
  organization: '公司組織', 'organization-editor': '組織單位', stores: '門市管理', 'store-map': '門市整合地圖', 'store-promotions': '批次升遷',
  'store-personnel': '門市員工主檔', 'store-personnel-history': '員工歷程', 'store-employees': '門市員工', 'store-editor': '門市資料',
  'store-relocation': '門市搬遷沿革', 'store-history-editor': '補建歷史沿革', supervisors: '經理／督導管理', 'supervisor-edit': '管理門市指派',
  'store-managers': '店長指派', 'store-manager-edit': '編輯店長指派', 'task-copy': '複製範本', 'task-assign': '派發任務',
  'task-template-editor': '任務範本', 'task-management': '任務管理', 'task-management-detail': '任務管理明細', 'task-archive': '已封存任務',
  'task-archive-detail': '封存任務紀錄', 'my-tasks': '我的任務', 'task-runner': '任務內容', 'inspection-print': '巡店列印預覽',
  'inspection-settings': '巡店範本設定', 'inspection-setting-edit': '編輯巡店設定', improvements: '待改善追蹤', 'improvement-detail': '改善回報',
  'inspection-compare': '巡店比較', 'inspection-editor': '新增巡店', 'inspection-detail': '巡店紀錄明細', 'campaign-schedule': '活動門市排程',
  monthly: '每月人員狀態', 'monthly-edit': '人員明細', 'monthly-export': '資料匯出', 'monthly-release': '每月版更內容', 'employee-purchases': '員工購物管理', pharmacists: '藥師管理', relationships: '關係會員',
  roles: '角色權限管理', users: '使用者管理', performance: '業績管理', 'performance-thresholds': '獎金閾值', 'performance-prescription': '處方箋報表',
  'performance-bonus': '每月獎金', 'performance-edit': '編輯業績', inventory: '盤點管理',
};
function legacyTitle(kind: string, recordId?: string) {
  return LEGACY_TITLES[kind] || (kind === 'inspections' ? '巡店列表' : kind === 'campaigns' ? '活動管理' : recordId ? '編輯活動' : '新增活動');
}
const LEGACY_DEFAULT_STORE = ['inspections', 'inspection-compare', 'improvements', 'monthly', 'performance', 'inventory'];

const CAP_KEYS = Array.from(
  read('vue-workspace/src/stores.ts').match(/capabilities: \{([\s\S]*?)\};/)![1].matchAll(/^\s+(\w+): boolean;/gm),
  (m) => m[1] as CapabilityKey,
);

describe('T03 頁面註冊表等價於重構前行為', () => {
  it('capability 鍵清單可從 stores.ts 解析', () => {
    expect(CAP_KEYS.length).toBeGreaterThan(25);
  });

  it('權限：每個 kind 在「全關、全開、單一 capability 開、過期、未登入」下與舊三元式結果一致', () => {
    const scenarios: Array<[string, Capabilities | undefined, boolean]> = [
      ['未登入', undefined, false],
      ['全關', Object.fromEntries(CAP_KEYS.map((k) => [k, false])), false],
      ['全開', Object.fromEntries(CAP_KEYS.map((k) => [k, true])), false],
      ['全開但過期', Object.fromEntries(CAP_KEYS.map((k) => [k, true])), true],
      ...CAP_KEYS.map((k): [string, Capabilities, boolean] => [`只開 ${k}`, { [k]: true }, false]),
    ];
    for (const kind of WORKSPACE_TAB_KINDS) {
      for (const [label, caps, expired] of scenarios) {
        expect(isPageAllowed(kind, caps, expired), `${kind} / ${label}`).toBe(!!legacyAllowed(kind, caps, expired));
      }
    }
  });

  it('權限：任兩個 capability 同時開的組合也一致（涵蓋 OR 規則）', () => {
    for (const kind of WORKSPACE_TAB_KINDS) {
      for (let i = 0; i < CAP_KEYS.length; i++) {
        for (let j = i + 1; j < CAP_KEYS.length; j++) {
          const caps = { [CAP_KEYS[i]]: true, [CAP_KEYS[j]]: true };
          expect(isPageAllowed(kind, caps), `${kind} / ${CAP_KEYS[i]}+${CAP_KEYS[j]}`).toBe(!!legacyAllowed(kind, caps, false));
        }
      }
    }
  });

  it('標題與新頁預設門市與舊版一致，含 campaign-edit 的新增／編輯', () => {
    for (const kind of WORKSPACE_TAB_KINDS) {
      expect(pageTitle(kind), kind).toBe(legacyTitle(kind));
      expect(pageTitle(kind, 'rec-1'), kind).toBe(legacyTitle(kind, 'rec-1'));
      expect(pageUsesDefaultStore(kind), kind).toBe(LEGACY_DEFAULT_STORE.includes(kind));
    }
    expect(pageTitle('campaign-edit')).toBe('新增活動');
    expect(pageTitle('campaign-edit', 'x')).toBe('編輯活動');
  });
});

describe('T03 註冊完整性', () => {
  it('kind 沒有重複，導覽 kind 與明細 kind 互不重疊', () => {
    expect(new Set(WORKSPACE_TAB_KINDS).size).toBe(WORKSPACE_NAV_KINDS.length + WORKSPACE_DETAIL_KINDS.length);
  });

  it('meta 恰好涵蓋所有 kind，且每個權限鍵都存在於 Session.capabilities', () => {
    expect(Object.keys(WORKSPACE_PAGE_META).sort()).toEqual([...WORKSPACE_TAB_KINDS].sort());
    for (const kind of WORKSPACE_TAB_KINDS) {
      expect(WORKSPACE_PAGE_META[kind].permission.length, kind).toBeGreaterThan(0);
      for (const key of WORKSPACE_PAGE_META[kind].permission) expect(CAP_KEYS, `${kind}:${key}`).toContain(key);
    }
  });

  it('workspace-pages.ts 為每個 kind 登錄了元件（原始碼層級檢查；型別層級由 vue-tsc 強制）', () => {
    const src = read('vue-workspace/src/workspace-pages.ts');
    const block = src.slice(src.indexOf('const components'), src.indexOf('export const WORKSPACE_PAGES'));
    for (const kind of WORKSPACE_TAB_KINDS as readonly WorkTabKind[]) {
      const key = kind.includes('-') ? `"${kind}"` : kind;
      expect(block, kind).toMatch(new RegExp(`^  ${key}: \\w+,$`, 'm'));
    }
  });

  it('navigation.ts 不再內嵌 kind 字串聯集，改用 WorkspaceNavKind', () => {
    const nav = read('lib/workspace/navigation.ts');
    expect(nav).toContain('WorkspaceNavKind');
    expect(nav).not.toMatch(/\|\s*"movement-management"/);
  });

  it('navigation.ts 內每個 item(...) 使用的 kind 字串都在 WORKSPACE_NAV_KINDS 內', () => {
    const nav = read('lib/workspace/navigation.ts');
    const used = Array.from(nav.matchAll(/,\s*"([a-z][a-z-]+)",?\s*\)/g), (m) => m[1]);
    expect(used.length).toBeGreaterThan(20);
    for (const k of used) expect(WORKSPACE_NAV_KINDS as readonly string[], k).toContain(k);
  });

  it('App.vue 不再有巨型權限三元式與 v-else-if 元件鏈', () => {
    const app = read('vue-workspace/src/App.vue');
    expect(app).not.toContain("tab.kind === 'employee-purchases'");
    expect(app).not.toMatch(/v-else-if="tab\.kind/);
    expect(app).toContain('WORKSPACE_PAGES[tab.kind].component');
  });
});

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as org from '@/lib/admin/organization-management';
import { workspaceNavigation } from '@/lib/workspace/navigation';
import {
  ASSIGNMENT_TYPES,
  DEPARTMENT_PAGE_PERMISSION_CODES,
  buildChart,
  countPersonAssignments,
  liveWorkItems,
  personResponsibilities,
  type AssignmentType,
} from '@/lib/workspace/organization-rules';

// W21（M5 Q9、Q10、Q11、人員職掌統計、組織圖）規則測試：新版規則與舊版（原始碼／同輸入）逐項比對。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 舊版部門管理頁 app/admin/departments/page.tsx 的進入條件：讀原始碼，不手抄。
function legacyDepartmentGateCodes(): string[] {
  const src = read('app/admin/departments/page.tsx');
  const imported = /import \{([^}]+)\} from '@\/lib\/admin\/organization-management'/.exec(src)![1]
    .split(',').map((x) => x.trim()).filter(Boolean);
  const codes = new Set<string>();
  for (const name of imported) {
    const value = (org as any)[name];
    if (!Array.isArray(value)) throw new Error(`舊頁引用的 ${name} 不是權限清單`);
    value.forEach((c: string) => codes.add(c));
  }
  return Array.from(codes).sort();
}

describe('Q9 部門管理進入條件照舊版頁面', () => {
  it('新版進入條件的權限碼集合 = 舊頁引用的 5 組權限碼聯集（部門工作檢視／檢視、新增、工作管理／編輯、成員管理、主管管理）', () => {
    expect([...DEPARTMENT_PAGE_PERMISSION_CODES].sort()).toEqual(legacyDepartmentGateCodes());
    expect(legacyDepartmentGateCodes()).toEqual([
      'organization.department.create',
      'organization.department.edit',
      'organization.department.view',
      'organization.department_workspace.manage',
      'organization.department_workspace.view',
      'organization.manager.manage',
      'organization.member.manage',
    ]);
  });

  const universe = Array.from(new Set([...org.ORGANIZATION_NAV_PERMISSION_CODES, ...DEPARTMENT_PAGE_PERMISSION_CODES]));
  const subsets: string[][] = [];
  for (let mask = 0; mask < 1 << universe.length; mask += 1) subsets.push(universe.filter((_, i) => mask & (1 << i)));
  const ctxOf = (codes: string[]) => ({ has: (...c: string[]) => c.some((x) => codes.includes(x)), roleCodes: new Set<string>() }) as any;
  const legacyAllowed = (codes: string[]) => {
    const any = (list: readonly string[]) => list.some((c) => codes.includes(c));
    return (
      any(org.ORGANIZATION_DEPARTMENT_WORKSPACE_VIEW_PERMISSION_CODES) ||
      any(org.ORGANIZATION_DEPARTMENT_CREATE_PERMISSION_CODES) ||
      any(org.ORGANIZATION_DEPARTMENT_WORKSPACE_MANAGE_PERMISSION_CODES) ||
      any(org.ORGANIZATION_MEMBER_MANAGE_PERMISSION_CODES) ||
      any(org.ORGANIZATION_MANAGER_MANAGE_PERMISSION_CODES)
    );
  };

  it(`${universe.length} 個相關權限碼的全部 ${1 << universe.length} 種組合：導覽入口、能力旗標與舊頁條件完全一致`, () => {
    const mismatches: string[] = [];
    for (const codes of subsets) {
      const present = workspaceNavigation(ctxOf(codes)).flatMap((g) => g.items).some((i) => i.href === '/admin/departments'); // 導覽只回傳有權限的項目
      const gate = ctxOf(codes).has(...DEPARTMENT_PAGE_PERMISSION_CODES);
      const expected = legacyAllowed(codes);
      if (present !== expected || gate !== expected) mismatches.push(codes.join(','));
    }
    expect(mismatches).toEqual([]);
  });

  it('只有「組織檢視」「成員檢視」「主管檢視」其中之一或組合的人：舊版進不去、新版（Q9）也進不去；這群人是與先前新版的差異來源', () => {
    for (const only of [['organization.organization.view'], ['organization.member.view'], ['organization.manager.view'], ['organization.organization.view', 'organization.member.view', 'organization.manager.view']]) {
      expect(legacyAllowed(only)).toBe(false);
      expect(ctxOf(only).has(...DEPARTMENT_PAGE_PERMISSION_CODES)).toBe(false);
      // 先前新版的條件（整組組織相關權限＋工作管理）會放行 —— 這就是 Q9 要收回的部分
      expect(ctxOf(only).has(...org.ORGANIZATION_NAV_PERMISSION_CODES, 'organization.department_workspace.manage')).toBe(true);
    }
  });

  it('公司組織頁入口不變：仍是整組組織相關權限（舊版 Navbar canViewOrganization）', () => {
    for (const codes of subsets) {
      const present = workspaceNavigation(ctxOf(codes)).flatMap((g) => g.items).some((i) => i.href === '/admin/organization');
      expect(present).toBe(codes.some((c) => (org.ORGANIZATION_NAV_PERMISSION_CODES as readonly string[]).includes(c)));
    }
  });
});

// ------------------------------------------------------------------ 人員職掌統計
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
// 舊版 OrganizationManagementClient.tsx 的算法逐字照抄：workItems 只含 status=active（舊 API 篩選），每項看使用者是否有該類型的有效指派（啟用、無結束日）。
function legacyGrouped(allItems: any[], userId: string, type: AssignmentType) {
  const workItems = allItems.filter((i) => i.status === 'active'); // 舊 API：.eq('status','active')
  return workItems.filter((item) => item.assignments.some((a: any) => a.user_id === userId && a.assignment_type === type && a.status === 'active' && !a.effective_to));
}
function randomItems(rand: () => number) {
  const users = ['u1', 'u2', 'u3'];
  const items = Array.from({ length: Math.floor(rand() * 7) }, (_, i) => ({
    id: `w${i}`,
    status: rand() < 0.75 ? 'active' : 'inactive',
    assignments: Array.from({ length: Math.floor(rand() * 5) }, () => ({
      user_id: users[Math.floor(rand() * users.length)],
      assignment_type: ASSIGNMENT_TYPES[Math.floor(rand() * 3)],
      status: rand() < 0.8 ? 'active' : 'inactive',
      effective_to: rand() < 0.2 ? '2025-01-01' : null,
    })),
  }));
  return items;
}

describe('人員職掌統計（主責／協作／代理）新舊同輸入同輸出', () => {
  it('300 組隨機資料 × 3 位使用者 × 3 種類型：數量與職掌清單都與舊版算法相同', () => {
    const rand = rng(20261109);
    const diffs: string[] = [];
    for (let n = 0; n < 300; n += 1) {
      const items = randomItems(rand);
      for (const u of ['u1', 'u2', 'u3']) {
        const stats = personResponsibilities(items, u);
        for (const type of ASSIGNMENT_TYPES) {
          const legacy = legacyGrouped(items, u, type).map((i) => i.id);
          if (JSON.stringify(stats[type].map((i) => i.id)) !== JSON.stringify(legacy) || countPersonAssignments(items, u, type) !== legacy.length)
            diffs.push(`case ${n} ${u} ${type}`);
        }
        expect(stats.total).toBe(ASSIGNMENT_TYPES.reduce((sum, t) => sum + legacyGrouped(items, u, t).length, 0));
      }
    }
    expect(diffs).toEqual([]);
  });

  it('表格案例：停用職掌、已結束指派、停用指派、同職掌重複指派只算一次、空資料', () => {
    const items = [
      { id: 'a', status: 'active', assignments: [{ user_id: 'u', assignment_type: 'PRIMARY', status: 'active' }, { user_id: 'u', assignment_type: 'PRIMARY', status: 'active' }, { user_id: 'u', assignment_type: 'BACKUP', status: 'active', effective_to: '2020-01-01' }] },
      { id: 'b', status: 'inactive', assignments: [{ user_id: 'u', assignment_type: 'PRIMARY', status: 'active' }] },
      { id: 'c', status: 'active', assignments: [{ user_id: 'u', assignment_type: 'COLLABORATOR', status: 'inactive' }, { user_id: 'v', assignment_type: 'COLLABORATOR', status: 'active' }] },
    ];
    expect(countPersonAssignments(items, 'u', 'PRIMARY')).toBe(1);
    expect(countPersonAssignments(items, 'u', 'COLLABORATOR')).toBe(0);
    expect(countPersonAssignments(items, 'u', 'BACKUP')).toBe(0);
    expect(countPersonAssignments(items, 'v', 'COLLABORATOR')).toBe(1);
    expect(personResponsibilities(items, 'nobody').total).toBe(0);
    expect(personResponsibilities(null, 'u').total).toBe(0);
    expect(liveWorkItems(items).map((i) => i.id)).toEqual(['a', 'c']);
    expect(liveWorkItems(undefined)).toEqual([]);
  });
});

// ------------------------------------------------------------------ 組織圖
describe('組織圖卡片（唯讀）', () => {
  const units = [
    { id: 'co', code: 'CO', parent_id: null, sort_order: 0, status: 'active' },
    { id: 'b', code: 'B', parent_id: 'co', sort_order: 2, status: 'active' },
    { id: 'a', code: 'A', parent_id: 'co', sort_order: 1, status: 'active' },
    { id: 'a1', code: 'A1', parent_id: 'a', sort_order: 1, status: 'inactive' },
    { id: 'orphan', code: 'O', parent_id: 'gone', sort_order: 0, status: 'active' },
  ];
  const flat = (nodes: any[]): string[] => nodes.flatMap((n) => [n.unit.id, ...flat(n.children)]);
  it('依排序、代碼排列；預設不含停用單位；含停用時出現；找不到上層的單位當成根', () => {
    expect(flat(buildChart(units, false))).toEqual(['co', 'a', 'b', 'orphan']);
    expect(flat(buildChart(units, true))).toEqual(['co', 'a', 'a1', 'b', 'orphan']);
  });
  it('資料有循環也不會無限迴圈、每個單位最多出現一次', () => {
    const loop = [
      { id: 'x', code: 'X', parent_id: 'y', sort_order: 0, status: 'active' },
      { id: 'y', code: 'Y', parent_id: 'x', sort_order: 0, status: 'active' },
    ];
    expect(flat(buildChart(loop, true)).length).toBeLessThanOrEqual(2);
  });
});

// ------------------------------------------------------------------ Q10、Q11（SQL 與結構）
const norm = (s: string) => s.replace(/\r\n/g, '\n');
describe('Q10、Q11 DEV SQL', () => {
  const up = norm(read('supabase/workspace-dev/20261109100000_m5_w21_org_inactive_members_no_unit_sync.sql'));
  const down = norm(read('supabase/workspace-dev/20261109100000_m5_w21_org_inactive_members_no_unit_sync.rollback.sql'));
  const base = norm(read('supabase/workspace-dev/20261028180000_vue_organization.sql'));
  const fnOf = (sql: string) => {
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.workspace_organization_save');
    const end = sql.indexOf('\n$' + '$;', start);
    return sql.slice(start, end + 4);
  };

  it('Q11：移除部門改名／停用同步人員資料的 trigger 與函式；rollback 重建（與原檔相同）', () => {
    expect(up).toContain('DROP TRIGGER IF EXISTS workspace_organization_unit_sync_profiles ON public.organization_units');
    expect(up).toContain('DROP FUNCTION IF EXISTS public.workspace_organization_unit_sync_profiles()');
    expect(up).not.toMatch(/CREATE TRIGGER workspace_organization_unit_sync_profiles/);
    const original = norm(read('supabase/workspace-dev/20261028190000_vue_organization_profile_sync.sql')).replace(/^BEGIN;\n/, '').replace(/COMMIT;\s*$/, '').trim();
    expect(down).toContain(original);
  });
  it('Q10：成員／主管操作不再因單位停用而拒絕；建立／更新／層級調整對停用上層的限制保留；rollback 還原原函式', () => {
    expect(fnOf(up)).not.toContain('WORKSPACE_INACTIVE');
    expect(fnOf(up)).toContain('WORKSPACE_PARENT');
    expect(fnOf(up)).toContain('WORKSPACE_PRIMARY_CONFLICT');
    expect(fnOf(base).match(/WORKSPACE_INACTIVE/g)?.length).toBe(2);
    expect(fnOf(down).trim()).toBe(fnOf(base).trim());
  });
  it('兩支都有 BEGIN／COMMIT，且不碰 supabase/migrations', () => {
    for (const sql of [up, down]) {
      expect(sql.trimStart().startsWith('BEGIN;')).toBe(true);
      expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    }
    expect(read('scripts/apply-workspace-m5-w21-org-dev.cjs')).toContain('--rollback');
  });
  it('成員同步（成員異動才同步）的 trigger 與函式沒有被動到', () => {
    expect(up).not.toContain('organization_membership_sync_profile_department');
    expect(up).not.toContain('sync_primary_department_to_profile');
  });
});

describe('W21 畫面與 API 結構', () => {
  const vue = (p: string) => read(`vue-workspace/src/${p}`);
  it('停用單位的「設定成員」「設定主管」入口仍在（公司組織、部門詳情），編輯頁不再因停用而鎖住', () => {
    const o = vue('pages/Organization.vue');
    expect(o).toContain('v-if="caps.members"');
    expect(o).toContain('v-if="caps.managers"');
    expect(o).not.toMatch(/caps\.(members|managers)&&current\.status==='active'/);
    const d = vue('pages/DepartmentDetail.vue');
    expect(d).toContain('v-if="data.organizationCapabilities.members"');
    expect(d).toContain('v-if="data.organizationCapabilities.managers"');
    expect(vue('pages/OrganizationEditor.vue')).not.toContain("current.value?.status!=='active')permitted.value=false");
  });
  it('組織圖卡片為唯讀：切換按鈕、卡片元件不含拖曳或儲存；編輯中不可切到組織圖', () => {
    const o = vue('pages/Organization.vue');
    for (const t of ['view-tree', 'view-chart', 'org-chart', 'OrgChartNode']) expect(o).toContain(t);
    expect(o).toContain(':disabled="editing"');
    const card = vue('components/OrgChartNode.vue');
    expect(card).not.toMatch(/draggable|dragstart|api\(|POST/);
  });
  it('人員職掌抽屜：公司組織與部門管理兩頁都能開；只在有部門管理進入權限時才可點；成員表有主責／協作／代理欄', () => {
    expect(vue('pages/Organization.vue')).toContain('PersonDrawer');
    expect(vue('pages/Organization.vue')).toContain('session.data?.capabilities.departments');
    const d = vue('pages/DepartmentDetail.vue');
    expect(d).toContain('PersonDrawer');
    for (const t of ['count-PRIMARY', 'count-COLLABORATOR', 'count-BACKUP', '<th>組織角色</th>']) expect(d).toContain(t);
    const drawer = vue('components/PersonDrawer.vue');
    expect(drawer).toContain('department-work?department=');
    expect(drawer).toContain('person-drawer');
    expect(drawer).not.toContain('工作交接'); // 舊版只是空白佔位，不復刻
  });
  it('部門管理 API 與導覽、session 都用同一份舊頁條件', () => {
    expect(read('app/api/workspace/department-work/route.ts')).toContain('DEPARTMENT_PAGE_PERMISSION_CODES');
    expect(read('app/api/workspace/session/route.ts')).toContain('departments: ctx.has(...DEPARTMENT_PAGE_PERMISSION_CODES)');
    expect(read('app/api/workspace/organization/route.ts')).not.toContain("['WORKSPACE_INACTIVE'");
  });
  it('舊版 route handler 與舊頁的 RBAC 沒有被動到（檔案內容不含 M5 標記）', () => {
    for (const p of ['app/api/department-workspace/work-items/route.ts', 'app/api/organization/units/route.ts', 'app/api/organization/users/route.ts', 'app/admin/departments/page.tsx', 'app/admin/organization/page.tsx']) {
      expect(read(p)).not.toMatch(/M5|DEPARTMENT_PAGE_PERMISSION_CODES/);
    }
  });
});

describe('組織圖卡片統計（照舊版 renderChartNode）', () => {
  it('直接下層數與含下層的不重複人數（同一人在多個單位只算一次）', async () => {
    const { chartCounts } = await import('@/lib/workspace/organization-rules');
    const units = [
      { id: 'co', code: 'CO', parent_id: null, sort_order: 0, status: 'active', members: [{ user_id: 'a' }] },
      { id: 'd1', code: 'D1', parent_id: 'co', sort_order: 1, status: 'active', members: [{ user_id: 'a' }, { user_id: 'b' }] },
      { id: 'd2', code: 'D2', parent_id: 'co', sort_order: 2, status: 'active', members: [{ user_id: 'c' }] },
      { id: 't', code: 'T', parent_id: 'd1', sort_order: 1, status: 'active', members: [] },
    ];
    const [root] = buildChart(units, false);
    expect(chartCounts(root)).toEqual({ children: 2, people: 3 });
    expect(chartCounts(root.children[0])).toEqual({ children: 1, people: 2 });
    expect(chartCounts(root.children[1])).toEqual({ children: 0, people: 1 });
  });
});

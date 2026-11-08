import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADMIN_LEVEL_ROLE_CODES,
  ADMIN_GRANT_WARNING,
  REGISTER_PATH,
  compatRoleNeedsAdminConfirm,
  isAdminLevelRoleCode,
  isBanActive,
  isPendingActivation,
  pendingCount,
  roleAssignmentNeedsAdminConfirm,
} from '@/lib/workspace/user-management-rules';
import { ADMIN_LIKE_ROLE_CODES } from '@/lib/workspace/permission-semantics';
import { isAdminLikeLegacyOrRole } from '@/lib/admin/user-rbac-view';

// P06（M5 Q12、Q13、Q14、Q15）規則與結構測試。
const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('Q12 新增使用者改回公開註冊頁', () => {
  it('連結與舊版 app/admin/users/page.tsx 相同（/register）', () => {
    expect(REGISTER_PATH).toBe('/register');
    expect(read('app/admin/users/page.tsx')).toContain(`href="${REGISTER_PATH}"`);
  });
  it('使用者管理頁沒有直接建立的表單、也不呼叫 create；API 不再建立帳號', () => {
    const page = read('vue-workspace/src/pages/Users.vue');
    expect(page).toContain('add-user-link');
    expect(page).toContain('target="_blank"');
    expect(page).toContain('rel="noopener"');
    expect(page).not.toMatch(/confirmPassword|modal === "create"|open\("create"|open\('create'/);
    const api = read('app/api/workspace/users/route.ts');
    expect(api).not.toMatch(/createUser\(|user\.user\.create/);
    expect(api).toContain('新增使用者請由本人使用公開註冊頁自行註冊');
  });
});

describe('Q13 授予管理員前醒目確認（規則不變）', () => {
  it('管理員等級角色代碼與權限語意檔、使用者檢視檔三處一致', () => {
    expect([...ADMIN_LEVEL_ROLE_CODES].sort()).toEqual([...ADMIN_LIKE_ROLE_CODES].sort());
    for (const code of ADMIN_LEVEL_ROLE_CODES) expect(isAdminLikeLegacyOrRole('member', [code])).toBe(true);
    expect(isAdminLikeLegacyOrRole('member', ['store_manager'])).toBe(false);
  });
  it('相容角色：改成 admin 才要確認；本來就是 admin、降級、改成 manager／member 都不要', () => {
    const cases: Array<[string | null, string | null, boolean]> = [
      ['member', 'admin', true], ['manager', 'admin', true], [null, 'admin', true], [undefined as any, 'admin', true],
      ['admin', 'admin', false], ['admin', 'member', false], ['admin', 'manager', false],
      ['member', 'manager', false], ['manager', 'member', false], ['member', 'member', false],
    ];
    for (const [from, to, expected] of cases) expect(compatRoleNeedsAdminConfirm(from, to), `${from} -> ${to}`).toBe(expected);
  });
  it('指派使用者到角色：只有管理員等級角色代碼要確認', () => {
    for (const code of ADMIN_LEVEL_ROLE_CODES) expect(roleAssignmentNeedsAdminConfirm({ code })).toBe(true);
    for (const code of ['store_manager', 'viewer', 'no_access', 'administrator', 'Admin', '', null, undefined]) expect(roleAssignmentNeedsAdminConfirm({ code } as any)).toBe(false);
    expect(roleAssignmentNeedsAdminConfirm(null)).toBe(false);
    expect(isAdminLevelRoleCode('owner_role')).toBe(true);
  });
  it('警示文字清楚寫出「完整管理權限」；兩個畫面都有確認視窗，且後端規則檔沒有被改動', () => {
    expect(ADMIN_GRANT_WARNING).toContain('完整管理權限');
    const users = read('vue-workspace/src/pages/Users.vue');
    const roles = read('vue-workspace/src/pages/Roles.vue');
    for (const src of [users, roles]) {
      expect(src).toContain('admin-grant-warning');
      expect(src).toContain('admin-grant-confirm');
      expect(src).toContain('ADMIN_GRANT_WARNING');
    }
    expect(users).toContain('compatRoleNeedsAdminConfirm');
    expect(roles).toContain('roleAssignmentNeedsAdminConfirm');
    // 後端規則不改：舊版 route handler 沒有任何 M5 修改
    for (const p of ['app/api/roles/[id]/users/route.ts', 'app/api/roles/route.ts']) expect(read(p)).not.toMatch(/M5|ADMIN_GRANT/);
  });
});

describe('Q14 重置密碼維持只有舊式管理員', () => {
  it('API 仍以 profiles.role === admin 判斷，角色權限碼（含 owner 等）不能代替', () => {
    const api = read('app/api/workspace/users/route.ts');
    expect(api).toContain('actor?.role !== "admin"');
    expect(api).toContain('只有管理員可以重置密碼');
    expect(api).toContain('reset: rows.get(ctx.user.id)?.role === "admin"');
  });
});

describe('Q15 待開通', () => {
  const role = (over: Record<string, unknown> = {}) => ({ assignment_active: true, is_expired: false, ...over });
  const base = { has_auth: true, is_disabled: false, is_admin_compatibility: false };
  it('表格案例：沒有任何指派、只有已停用／已到期的指派 = 待開通；有生效指派、管理員相容、已停用、沒有登入帳號 = 不是', () => {
    const cases: Array<[string, any, boolean]> = [
      ['沒有角色', { ...base, rbac_roles: [] }, true],
      ['rbac_roles 缺漏', { ...base }, true],
      ['只有已停用的指派', { ...base, rbac_roles: [role({ assignment_active: false })] }, true],
      ['只有已到期的指派', { ...base, rbac_roles: [role({ is_expired: true })] }, true],
      ['有生效指派', { ...base, rbac_roles: [role()] }, false],
      ['生效指派＋已到期指派', { ...base, rbac_roles: [role({ is_expired: true }), role()] }, false],
      ['生效指派但角色本身停用（正式區不檢查 roles.is_active）', { ...base, rbac_roles: [role({ is_active: false, is_current: false })] }, false],
      ['舊式身分管理員、沒有角色', { ...base, is_admin_compatibility: true, rbac_roles: [] }, false],
      ['帳號已停用', { ...base, is_disabled: true, rbac_roles: [] }, false],
      ['只有基本資料沒有登入帳號', { ...base, has_auth: false, rbac_roles: [] }, false],
    ];
    for (const [name, user, expected] of cases) expect(isPendingActivation(user), name).toBe(expected);
    expect(pendingCount(cases.map((c) => c[1]))).toBe(cases.filter((c) => c[2]).length);
  });
  it('停用判定：封鎖時間未到期才算（沒有時間、已過期都不算）', () => {
    const now = Date.parse('2026-11-09T00:00:00Z');
    expect(isBanActive(null, now)).toBe(false);
    expect(isBanActive(undefined, now)).toBe(false);
    expect(isBanActive('2026-11-08T00:00:00Z', now)).toBe(false);
    expect(isBanActive('2026-11-10T00:00:00Z', now)).toBe(true);
    expect(isBanActive('none', now)).toBe(false);
  });
  it('API 回傳每位使用者的旗標與總數；畫面有標籤、篩選與「待開通 N 位」，不寄信', () => {
    const api = read('app/api/workspace/users/route.ts');
    expect(api).toContain('is_pending_activation');
    expect(api).toContain('pendingCount');
    expect(api).not.toMatch(/sendMail|nodemailer|resend/i);
    const page = read('vue-workspace/src/pages/Users.vue');
    for (const t of ['pending-filter', 'pending-count', 'pending-tag', '待開通', 'pendingOnly']) expect(page).toContain(t);
  });
});

describe('角色清單 DEV 測試角色開關', () => {
  it('預設隱藏、提示隱藏數量、標示 DEV 測試角色；no_access 也屬於此類（與舊版 API 規則相同）', () => {
    const page = read('vue-workspace/src/pages/Roles.vue');
    expect(page).toContain('includeDev = ref(false)');
    expect(page).toContain('顯示 DEV 測試角色');
    expect(page).toContain('已隱藏 {{ hidden }} 個 DEV 測試角色');
    expect(page).toContain('hidden-dev-roles');
    expect(page).toContain('dev-role-tag');
    expect(read('app/api/roles/route.ts')).toContain('/^no_access$/');
  });
});

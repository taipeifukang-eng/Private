import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_LIKE_ROLE_CODES, resolveAccess, type RoleAssignment } from '../../../lib/workspace/permission-semantics';

// PERM 單元層：Vue context() 的權限語意對齊「舊版在正式區的實際判斷」。
//   permissions ＝ 正式區 has_permission：user_roles.is_active 且未過期、role_permissions.is_allowed、permissions.is_active；
//                  不檢查 roles.is_active、DB 端沒有 admin 繞過。
//   has／isAdmin ＝ 舊版 hasPermission() 的應用層保底：profiles.role==='admin' 或持有有效的管理員類角色 → 任何碼都 true。

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const NOW = Date.parse('2026-11-06T04:00:00Z');
const PAST = '2026-11-01T00:00:00Z';
const FUTURE = '2026-12-01T00:00:00Z';

type Grant = { code: string; is_allowed?: boolean; perm_active?: boolean };
function assignment(
  roleCode: string,
  grants: Grant[],
  o: { role_active?: boolean; ur_active?: boolean; expires_at?: string | null; asArray?: boolean } = {},
): RoleAssignment {
  const role = {
    code: roleCode,
    is_active: o.role_active ?? true,
    role_permissions: grants.map((g) => ({
      is_allowed: g.is_allowed ?? true,
      permission: { code: g.code, is_active: g.perm_active ?? true },
    })),
  };
  return { is_active: o.ur_active ?? true, expires_at: o.expires_at ?? null, role: o.asArray ? [role] : role };
}

/** 正式區 has_permission（逐字語意）：對一組指派與一個碼回傳 boolean。 */
function prodHasPermission(rows: RoleAssignment[], code: string) {
  return rows.some((ur) => {
    if (!ur.is_active) return false;
    if (ur.expires_at && !(Date.parse(ur.expires_at) > NOW)) return false;
    return (ur.role.role_permissions as any[]).some((rp) => rp.is_allowed && rp.permission.code === code && rp.permission.is_active);
  });
}
/** 舊版 hasPermission()：isAdminLikeUser 保底 → 否則走正式區 has_permission。 */
function legacyHasPermission(rows: RoleAssignment[], profileRole: string | null, code: string) {
  const adminLike =
    profileRole === 'admin' ||
    rows.some((ur) => ur.is_active && !(ur.expires_at && !(Date.parse(ur.expires_at) > NOW)) && ADMIN_LIKE_ROLE_CODES.includes(ur.role.code));
  return adminLike || prodHasPermission(rows, code);
}

describe('resolveAccess：逐項語意', () => {
  it('停用的角色（roles.is_active=false）仍然生效，與正式區 has_permission 一致', () => {
    const a = resolveAccess([assignment('r1', [{ code: 'x.view' }], { role_active: false })], 'member', NOW);
    expect(a.permissions.has('x.view')).toBe(true);
    expect(a.has('x.view')).toBe(true);
    expect(a.roleCodes.has('r1')).toBe(true);
    expect(a.isAdmin).toBe(false);
  });
  it('停用的管理員角色仍算管理員（舊版 isAdminLikeUser 不檢查 roles.is_active）', () => {
    const a = resolveAccess([assignment('admin_role', [], { role_active: false })], 'member', NOW);
    expect(a.isAdmin).toBe(true);
    expect(a.has('anything.at.all')).toBe(true);
  });
  it('profiles.role === admin 保底：沒有任何角色也是管理員（has 全 true），但 permissions 仍是空的（DB 端沒有繞過）', () => {
    const a = resolveAccess([], 'admin', NOW);
    expect(a.isAdmin).toBe(true);
    expect(a.has('x.view')).toBe(true);
    expect(a.permissions.size).toBe(0);
  });
  it('profiles.role 不是 admin（member／manager／null／undefined）不會變管理員', () => {
    for (const r of ['member', 'manager', 'Admin', '', null, undefined]) {
      const a = resolveAccess([], r as any, NOW);
      expect(a.isAdmin, String(r)).toBe(false);
      expect(a.has('x.view')).toBe(false);
    }
  });
  it('管理員類角色：isAdmin 為 true，但 permissions 只有明確授權的碼（不因 admin 多出碼）', () => {
    for (const code of ADMIN_LIKE_ROLE_CODES) {
      const a = resolveAccess([assignment(code, [{ code: 'x.view' }])], 'member', NOW);
      expect(a.isAdmin, code).toBe(true);
      expect(a.has('y.view'), code).toBe(true);
      expect([...a.permissions]).toEqual(['x.view']);
    }
  });
  it('過期的 user_roles 不生效；未過期與沒有期限生效；剛好到期（== now）視為過期', () => {
    const rows = [
      assignment('expired', [{ code: 'a' }], { expires_at: PAST }),
      assignment('future', [{ code: 'b' }], { expires_at: FUTURE }),
      assignment('forever', [{ code: 'c' }], { expires_at: null }),
      assignment('edge', [{ code: 'd' }], { expires_at: new Date(NOW).toISOString() }),
    ];
    const a = resolveAccess(rows, 'member', NOW);
    expect([...a.permissions].sort()).toEqual(['b', 'c']);
    expect(a.roleCodes.has('expired')).toBe(false);
  });
  it('過期的管理員角色不算管理員', () => {
    const a = resolveAccess([assignment('admin', [], { expires_at: PAST })], 'member', NOW);
    expect(a.isAdmin).toBe(false);
  });
  it('user_roles.is_active=false 不生效', () => {
    const a = resolveAccess([assignment('admin', [{ code: 'a' }], { ur_active: false })], 'member', NOW);
    expect(a.permissions.size).toBe(0);
    expect(a.isAdmin).toBe(false);
  });
  it('權限停用（permissions.is_active=false）、未允許（is_allowed=false）不進 permissions', () => {
    const a = resolveAccess(
      [assignment('r', [{ code: 'on' }, { code: 'off', perm_active: false }, { code: 'denied', is_allowed: false }])],
      'member',
      NOW,
    );
    expect([...a.permissions]).toEqual(['on']);
    expect(a.has('off')).toBe(false);
    expect(a.has('denied')).toBe(false);
  });
  it('PostgREST 把關聯包成陣列時也能解析；role 為 null 的指派被略過', () => {
    const a = resolveAccess([assignment('r', [{ code: 'a' }], { asArray: true }), { is_active: true, role: null }], 'member', NOW);
    expect([...a.permissions]).toEqual(['a']);
  });
  it('多個角色的權限取聯集', () => {
    const a = resolveAccess([assignment('r1', [{ code: 'a' }]), assignment('r2', [{ code: 'b' }], { role_active: false })], 'member', NOW);
    expect([...a.permissions].sort()).toEqual(['a', 'b']);
    expect(a.has('x', 'b')).toBe(true);
  });
});

describe('與舊版在正式區語意下的等價（參考實作逐項比對）', () => {
  const CODES = ['a', 'b', 'c', 'off', 'denied', 'zzz'];
  const roles = ['member_role', 'admin', 'owner_role', 'store_manager'];
  const variants: Partial<Parameters<typeof assignment>[2]>[] = [
    {},
    { role_active: false },
    { ur_active: false },
    { expires_at: PAST },
    { expires_at: FUTURE },
    { role_active: false, expires_at: PAST },
  ];
  const grants: Grant[] = [{ code: 'a' }, { code: 'off', perm_active: false }, { code: 'denied', is_allowed: false }, { code: 'b' }];

  it('單一指派：所有 角色碼 × 指派狀態 × profile.role × 權限碼 組合', () => {
    let n = 0;
    for (const roleCode of roles)
      for (const v of variants)
        for (const profileRole of ['member', 'admin', null]) {
          const rows = [assignment(roleCode, grants, v)];
          const a = resolveAccess(rows, profileRole, NOW);
          for (const code of CODES) {
            // ctx.has ＝ 舊版 hasPermission；ctx.permissions ＝ 正式區 has_permission（無 admin 繞過）
            expect(a.has(code), `${roleCode} ${JSON.stringify(v)} ${profileRole} ${code}`).toBe(legacyHasPermission(rows, profileRole, code));
            expect(a.permissions.has(code), `perm ${roleCode} ${JSON.stringify(v)} ${code}`).toBe(prodHasPermission(rows, code));
            n++;
          }
        }
    expect(n).toBeGreaterThan(400);
  });
  it('兩個指派的組合', () => {
    for (const v1 of variants)
      for (const v2 of variants) {
        const rows = [assignment('member_role', [{ code: 'a' }], v1), assignment('admin_role', [{ code: 'b' }], v2)];
        const a = resolveAccess(rows, 'member', NOW);
        for (const code of CODES) {
          expect(a.has(code)).toBe(legacyHasPermission(rows, 'member', code));
          expect(a.permissions.has(code)).toBe(prodHasPermission(rows, code));
        }
      }
  });
});

describe('接線', () => {
  const server = read('lib/workspace/server.ts');
  it('context() 用 resolveAccess；不再略過停用角色；profiles 一律連 role 一起查', () => {
    expect(server).toMatch(/from ["']\.\/permission-semantics["']/);
    expect(server).toMatch(/resolveAccess\(/);
    expect(server).not.toMatch(/role\?\.is_active/);
    expect(server).not.toMatch(/role:roles\(code,is_active/);
    expect(server).toMatch(/\.select\("id,full_name,role"\)/);
    expect(server).toMatch(/options\.profile === false/);
  });
  it('每月人員狀態 meta 仍用 ctx.permissions（不用 ctx.has），註解不再記載 roles.is_active 殘餘差異', () => {
    const meta = read('lib/workspace/monthly-meta.ts');
    expect(meta).toMatch(/viewAll: ctx\.permissions\.has\(CAMPAIGN_PERM\.viewAll\)/);
    expect(meta).not.toMatch(/已知殘餘差異/);
    expect(meta).toMatch(/permission-semantics/);
  });
  it('管理員類角色清單與舊版 lib/permissions/check.ts 的 isAdminLikeUser 相同', () => {
    const legacy = read('lib/permissions/check.ts');
    const block = legacy.slice(legacy.indexOf('return notExpired && ['), legacy.indexOf('].includes(roleCode)'));
    const codes = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect([...ADMIN_LIKE_ROLE_CODES].sort()).toEqual(codes);
    expect(legacy).toMatch(/profile\?\.role === 'admin'/);
  });
});

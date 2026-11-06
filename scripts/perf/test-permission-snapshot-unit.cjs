#!/usr/bin/env node
'use strict';
/**
 * 權限快照（lib/permissions/snapshot.ts）與舊 hasPermission（lib/permissions/check.ts）的離線窮舉比對。
 *
 * DEV 資料庫的 RLS 會讓一般使用者看不到自己 user_roles 內「非 admin」角色的 code，
 * 所以 DEV 整合測試測不到「管理員保底名單」的每個分支；這裡用記憶體假資料庫窮舉：
 *   profiles.role（admin / Admin / supervisor / null / 查不到）
 *   × 管理員保底名單內 8 個 code + 一般角色 code
 *   × roles.is_active、user_roles.is_active、expires_at（過期 / 未到期 / 空）
 *   × role_permissions.is_allowed、permissions.is_active、權限 code 相符與否
 * 對每個組合，比較「舊 hasPermission(userId, code)」與「snapshot.has(code)」必須相同。
 *
 * 舊 hasPermission 內的 RPC has_permission 以 DEV 基準 migration 的 SQL 語意在假資料庫裡重現
 * （supabase/migrations/20260722030244_dev_schema_baseline.sql）。不連資料庫。
 *
 * 用法：node scripts/perf/test-permission-snapshot-unit.cjs
 */
const { loadProjectModule } = require('./ms-harness.cjs');

const ADMIN_LIKE = ['admin', 'system_admin', 'admin_role', 'full_admin', 'full_admin_role', 'dev_full_admin', 'owner', 'owner_role'];
const NOW = Date.now();
const PAST = new Date(NOW - 86400000).toISOString();
const FUTURE = new Date(NOW + 86400000).toISOString();
const USER_ID = '00000000-0000-0000-0000-000000000001';
const TARGET = 'monthly.status.view_stats';

/** 世界：{ profile, rows:[{ ur:{is_active,expires_at}, role:{code,is_active}, perms:[{code,is_allowed,is_active}] }] } */
function makeDb(world, { userSeesRoles = true } = {}) {
  function builder(table, kind) {
    const filters = [];
    let selectStr = '';
    const b = {
      select(s) {
        selectStr = s;
        return b;
      },
      eq(col, val) {
        filters.push([col, val]);
        return b;
      },
      limit() {
        return b;
      },
      async maybeSingle() {
        if (table === 'profiles') return { data: world.profile, error: null };
        return { data: null, error: null };
      },
      then(resolve, reject) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    function run() {
      if (table !== 'user_roles') return { data: [], error: null };
      let rows = world.rows.filter((r) => filters.every(([c, v]) => (c === 'is_active' ? r.ur.is_active === v : true)));
      if (kind === 'user' && !userSeesRoles) return { data: [], error: null };
      if (selectStr.includes('role_permissions')) {
        return {
          data: rows.map((r) => ({
            expires_at: r.ur.expires_at,
            role: { code: r.role.code, is_active: r.role.is_active, role_permissions: r.perms.map((p) => ({ is_allowed: p.is_allowed, permission: { code: p.code, is_active: p.is_active } })) },
          })),
          error: null,
        };
      }
      return { data: rows.map((r) => ({ is_active: r.ur.is_active, expires_at: r.ur.expires_at, role: { code: r.role.code } })), error: null };
    }
    return b;
  }
  return {
    from: (t) => builder(t, 'user'),
    // 重現 DB has_permission（基準 migration）
    async rpc(name, args) {
      if (name !== 'has_permission') return { data: null, error: { message: 'unknown rpc' } };
      const code = args.p_permission_code;
      if (!code || String(code).trim() === '') return { data: false, error: null };
      const valid = world.rows.filter((r) => r.ur.is_active === true && (r.ur.expires_at === null || new Date(r.ur.expires_at).getTime() > NOW) && r.role.is_active === true);
      if (valid.some((r) => r.role.code === 'admin')) return { data: true, error: null };
      const ok = valid.some((r) => r.perms.some((p) => p.is_allowed === true && p.is_active === true && p.code === code));
      return { data: ok, error: null };
    },
    __admin: { from: (t) => builder(t, 'admin') },
  };
}

let total = 0;
let bad = 0;
async function compare(label, world, opts) {
  const db = makeDb(world, opts);
  const ctx = { user: db, admin: db.__admin };
  const oldMod = loadProjectModule('worktree', 'lib/permissions/check.ts', ctx);
  const snapMod = loadProjectModule('worktree', 'lib/permissions/snapshot.ts', ctx);
  const snap = await snapMod.loadPermissionSnapshot(db, db.__admin, USER_ID);
  for (const code of [TARGET, 'monthly.status.confirm', 'unknown.perm.code', '']) {
    total += 1;
    const o = await oldMod.hasPermission(USER_ID, code);
    const n = snap.has(code);
    if (o !== n) {
      bad += 1;
      if (bad <= 20) console.log(`不一致 ${label} code=${JSON.stringify(code)} 舊=${o} 新=${n}`);
    }
  }
}

(async () => {
  const origErr = console.error;
  console.error = () => {};
  const profiles = [{ role: 'admin' }, { role: 'Admin' }, { role: 'supervisor' }, { role: null }, null];
  const roleCodes = [...ADMIN_LIKE, 'store_manager', 'perf_custom'];
  const expiries = [null, PAST, FUTURE];
  const bools = [true, false];
  let n = 0;
  for (const profile of profiles) {
    for (const code of roleCodes) {
      for (const roleActive of bools) {
        for (const urActive of bools) {
          for (const expires of expiries) {
            for (const allowed of bools) {
              for (const permActive of bools) {
                for (const permCode of [TARGET, 'other.perm']) {
                  const world = {
                    profile: profile && { ...profile, department: null, job_title: null },
                    rows: [{ ur: { is_active: urActive, expires_at: expires }, role: { code, is_active: roleActive }, perms: [{ code: permCode, is_allowed: allowed, is_active: permActive }] }],
                  };
                  n += 1;
                  await compare(`profile=${JSON.stringify(profile)} role=${code} roleActive=${roleActive} urActive=${urActive} exp=${expires && (expires === PAST ? 'past' : 'future')} allowed=${allowed} permActive=${permActive} permCode=${permCode}`, world);
                  // RLS 讓使用者看不到自己的 user_roles（DEV 的實際情形）：管理員保底只剩 profiles.role
                  if (n % 7 === 0) await compare(`(rls-hidden) ${code} ${roleActive} ${urActive} ${expires} ${allowed} ${permActive} ${permCode}`, world, { userSeesRoles: false });
                }
              }
            }
          }
        }
      }
    }
  }
  // 多角色聯集：一個過期、一個不允許、一個有效
  await compare('multi-role union', {
    profile: { role: null, department: null, job_title: null },
    rows: [
      { ur: { is_active: true, expires_at: PAST }, role: { code: 'a', is_active: true }, perms: [{ code: TARGET, is_allowed: true, is_active: true }] },
      { ur: { is_active: true, expires_at: null }, role: { code: 'b', is_active: true }, perms: [{ code: TARGET, is_allowed: false, is_active: true }, { code: 'monthly.status.confirm', is_allowed: true, is_active: true }] },
    ],
  });
  console.error = origErr;
  console.log(`世界 ${n} 種、比對 ${total} 項，不一致 ${bad} 項`);
  if (bad) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

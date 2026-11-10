#!/usr/bin/env node
'use strict';
/**
 * 員工管理進入條件：DEV 整合測試（只連 DEV，ref 守衛在 dev-env.cjs）。
 *
 * 建立測試帳號與只含 employee.manage 的測試角色，用「真正的」路由程式（每月人數統計 API、
 * 員工管理權限 API），以各帳號的真實 session 呼叫，驗證：
 *   admin 可進；有 employee.manage 但部門非營業／職稱督導／店長 → 可進；
 *   營業部主管／助理但沒有 employee.manage → 403；RPC 錯誤 → 403。
 * 結束刪除自己建立的帳號、角色與指派，並檢查孤兒為 0。
 *
 * 用法：node scripts/perf/test-employee-management-access-dev.cjs
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { loadDevEnv } = require('./dev-env.cjs');
const { loadProjectModule, makeServiceClient, makeUserClient } = require('./ms-harness.cjs');
const { createClient } = require('@supabase/supabase-js');

const ENV = loadDevEnv();
const db = makeServiceClient(ENV);
const PREFIX_EMAIL = 'emaccess-';
const PREFIX_ROLE = 'EMACCESS-';
const HEADCOUNT_ROUTE = 'app/api/admin/position-headcount/route.ts';
const ACCESS_ROUTE = 'app/api/admin/employee-management/access/route.ts';

const SCENARIOS = {
  admin: { dept: '行政部', title: '專員', role: 'admin', perm: false, expect: true },
  perm_nonbiz: { dept: '行政部', title: '專員', role: 'member', perm: true, expect: true },
  perm_supervisor_title: { dept: '營業部', title: '督導', role: 'manager', perm: true, expect: true },
  perm_store_manager_title: { dept: '營業部', title: '店長', role: 'member', perm: true, expect: true },
  biz_manager_noperm: { dept: '營業部', title: '經理', role: 'manager', perm: false, expect: false },
  biz_member_noperm: { dept: '營業一部', title: '助理', role: 'member', perm: false, expect: false },
  other_perm_only: { dept: '行政部', title: '專員', role: 'member', perm: false, otherPerm: 'store.manage', expect: false },
};

const results = [];
let failed = 0;
async function record(name, fn) {
  try {
    await fn();
    results.push(`通過  ${name}`);
  } catch (e) {
    failed += 1;
    results.push(`失敗  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`);
  }
}

async function must(p, what) {
  const r = await p;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

function anonClient() {
  return createClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function cleanup() {
  const log = [];
  const { data: profs } = await db.from('profiles').select('id').like('email', `${PREFIX_EMAIL}%@example.test`);
  const uids = (profs || []).map((p) => p.id);
  if (uids.length) await db.from('user_roles').delete().in('user_id', uids);
  const { data: roles } = await db.from('roles').select('id').like('description', `${PREFIX_ROLE}%`);
  const roleIds = (roles || []).map((r) => r.id);
  if (roleIds.length) {
    await db.from('user_roles').delete().in('role_id', roleIds);
    await db.from('role_permissions').delete().in('role_id', roleIds);
    await db.from('roles').delete().in('id', roleIds);
  }
  for (let page = 1; ; page++) {
    const r = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (r.error) { log.push(r.error.message); break; }
    for (const u of r.data.users || []) {
      if (u.email && u.email.startsWith(PREFIX_EMAIL) && u.email.endsWith('@example.test')) {
        const d = await db.auth.admin.deleteUser(u.id);
        if (d.error) log.push(d.error.message);
      }
    }
    if ((r.data.users || []).length < 200) break;
  }
  return log;
}

async function main() {
  await cleanup(); // 清掉上次中斷可能殘留的
  const created = [];
  try {
    const perms = await must(db.from('permissions').select('id,code').in('code', ['employee.manage', 'store.manage']), '讀取 permissions');
    const pid = Object.fromEntries(perms.map((p) => [p.code, p.id]));
    assert.ok(pid['employee.manage'], 'DEV 找不到 employee.manage');
    const mkRole = async (suffix, code) => {
      const role = await must(
        db.from('roles').insert({ name: `${PREFIX_ROLE}${suffix}`, code: `${PREFIX_ROLE.toLowerCase()}${suffix}`, description: `${PREFIX_ROLE}test`, is_system: false, is_active: true }).select('id').single(),
        `建立角色 ${suffix}`,
      );
      await must(db.from('role_permissions').insert({ role_id: role.id, permission_id: pid[code], is_allowed: true }), `角色權限 ${suffix}`);
      return role.id;
    };
    const roleManage = await mkRole('manage', 'employee.manage');
    const roleOther = await mkRole('other', 'store.manage');

    const users = {};
    for (const [key, sc] of Object.entries(SCENARIOS)) {
      const email = `${PREFIX_EMAIL}${key.replace(/_/g, '-')}@example.test`;
      const password = crypto.randomBytes(18).toString('base64url') + 'aA1!';
      const c = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `EMACCESS ${key}` } });
      if (c.error) throw new Error(`建立帳號 ${key}: ${c.error.message}`);
      const id = c.data.user.id;
      created.push(id);
      await must(db.from('profiles').update({ department: sc.dept, job_title: sc.title, role: sc.role }).eq('id', id), `profile ${key}`);
      if (sc.perm) await must(db.from('user_roles').insert({ user_id: id, role_id: roleManage, is_active: true }), `user_roles ${key}`);
      if (sc.otherPerm) await must(db.from('user_roles').insert({ user_id: id, role_id: roleOther, is_active: true }), `user_roles ${key}`);
      let session = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        const r = await anonClient().auth.signInWithPassword({ email, password });
        if (!r.error) { session = r.data.session; break; }
        if (/rate limit/i.test(r.error.message)) { await new Promise((res) => setTimeout(res, 15000)); continue; }
        throw new Error(`登入 ${key}: ${r.error.message}`);
      }
      assert.ok(session, `登入 ${key} 失敗`);
      users[key] = { id, session };
    }

    const status = async (route, user, rename) => {
      let client = await makeUserClient(ENV, user.session);
      if (rename) {
        const base = client;
        client = new Proxy(base, {
          get: (t, p) => (p === 'rpc' ? (n, ...a) => t.rpc(rename[n] || n, ...a) : typeof t[p] === 'function' ? t[p].bind(t) : t[p]),
        });
      }
      const GET = loadProjectModule('worktree', route, { user: client, admin: db }).GET;
      const res = await GET(new Request('http://localhost/api?month=2099-01'));
      return res.status;
    };

    for (const [key, sc] of Object.entries(SCENARIOS)) {
      const want = sc.expect ? 200 : 403;
      await record(`每月人數統計 API：${key}（${sc.dept}/${sc.role}/${sc.title}）→ ${want}`, async () => {
        assert.equal(await status(HEADCOUNT_ROUTE, users[key]), want);
      });
      await record(`員工管理權限 API：${key} → ${want}`, async () => {
        assert.equal(await status(ACCESS_ROUTE, users[key]), want);
      });
    }

    // RPC 錯誤：把 has_permission 改呼叫不存在的函式，有權限的非 admin 帳號也必須被擋（錯誤不得變成放行）
    const origError = console.error;
    console.error = () => {};
    try {
      const bad = { has_permission: 'em_access_no_such_fn' };
      await record('RPC 錯誤：有 employee.manage 的非 admin 帳號 → 403（每月人數統計 API）', async () => {
        assert.equal(await status(HEADCOUNT_ROUTE, users.perm_nonbiz, bad), 403);
      });
      await record('RPC 錯誤：員工管理權限 API → 403', async () => {
        assert.equal(await status(ACCESS_ROUTE, users.perm_nonbiz, bad), 403);
      });
      await record('RPC 錯誤：admin 不受影響（應用層一律可進）', async () => {
        assert.equal(await status(HEADCOUNT_ROUTE, users.admin, bad), 200);
      });
    } finally {
      console.error = origError;
    }

    await record('未登入 → 401', async () => {
      const GET = loadProjectModule('worktree', HEADCOUNT_ROUTE, { user: anonClient(), admin: db }).GET;
      const res = await GET(new Request('http://localhost/api?month=2099-01'));
      assert.equal(res.status, 401);
    });

    await record('撤銷 employee.manage 後同一帳號變 403，再給回去又 200', async () => {
      const u = users.perm_nonbiz;
      await must(db.from('user_roles').delete().eq('user_id', u.id), '撤銷');
      assert.equal(await status(HEADCOUNT_ROUTE, u), 403);
      await must(db.from('user_roles').insert({ user_id: u.id, role_id: roleManage, is_active: true }), '還原');
      assert.equal(await status(HEADCOUNT_ROUTE, u), 200);
    });
  } finally {
    const log = await cleanup();
    const { count: p } = await db.from('profiles').select('id', { count: 'exact', head: true }).like('email', `${PREFIX_EMAIL}%@example.test`);
    const { count: r } = await db.from('roles').select('id', { count: 'exact', head: true }).like('description', `${PREFIX_ROLE}%`);
    const ids = created.length ? created : ['00000000-0000-0000-0000-000000000000'];
    const { count: ur } = await db.from('user_roles').select('id', { count: 'exact', head: true }).in('user_id', ids);
    console.log(results.join('\n'));
    console.log(`清理：${log.length ? log.join('; ') : '無錯誤'}；孤兒檢查：測試帳號=${p}、測試角色=${r}、user_roles=${ur}`);
    if (log.length || p || r || ur) process.exitCode = 1;
  }
  console.log(failed ? `失敗 ${failed} 項` : '全部通過');
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error('測試中斷：', e.message);
  process.exit(1);
});

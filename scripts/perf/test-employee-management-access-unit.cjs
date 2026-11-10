#!/usr/bin/env node
'use strict';
/**
 * 員工管理進入條件（lib/monthly-staff/employee-management-access.ts）表格驅動單元測試。不連資料庫。
 * 載入真正的 lib/permissions/check.ts，底層 supabase client 換成假的，可控制 has_permission 回傳／錯誤。
 * 用法：node scripts/perf/test-employee-management-access-unit.cjs
 */
const assert = require('node:assert/strict');
const { loadProjectModule } = require('./ms-harness.cjs');

// 假 client：profiles / user_roles 查詢回空（沒有保底管理員角色），rpc 依 state 回傳
const state = { rpcResult: { data: false, error: null }, rpcThrows: false, rpcCalls: [] };
function chain(result) {
  const p = {
    select: () => p, eq: () => p, in: () => p,
    maybeSingle: async () => result, single: async () => result,
    then: (res, rej) => Promise.resolve(result).then(res, rej),
  };
  return p;
}
const fake = {
  from: (t) => chain(t === 'user_roles' ? { data: [], error: null } : { data: null, error: null }),
  rpc: async (name, args) => {
    state.rpcCalls.push([name, args]);
    if (state.rpcThrows) throw new Error('rpc boom');
    return state.rpcResult;
  },
};
const ctx = { user: fake, admin: fake };
const A = loadProjectModule('worktree', 'lib/monthly-staff/employee-management-access.ts', ctx);

let passed = 0;
const failures = [];
async function t(name, fn) {
  try {
    state.rpcCalls = [];
    state.rpcThrows = false;
    state.rpcResult = { data: false, error: null };
    await fn();
    passed += 1;
  } catch (e) {
    failures.push(`${name}\n    ${e.message.split('\n').join('\n    ')}`);
  }
}

const GRANT = { data: true, error: null };

(async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    await t('admin（profiles.role）不查權限也可進', async () => {
      assert.equal(await A.canAccessEmployeeManagement('u1', { role: 'admin' }), true);
      assert.equal(state.rpcCalls.length, 0);
    });
    await t('admin 即使 RPC 會出錯也可進', async () => {
      state.rpcThrows = true;
      assert.equal(await A.canAccessEmployeeManagement('u1', { role: 'admin' }), true);
    });
    const withPerm = [
      ['行政部 member，有 employee.manage', { role: 'member', department: '行政部', job_title: '專員' }],
      ['營業部 manager 職稱督導，有 employee.manage', { role: 'manager', department: '營業部', job_title: '督導' }],
      ['營業部 member 職稱店長，有 employee.manage', { role: 'member', department: '營業部', job_title: '店長' }],
      ['沒有部門／職稱，有 employee.manage', { role: 'member' }],
      ['profile 讀不到（null），有 employee.manage', null],
    ];
    for (const [name, p] of withPerm) {
      await t(`${name} → 可進`, async () => {
        state.rpcResult = GRANT;
        assert.equal(await A.canAccessEmployeeManagement('u1', p), true);
        assert.deepEqual(state.rpcCalls[0], ['has_permission', { p_user_id: 'u1', p_permission_code: 'employee.manage' }]);
      });
    }
    const noPerm = [
      ['營業部 member 助理', { role: 'member', department: '營業部', job_title: '助理' }],
      ['營業一部 manager 經理', { role: 'manager', department: '營業一部', job_title: '經理' }],
      ['行政部 member', { role: 'member', department: '行政部' }],
      ['Admin 大小寫不同（不是 admin）', { role: 'Admin' }],
      ['null profile', null],
    ];
    for (const [name, p] of noPerm) {
      await t(`${name}，沒有 employee.manage → 不可進`, async () => {
        assert.equal(await A.canAccessEmployeeManagement('u1', p), false);
      });
    }
    await t('RPC 回傳 error → 不可進', async () => {
      state.rpcResult = { data: null, error: { message: 'function not found' } };
      assert.equal(await A.canAccessEmployeeManagement('u1', { role: 'manager', department: '營業部' }), false);
    });
    await t('RPC 回 error 但同時帶 data:true → 仍不可進', async () => {
      state.rpcResult = { data: true, error: { message: 'weird' } };
      assert.equal(await A.canAccessEmployeeManagement('u1', { role: 'member' }), false);
    });
    await t('RPC 丟例外 → 不可進', async () => {
      state.rpcThrows = true;
      assert.equal(await A.canAccessEmployeeManagement('u1', { role: 'member' }), false);
    });
    await t('RPC 回傳非 true（null / 字串）→ 不可進', async () => {
      state.rpcResult = { data: null, error: null };
      assert.equal(await A.canAccessEmployeeManagement('u1', { role: 'member' }), false);
      state.rpcResult = { data: 'true', error: null };
      assert.equal(await A.canAccessEmployeeManagement('u1', { role: 'member' }), false);
    });
    await t('沒有 userId → 不可進（即使 profile 是 admin）', async () => {
      assert.equal(await A.canAccessEmployeeManagement(null, { role: 'admin' }), false);
      assert.equal(await A.canAccessEmployeeManagement(undefined, null), false);
    });
  } finally {
    console.error = origError;
  }
  console.log(`通過 ${passed} 項`);
  if (failures.length) {
    console.error(`失敗 ${failures.length} 項：\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('全部通過');
})();

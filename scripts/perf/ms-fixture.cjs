'use strict';
/**
 * 每月人員狀態加速：DEV 測試資料（帳號 / 角色 / 保留月份 2099-01 的資料）。
 *
 * 只動：
 *   - email 為 perf-ms-*@example.test 的測試帳號、description 為 perf_ms_test 的測試角色（用完刪除）
 *   - 測試門市 VW001/VW002/ZT01~ZT05 在保留月份 2099-01 的資料（用完刪除）
 *   - ZT05 的 is_franchise 暫時設為 true（用來驗證加盟店業績排除邏輯），結束時還原
 * 不碰任何既有帳號與正式資料。
 */
const crypto = require('node:crypto');

const PREFIX_EMAIL = 'perf-ms-';
const PREFIX_ROLE = 'perf_ms_';
const YM = '2099-01';
const FRANCHISE_STORE = 'ZT05';

const MONTHLY = {
  viewAll: 'monthly.status.view_all',
  viewOwn: 'monthly.status.view_own',
  stats: 'monthly.status.view_stats',
  supView: 'monthly.allowance.view_support_hours',
  supEdit: 'monthly.allowance.edit_support_hours',
  bonusEdit: 'monthly.allowance.edit_support_bonus',
  addEmp: 'monthly.status.add_employee',
  perf: 'monthly.status.view_performance',
  bonusDetail: 'monthly.status.bonus_detail.view',
  confirm: 'monthly.status.confirm',
  revert: 'monthly.status.revert',
  unconfirm: 'monthly.status.unconfirm',
  exportDl: 'monthly.export.download',
};
const CAMPAIGN = { all: 'activity.campaign.view_all', own: 'activity.campaign.view_own', legacy: 'activity.campaign.view' };
const ALL_MONTHLY = Object.values(MONTHLY);

const PAST = '2000-01-01T00:00:00Z';
const FUTURE = '2999-01-01T00:00:00Z';

/**
 * 帳號情境。
 *  profile: { role, dept, title }
 *  roles: [{ existing: '<既有角色 code>' } | { perms: [...], roleActive, urActive, expires, allowed, code }]
 *  appts: [[門市代碼, role_type]]
 */
function buildScenarios() {
  const S = {};
  const add = (key, spec) => {
    S[key] = { profile: {}, roles: [], appts: [], ...spec };
  };

  // --- 管理員類
  add('admin_profile_only', { desc: 'profiles.role=admin、沒有任何 user_roles', profile: { role: 'admin' } });
  add('admin_role_real', { desc: '既有 admin 角色', roles: [{ existing: 'admin' }] });
  add('admin_like_dev_full_admin', { desc: '既有 dev_full_admin 角色（管理員保底名單）', roles: [{ existing: 'dev_full_admin' }] });
  add('admin_like_role_inactive', { desc: '管理員保底角色但 roles.is_active=false（舊程式保底仍放行）', roles: [{ code: 'owner_role', perms: [], roleActive: false }] });
  add('admin_like_ur_expired', { desc: '管理員保底角色但 user_roles 已過期（不放行）', roles: [{ code: 'full_admin', perms: [], expires: PAST }] });
  add('admin_like_ur_future', { desc: '管理員保底角色，user_roles 未到期（放行）', roles: [{ code: 'system_admin', perms: [], expires: FUTURE }] });
  add('admin_like_ur_inactive', { desc: '管理員保底角色但 user_roles.is_active=false（不放行）', roles: [{ code: 'owner', perms: [], urActive: false }] });
  add('profile_admin_upper', { desc: 'profiles.role=Admin（大小寫不同，舊程式不放行）', profile: { role: 'Admin' } });
  add('profile_supervisor_role', { desc: 'profiles.role=supervisor、無 RBAC', profile: { role: 'supervisor' }, appts: [['ZT01', 'supervisor']] });

  // --- 業務角色
  add('store_manager_real', { desc: '既有 store_manager 角色 + VW001 店長任命', profile: { title: '店長' }, roles: [{ existing: 'store_manager' }], appts: [['VW001', 'store_manager']] });
  add('store_manager_full', {
    desc: '店長（自訂完整月結權限）+ VW001',
    profile: { title: '店長' },
    roles: [{ perms: [MONTHLY.viewOwn, MONTHLY.stats, MONTHLY.supView, MONTHLY.supEdit, MONTHLY.bonusEdit, MONTHLY.perf, MONTHLY.confirm, CAMPAIGN.own] }],
    appts: [['VW001', 'store_manager']],
  });
  add('store_manager_dual', { desc: '雙店長 VW001+VW002', profile: { title: '店長' }, roles: [{ perms: [MONTHLY.viewOwn, MONTHLY.stats, CAMPAIGN.own] }], appts: [['VW001', 'store_manager'], ['VW002', 'store_manager']] });
  add('supervisor_multi', {
    desc: '督導 ZT01/ZT02/VW002（view_own + 活動）',
    profile: { title: '督導' },
    roles: [{ perms: [MONTHLY.viewOwn, MONTHLY.stats, MONTHLY.perf, MONTHLY.supView, CAMPAIGN.own, CAMPAIGN.legacy] }],
    appts: [['ZT01', 'supervisor'], ['ZT02', 'supervisor'], ['VW002', 'store_manager']],
  });
  add('supervisor_real', { desc: '既有 manager 角色 + ZT01 督導', profile: { title: '督導' }, roles: [{ existing: 'manager' }], appts: [['ZT01', 'supervisor']] });
  add('view_all_user', { desc: 'view_all 持有者（無任命）', roles: [{ perms: [MONTHLY.viewAll, MONTHLY.stats, MONTHLY.perf, MONTHLY.confirm, MONTHLY.revert, MONTHLY.unconfirm, MONTHLY.exportDl, MONTHLY.bonusDetail, CAMPAIGN.all] }] });
  add('view_all_and_own', { desc: 'view_all + view_own + 任命', roles: [{ perms: [MONTHLY.viewAll, MONTHLY.viewOwn] }], appts: [['VW001', 'store_manager']] });
  add('general_member', { desc: '一般員工（既有 member 角色）', roles: [{ existing: 'member' }] });
  add('no_access_role', { desc: '既有 no_access 角色', roles: [{ existing: 'no_access' }] });
  add('no_roles_at_all', { desc: '完全沒有角色與任命' });
  add('no_roles_with_appt', { desc: '沒有角色，但有任命', appts: [['VW001', 'store_manager']] });

  // --- 角色狀態邊界
  add('role_inactive', { desc: '角色 is_active=false（持完整權限）', roles: [{ perms: ALL_MONTHLY, roleActive: false }], appts: [['VW001', 'store_manager']] });
  add('ur_inactive', { desc: 'user_roles.is_active=false', roles: [{ perms: ALL_MONTHLY, urActive: false }], appts: [['VW001', 'store_manager']] });
  add('ur_expired', { desc: 'user_roles 已過期', roles: [{ perms: ALL_MONTHLY, expires: PAST }], appts: [['VW001', 'store_manager']] });
  add('ur_not_yet_expired', { desc: 'user_roles 未到期', roles: [{ perms: ALL_MONTHLY, expires: FUTURE }], appts: [['VW001', 'store_manager']] });
  add('rp_not_allowed', { desc: 'role_permissions.is_allowed=false', roles: [{ perms: ALL_MONTHLY, allowed: false }], appts: [['VW001', 'store_manager']] });
  add('multi_role_union', {
    desc: '三個角色權限聯集（其中一個過期）',
    roles: [{ perms: [MONTHLY.viewOwn, MONTHLY.stats] }, { perms: [MONTHLY.confirm, MONTHLY.revert] }, { perms: [MONTHLY.unconfirm], expires: PAST }],
    appts: [['ZT03', 'store_manager']],
  });

  // --- 活動入口
  add('campaign_own_with_appt', { desc: 'campaign view_own + 有任命', roles: [{ perms: [CAMPAIGN.own] }], appts: [['VW001', 'store_manager']] });
  add('campaign_own_no_appt', { desc: 'campaign view_own + 無任命', roles: [{ perms: [CAMPAIGN.own] }] });
  add('campaign_own_inventory_dept', { desc: 'campaign view_own + 盤點組', profile: { dept: '營業部-盤點組' }, roles: [{ perms: [CAMPAIGN.own] }] });
  add('campaign_legacy_with_appt', { desc: 'campaign 舊 view + 有任命', roles: [{ perms: [CAMPAIGN.legacy] }], appts: [['VW001', 'store_manager']] });
  add('campaign_legacy_no_appt', { desc: 'campaign 舊 view + 無任命', roles: [{ perms: [CAMPAIGN.legacy] }] });
  add('campaign_all_only', { desc: 'campaign view_all', roles: [{ perms: [CAMPAIGN.all] }] });

  // --- 單一權限帳號（各一份有 VW001 店長任命、一份無任命）
  for (const [name, code] of Object.entries(MONTHLY)) {
    add(`single_${name}`, { desc: `單一權限 ${code}（+VW001 店長任命）`, roles: [{ perms: [code] }], appts: [['VW001', 'store_manager']] });
    add(`single_${name}_noappt`, { desc: `單一權限 ${code}（無任命）`, roles: [{ perms: [code] }] });
  }
  return S;
}

async function cleanupAll(admin) {
  const log = [];
  const del = async (what, q) => {
    const r = await q;
    if (r.error && r.error.code !== '42P01') log.push(`${what}: ${r.error.message}`);
  };
  // 保留月份資料
  const { data: staff } = await admin.from('monthly_staff_status').select('id').like('year_month', '2099-%');
  const staffIds = (staff || []).map((s) => s.id);
  if (staffIds.length) await del('monthly_performance_details', admin.from('monthly_performance_details').delete().in('staff_status_id', staffIds));
  await del('monthly_staff_status', admin.from('monthly_staff_status').delete().like('year_month', '2099-%'));
  await del('monthly_store_summary', admin.from('monthly_store_summary').delete().like('year_month', '2099-%'));
  await del('support_staff_bonus', admin.from('support_staff_bonus').delete().like('year_month', '2099-%'));

  // 帳號 / 任命 / 角色
  const { data: profs } = await admin.from('profiles').select('id').like('email', `${PREFIX_EMAIL}%@example.test`);
  const uids = (profs || []).map((p) => p.id);
  if (uids.length) {
    await del('store_managers', admin.from('store_managers').delete().in('user_id', uids));
    await del('user_roles', admin.from('user_roles').delete().in('user_id', uids));
  }
  const { data: roles } = await admin.from('roles').select('id').like('description', `${PREFIX_ROLE}%`);
  const roleIds = (roles || []).map((r) => r.id);
  if (roleIds.length) {
    await del('user_roles(role)', admin.from('user_roles').delete().in('role_id', roleIds));
    await del('role_permissions', admin.from('role_permissions').delete().in('role_id', roleIds));
    await del('roles', admin.from('roles').delete().in('id', roleIds));
  }
  let page = 1;
  for (;;) {
    const r = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (r.error) {
      log.push(`listUsers: ${r.error.message}`);
      break;
    }
    for (const u of r.data.users || []) {
      if (u.email && u.email.startsWith(PREFIX_EMAIL) && u.email.endsWith('@example.test')) {
        const d = await admin.auth.admin.deleteUser(u.id);
        if (d.error) log.push(`deleteUser: ${d.error.message}`);
      }
    }
    if ((r.data.users || []).length < 200) break;
    page += 1;
  }
  return log;
}

async function must(p, what) {
  const r = await p;
  if (r.error) throw new Error(`${what} 失敗：${r.error.message}`);
  return r.data;
}

/**
 * 建立資料。回傳 { users: {key:{id,email,password,session}}, stores:{code:{id}}, franchisePrev }。
 * opts.scenarios：只建立指定情境（預設全部）。
 */
async function setup(env, admin, anonClientFactory, opts = {}) {
  const scenarios = buildScenarios();
  const keys = opts.scenarios || Object.keys(scenarios);

  const stCodes = ['VW001', 'VW002', 'ZT01', 'ZT02', 'ZT03', 'ZT04', FRANCHISE_STORE];
  const stRows = await must(admin.from('stores').select('id,store_code,store_name,is_franchise,is_active').in('store_code', stCodes), '讀取測試門市');
  const stores = {};
  for (const c of stCodes) {
    const s = stRows.find((x) => x.store_code === c);
    if (!s) throw new Error(`DEV 缺少測試門市 ${c}`);
    stores[c] = { id: s.id, name: s.store_name, isFranchise: s.is_franchise };
  }

  // 啟動前先清掉殘留（上次失敗）
  const pre = await cleanupAll(admin);
  if (pre.length) console.warn('[fixture] 清除殘留警告：', pre.join('; '));

  // 加盟店（暫時）
  const franchisePrev = stores[FRANCHISE_STORE].isFranchise;
  const fx = { users: {}, stores, franchisePrev, scenarios };
  await must(admin.from('stores').update({ is_franchise: true }).eq('id', stores[FRANCHISE_STORE].id), '設定測試加盟店');

  try {
    // 權限 / 既有角色
    const allPerms = await must(admin.from('permissions').select('id,code'), '讀取 permissions');
    const permId = Object.fromEntries(allPerms.map((p) => [p.code, p.id]));
    const existingRoles = await must(admin.from('roles').select('id,code'), '讀取 roles');
    const existingRoleId = Object.fromEntries(existingRoles.map((r) => [r.code, r.id]));

    const users = fx.users;
    const usedCodes = new Set();
    let roleSeq = 0;
    const jobs = keys.map((key) => async () => {
      const sc = scenarios[key];
      const email = `${PREFIX_EMAIL}${key.toLowerCase().replace(/_/g, '-')}@example.test`;
      const password = crypto.randomBytes(18).toString('base64url') + 'aA1!';
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `PERF ${key}` } });
      if (created.error) throw new Error(`建立帳號 ${key} 失敗：${created.error.message}`);
      const uid = created.data.user.id;
      users[key] = { id: uid, email, password, desc: sc.desc };
      await must(
        admin.from('profiles').update({ department: sc.profile.dept ?? null, job_title: sc.profile.title ?? null, role: sc.profile.role ?? 'member' }).eq('id', uid),
        `profile ${key}`
      );
      for (const r of sc.roles) {
        let roleId;
        if (r.existing) {
          roleId = existingRoleId[r.existing];
          if (!roleId) throw new Error(`DEV 缺少既有角色 ${r.existing}`);
        } else {
          // 管理員保底名單的 code：DEV 已有就沿用既有角色，沒有才建立（description 帶前綴供清除）
          if (r.code && existingRoleId[r.code]) {
            throw new Error(`既有角色 ${r.code} 不可借用於邊界情境，請改用其他 code`);
          }
          roleSeq += 1;
          const code = r.code && !usedCodes.has(r.code) ? r.code : `${PREFIX_ROLE}${key.toLowerCase()}_${roleSeq}`;
          if (r.code) usedCodes.add(r.code);
          const row = await must(
            admin
              .from('roles')
              .insert({ name: `PERF ${key} ${roleSeq}`, code, description: `${PREFIX_ROLE}test`, is_system: false, is_active: r.roleActive !== false })
              .select('id')
              .single(),
            `建立角色 ${key}`
          );
          roleId = row.id;
          if (r.perms && r.perms.length) {
            const rows = r.perms.filter((c) => permId[c]).map((c) => ({ role_id: roleId, permission_id: permId[c], is_allowed: r.allowed !== false }));
            if (rows.length) await must(admin.from('role_permissions').insert(rows), `角色權限 ${key}`);
          }
        }
        await must(
          admin.from('user_roles').insert({ user_id: uid, role_id: roleId, is_active: r.urActive !== false, expires_at: r.expires || null }),
          `user_roles ${key}`
        );
      }
      if (sc.appts.length) {
        await must(
          admin.from('store_managers').insert(sc.appts.map(([code, type], i) => ({ user_id: uid, store_id: stores[code].id, role_type: type, is_primary: i === 0 }))),
          `store_managers ${key}`
        );
      }
    });
    // 分批執行避免打爆 auth rate limit
    for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map((j) => j()));

    // 登入
    const loginJobs = Object.entries(users).map(([key, u]) => async () => {
      const c = anonClientFactory();
      const r = await c.auth.signInWithPassword({ email: u.email, password: u.password });
      if (r.error) throw new Error(`登入 ${key} 失敗：${r.error.message}`);
      u.session = r.data.session;
    });
    for (let i = 0; i < loginJobs.length; i += 6) await Promise.all(loginJobs.slice(i, i + 6).map((j) => j()));

    // 保留月份資料
    const sumRows = ['VW001', 'VW002', 'ZT01', 'ZT02', 'ZT03', 'ZT04'].map((c, i) => ({
      year_month: YM,
      store_id: stores[c].id,
      total_employees: i + 1,
      confirmed_count: 0,
      store_status: i % 2 ? 'in_progress' : 'pending',
      total_staff_count: 5 + i,
      admin_staff_count: 1,
      newbie_count: i,
      business_days: 26,
      total_gross_profit: 100000 + i * 1000,
      total_customer_count: 2000 + i,
      prescription_addon_only_count: 10,
      regular_prescription_count: 100 + i,
      chronic_prescription_count: 50 + i,
      support_to_other_stores_hours: 1.5 * i,
      support_from_other_stores_hours: 2 * i,
    }));
    await must(admin.from('monthly_store_summary').insert(sumRows), '建立測試月度摘要');

    const staffRows = [];
    for (const [sc, n] of [['VW001', 5], ['VW002', 3], ['ZT01', 2]]) {
      for (let i = 1; i <= n; i++) {
        staffRows.push({
          year_month: YM,
          store_id: stores[sc].id,
          employee_code: `PERF${sc.slice(-2)}${i}`,
          employee_name: `測試員工${sc}-${i}`,
          position: i === 1 ? '店長' : '專員',
          employment_type: 'full_time',
          is_pharmacist: false,
          monthly_status: 'full_month',
          work_days: 31,
          total_days_in_month: 31,
          status: 'draft',
          transaction_count: 100 * i,
          sales_amount: 10000 * i,
          gross_profit: 3000 * i,
          gross_profit_rate: 30,
          is_acting_manager: i === 2,
        });
      }
    }
    const insertedStaff = await must(admin.from('monthly_staff_status').insert(staffRows).select('id,store_id,employee_code'), '建立測試人員狀態');
    const vw1 = insertedStaff.filter((s) => s.store_id === stores.VW001.id);
    const detailRows = [];
    for (const s of vw1.slice(0, 3)) {
      detailRows.push({ staff_status_id: s.id, store_code: 'VW001', store_name: 'VW', transaction_count: 10, sales_amount: 1000.55, gross_profit: 300.25 });
      detailRows.push({ staff_status_id: s.id, store_code: FRANCHISE_STORE, store_name: 'ZT5', transaction_count: 7, sales_amount: 777, gross_profit: 77 });
      detailRows.push({ staff_status_id: s.id, store_code: 'ZT01', store_name: 'ZT1', transaction_count: 3, sales_amount: 333, gross_profit: 33 });
    }
    await must(admin.from('monthly_performance_details').insert(detailRows), '建立測試業績明細');
    await must(
      admin.from('support_staff_bonus').insert([
        { year_month: YM, employee_code: vw1[0].employee_code, employee_name: 'x', bonus_amount: 1234, store_id: stores.VW001.id },
        { year_month: YM, employee_code: vw1[1].employee_code, employee_name: 'y', bonus_amount: 99, store_id: stores.VW001.id },
      ]),
      '建立測試支援獎金'
    );
    return fx;
  } catch (e) {
    // 建立到一半失敗：先清乾淨再丟出
    const log = await teardown(admin, fx);
    if (log.length) console.warn('[fixture] 失敗後清除警告：', log.join('; '));
    throw e;
  }
}

async function teardown(admin, fx) {
  const log = await cleanupAll(admin);
  if (fx && fx.stores) {
    const r = await admin.from('stores').update({ is_franchise: fx.franchisePrev }).eq('id', fx.stores[FRANCHISE_STORE].id);
    if (r.error) log.push(`還原 ${FRANCHISE_STORE} is_franchise: ${r.error.message}`);
  }
  return log;
}

module.exports = { YM, FRANCHISE_STORE, MONTHLY, CAMPAIGN, buildScenarios, setup, teardown, cleanupAll };

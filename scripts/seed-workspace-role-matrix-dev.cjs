'use strict';
/**
 * T01：角色帳號矩陣 seed（只連 DEV）。
 *
 * 範圍（D05／D15）：
 *  - auth 使用者：只動 @example.test 且列在 tests/fixtures/role-matrix.json 的帳號。
 *  - roles / role_permissions：只動 vue_workspace_* 角色（admin 帳號另掛既有系統角色 admin，只建立指派，不改角色本身）。
 *  - user_roles / store_managers：只動上述帳號的資料列。
 *  - stores：只 upsert VW* / ZT* 測試門市（長駐基準資料）。
 * 密碼：隨機產生，只寫入 .tmp-check/test-credentials.json（gitignored）。
 *  已存在帳號且 credentials 檔已有密碼 -> 不重設；沒有 -> 重設並寫入。
 * 另外會把舊的明碼憑證檔整併後刪除（見 consolidateLegacyCredentials）。
 *
 * 用法：node scripts/seed-workspace-role-matrix-dev.cjs [--dry-run] [--skip-legacy] [--keep-email=a@x,b@y] [--discard-non-test]
 */
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { assertDevEnvironment } = require('../tests/support/env-guard.cjs');
const {
  ROOT,
  CREDENTIALS_FILE,
  TEST_EMAIL_DOMAIN,
  loadCredentials,
  saveCredentials,
  randomPassword,
  maskEmail,
} = require('../tests/support/credentials.cjs');

const FIXTURE_FILE = path.join(ROOT, 'tests', 'fixtures', 'role-matrix.json');
const ROLE_PREFIX = 'vue_workspace_';
const ALLOWED_SYSTEM_ROLES = new Set(['admin']);
const ALLOWED_STORE_PREFIXES = ['VW', 'ZT'];
const STORE_ROLE_TYPES = new Set(['store_manager', 'supervisor', 'area_manager']);
const LEGACY_FILES = [
  '.tmp-check/workspace-accounts.json',
  '.tmp-check/測試登入資料.txt',
  '.tmp-check/新版全站測試登入資料.txt',
  '.tmp-check/improvement-manager-account.json',
  '.tmp-check/task-archive-manager.json',
  '.tmp-check/_archive-20261102/workspace-accounts.json',
  '.tmp-check/_archive-20261102/測試登入資料.txt',
  '.tmp-check/_archive-20261102/新版全站測試登入資料.txt',
  '.tmp-check/_archive-20261102/improvement-manager-account.json',
  '.tmp-check/_archive-20261102/task-archive-manager.json',
];

function ok(result, what) {
  if (result.error) {
    // 只輸出表／動作與錯誤碼，不輸出資料內容。
    throw new Error(`DEV seed 失敗：${what}（${result.error.code || result.error.message}）`);
  }
  return result.data;
}

/** 純函式：驗證 fixture 的安全邊界（可單元測試）。 */
function validateFixture(fixture) {
  const errors = [];
  const emails = new Set();
  const roleCodes = new Set();
  const keys = new Set();
  for (const s of fixture.stores) {
    if (!ALLOWED_STORE_PREFIXES.some((p) => s.store_code.startsWith(p))) {
      errors.push(`門市 ${s.store_code} 不是 VW*/ZT* 測試門市`);
    }
  }
  const storeCodes = new Set(fixture.stores.map((s) => s.store_code));
  for (const a of fixture.accounts) {
    if (!a.email.toLowerCase().endsWith(`@${TEST_EMAIL_DOMAIN}`)) errors.push(`${a.key}: email 網域不是 ${TEST_EMAIL_DOMAIN}`);
    if (!a.roleCode.startsWith(ROLE_PREFIX)) errors.push(`${a.key}: roleCode 不是 ${ROLE_PREFIX}*`);
    for (const r of a.systemRoles || []) {
      if (!ALLOWED_SYSTEM_ROLES.has(r)) errors.push(`${a.key}: 不允許掛系統角色 ${r}`);
    }
    if (emails.has(a.email)) errors.push(`email 重複：${a.email}`);
    if (roleCodes.has(a.roleCode)) errors.push(`roleCode 重複：${a.roleCode}`);
    if (keys.has(a.key)) errors.push(`key 重複：${a.key}`);
    emails.add(a.email);
    roleCodes.add(a.roleCode);
    keys.add(a.key);
    for (const st of a.stores || []) {
      if (!storeCodes.has(st.store_code)) errors.push(`${a.key}: 門市 ${st.store_code} 不在 stores 清單`);
      if (!STORE_ROLE_TYPES.has(st.role_type)) errors.push(`${a.key}: role_type ${st.role_type} 無效`);
    }
  }
  return errors;
}

async function listAllUsers(db) {
  const users = [];
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`DEV seed 失敗：auth.listUsers（${error.status || error.message}）`);
    users.push(...data.users);
    if (data.users.length < 200) break;
  }
  return users;
}

async function ensureStores(db, fixture) {
  const map = new Map();
  for (const s of fixture.stores) {
    const row = ok(
      await db
        .from('stores')
        .upsert({ store_code: s.store_code, store_name: s.store_name, is_active: true }, { onConflict: 'store_code' })
        .select('id,store_code')
        .single(),
      `stores upsert ${s.store_code}`,
    );
    map.set(row.store_code, row.id);
  }
  return map;
}

async function ensureUser(db, account, usersByEmail, store, stats) {
  const email = account.email.toLowerCase();
  let user = usersByEmail.get(email);
  const saved = store.accounts[account.key];
  if (!user) {
    const password = randomPassword();
    const created = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: account.fullName },
    });
    if (created.error) throw new Error(`DEV seed 失敗：createUser ${maskEmail(email)}（${created.error.status}）`);
    user = created.data.user;
    store.accounts[account.key] = { email, password, userId: user.id };
    saveCredentials(store);
    usersByEmail.set(email, user);
    stats.created += 1;
  } else if (!saved || !saved.password || saved.userId !== user.id) {
    // 帳號已存在但 credentials 檔沒有：依規則重設並寫入（只限 @example.test 的 fixture 帳號）。
    const password = randomPassword();
    const updated = await db.auth.admin.updateUserById(user.id, { password, email_confirm: true });
    if (updated.error) throw new Error(`DEV seed 失敗：resetPassword ${maskEmail(email)}（${updated.error.status}）`);
    store.accounts[account.key] = { email, password, userId: user.id };
    saveCredentials(store);
    stats.passwordReset += 1;
  } else {
    stats.kept += 1;
  }
  return user;
}

async function syncRole(db, account, permissionIds) {
  const role = ok(
    await db
      .from('roles')
      .upsert(
        { code: account.roleCode, name: account.fullName, description: 'T01 測試角色矩陣（vue_workspace_*）', is_active: true, is_system: false },
        { onConflict: 'code' },
      )
      .select('id,code')
      .single(),
    `roles upsert ${account.roleCode}`,
  );
  if (!role.code.startsWith(ROLE_PREFIX)) throw new Error('拒絕修改非 vue_workspace_* 角色');
  // ALL = 所有 active 權限；但活動查看權限 migration（20261103090000）規定持有 view_all 的角色不再保留舊 view / view_own，
  // 所以 ALL 要排除這兩個碼（與 DEV 現況與 fixture 一致），否則重新 seed 會把它們加回來。
  const desiredCodes =
    account.permissions === 'ALL'
      ? [...permissionIds.keys()].filter(
          (c) => !(permissionIds.has('activity.campaign.view_all') && (c === 'activity.campaign.view' || c === 'activity.campaign.view_own')),
        )
      : account.permissions;
  const desiredIds = new Set(desiredCodes.map((c) => permissionIds.get(c)));
  const existing = ok(await db.from('role_permissions').select('id,permission_id').eq('role_id', role.id), 'role_permissions select');
  const stale = existing.filter((r) => !desiredIds.has(r.permission_id)).map((r) => r.id);
  if (stale.length) ok(await db.from('role_permissions').delete().in('id', stale), 'role_permissions delete stale');
  if (desiredIds.size) {
    ok(
      await db.from('role_permissions').upsert(
        [...desiredIds].map((permission_id) => ({ role_id: role.id, permission_id, is_allowed: true })),
        { onConflict: 'role_id,permission_id' },
      ),
      'role_permissions upsert',
    );
  }
  return role;
}

async function syncUserRoles(db, user, account, role, systemRoleIds) {
  const desired = new Map([[role.id, true]]);
  for (const code of account.systemRoles || []) desired.set(systemRoleIds.get(code), true);
  const existing = ok(await db.from('user_roles').select('id,role_id').eq('user_id', user.id), 'user_roles select');
  const stale = existing.filter((r) => !desired.has(r.role_id)).map((r) => r.id);
  if (stale.length) ok(await db.from('user_roles').delete().in('id', stale), 'user_roles delete stale');
  ok(
    await db.from('user_roles').upsert(
      [...desired.keys()].map((role_id) => ({ user_id: user.id, role_id, is_active: true, expires_at: null })),
      { onConflict: 'user_id,role_id' },
    ),
    'user_roles upsert',
  );
}

async function syncStoreManagers(db, user, account, storeIds) {
  const desired = (account.stores || []).map((s) => ({
    store_id: storeIds.get(s.store_code),
    user_id: user.id,
    role_type: s.role_type,
    is_primary: false,
  }));
  const existing = ok(await db.from('store_managers').select('id,store_id,role_type').eq('user_id', user.id), 'store_managers select');
  const wanted = new Set(desired.map((d) => `${d.store_id}|${d.role_type}`));
  const stale = existing.filter((r) => !wanted.has(`${r.store_id}|${r.role_type}`)).map((r) => r.id);
  if (stale.length) ok(await db.from('store_managers').delete().in('id', stale), 'store_managers delete stale');
  if (desired.length) {
    ok(await db.from('store_managers').upsert(desired, { onConflict: 'store_id,user_id,role_type' }), 'store_managers upsert');
  }
}

/** 解析舊明碼檔，回傳 [{ email, password }]（不過濾網域；由 consolidate 逐一分類並報告）。 */
function parseLegacyFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  if (file.endsWith('.json')) {
    const data = JSON.parse(text);
    const list = Array.isArray(data.accounts) ? data.accounts : [data];
    for (const a of list) if (a && a.email && a.password) out.push({ email: String(a.email), password: String(a.password) });
  } else {
    let email = null;
    for (const line of text.split(/\r?\n/)) {
      const e = line.match(/帳號[:：]\s*(\S+)/);
      const p = line.match(/密碼[:：]\s*(\S+)/);
      if (e) email = e[1];
      if (p && email) {
        out.push({ email, password: p[1] });
        email = null;
      }
    }
  }
  return out;
}

/**
 * D04：舊明碼檔整併。
 *  - 每個帳號都會分類並以遮罩 email 報告：imported / already（已在 credentials）/ discarded（附原因）/ blocked。
 *  - @example.test 帳號：DEV 使用者仍存在且舊密碼仍可登入 -> 以 legacy:<email> 匯入；否則判定不需要（reason 列出）。
 *  - 非 @example.test 帳號（例如 administrator）：預設不碰、也不刪檔；只有 keepEmails 白名單內的才驗證後整併，
 *    或 discardNonTest=true（--discard-non-test）明確聲明不需要。
 *  - 只有「檔內所有帳號都已處理」且 credentials 已成功寫入並讀回確認後，才刪該檔；其餘檔案保留。
 */
async function consolidateLegacyCredentials(env, usersByEmail, store, dryRun, options = {}) {
  const keepEmails = new Set((options.keepEmails || []).map((e) => e.toLowerCase()));
  const discardNonTest = Boolean(options.discardNonTest);
  const report = { filesFound: 0, imported: 0, already: 0, discarded: 0, blocked: 0, deleted: 0, kept: 0, details: [] };
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const found = LEGACY_FILES.map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
  report.filesFound = found.length;
  const fileResolved = new Map();
  for (const file of found) {
    let resolved = true;
    let accounts;
    try {
      accounts = parseLegacyFile(file);
    } catch {
      report.details.push(`${path.basename(file)}: 無法解析，保留檔案`);
      fileResolved.set(file, false);
      continue;
    }
    for (const acc of accounts) {
      const email = acc.email.toLowerCase();
      const key = `legacy:${email}`;
      const label = `${path.basename(file)} ${maskEmail(email)}`;
      const isTest = email.endsWith(`@${TEST_EMAIL_DOMAIN}`);
      const user = usersByEmail.get(email);
      if (Object.values(store.accounts).some((a) => String(a.email).toLowerCase() === email)) {
        report.already += 1;
        continue;
      }
      if (!isTest && !keepEmails.has(email)) {
        if (discardNonTest) {
          report.discarded += 1;
          report.details.push(`${label}: 捨棄（非 ${TEST_EMAIL_DOMAIN}，已用 --discard-non-test 聲明不需要）`);
        } else {
          report.blocked += 1;
          resolved = false;
          report.details.push(`${label}: 保留檔案（非 ${TEST_EMAIL_DOMAIN}；需要保留請加 --keep-email，不需要請加 --discard-non-test）`);
        }
        continue;
      }
      if (!user) {
        report.discarded += 1;
        report.details.push(`${label}: 捨棄（DEV 使用者不存在）`);
        continue;
      }
      const { error } = await anon.auth.signInWithPassword({ email, password: acc.password });
      if (error) {
        if (isTest) {
          report.discarded += 1;
          report.details.push(`${label}: 捨棄（舊密碼已失效）`);
        } else {
          // 白名單內的非測試帳號登入失敗：不可靜默丟棄，保留檔案。
          report.blocked += 1;
          resolved = false;
          report.details.push(`${label}: 保留檔案（白名單帳號舊密碼已失效，請人工處理）`);
        }
        continue;
      }
      await anon.auth.signOut();
      store.accounts[key] = { email, password: acc.password, userId: user.id, source: 'legacy' };
      report.imported += 1;
      report.details.push(`${label}: 已整併為 ${key}`);
    }
    fileResolved.set(file, resolved);
  }
  if (!dryRun) {
    if (report.imported) {
      saveCredentials(store);
      // 讀回確認：每個整併的帳號都確實寫入後才允許刪檔。
      const reread = loadCredentials(CREDENTIALS_FILE);
      for (const [k, v] of Object.entries(store.accounts)) {
        if (v.source === 'legacy' && !(reread.accounts[k] && reread.accounts[k].password === v.password)) {
          throw new Error(`credentials 寫入後讀回驗證失敗（${maskEmail(v.email)}），已中止，未刪除任何舊檔`);
        }
      }
    }
    for (const file of found) {
      if (fileResolved.get(file)) {
        fs.rmSync(file, { force: true });
        report.deleted += 1;
      } else {
        report.kept += 1;
      }
    }
  }
  return report;
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const skipLegacy = argv.includes('--skip-legacy');
  const { env, summary } = assertDevEnvironment({ root: ROOT });
  console.log(`Environment guard passed (Project Ref: ${summary.projectRef})`);

  const fixture = JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8'));
  const problems = validateFixture(fixture);
  if (problems.length) throw new Error(`role-matrix.json 驗證失敗：\n${problems.join('\n')}`);

  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const perms = ok(await db.from('permissions').select('id,code,is_active'), 'permissions select');
  const permissionIds = new Map(perms.filter((p) => p.is_active).map((p) => [p.code, p.id]));
  const unknown = new Set();
  for (const a of fixture.accounts) {
    if (a.permissions !== 'ALL') for (const c of a.permissions) if (!permissionIds.has(c)) unknown.add(c);
  }
  if (unknown.size) throw new Error(`fixture 含有 DEV 不存在的權限碼：${[...unknown].join(', ')}`);

  const systemRoleCodes = [...new Set(fixture.accounts.flatMap((a) => a.systemRoles || []))];
  const systemRoleIds = new Map();
  if (systemRoleCodes.length) {
    const rows = ok(await db.from('roles').select('id,code').in('code', systemRoleCodes), 'system roles select');
    for (const r of rows) systemRoleIds.set(r.code, r.id);
    for (const c of systemRoleCodes) if (!systemRoleIds.has(c)) throw new Error(`DEV 找不到系統角色 ${c}`);
  }

  if (dryRun) {
    console.log(`[dry-run] 將處理 ${fixture.accounts.length} 個帳號、${fixture.stores.length} 間測試門市；未寫入任何資料。`);
    return;
  }

  const store = loadCredentials(CREDENTIALS_FILE);
  const storeIds = await ensureStores(db, fixture);
  const usersByEmail = new Map((await listAllUsers(db)).map((u) => [String(u.email).toLowerCase(), u]));
  const stats = { created: 0, passwordReset: 0, kept: 0 };

  for (const account of fixture.accounts) {
    const user = await ensureUser(db, account, usersByEmail, store, stats);
    ok(
      await db.from('profiles').upsert(
        {
          id: user.id,
          email: account.email.toLowerCase(),
          full_name: account.fullName,
          role: account.profileRole,
          job_title: account.jobTitle,
          ...(account.department ? { department: account.department } : {}),
        },
        { onConflict: 'id' },
      ),
      `profiles upsert ${account.key}`,
    );
    const role = await syncRole(db, account, permissionIds);
    await syncUserRoles(db, user, account, role, systemRoleIds);
    await syncStoreManagers(db, user, account, storeIds);
  }

  const keepEmails = argv.filter((x) => x.startsWith('--keep-email=')).flatMap((x) => x.slice('--keep-email='.length).split(',')).filter(Boolean);
  let legacy = null;
  if (!skipLegacy) {
    legacy = await consolidateLegacyCredentials(env, usersByEmail, store, false, {
      keepEmails,
      discardNonTest: argv.includes('--discard-non-test'),
    });
  }

  console.log(
    `Seed 完成：帳號 ${fixture.accounts.length}（新建 ${stats.created}、重設密碼 ${stats.passwordReset}、沿用 ${stats.kept}）、門市 ${storeIds.size}。`,
  );
  if (legacy) {
    console.log(
      `舊明碼檔：找到 ${legacy.filesFound}、整併 ${legacy.imported}、已在憑證檔 ${legacy.already}、捨棄 ${legacy.discarded}、待處理 ${legacy.blocked}；刪除 ${legacy.deleted} 個檔案、保留 ${legacy.kept} 個檔案。`,
    );
    for (const d of legacy.details) console.log(`  - ${d}`);
  }
  console.log(`憑證檔：${path.relative(ROOT, CREDENTIALS_FILE)}（gitignored，內容不輸出）`);
}

module.exports = { validateFixture, parseLegacyFile };

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error('Role matrix seed failed');
    console.error(`Reason: ${error.message}`);
    process.exit(2);
  });
}

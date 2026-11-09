#!/usr/bin/env node
'use strict';
/**
 * 給瀏覽器量測用：建立 / 清除 DEV 測試帳號與 2099-01 資料。
 *   node scripts/perf/e2e-fixture.cjs setup <輸出 json 路徑>   （json 含 session cookie，只放在暫存資料夾，不可 commit）
 *   node scripts/perf/e2e-fixture.cjs teardown
 */
const fs = require('node:fs');
const path = require('node:path');
const { loadDevEnv, ROOT, DEV_REF } = require('./dev-env.cjs');
const { setup, teardown, FRANCHISE_STORE } = require('./ms-fixture.cjs');
const { makeServiceClient } = require('./ms-harness.cjs');

process.chdir(ROOT);
const ENV = loadDevEnv();
const { createClient } = require(path.join(ROOT, 'node_modules', '@supabase', 'supabase-js'));
const USERS = ['admin_role_real', 'store_manager_full', 'supervisor_multi'];

function buildCookies(session) {
  const name = `sb-${DEV_REF}-auth-token`;
  const value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
  const SIZE = 3180;
  if (value.length <= SIZE) return [{ name, value }];
  const out = [];
  for (let i = 0, n = 0; i < value.length; i += SIZE, n += 1) out.push({ name: `${name}.${n}`, value: value.slice(i, i + SIZE) });
  return out;
}

(async () => {
  const [cmd, out] = process.argv.slice(2);
  const admin = makeServiceClient(ENV);
  if (cmd === 'setup') {
    const anon = () => createClient(ENV.NEXT_PUBLIC_SUPABASE_URL, ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const fx = await setup(ENV, admin, anon, { scenarios: USERS });
    const data = { stores: Object.fromEntries(Object.entries(fx.stores).map(([k, v]) => [k, v.id])), users: {} };
    for (const k of USERS) data.users[k] = { cookies: buildCookies(fx.users[k].session) };
    fs.writeFileSync(out, JSON.stringify(data));
    console.log('setup OK ->', out);
  } else if (cmd === 'teardown') {
    const id = (await admin.from('stores').select('id').eq('store_code', FRANCHISE_STORE).single()).data.id;
    const log = await teardown(admin, { stores: { [FRANCHISE_STORE]: { id } }, franchisePrev: false });
    console.log('teardown', log.length ? log : 'OK');
  } else {
    console.error('usage: setup <out.json> | teardown');
    process.exit(2);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

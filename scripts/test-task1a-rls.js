#!/usr/bin/env node

/**
 * Task 1A direct Supabase RLS test.
 *
 * Local DEV only. This script:
 * - runs the DEV environment guard first
 * - prompts for DEV test user passwords without echoing them
 * - signs in with the anon client for each role
 * - uses the service role only for test setup/cleanup
 *
 * It never prints keys, JWTs, or passwords.
 */

const { spawnSync } = require('child_process');
const readline = require('readline');
const { loadEnvConfig } = require('@next/env');
const { createClient } = require('@supabase/supabase-js');

const TEST_USERS = [
  {
    label: 'no_access',
    email: 'dev-no-ga@example.test',
    expectVisible: false,
    expectManage: false,
  },
  {
    label: 'access_only',
    email: 'dev-ga-access@example.test',
    expectVisible: true,
    expectManage: false,
  },
  {
    label: 'category_view',
    email: 'dev-ga-view@example.test',
    expectVisible: true,
    expectManage: false,
  },
  {
    label: 'category_manage',
    email: 'dev-ga-manage@example.test',
    expectVisible: true,
    expectManage: true,
  },
];

const TABLES = [
  'ga_equipment_categories',
  'ga_facility_categories',
  'ga_part_categories',
];

function runGuard() {
  const result = spawnSync(process.execPath, ['scripts/verify-dev-supabase-environment.js'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function promptHidden(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    const onData = (char) => {
      char = String(char);
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          process.stdout.write('\n');
          process.stdin.removeListener('data', onData);
          break;
        default:
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(query + '*'.repeat(rl.line.length));
          break;
      }
    };

    process.stdin.on('data', onData);
    rl.question(query, (value) => {
      rl.close();
      resolve(value);
    });
  });
}

function createAnonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function upsertSeedRows(admin) {
  const seeds = [
    {
      table: 'ga_equipment_categories',
      row: {
        name: 'DEV RLS 設備分類',
        code: 'DEV-RLS-EQUIPMENT',
        is_active: true,
        default_fields: {},
      },
    },
    {
      table: 'ga_facility_categories',
      row: {
        name: 'DEV RLS 設施分類',
        code: 'DEV-RLS-FACILITY',
        is_active: true,
        default_issue_fields: {},
      },
    },
    {
      table: 'ga_part_categories',
      row: {
        name: 'DEV RLS 料件分類',
        code: 'DEV-RLS-PART',
        is_active: true,
        spec_schema: [],
      },
    },
  ];

  for (const seed of seeds) {
    await admin
      .from(seed.table)
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('code', seed.row.code)
      .is('deleted_at', null);

    const { error } = await admin.from(seed.table).insert(seed.row);
    if (error) throw new Error(`seed failed for ${seed.table}: ${error.message}`);
  }
}

async function cleanup(admin) {
  for (const table of TABLES) {
    await admin
      .from(table)
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .like('code', 'DEV-RLS-%')
      .is('deleted_at', null);
  }
}

async function signIn(email, password) {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in failed for ${email}: ${error.message}`);
  return client;
}

async function selectVisibleRows(client, table) {
  const { data, error } = await client
    .from(table)
    .select('id, code, is_active, deleted_at')
    .like('code', 'DEV-RLS-%')
    .order('code');

  if (error) throw error;
  return data || [];
}

async function tryInsert(client, table, code) {
  const payload = {
    name: `DEV RLS unauthorized ${code}`,
    code,
  };

  if (table === 'ga_equipment_categories') payload.default_fields = {};
  if (table === 'ga_facility_categories') payload.default_issue_fields = {};
  if (table === 'ga_part_categories') payload.spec_schema = [];

  const { data, error } = await client.from(table).insert(payload).select('id, code');
  return { data: data || [], error };
}

async function tryUpdateFirst(client, table) {
  const rows = await selectVisibleRows(client, table);
  if (rows.length === 0) return { skipped: true, data: [], error: null };

  const { data, error } = await client
    .from(table)
    .update({ description: `DEV RLS update ${Date.now()}` })
    .eq('id', rows[0].id)
    .select('id, code');

  return { skipped: false, data: data || [], error };
}

async function tryHardDeleteFirst(client, table) {
  const rows = await selectVisibleRows(client, table);
  if (rows.length === 0) return { skipped: true, data: [], error: null };

  const { data, error } = await client
    .from(table)
    .delete()
    .eq('id', rows[0].id)
    .select('id, code');

  return { skipped: false, data: data || [], error };
}

async function testUser(user, password) {
  const client = await signIn(user.email, password);
  console.log(`Testing ${user.label} (${user.email})`);

  for (const table of TABLES) {
    const rows = await selectVisibleRows(client, table);

    if (user.expectVisible) {
      assert(rows.length >= 1, `${user.label} expected visible rows in ${table}`);
    } else {
      assert(rows.length === 0, `${user.label} must not read rows in ${table}`);
    }

    const insertResult = await tryInsert(client, table, `DEV-RLS-${user.label}-${table}`.toUpperCase());
    if (user.expectManage) {
      assert(!insertResult.error && insertResult.data.length === 1, `${user.label} should insert ${table}`);
    } else {
      assert(insertResult.error || insertResult.data.length === 0, `${user.label} must not insert ${table}`);
    }

    const updateResult = await tryUpdateFirst(client, table);
    if (user.expectManage && !updateResult.skipped) {
      assert(!updateResult.error && updateResult.data.length === 1, `${user.label} should update ${table}`);
    } else if (!updateResult.skipped) {
      assert(updateResult.error || updateResult.data.length === 0, `${user.label} must not update ${table}`);
    }

    const deleteResult = await tryHardDeleteFirst(client, table);
    if (!deleteResult.skipped) {
      assert(deleteResult.error || deleteResult.data.length === 0, `${user.label} must not hard delete ${table}`);
    }
  }

  await client.auth.signOut();
  console.log(`PASS ${user.label}`);
}

async function main() {
  runGuard();
  loadEnvConfig(process.cwd(), true);

  const passwords = {};
  for (const user of TEST_USERS) {
    passwords[user.email] = await promptHidden(`Password for ${user.email}: `);
  }

  const admin = createServiceClient();
  await cleanup(admin);
  await upsertSeedRows(admin);

  try {
    for (const user of TEST_USERS) {
      await testUser(user, passwords[user.email]);
    }
  } finally {
    await cleanup(admin);
  }

  console.log('Task 1A RLS direct tests passed');
}

main().catch((error) => {
  console.error('Task 1A RLS direct tests failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

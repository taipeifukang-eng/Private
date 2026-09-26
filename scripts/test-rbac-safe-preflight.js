#!/usr/bin/env node

/**
 * Safe preflight for RBAC management work.
 *
 * This script only runs checks that do not require passwords, do not use
 * service role, and do not write DEV data. It intentionally excludes
 * test-rbac-navbar-permissions-dev.js because that script creates/updates
 * DEV-only Auth users and temporary RBAC roles.
 */

const { spawnSync } = require('child_process');

const BASE_URL = process.env.RBAC_SAFE_PREFLIGHT_BASE_URL || 'http://localhost:3002';
const FORBIDDEN_ARGS = [
  'scripts/test-rbac-navbar-permissions-dev.js',
  'scripts/test-rbac-user-search-dev.js',
  'scripts/test-rbac-user-permissions-view-dev.js',
  'scripts/test-rbac-user-management-dev.js',
  'supabase',
];

const COMMANDS = [
  {
    label: 'syntax: user search dynamic script',
    args: ['--check', 'scripts/test-rbac-user-search-dev.js'],
  },
  {
    label: 'syntax: user permissions dynamic script',
    args: ['--check', 'scripts/test-rbac-user-permissions-view-dev.js'],
  },
  {
    label: 'syntax: combined user management dynamic script',
    args: ['--check', 'scripts/test-rbac-user-management-dev.js'],
  },
  {
    label: 'static: RBAC formal management flow',
    args: ['scripts/test-rbac-formal-management-flow.js'],
  },
  {
    label: 'smoke: RBAC admin unauthenticated routes',
    args: ['scripts/test-rbac-admin-routes-smoke.js'],
  },
];

function assertSafeCommandList() {
  for (const command of COMMANDS) {
    const joined = command.args.join(' ');
    for (const forbidden of FORBIDDEN_ARGS) {
      if (joined.includes(forbidden) && !joined.startsWith(`--check ${forbidden}`)) {
        throw new Error(`unsafe command in RBAC safe preflight: ${joined}`);
      }
    }
  }
}

async function assertDevServerReady() {
  console.log(`RUN dev server ready check: ${BASE_URL}`);
  let response;
  try {
    response = await fetch(BASE_URL, { redirect: 'manual' });
  } catch (error) {
    throw new Error(
      `dev server is not reachable at ${BASE_URL}. Start it with: npm run dev -- -p 3002`
    );
  }

  if (response.status >= 500) {
    throw new Error(`dev server returned ${response.status} at ${BASE_URL}`);
  }

  console.log(`PASS dev server ready check: ${response.status}`);
}

function runCommand({ label, args }) {
  console.log(`RUN ${label}`);
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }

  console.log(`PASS ${label}`);
}

async function main() {
  assertSafeCommandList();
  await assertDevServerReady();

  for (const command of COMMANDS) {
    runCommand(command);
  }

  console.log('RBAC safe preflight passed');
  console.log('Next manual dynamic check requires hidden DEV passwords:');
  console.log('  npm run test:rbac-user-management-dev');
  console.log('Fallback split checks:');
  console.log('  node scripts/test-rbac-user-search-dev.js');
  console.log('  node scripts/test-rbac-user-permissions-view-dev.js');
}

main().catch((error) => {
  console.error('RBAC safe preflight failed');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

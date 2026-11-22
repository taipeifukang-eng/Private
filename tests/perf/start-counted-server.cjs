'use strict';
// 量測用：以與 3002 相同的 integrated 設定另開 3022（獨立 distDir），並載入 count-fetch.cjs 記錄 Supabase 往返。
// 只用 .env.development.local（env-guard），不連 Production。
const path = require('node:path');
const { spawn } = require('node:child_process');
const { assertDevEnvironment, applyDevEnv } = require('../support/env-guard.cjs');
const root = path.resolve(__dirname, '..', '..');
const { env } = assertDevEnvironment({ root });
applyDevEnv(env);
const log = process.env.PERF_FETCH_LOG || path.join(root, '.tmp-check', 'perf-fetch.log');
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '-H', '127.0.0.1', '-p', '3022'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    NEXT_DIST_DIR: '.next-perf',
    WORKSPACE_DEV_ENABLED: 'true',
    WORKSPACE_ORIGIN: 'http://localhost:3022',
    WORKSPACE_USE_EXISTING_SESSION: 'true',
    NEXT_TELEMETRY_DISABLED: '1',
    PERF_FETCH_LOG: log,
    NODE_OPTIONS: `--require ${path.join(__dirname, 'count-fetch.cjs')}`,
  },
});
process.on('SIGTERM', () => child.kill());
process.on('SIGINT', () => child.kill());
child.on('exit', (c) => process.exit(c || 0));

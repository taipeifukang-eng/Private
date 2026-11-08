'use strict';
/**
 * 給 Playwright webServer 使用（D10）：
 * 守衛 -> build Vue -> 同步 vue-workspace/dist 到 public/workspace -> 以 integrated 模式前景啟動 3002。
 * 只有在 3002 沒人監聽時 Playwright 才會執行這支；測完由 Playwright 結束此程序樹。
 * 與 scripts/start-workspace-preview.ps1 的步驟一致。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { assertDevEnvironment, applyDevEnv } = require('./env-guard.cjs');

const root = path.resolve(__dirname, '..', '..');

function fail(message) {
  console.error(`[start-test-server] ${message}`);
  process.exit(2);
}

try {
  const { env } = assertDevEnvironment({ root });
  applyDevEnv(env);
} catch (error) {
  fail(`環境守衛未通過：${error.message}`);
}

// M5 W22（D17）：註冊與忘記密碼對 @example.test 信箱改走不寄信路徑；只在測試站啟動時開啟。
process.env.WORKSPACE_AUTH_MAIL_MOCK = 'true';

// M5 W23／W24（D17）：Google 日曆與人事總處辦公日曆在測試站一律走假回應（lib/workspace/calendar-mock.ts），不連真實 Google。
// 這裡同時把 Google 設定蓋成假值：即使 .env.development.local 有真實金鑰也不會被使用；加密金鑰每次啟動隨機產生，只存在這個程序。
process.env.WORKSPACE_CALENDAR_MOCK = 'true';
process.env.GOOGLE_CALENDAR_CLIENT_ID = 'mock-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'mock-client-secret';
process.env.GOOGLE_CALENDAR_REDIRECT_URI = 'http://localhost:3002/api/organization/calendar/google/callback';
process.env.GOOGLE_CALENDAR_ID = 'mock-calendar@group.calendar.google.com';
process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY = require('node:crypto').randomBytes(32).toString('hex');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npm, ['--prefix', 'vue-workspace', 'run', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (build.status !== 0) fail('Vue build 失敗');

const dist = path.join(root, 'vue-workspace', 'dist');
const target = path.join(root, 'public', 'workspace');
fs.mkdirSync(target, { recursive: true });
fs.cpSync(dist, target, { recursive: true, force: true });

const child = spawn(process.execPath, [path.join(root, 'scripts', 'workspace-backend.cjs'), '--integrated'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
const stop = () => child.kill();
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code || 0));

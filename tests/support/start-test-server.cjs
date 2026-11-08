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

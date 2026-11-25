#!/usr/bin/env node
/**
 * Build the Vue workspace SPA and place it at public/workspace so that
 * Next.js serves it at /workspace/index.html. Cross-platform (Vercel + Windows).
 *
 * Steps: clean public/workspace -> npm ci in vue-workspace -> vue build -> copy dist -> verify.
 * The root `npm ci` must already have run (Vercel does it; the Vue source imports root
 * files whose packages, e.g. xlsx, are resolved from the root node_modules).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDist(src, dest) {
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    throw new Error(`build output not found: ${src}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

function verifyEntry(dest) {
  const entry = path.join(dest, 'index.html');
  if (!fs.existsSync(entry)) {
    throw new Error(`missing ${entry} after build`);
  }
  return entry;
}

function dirSize(dir) {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

function npmEnv() {
  // Dev dependencies (vite, vue-tsc) are required, so never install with NODE_ENV=production.
  const env = { ...process.env };
  delete env.NODE_ENV;
  env.npm_config_production = 'false';
  env.npm_config_include = 'dev';
  return env;
}

function run(args, cwd) {
  const r = spawnSync('npm', args, {
    cwd,
    env: npmEnv(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed (exit ${r.status})`);
  }
}

function main() {
  const root = path.resolve(__dirname, '..');
  const vueDir = path.join(root, 'vue-workspace');
  const dist = path.join(vueDir, 'dist');
  const dest = path.join(root, 'public', 'workspace');

  const started = Date.now();
  cleanDir(dest);
  run(['--prefix', vueDir, 'ci'], root);
  cleanDir(dist);
  run(['--prefix', vueDir, 'run', 'build'], root);
  copyDist(dist, dest);
  verifyEntry(dest);
  const mb = (dirSize(dest) / 1024 / 1024).toFixed(2);
  console.log(`[build-workspace] ok: public/workspace ${mb} MB in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

module.exports = { cleanDir, copyDist, verifyEntry, dirSize, npmEnv };

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`[build-workspace] FAILED: ${e.message}`);
    process.exit(1);
  }
}

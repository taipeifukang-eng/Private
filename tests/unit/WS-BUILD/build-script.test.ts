import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..', '..', '..');
const mod = require(path.join(ROOT, 'scripts', 'build-workspace.cjs'));

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-build-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('build-workspace helpers', () => {
  it('cleanDir removes a populated dir and tolerates a missing one', () => {
    const d = path.join(tmp, 'pw');
    fs.mkdirSync(path.join(d, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(d, 'assets', 'a.js'), 'x');
    mod.cleanDir(d);
    expect(fs.existsSync(d)).toBe(false);
    expect(() => mod.cleanDir(d)).not.toThrow();
  });

  it('copyDist copies nested files and verifyEntry accepts index.html', () => {
    const src = path.join(tmp, 'dist');
    const dest = path.join(tmp, 'public', 'workspace');
    fs.mkdirSync(path.join(src, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(src, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(src, 'assets', 'app-abc.js'), 'console.log(1)');
    mod.copyDist(src, dest);
    expect(fs.existsSync(path.join(dest, 'assets', 'app-abc.js'))).toBe(true);
    expect(mod.verifyEntry(dest)).toBe(path.join(dest, 'index.html'));
    expect(mod.dirSize(dest)).toBeGreaterThan(0);
  });

  it('copyDist fails when dist is missing', () => {
    expect(() => mod.copyDist(path.join(tmp, 'nope'), path.join(tmp, 'out'))).toThrow(/not found/);
  });

  it('verifyEntry fails loudly when index.html is missing', () => {
    const dest = path.join(tmp, 'ws');
    fs.mkdirSync(dest, { recursive: true });
    expect(() => mod.verifyEntry(dest)).toThrow(/index\.html/);
  });

  it('npmEnv strips NODE_ENV so dev dependencies install', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const env = mod.npmEnv();
      expect(env.NODE_ENV).toBeUndefined();
      expect(env.npm_config_production).toBe('false');
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });
});

describe('build wiring', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const vuePkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vue-workspace', 'package.json'), 'utf8'));

  it('root build runs the workspace build before next build', () => {
    expect(pkg.scripts.build).toBe('node scripts/build-workspace.cjs && next build');
  });
  it('does not pin engines.node (Vercel project setting decides)', () => {
    expect(pkg.engines?.node).toBeUndefined();
  });
  it('vue-workspace has no self file: dependency', () => {
    expect(JSON.stringify(vuePkg.dependencies)).not.toMatch(/file:/);
    const lock = fs.readFileSync(path.join(ROOT, 'vue-workspace', 'package-lock.json'), 'utf8');
    expect(lock).not.toMatch(/workflow-checklist-system/);
  });
});

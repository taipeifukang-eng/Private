import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, pwOptions, refs, registry, runAll } from './helpers';

const runId = 'T20261102-ab12';
const opts = pwOptions.buildPlaywrightOptions({ root: ROOT, runId });

describe('Playwright 設定', () => {
  it('只有 desktop-1440 與 mobile-390 兩個 project，viewport 正確', () => {
    expect(opts.projects.map((p: { name: string }) => p.name)).toEqual(['desktop-1440', 'mobile-390']);
    expect(opts.projects[0].use.viewport).toEqual({ width: 1440, height: 900 });
    expect(opts.projects[1].use.viewport.width).toBe(390);
  });

  it('chromium、單一 worker、baseURL 為 localhost:3002', () => {
    expect(opts.use.browserName).toBe('chromium');
    expect(opts.workers).toBe(1);
    expect(opts.fullyParallel).toBe(false);
    expect(opts.use.baseURL).toBe('http://localhost:3002');
  });

  it('手機 project 不跑 integration / parity；桌機跑全部', () => {
    const mobile = opts.projects[1].testMatch.join(' ');
    expect(mobile).toContain('smoke');
    expect(mobile).toContain('e2e');
    expect(mobile).not.toContain('integration');
    expect(mobile).not.toContain('parity');
    expect(opts.projects[0].testMatch).toBeUndefined();
    expect(opts.testMatch).toEqual(['**/*.spec.ts']);
  });

  it('webServer：沿用已在執行的 3002，否則由 start-test-server 啟動', () => {
    expect(opts.webServer.reuseExistingServer).toBe(true);
    expect(opts.webServer.url).toBe('http://localhost:3002/api/workspace/session');
    expect(opts.webServer.command).toContain('start-test-server.cjs');
    expect(fs.existsSync(path.join(ROOT, 'tests', 'support', 'start-test-server.cjs'))).toBe(true);
  });

  it('globalSetup 先跑守衛、teardown 存在', () => {
    expect(fs.existsSync(opts.globalSetup)).toBe(true);
    expect(fs.existsSync(opts.globalTeardown)).toBe(true);
    const setup = fs.readFileSync(opts.globalSetup, 'utf8');
    expect(setup.indexOf('assertDevEnvironment')).toBeGreaterThan(-1);
    expect(setup.indexOf('assertDevEnvironment')).toBeLessThan(setup.indexOf('preflightServer('));
  });

  it('報表全部輸出到 tests/reports/<runId>/', () => {
    const base = path.join(ROOT, 'tests', 'reports', runId);
    expect(opts.outputDir.startsWith(base)).toBe(true);
    const files = opts.reporter.map((r: [string, { outputFile?: string; outputFolder?: string }?]) => r[1]?.outputFile || r[1]?.outputFolder).filter(Boolean);
    expect(files.length).toBe(3);
    for (const f of files) expect(f.startsWith(base)).toBe(true);
  });

  it('缺 root 或 runId 時丟錯', () => {
    expect(() => pwOptions.buildPlaywrightOptions({ runId })).toThrow();
    expect(() => pwOptions.buildPlaywrightOptions({ root: ROOT })).toThrow();
  });

  it('playwright.config.ts / vitest.config.mts 不載入任何 .env 檔', () => {
    for (const file of ['playwright.config.ts', 'vitest.config.mts']) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      expect(text).not.toMatch(/dotenv|loadEnvConfig|loadEnv\(/);
    }
  });

  it('Vitest envDir 指向沒有任何 .env* 檔的空目錄', () => {
    const text = fs.readFileSync(path.join(ROOT, 'vitest.config.mts'), 'utf8');
    expect(text).toContain('empty-env-dir');
    const dir = path.join(ROOT, 'tests', 'support', 'empty-env-dir');
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('.env'))).toEqual([]);
  });
});

describe('runner 參數與報表', () => {
  it('預設跑全部層；--layers 與 --page 解析', () => {
    expect(runAll.parseArgs([]).layers).toEqual(['unit', 'smoke', 'integration', 'e2e', 'parity']);
    expect(runAll.parseArgs(['--layers', 'unit,e2e']).layers).toEqual(['unit', 'e2e']);
    expect(runAll.parseArgs(['--layers', 'all', '--page', 'W06']).page).toBe('W06');
    expect(runAll.parseArgs(['W06']).page).toBe('W06');
  });

  it('拒絕未知層、未知參數與不合法的 ID / runId', () => {
    expect(() => runAll.parseArgs(['--layers', 'bogus'])).toThrow();
    expect(() => runAll.parseArgs(['--what'])).toThrow();
    expect(() => runAll.parseArgs(['--page', '../x'])).toThrow();
    expect(() => runAll.parseArgs(['--run-id', 'nope'])).toThrow();
  });

  it('collectPlaywrightCounts 依檔案所在層統計', () => {
    const json = {
      suites: [
        { file: 'smoke/W01.smoke.spec.ts', specs: [{ file: 'smoke/W01.smoke.spec.ts', tests: [{ status: 'expected', results: [{ duration: 10 }] }, { status: 'skipped', results: [] }] }] },
        { file: 'e2e/W01.e2e.spec.ts', specs: [{ file: 'e2e/W01.e2e.spec.ts', tests: [{ status: 'unexpected', results: [{ duration: 5 }] }] }] },
      ],
    };
    const c = runAll.collectPlaywrightCounts(json);
    expect(c.smoke).toMatchObject({ pass: 1, skip: 1, fail: 0, durationMs: 10 });
    expect(c.e2e).toMatchObject({ pass: 0, fail: 1 });
  });

  it('runId 格式為 T<yyyymmdd>-<4碼>，且 package.json 有完整 test:* scripts', () => {
    const id = registry.newRunId(new Date(2026, 10, 2), () => 0.5);
    expect(id).toMatch(registry.RUN_ID_RE);
    expect(id.startsWith('T20261102-')).toBe(true);
    const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
    for (const k of ['test:guard', 'test:unit', 'test:smoke', 'test:integration', 'test:e2e', 'test:parity', 'test:page', 'test:all']) {
      expect(scripts[k], k).toBeTruthy();
    }
  });

  it('env-refs：Production 與 DEV ref 不同，並明確禁止 .env.local 等檔案', () => {
    expect(refs.PRODUCTION_REFS).not.toContain(refs.DEV_REF);
    expect(refs.ALLOWED_ENV_FILE).toBe('.env.development.local');
    for (const f of ['.env.local', '.env.production.local', '.env.production-candidate.local.bak']) {
      expect(refs.FORBIDDEN_ENV_FILES).toContain(f);
    }
  });
});

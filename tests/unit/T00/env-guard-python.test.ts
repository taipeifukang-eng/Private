import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEV_REF, PROD_REF, ROOT, fakeJwt, goodEnv, refs } from './helpers';

const pyFile = path.join(ROOT, 'tests', 'support', 'env_guard.py');
const pyText = fs.readFileSync(pyFile, 'utf8');
const hasPython = spawnSync('python', ['--version']).status === 0;

/** 以 python -I 載入 env_guard.py 並執行一段檢查，回傳 stdout（JSON）。 */
function runPy(body: string, env: Record<string, string> = {}) {
  const code = [
    'import sys, json',
    `sys.path.insert(0, ${JSON.stringify(path.dirname(pyFile))})`,
    'import env_guard as g',
    body,
  ].join('\n');
  const r = spawnSync('python', ['-I', '-X', 'utf8', '-c', code], { encoding: 'utf8', env: { ...process.env, ...env, PYTHONIOENCODING: 'utf-8' } });
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

describe('env_guard.py 與 env-guard.cjs 一致', () => {
  it('DEV / Production ref 常數與 env-refs.cjs 相同', () => {
    expect(pyText).toContain(`DEV_REF = "${DEV_REF}"`);
    expect(pyText).toContain(`PRODUCTION_REFS = ("${PROD_REF}",)`);
    expect(pyText).toContain(`PRODUCTION_REF_PREFIX = "${refs.PRODUCTION_REF_PREFIX}"`);
    expect(pyText).toContain(`ALLOWED_ENV_FILE = "${refs.ALLOWED_ENV_FILE}"`);
  });

  it.skipIf(!hasPython)('正確 DEV env 通過', () => {
    const env = JSON.stringify(goodEnv());
    const r = runPy(`print(json.dumps(g.validate_dev_env(json.loads(${JSON.stringify(env)}), 'test')))`);
    expect(r.status, r.err).toBe(0);
    expect(JSON.parse(r.out).project_ref).toBe(`${DEV_REF.slice(0, 4)}...${DEV_REF.slice(-4)}`);
  });

  const bad: Array<[string, Record<string, string | undefined>, string]> = [
    ['URL ref 是 Production', { NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`, EXPECTED_SUPABASE_PROJECT_REF: PROD_REF }, 'test'],
    ['anon JWT ref 不符', { NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon', ref: PROD_REF }) }, 'test'],
    ['service role JWT ref 不符', { SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'service_role', ref: 'zzzzzzzzzzzzzzzzzzzz' }) }, 'test'],
    ['其他變數含大寫 Production ref', { SOME_OTHER_URL: `https://${PROD_REF.toUpperCase()}.supabase.co` }, 'test'],
    ['其他變數含 odvk 前綴樣式', { SOME_OTHER_URL: 'x-ODVKabcdefghijklmnop-y' }, 'test'],
    ['缺 ALLOW 旗標', { ALLOW_DEV_DATABASE_OPERATIONS: undefined }, 'test'],
    ['NODE_ENV=production', {}, 'production'],
  ];
  it.skipIf(!hasPython).each(bad)('%s 時拒絕（exit 2 且訊息不含 Production ref）', (_name, overrides, nodeEnv) => {
    const env = JSON.stringify(goodEnv(overrides));
    const r = runPy(
      `g.assert_dev_environment(env=json.loads(${JSON.stringify(env)}), node_env=${JSON.stringify(nodeEnv)})`,
    );
    expect(r.status).toBe(2);
    expect(r.err).toContain('Environment guard failed');
    expect(r.err).not.toContain(PROD_REF);
  });

  it.skipIf(!hasPython)('讀取 .env.local 一律拒絕', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envguard-py-'));
    fs.writeFileSync(path.join(dir, '.env.local'), 'NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co');
    const r = runPy(`g.load_dev_env_file(${JSON.stringify(dir)}, '.env.local')`);
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('拒絕載入');
    // 只有 .env.local 時，預設載入也要失敗而不是退而求其次
    const r2 = runPy(`g.assert_dev_environment(root=${JSON.stringify(dir)})`);
    expect(r2.status).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DEV_REF, PROD_REF, ROOT, fakeJwt, goodEnv, guard } from './helpers';

const devFile = () => goodEnv({}) as Record<string, string>;

function rejects(file: Record<string, string | undefined>, loaded: Record<string, string | undefined>) {
  let error: unknown;
  try {
    guard.assertBackendDevEnv(file, loaded);
  } catch (e) {
    error = e;
  }
  expect(error, '應該被拒絕').toBeInstanceOf(guard.EnvGuardError);
  return (error as Error).message;
}

describe('workspace-backend 嚴格 DEV 檢查（assertBackendDevEnv）', () => {
  it('env 檔與載入後一致且 ref 都是 DEV 時通過', () => {
    expect(() => guard.assertBackendDevEnv(devFile(), { ...devFile() })).not.toThrow();
  });

  it('.env.development.local 缺少必要變數（會被 fallback 補上）時拒絕', () => {
    for (const key of guard.BACKEND_REQUIRED_KEYS as string[]) {
      const file = { ...devFile() } as Record<string, string | undefined>;
      delete file[key];
      const msg = rejects(file, devFile());
      expect(msg).toContain(key);
    }
  });

  it('載入後的值與 env 檔不同（fallback / shell 覆蓋）時拒絕', () => {
    const loaded = { ...devFile(), SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'service_role', ref: DEV_REF, x: 1 }) };
    expect(rejects(devFile(), loaded)).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('anon / service role JWT 的 ref 不是 DEV 時拒絕，訊息不含 Production ref', () => {
    for (const [key, role] of [
      ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon'],
      ['SUPABASE_SERVICE_ROLE_KEY', 'service_role'],
    ] as const) {
      for (const ref of [PROD_REF, 'zzzzzzzzzzzzzzzzzzzz', undefined]) {
        const env = { ...devFile(), [key]: fakeJwt({ role, ref }) };
        const msg = rejects(env, env);
        expect(msg).toContain(key);
        expect(msg).not.toContain(PROD_REF);
      }
    }
  });

  it('URL 是 Production 時拒絕', () => {
    const env = { ...devFile(), NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`, EXPECTED_SUPABASE_PROJECT_REF: PROD_REF };
    expect(rejects(env, env)).not.toContain(PROD_REF);
  });
});

describe('workspace-backend.cjs 與測試啟動路徑的接線', () => {
  const backend = fs.readFileSync(path.join(ROOT, 'scripts', 'workspace-backend.cjs'), 'utf8');
  const starter = fs.readFileSync(path.join(ROOT, 'tests', 'support', 'start-test-server.cjs'), 'utf8');

  it('loadEnvConfig 之前先解析 .env.development.local，之後比對；--build 不套用嚴格檢查', () => {
    const iLoadFile = backend.indexOf('guard.loadDevEnvFile(');
    const iNext = backend.indexOf('loadEnvConfig(process.cwd()');
    const iAssert = backend.indexOf('guard.assertBackendDevEnv(');
    expect(iLoadFile).toBeGreaterThan(-1);
    expect(iLoadFile).toBeLessThan(iNext);
    expect(iNext).toBeLessThan(iAssert);
    expect(backend).toMatch(/if \(!build\) \{\s*try \{\s*devFileEnv/);
    expect(backend).toMatch(/if \(!build\) \{\s*try \{\s*guard\.assertBackendDevEnv/);
  });

  it('測試啟動腳本先經守衛並 applyDevEnv，再以繼承 process.env 的子程序啟動後端', () => {
    expect(starter).toContain('applyDevEnv(env)');
    expect(starter).toMatch(/workspace-backend\.cjs[\s\S]*env: process\.env/);
    expect(starter).not.toContain('--build');
  });
});

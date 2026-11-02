import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEV_REF, PROD_REF, fakeJwt, goodEnv, guard } from './helpers';

function rejects(env: Record<string, string | undefined>, nodeEnv: string | undefined = 'test') {
  let error: unknown;
  try {
    guard.validateDevEnv(env, { nodeEnv });
  } catch (e) {
    error = e;
  }
  expect(error, '應該被守衛拒絕').toBeInstanceOf(guard.EnvGuardError);
  return (error as Error).message;
}

describe('env-guard validateDevEnv', () => {
  it('正確的 DEV 環境通過，且只回傳遮罩後的 ref', () => {
    const summary = guard.validateDevEnv(goodEnv(), { nodeEnv: 'test' });
    expect(summary.projectRef).toBe(guard.mask(DEV_REF));
    expect(JSON.stringify(summary)).not.toContain(DEV_REF);
  });

  it('URL ref 不符（非 DEV）拒絕', () => {
    const msg = rejects(goodEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' }));
    expect(msg).toContain('不是 DEV');
  });

  it('URL ref 是 Production 拒絕，訊息不含完整 ref', () => {
    const msg = rejects(
      goodEnv({
        NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
        EXPECTED_SUPABASE_PROJECT_REF: PROD_REF,
      }),
    );
    expect(msg).toContain('Production');
    expect(msg).not.toContain(PROD_REF);
  });

  it('URL 不是 Supabase 網域或不是網址時拒絕', () => {
    rejects(goodEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.com' }));
    rejects(goodEnv({ NEXT_PUBLIC_SUPABASE_URL: 'not a url' }));
    rejects(goodEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined }));
  });

  it('EXPECTED_SUPABASE_PROJECT_REF 缺少或不一致拒絕', () => {
    rejects(goodEnv({ EXPECTED_SUPABASE_PROJECT_REF: undefined }));
    rejects(goodEnv({ EXPECTED_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst' }));
  });

  it('anon JWT 的 ref claim 不符拒絕（Production ref 與其他 ref）', () => {
    const prodMsg = rejects(
      goodEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon', ref: PROD_REF }) }),
    );
    expect(prodMsg).toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    expect(prodMsg).not.toContain(PROD_REF);
    rejects(goodEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon', ref: 'zzzzzzzzzzzzzzzzzzzz' }) }));
    rejects(goodEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon' }) }));
  });

  it('service role JWT 的 ref claim 不符拒絕', () => {
    rejects(goodEnv({ SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'service_role', ref: PROD_REF }) }));
    rejects(goodEnv({ SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'service_role', ref: 'zzzzzzzzzzzzzzzzzzzz' }) }));
  });

  it('JWT role 錯誤、格式錯誤、缺少都拒絕', () => {
    rejects(goodEnv({ SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'anon', ref: DEV_REF }) }));
    rejects(goodEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'service_role', ref: DEV_REF }) }));
    rejects(goodEnv({ SUPABASE_SERVICE_ROLE_KEY: 'garbage' }));
    rejects(goodEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }));
  });

  it('缺少或不嚴格等於 true 的 ALLOW_DEV_DATABASE_OPERATIONS 拒絕', () => {
    rejects(goodEnv({ ALLOW_DEV_DATABASE_OPERATIONS: undefined }));
    rejects(goodEnv({ ALLOW_DEV_DATABASE_OPERATIONS: 'false' }));
    rejects(goodEnv({ ALLOW_DEV_DATABASE_OPERATIONS: 'TRUE' }));
    rejects(goodEnv({ ALLOW_DEV_DATABASE_OPERATIONS: '1' }));
  });

  it('NODE_ENV=production 拒絕（參數與 env 檔兩種來源）', () => {
    rejects(goodEnv(), 'production');
    rejects(goodEnv({ NODE_ENV: 'production' }), 'test');
  });

  it('其他變數含 Production ref 也拒絕，且不輸出該值', () => {
    const msg = rejects(goodEnv({ SOME_OTHER_URL: `https://${PROD_REF}.supabase.co/rest` }));
    expect(msg).toContain('SOME_OTHER_URL');
    expect(msg).not.toContain(PROD_REF);
  });

  it('所有拒絕訊息都不含 JWT 內容', () => {
    const env = goodEnv({ SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'service_role', ref: PROD_REF }) });
    const msg = rejects(env);
    expect(msg).not.toContain(String(env.SUPABASE_SERVICE_ROLE_KEY));
    expect(msg).not.toContain('fake-signature');
  });
});

describe('env-guard 載入 env 檔', () => {
  function makeRoot(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envguard-'));
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    return dir;
  }
  const devText = (env: Record<string, string | undefined>) =>
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

  it('只讀 .env.development.local；同目錄的 .env.local（Production）完全被忽略', () => {
    const prod = goodEnv({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
      EXPECTED_SUPABASE_PROJECT_REF: PROD_REF,
    });
    const root = makeRoot({ '.env.development.local': devText(goodEnv()), '.env.local': devText(prod) });
    const { env } = guard.assertDevEnvironment({ root, nodeEnv: 'test' });
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toContain(DEV_REF);
    expect(JSON.stringify(env)).not.toContain(PROD_REF);
  });

  it('只有 .env.local（沒有 development.local）時拒絕，不會退而讀 .env.local', () => {
    const root = makeRoot({ '.env.local': devText(goodEnv()) });
    expect(() => guard.assertDevEnvironment({ root, nodeEnv: 'test' })).toThrow(guard.EnvGuardError);
  });

  it.each(['.env.local', '.env', '.env.production.local', '.env.production-candidate.local.bak', '../.env.local'])(
    '明確要求載入 %s 時拒絕',
    (name) => {
      const root = makeRoot({ '.env.local': devText(goodEnv()) });
      expect(() => guard.loadDevEnvFile(root, name)).toThrow(/拒絕載入/);
    },
  );

  it('.env.development.local 內若指向 Production 仍被驗證擋下', () => {
    const root = makeRoot({
      '.env.development.local': devText(
        goodEnv({ NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co`, EXPECTED_SUPABASE_PROJECT_REF: PROD_REF }),
      ),
    });
    expect(() => guard.assertDevEnvironment({ root, nodeEnv: 'test' })).toThrow(/Production/);
  });

  it('parseEnvText 處理引號、註解與 export', () => {
    const parsed = guard.parseEnvText('# c\nA=1\nexport B="two words"\nC=3 # tail\n\nD=\'x\'');
    expect(parsed).toEqual({ A: '1', B: 'two words', C: '3', D: 'x' });
  });
});

describe('env-guard preflightServer', () => {
  const respond = (status: number) => async () => ({ status }) as Response;

  it('200 與 401 通過', async () => {
    await expect(guard.preflightServer('http://localhost:3002', { fetchImpl: respond(200) })).resolves.toEqual({ status: 200 });
    await expect(guard.preflightServer('http://localhost:3002', { fetchImpl: respond(401) })).resolves.toEqual({ status: 401 });
  });

  it('503 拒絕', async () => {
    await expect(guard.preflightServer('http://localhost:3002', { fetchImpl: respond(503) })).rejects.toThrow(/503/);
  });

  it('其他 5xx、連線失敗、非 localhost 都拒絕', async () => {
    await expect(guard.preflightServer('http://localhost:3002', { fetchImpl: respond(500) })).rejects.toThrow();
    await expect(
      guard.preflightServer('http://localhost:3002', {
        fetchImpl: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
    ).rejects.toThrow(/無法連線/);
    await expect(guard.preflightServer('https://example.com', { fetchImpl: respond(200) })).rejects.toThrow(/localhost/);
  });
});

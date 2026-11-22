import { createRequire } from 'node:module';
import path from 'node:path';

const req = createRequire(import.meta.url);

export const ROOT = path.resolve(__dirname, '..', '..', '..');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyModule = Record<string, any>;

export const guard: AnyModule = req('../../support/env-guard.cjs');
export const refs: AnyModule = req('../../support/env-refs.cjs');
export const registry: AnyModule = req('../../support/registry.cjs');
export const sweeper: AnyModule = req('../../support/sweeper.cjs');
export const pwOptions: AnyModule = req('../../support/playwright-options.cjs');
export const runAll: AnyModule = req('../../run-all.cjs');

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** 產生假的（未簽章）JWT，只用於測試守衛的 claims 判斷。 */
export function fakeJwt(claims: Record<string, unknown>): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(claims)}.fake-signature`;
}

export const DEV_REF: string = refs.DEV_REF;
export const PROD_REF: string = refs.PRODUCTION_REFS[0];

/** 一組全部正確的 DEV 假 env。 */
export function goodEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: `https://${DEV_REF}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: fakeJwt({ role: 'anon', ref: DEV_REF }),
    SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: 'service_role', ref: DEV_REF }),
    EXPECTED_SUPABASE_PROJECT_REF: DEV_REF,
    ALLOW_DEV_DATABASE_OPERATIONS: 'true',
    ...overrides,
  };
}

import path from 'node:path';
import { createRequire } from 'node:module';
import { blockRpcArgs, type BlockInput } from '../../lib/monthly-staff/block';

const nodeRequire = createRequire(path.join(__dirname, 'w01b-db.ts'));
const ROOT = path.resolve(__dirname, '..', '..');

type RpcClient = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

let cached: RpcClient | null = null;

/** 通過 DEV 守衛的 service role client（只用來呼叫純計算 RPC，不讀寫任何資料表）。 */
function client(): RpcClient {
  if (cached) return cached;
  const guard = nodeRequire('./env-guard.cjs') as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
  const { env } = guard.assertDevEnvironment({ root: ROOT });
  const { createClient } = nodeRequire('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => RpcClient };
  cached = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** 在 DEV 呼叫 calculate_bonus_block（9 個參數版）。 */
export async function dbBonusBlock(input: BlockInput): Promise<number> {
  const { data, error } = await client().rpc('calculate_bonus_block', blockRpcArgs(input));
  if (error) throw new Error(`calculate_bonus_block RPC 失敗：${error.message}`);
  return data as number;
}

/** 分批平行呼叫，避免一次送出過多請求。 */
export async function dbBonusBlocks(inputs: BlockInput[], batch = 20): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < inputs.length; i += batch) {
    out.push(...(await Promise.all(inputs.slice(i, i + batch).map(dbBonusBlock))));
  }
  return out;
}

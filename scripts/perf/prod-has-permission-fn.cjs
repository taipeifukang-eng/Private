'use strict';
/**
 * 在 DEV 建立／刪除暫時函式 public.perf_has_permission_prod（內容 = 正式區 has_permission 定義，逐字相同，只改函式名稱）。
 * 用途：讓比對測試的「改前」參考值走正式區語意（DEV 的 has_permission 與正式區不同）。
 *
 * 守衛：先過 loadDevEnv（ref 必須是 DEV、不得為 Production）與 scripts/verify-dev-supabase-*.js，
 * 再用 supabase CLI（--linked，supabase/.temp/project-ref 必須是 DEV ref）執行 SQL。
 *
 * 用法：node scripts/perf/prod-has-permission-fn.cjs create|drop
 * 或 require('./prod-has-permission-fn.cjs').{createProdFn, dropProdFn}
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, DEV_REF, loadDevEnv } = require('./dev-env.cjs');

const FN = 'perf_has_permission_prod';

const CREATE_SQL = `CREATE OR REPLACE FUNCTION public.${FN}(p_user_id uuid, p_permission_code character varying)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_has_permission BOOLEAN := false;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM user_roles ur
    INNER JOIN role_permissions rp ON ur.role_id = rp.role_id
    INNER JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = p_user_id
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      AND rp.is_allowed = true
      AND p.code = p_permission_code
      AND p.is_active = true
  ) INTO v_has_permission;
  
  RETURN v_has_permission;
END;
$function$;
`;
const DROP_SQL = `DROP FUNCTION IF EXISTS public.${FN}(uuid, character varying);\n`;

function guard() {
  const env = loadDevEnv();
  const refFile = path.join(ROOT, 'supabase', '.temp', 'project-ref');
  const cliRef = fs.existsSync(refFile) ? fs.readFileSync(refFile, 'utf8').trim() : '';
  if (cliRef !== DEV_REF) throw new Error('supabase/.temp/project-ref 不是 DEV ref，拒絕執行 SQL');
  if (process.env.ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS !== 'true' && env.ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS !== 'true') {
    throw new Error('ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS 必須為 true');
  }
  for (const s of ['verify-dev-supabase-environment.js', 'verify-dev-supabase-cli-environment.js']) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', s)], { cwd: ROOT, stdio: 'ignore' });
    if (r.status) throw new Error(`${s} 守衛失敗`);
  }
}

function runSql(sql) {
  guard();
  const file = path.join(os.tmpdir(), `${FN}-${process.pid}-${Date.now()}.sql`);
  fs.writeFileSync(file, sql);
  try {
    const r = spawnSync('supabase', ['db', 'query', '--linked', '--file', file], { cwd: ROOT, encoding: 'utf8', shell: true });
    if (r.status) throw new Error(`supabase db query 失敗：${(r.stderr || r.stdout || '').slice(0, 500)}`);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

const createProdFn = () => runSql(CREATE_SQL);
const dropProdFn = () => runSql(DROP_SQL);

module.exports = { FN, CREATE_SQL, createProdFn, dropProdFn };

if (require.main === module) {
  process.chdir(ROOT);
  const cmd = process.argv[2];
  if (cmd === 'create') createProdFn();
  else if (cmd === 'drop') dropProdFn();
  else throw new Error('用法：create | drop');
  console.log(`${cmd} ${FN} 完成`);
}

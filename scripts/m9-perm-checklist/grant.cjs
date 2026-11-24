#!/usr/bin/env node
/* 把老闆在「新權限勾選」頁送出的答案，轉成正式區授權 SQL 三件組。
 * 用法：node scripts/m9-perm-checklist/grant.cjs <answers.json> [outDir]
 * answers.json 是 artifact db 的 survey/m9-permissions 內容：
 *   {answers:{<code>:{roles:[...],note}}, losses:{<code>:{roles:[...]}}, general, submittedAt, status}
 * 輸出（預設 docs/vue-workspace/parity-plan/m9-sql）：
 *   95_role_permission_grants.sql           只新增授權（可重複執行）
 *   95_role_permission_grants.rollback.sql  只刪「本檔新增」的列（依 m9_role_grant_log）
 *   95_role_permission_grants.verify.sql    只有 SELECT，逐列回傳 role, code, ok */
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = '95_role_permission_grants';
const DEFAULT_OUT = path.resolve(__dirname, '..', '..', 'docs', 'vue-workspace', 'parity-plan', 'm9-sql');
const CODE_RE = /^[A-Za-z0-9_.]+$/;

function collectPairs(doc) {
  const set = new Map();
  const add = (code, roles) => {
    for (const role of (roles && roles.roles) || []) {
      if (!CODE_RE.test(code) || !CODE_RE.test(role)) throw new Error(`不合法的代碼：${role} / ${code}`);
      set.set(`${role}\u0000${code}`, [role, code]);
    }
  };
  for (const [code, a] of Object.entries((doc && doc.answers) || {})) add(code, a);
  for (const [code, l] of Object.entries((doc && doc.losses) || {})) add(code, l);
  return [...set.values()].sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
}

const q = (s) => `'${s}'`;
const values = (pairs) => pairs.map(([r, c]) => `    (${q(r)}, ${q(c)})`).join(',\n');

const LOG_DDL = `CREATE TABLE IF NOT EXISTS public.m9_role_grant_log (
  role_code       text        NOT NULL,
  permission_code text        NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_code, permission_code)
);`;

function header(title, doc, n) {
  return `-- ${title}
-- 來源：新權限勾選頁（survey/m9-permissions，送出時間 ${(doc && doc.submittedAt) || '無'}）
-- 授權配對數：${n}
`;
}

function genGrant(doc, pairs) {
  const head = header('M9 95 角色權限授權（只新增，可重複執行）', doc, pairs.length) +
    '-- 只新增不刪除；已存在的配對不動。新增前不存在的配對會記進 m9_role_grant_log，供 rollback 使用。\n';
  if (!pairs.length) {
    return `${head}-- 本次沒有勾選任何授權，所以這支檔案只建立（或確認）備份表，不新增任何授權。
BEGIN;
${LOG_DDL}
COMMIT;
`;
  }
  return `${head}BEGIN;
${LOG_DDL}

WITH wanted(role_code, permission_code) AS (
  VALUES
${values(pairs)}
),
missing AS (
  SELECT r.id AS role_id, p.id AS permission_id, w.role_code, w.permission_code
  FROM wanted w
  JOIN public.roles r ON r.code = w.role_code
  JOIN public.permissions p ON p.code = w.permission_code
  WHERE NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  )
),
logged AS (
  INSERT INTO public.m9_role_grant_log (role_code, permission_code)
  SELECT role_code, permission_code FROM missing
  ON CONFLICT (role_code, permission_code) DO NOTHING
  RETURNING 1
)
INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT role_id, permission_id, true FROM missing;

COMMIT;
`;
}

function genRollback(doc, pairs) {
  return `${header('M9 95 角色權限授權 rollback（只刪本檔新增的列）', doc, pairs.length)}-- 只刪 m9_role_grant_log 裡記錄的配對（也就是新增前不存在的那些）；原本就有的授權不會動。
-- 若 m9_role_grant_log 不存在，代表授權檔沒有執行過，這裡會報錯，不需要 rollback。
BEGIN;

DELETE FROM public.role_permissions rp
USING public.m9_role_grant_log l, public.roles r, public.permissions p
WHERE r.code = l.role_code
  AND p.code = l.permission_code
  AND rp.role_id = r.id
  AND rp.permission_id = p.id;

DELETE FROM public.m9_role_grant_log;

COMMIT;
`;
}

function genVerify(doc, pairs) {
  const head = header('M9 95 角色權限授權 verify（只有 SELECT）', doc, pairs.length) + '-- ok = true 代表該角色目前確實持有該權限（is_allowed = true）。\n';
  if (!pairs.length) {
    return `${head}-- 沒有勾選任何授權，回傳 0 列。
SELECT NULL::text AS role, NULL::text AS code, NULL::boolean AS ok WHERE false;
`;
  }
  return `${head}SELECT v.role_code AS role, v.permission_code AS code,
  EXISTS (
    SELECT 1
    FROM public.roles r
    JOIN public.permissions p ON p.code = v.permission_code
    JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.permission_id = p.id
    WHERE r.code = v.role_code AND rp.is_allowed
  ) AS ok
FROM (
  VALUES
${values(pairs)}
) AS v(role_code, permission_code)
ORDER BY v.role_code, v.permission_code;
`;
}

function generate(doc) {
  const pairs = collectPairs(doc);
  return {
    pairs,
    grant: genGrant(doc, pairs),
    rollback: genRollback(doc, pairs),
    verify: genVerify(doc, pairs),
  };
}

function main(argv) {
  if (!argv[0]) { console.error('用法：node grant.cjs <answers.json> [outDir]'); process.exit(2); }
  const doc = JSON.parse(fs.readFileSync(argv[0], 'utf8'));
  const outDir = argv[1] ? path.resolve(argv[1]) : DEFAULT_OUT;
  const r = generate(doc);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${BASE}.sql`), r.grant);
  fs.writeFileSync(path.join(outDir, `${BASE}.rollback.sql`), r.rollback);
  fs.writeFileSync(path.join(outDir, `${BASE}.verify.sql`), r.verify);
  console.log(`pairs ${r.pairs.length} -> ${outDir}`);
}

module.exports = { generate, collectPairs, BASE };
if (require.main === module) main(process.argv.slice(2));

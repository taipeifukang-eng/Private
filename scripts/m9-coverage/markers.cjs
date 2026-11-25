#!/usr/bin/env node
/* eslint-disable */
/**
 * 產生 docs/vue-workspace/parity-plan/m9-sql/00d_prod_legacy_content_markers.readonly.sql
 *
 * 做法：讀 scripts/m9-coverage/markers.data.cjs（人工逐支讀 migration 後寫的標記清單），
 * 轉成一份只有 SELECT 的檢查。對象是 00c 查不出有沒有套用的那些舊版 migration（00c 的 unchecked_migrations）。
 * 可重跑：同樣的資料與 README 一定產生同樣的 SQL（檔內不含時間戳）。
 *   node scripts/m9-coverage/markers.cjs            寫出 SQL 檔
 *   node scripts/m9-coverage/markers.cjs --stdout   只印到畫面
 *
 * 步驟號：標記的 superseded_by.file 會對照 m9-sql/README.md 總表換成「步驟 N」，README 步驟重排後要重跑。
 */
const fs = require('node:fs');
const path = require('node:path');
const coverage = require('./build.cjs');
const data = require('./markers.data.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const PLAN_DIR = path.join(ROOT, 'docs', 'vue-workspace', 'parity-plan');
const README = path.join(PLAN_DIR, 'm9-sql', 'README.md');
const OUT_FILE = path.join(PLAN_DIR, 'm9-sql', '00d_prod_legacy_content_markers.readonly.sql');

const sq = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const ID_RE = /^[a-z_][a-z0-9_]*$/;
const REL_RE = /^(public\.)?[a-z_][a-z0-9_]*$/;
const FN_RE = /^public\.[a-z_][a-z0-9_]*\([a-z0-9_ ,\[\]]*\)$/;
const ROLE_RE = /^[a-z_][a-z0-9_]*$/;
const CODE_RE = /^[A-Za-z0-9_.]+$/;

function must(re, v, what) {
  if (typeof v !== 'string' || !re.test(v)) throw new Error(`標記資料不合法的${what}：${JSON.stringify(v)}`);
  return v;
}
const rel = (t) => sq(must(REL_RE, t, '表名').includes('.') ? t : 'public.' + t);
const relName = (t) => (t.includes('.') ? t.split('.')[1] : t);
const needleOf = (m) => {
  if (typeof m.needle !== 'string' || !m.needle || /[\r\n]/.test(m.needle)) throw new Error('needle 必須是單行非空字串：' + JSON.stringify(m));
  return sq(m.needle);
};
const short = (s) => (s.length > 44 ? s.slice(0, 44) + '…' : s);
const bool = (b) => (b ? 'true' : 'false');

/** README 總表：檔案 -> 步驟號。 */
function readmeSteps(readmePath = README) {
  const text = fs.readFileSync(readmePath, 'utf8').replace(/\r\n/g, '\n');
  const map = new Map();
  for (const line of text.split('\n')) {
    const c = line.split('|').map((s) => s.trim());
    if (c.length < 4 || !/^\d+$/.test(c[1])) continue;
    for (const m of c[2].matchAll(/`([^`]+)`/g)) map.set(m[1], Number(c[1]));
  }
  return map;
}

/** 單一標記 -> { expr, label }。 */
function compile(m) {
  switch (m.kind) {
    case 'fn_has': return {
      label: `函式內容含「${short(m.needle)}」：${m.fn}`,
      expr: `COALESCE(position(${needleOf(m)} IN pg_get_functiondef(to_regprocedure(${sq(must(FN_RE, m.fn, '函式'))}))) > 0, false)` };
    case 'fn_lacks': return {
      label: `函式內容不含「${short(m.needle)}」：${m.fn}`,
      expr: `COALESCE(position(${needleOf(m)} IN pg_get_functiondef(to_regprocedure(${sq(must(FN_RE, m.fn, '函式'))}))) = 0, false)` };
    case 'fn_exists': return { label: `函式存在：${m.fn}`, expr: `to_regprocedure(${sq(must(FN_RE, m.fn, '函式'))}) IS NOT NULL` };
    case 'fn_absent': return { label: `函式已不存在：${m.fn}`, expr: `to_regprocedure(${sq(must(FN_RE, m.fn, '函式'))}) IS NULL` };
    case 'fn_exec': {
      const parts = Object.entries(m.grants).map(([r, b]) => `COALESCE(has_function_privilege(${sq(must(ROLE_RE, r, '角色'))}, to_regprocedure(${sq(must(FN_RE, m.fn, '函式'))}), 'EXECUTE') = ${bool(b)}, false)`);
      const desc = Object.entries(m.grants).map(([r, b]) => `${r}=${b ? '可' : '不可'}`).join('、');
      return { label: `函式 EXECUTE 授權（${desc}）：${m.fn}`, expr: parts.join(' AND ') };
    }
    case 'seq_priv': {
      const parts = Object.entries(m.grants).map(([r, b]) => `COALESCE(has_sequence_privilege(${sq(must(ROLE_RE, r, '角色'))}, to_regclass(${rel(m.seq)}), 'USAGE') = ${bool(b)}, false)`);
      const desc = Object.entries(m.grants).map(([r, b]) => `${r}=${b ? '可' : '不可'}`).join('、');
      return { label: `序列 USAGE 授權（${desc}）：${m.seq}`, expr: parts.join(' AND ') };
    }
    case 'col_exists': return {
      label: `欄位存在：${m.table}.${m.column}`,
      expr: `EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(${rel(m.table)}) AND a.attname = ${sq(must(ID_RE, m.column, '欄位'))} AND a.attnum > 0 AND NOT a.attisdropped)` };
    case 'col_type': return {
      label: `欄位型別是 ${m.type}：${m.table}.${m.column}`,
      expr: `COALESCE((SELECT format_type(a.atttypid, a.atttypmod) = ${sq(m.type)} FROM pg_attribute a WHERE a.attrelid = to_regclass(${rel(m.table)}) AND a.attname = ${sq(must(ID_RE, m.column, '欄位'))} AND a.attnum > 0 AND NOT a.attisdropped), false)` };
    case 'col_default_has': return {
      label: `欄位預設值含「${short(m.needle)}」：${m.table}.${m.column}`,
      expr: `COALESCE((SELECT position(${needleOf(m)} IN pg_get_expr(d.adbin, d.adrelid)) > 0 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = to_regclass(${rel(m.table)}) AND a.attname = ${sq(must(ID_RE, m.column, '欄位'))}), false)` };
    case 'col_comment_has': return {
      label: `欄位註解含「${short(m.needle)}」：${m.table}.${m.column}`,
      expr: `COALESCE((SELECT position(${needleOf(m)} IN col_description(a.attrelid, a.attnum)) > 0 FROM pg_attribute a WHERE a.attrelid = to_regclass(${rel(m.table)}) AND a.attname = ${sq(must(ID_RE, m.column, '欄位'))} AND a.attnum > 0 AND NOT a.attisdropped), false)` };
    case 'constraint_has': return {
      label: `約束定義含「${short(m.needle)}」：${m.name} on ${m.table}`,
      expr: `COALESCE((SELECT position(${needleOf(m)} IN pg_get_constraintdef(c.oid)) > 0 FROM pg_constraint c WHERE c.conrelid = to_regclass(${rel(m.table)}) AND c.conname = ${sq(must(ID_RE, m.name, '約束'))}), false)` };
    case 'constraint_exists': return {
      label: `約束存在：${m.name} on ${m.table}`,
      expr: `EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass(${rel(m.table)}) AND c.conname = ${sq(must(ID_RE, m.name, '約束'))})` };
    case 'constraint_absent': return {
      label: `約束已不存在：${m.name} on ${m.table}`,
      expr: `(to_regclass(${rel(m.table)}) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = to_regclass(${rel(m.table)}) AND c.conname = ${sq(must(ID_RE, m.name, '約束'))}))` };
    case 'constraint_comment_has': return {
      label: `約束註解含「${short(m.needle)}」：${m.name} on ${m.table}`,
      expr: `COALESCE((SELECT position(${needleOf(m)} IN obj_description(c.oid, 'pg_constraint')) > 0 FROM pg_constraint c WHERE c.conrelid = to_regclass(${rel(m.table)}) AND c.conname = ${sq(must(ID_RE, m.name, '約束'))}), false)` };
    case 'index_has': return {
      label: `索引定義含「${short(m.needle)}」：${m.index}`,
      expr: `COALESCE((SELECT position(${needleOf(m)} IN ix.indexdef) > 0 FROM pg_indexes ix WHERE ix.schemaname = 'public' AND ix.indexname = ${sq(must(ID_RE, m.index, '索引'))}), false)` };
    case 'index_exists': return {
      label: `索引存在：${m.index}`,
      expr: `EXISTS (SELECT 1 FROM pg_indexes ix WHERE ix.schemaname = 'public' AND ix.indexname = ${sq(must(ID_RE, m.index, '索引'))})` };
    case 'policy_has':
    case 'policy_lacks': {
      const col = { qual: "COALESCE(pp.qual, '')", with_check: "COALESCE(pp.with_check, '')", any: "COALESCE(pp.qual, '') || ' ' || COALESCE(pp.with_check, '')" }[m.part];
      if (!col) throw new Error('policy part 必須是 qual／with_check／any：' + JSON.stringify(m));
      const has = m.kind === 'policy_has';
      return {
        label: `RLS 政策${has ? '含' : '不含'}「${short(m.needle)}」（${m.part}）：${m.name} on ${m.table}`,
        expr: `COALESCE((SELECT position(${needleOf(m)} IN ${col}) ${has ? '> 0' : '= 0'} FROM pg_policies pp WHERE pp.schemaname = 'public' AND pp.tablename = ${sq(must(ID_RE, relName(m.table), '表'))} AND pp.policyname = ${sq(must(ID_RE, m.name, '政策'))}), false)` };
    }
    case 'trigger_exists': return {
      label: `觸發器存在：${m.name} on ${m.table}`,
      expr: `EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass(${rel(m.table)}) AND g.tgname = ${sq(must(ID_RE, m.name, '觸發器'))} AND NOT g.tgisinternal)` };
    case 'trigger_absent': return {
      label: `觸發器已不存在：${m.name} on ${m.table}`,
      expr: `(to_regclass(${rel(m.table)}) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass(${rel(m.table)}) AND g.tgname = ${sq(must(ID_RE, m.name, '觸發器'))} AND NOT g.tgisinternal))` };
    case 'perm_active': {
      const codes = m.codes.map((c) => sq(must(CODE_RE, c, '權限碼')));
      return {
        label: `權限碼都存在且啟用（${codes.length} 個）：${short(m.codes[0])} 等`,
        expr: `(SELECT count(DISTINCT pm.code) FROM public.permissions pm WHERE pm.code = ANY (ARRAY[${codes.join(', ')}]) AND pm.is_active) = ${codes.length}` };
    }
    case 'role_perms_all': {
      const codes = m.codes.map((c) => sq(must(CODE_RE, c, '權限碼')));
      return {
        label: `角色 ${m.role} 對 ${codes.length} 個權限碼都有授權：${short(m.codes[0])} 等`,
        expr: `(SELECT count(DISTINCT pm.code) FROM public.roles r JOIN public.role_permissions rp ON rp.role_id = r.id JOIN public.permissions pm ON pm.id = rp.permission_id WHERE r.code = ${sq(must(ROLE_RE, m.role, '角色'))} AND rp.is_allowed AND pm.is_active AND pm.code = ANY (ARRAY[${codes.join(', ')}])) = ${codes.length}` };
    }
    case 'seed_codes': {
      const codes = m.codes.map((c) => sq(must(CODE_RE, c, '代碼')));
      const t = must(ID_RE, m.table, '表');
      const inner = `SELECT count(*) AS c FROM public.${t} WHERE code = ANY (ARRAY[${codes.join(', ')}]) AND is_active`;
      return {
        label: `種子資料 ${codes.length} 筆都存在且啟用：${t}`,
        expr: `COALESCE((CASE WHEN to_regclass(${sq('public.' + t)}) IS NOT NULL THEN ${xmlCount(inner)} = ${codes.length} END), false)` };
    }
    case 'no_null': {
      const t = must(ID_RE, m.table, '表');
      const c = must(ID_RE, m.column, '欄位');
      const inner = `SELECT count(*) AS c FROM public.${t} WHERE ${c} IS NULL`;
      return {
        label: `沒有空值：${t}.${c}`,
        expr: `COALESCE((CASE WHEN EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(${sq('public.' + t)}) AND a.attname = ${sq(c)} AND NOT a.attisdropped) THEN ${xmlCount(inner)} = 0 END), false)` };
    }
    case 'all': {
      const subs = m.parts.map(compile);
      return { label: subs.map((s) => s.label).join(' 且 '), expr: '(' + subs.map((s) => s.expr).join(' AND ') + ')' };
    }
    default:
      throw new Error('未知的標記種類：' + m.kind);
  }
}

/** 以 query_to_xml 執行只讀計數（只在 CASE 條件成立時才會執行，所以表或欄位不存在不會讓整份報錯）。 */
function xmlCount(innerSql) {
  return `((xpath('/row/c/text()', query_to_xml(${sq(innerSql)}, false, true, '')))[1]::text::bigint)`;
}

/** 把文字裡的 {{m9-sql/xx.sql}} 換成「步驟 N」（N 取自 README 總表）。 */
function refs(text, steps) {
  return String(text).replace(/\{\{([^}]+)\}\}/g, (_, f) => {
    const n = steps.get(f.trim());
    if (!n) throw new Error('文字引用的檔案不在 README 總表：' + f);
    return '步驟 ' + n;
  });
}

function supText(sup, steps) {
  if (!sup) return null;
  if (!sup.file) return refs(sup.note, steps);
  const n = steps.get(sup.file);
  if (!n) throw new Error('superseded_by 的檔案不在 README 總表：' + sup.file);
  return `步驟 ${n}（${sup.file}）：${refs(sup.note, steps)}`;
}

function build({ readmePath = README, dataOverride = null, unchecked = null } = {}) {
  const d = dataOverride || data;
  const unchk = unchecked || coverage.build().unchecked;
  const steps = readmeSteps(readmePath);

  const seen = new Set();
  for (const mg of d.migrations) {
    if (seen.has(mg.migration)) throw new Error('標記資料重複的 migration：' + mg.migration);
    seen.add(mg.migration);
    if (!mg.markers.length) throw new Error('migration 沒有標記：' + mg.migration);
  }
  for (const u of d.undeterminable) {
    if (seen.has(u.migration)) throw new Error('migration 同時有標記與「無法判斷」：' + u.migration);
    seen.add(u.migration);
  }
  const missingFromData = unchk.filter((m) => !seen.has(m));
  const extraInData = [...seen].filter((m) => !unchk.includes(m));
  if (missingFromData.length) throw new Error('00c 的 unchecked_migrations 有 migration 還沒寫標記：' + missingFromData.join(', '));
  if (extraInData.length) throw new Error('標記資料裡有不在 00c unchecked_migrations 的 migration：' + extraInData.join(', '));

  const rows = [];
  for (const mg of d.migrations) {
    for (const m of mg.markers) {
      const c = compile(m);
      if (!m.meaning) throw new Error('標記缺 meaning：' + c.label);
      rows.push({ migration: mg.migration, label: c.label, meaning: refs(m.meaning, steps), sup: supText(m.superseded_by, steps), expr: c.expr, kind: m.kind });
    }
  }
  const und = d.undeterminable.map((u) => ({ migration: u.migration, reason: refs(u.reason, steps) }));
  const obs = (d.observations || []).map((o) => ({ ...o, label: refs(o.label, steps) }));
  const sql = renderSql({ rows, undeterminable: und, observations: obs, migrationCount: d.migrations.length });
  return { sql, rows, undeterminable: und, observations: obs };
}

function obsExpr(o) {
  const guards = o.requires.map((r) => {
    const [s, t, c] = r.split('.');
    return `EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(${sq(s + '.' + t)}) AND a.attname = ${sq(c)} AND NOT a.attisdropped)`;
  });
  return `CASE WHEN ${guards.join(' AND ')} THEN ${xmlCount(o.sql)} END`;
}

function renderSql({ rows, undeterminable, observations, migrationCount }) {
  const supCount = rows.filter((r) => r.sup).length;
  const header = `-- M9 上線前唯讀檢查 00d：00c 查不出的那些舊版 migration（只改函式內容、授權、約束、資料），正式區到底有沒有套用？
-- 為什麼要跑：00c 只能確認「物件存在」。有 ${migrationCount + undeterminable.length} 支舊版 migration 沒有新建任何物件，只是改寫函式本文、收回或補上授權、換約束內容、補權限授與或資料，
--   物件早就存在，所以 00c 看不出它們有沒有跑過（結果的 unchecked_migrations 就是這幾支）。這份對每一支挑 1～3 個「套用後才會成立」的記號，
--   直接比對正式區現況（函式內容含不含某段字串、誰有 EXECUTE 權、約束定義、欄位型別、註解、權限授與、種子資料）。標記清單是人工逐支讀過 migration 內容挑的。
--
-- 怎麼用（老闆照做即可）：
--   1. 打開正式區 Supabase 的 SQL Editor，新開一個查詢。
--   2. 把這個檔案整份貼上，按 Run。
--   3. 結果只有一列一格（欄位名 result，內容是一段 JSON）。點開那一格，整段複製，貼回給我。
--   4. 這份只有查詢，不會建立、修改、刪除任何東西，可以隨時重複執行。
--
-- 怎麼看結果：
--   generated_at     執行時間
--   total_checked    總共檢查幾個標記
--   present_count    正式區成立的標記數
--   missing          不成立的標記清單；每筆有 migration（哪一支舊版 migration）、marker（查什麼）、meaning（成立代表什麼）、
--                    superseded_by（有寫的話，代表後面哪個步驟會蓋掉它：那一項缺了無妨，或重跑時變「缺」是預期的；null 代表沒有被取代，缺了就是真的沒套用）
--   undeterminable   「無法以唯讀查詢判斷」的 migration（純資料修補、跑完不留痕跡），每筆說明風險與後續是否被 m9 步驟取代
--   observations     給無法判斷的資料修補用的輔助數字：還會被那支 migration 改動幾筆（0 = 已修或本來就不需要）；null = 該表或欄位不存在
--   missing 是空的 []，代表這 ${migrationCount} 支舊版 migration 的記號正式區都成立。
--   missing 裡 superseded_by 不是 null 的項目，多半不用處理；superseded_by 是 null 的項目才要逐一回報給 Claude，由 Claude 判斷是補套用該支 migration 還是已有替代做法。
--
-- 判斷規則：
--   以「舊版 migration 全部套用後的最終狀態」為準：後面還有別支舊版覆蓋的函式，只挑最後一版仍保留的字串。
--   記號只看唯讀目錄（pg_get_functiondef、pg_get_constraintdef、has_function_privilege、pg_policies、permissions 與 role_permissions 等），不會執行任何寫入。
--   資料庫裡不存在的函式、表、約束一律當作「不成立」，不會讓整份查詢報錯。
--   正式區有人手動改過（例如老闆用權限勾選頁改了授權）時，授權類記號會缺，標在 superseded_by 的說明裡。
--
-- 檢查範圍（共 ${rows.length} 個標記，來自 ${migrationCount} 支舊版 migration，其中 ${supCount} 個標有 superseded_by；另有 ${undeterminable.length} 支列為無法判斷）。
-- 本檔由 scripts/m9-coverage/markers.cjs 依 scripts/m9-coverage/markers.data.cjs 自動產生，請勿手改；標記或 README 步驟有變動時重跑：node scripts/m9-coverage/markers.cjs
-- 只用 SELECT／WITH 與 to_regprocedure、to_regclass、pg_get_functiondef、pg_get_constraintdef、has_function_privilege、pg_catalog、pg_policies、pg_indexes、public.permissions／roles／role_permissions 查詢。
`;

  const vals = rows.map((r) => `  (${sq(r.migration)}, ${sq(r.label)}, ${sq(r.meaning)}, ${r.sup ? sq(r.sup) : 'NULL'}, ${r.expr})`).join(',\n');
  const undJson = JSON.stringify(undeterminable.map((u) => ({ migration: u.migration, reason: u.reason })));
  const obsVals = observations.map((o) => `jsonb_build_object('migration', ${sq(o.migration)}, 'label', ${sq(o.label)}, 'pending_rows', ${obsExpr(o)})`);

  return `${header}WITH items(migration, marker, meaning, superseded_by, ok) AS (VALUES
${vals}
)
SELECT jsonb_build_object(
         'generated_at', to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD"T"HH24:MI:SS') || '+08:00',
         'total_checked', (SELECT count(*) FROM items),
         'present_count', (SELECT count(*) FROM items WHERE ok),
         'missing', coalesce((SELECT jsonb_agg(jsonb_build_object('migration', migration, 'marker', marker, 'meaning', meaning, 'superseded_by', superseded_by) ORDER BY migration, marker) FROM items WHERE NOT ok), '[]'::jsonb),
         'undeterminable', ${sq(undJson)}::jsonb,
         'observations', ${obsVals.length ? 'jsonb_build_array(\n           ' + obsVals.join(',\n           ') + '\n         )' : "'[]'::jsonb"}
       ) AS result;
`;
}

module.exports = { build, compile, readmeSteps, renderSql, OUT_FILE, README, xmlCount };

if (require.main === module) {
  const { sql, rows, undeterminable } = build();
  if (process.argv.includes('--stdout')) process.stdout.write(sql);
  else {
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, sql, 'utf8');
  }
  console.error(`標記 ${rows.length}（來自 ${new Set(rows.map((r) => r.migration)).size} 支 migration），無法判斷 ${undeterminable.length} 支`);
}

// 驗證 M7M8 第 6 批「撤回 49 與 46 → 確認回到套用前 → 再套用 46 → 再套用 49」在 DEV 可往返（可重跑）。
// 目的：46 的 ga_ws_po_list attention 篩選有「舊寫法」與「純量子查詢新寫法」兩種，撤回正規式必須兩種都吃得下；
//       49 把八個述詞函式的 search_path 重設，撤回要設回去，再套用要重設，且最後 ga_ws_po_list 的定義與開始時完全一致。
// 步驟：
//   0. 快照：ga_ws_po_list 定義（含新寫法）、八個述詞函式 proconfig 為 NULL、ga_ws_home_summary 存在。
//   1. 撤回 49（150000 rollback）→ 八個函式 proconfig 有 search_path。
//   2. 撤回 46（120000 rollback）→ ga_ws_po_list 不含 v_attention 與 ga_att_po（回到套用前）、仍含 v_approvals；ga_ws_home_summary／ga_att_* 已移除。
//   3. 再套用 46（120000）→ ga_ws_po_list 含新寫法 (SELECT has_permission(...))；ga_ws_home_summary 存在。
//   4. 再套用 49（150000）→ 八個函式 proconfig 為 NULL，ga_ws_po_list 定義與快照逐字相同。
// 任何一步失敗都會嘗試把 DEV 補回完整套用狀態（再套用 120000、150000），並以非 0 結束碼結束。
// 只連 DEV：只解析 .env.development.local，並確認 supabase CLI 連結的專案 ref 以 mjpd 開頭。不連正式區、不輸出金鑰。
// 注意：執行期間 DEV 的首頁摘要與採購單 attention 篩選會短暫不存在，請不要與其他整合測試同時執行。
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { assertDevEnvironment, applyDevEnv } = require("../tests/support/env-guard.cjs");
const { env } = assertDevEnvironment({ root });
applyDevEnv(env);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (!ref.startsWith("mjpd")) throw Error("連線目標不是 DEV（ref 不是 mjpd 開頭），停止");
if (fs.readFileSync(path.join(root, "supabase/.temp/project-ref"), "utf8").trim() !== ref)
  throw Error("supabase CLI 連結的專案不是 DEV，停止");

const F46 = "supabase/workspace-dev/20261118120000_m7m8_b6_stats_home.sql";
const F46R = "supabase/workspace-dev/20261118120000_m7m8_b6_stats_home.rollback.sql";
const F49 = "supabase/workspace-dev/20261118150000_m7m8_b6_perf_inline_predicates.sql";
const F49R = "supabase/workspace-dev/20261118150000_m7m8_b6_perf_inline_predicates.rollback.sql";
const SIGS = [
  "ga_po_today()",
  "ga_att_request_intake(text)",
  "ga_att_store_wait(text)",
  "ga_att_po_overdue(text,date)",
  "ga_att_po(text,date,boolean)",
  "ga_att_transfer_overdue(text,timestamp with time zone,integer)",
  "ga_ub_is_overdue(date,date,timestamp with time zone)",
  "ga_wo_focus(text,text)",
];

function sup(args) {
  const r = spawnSync("supabase", ["db", "query", "--linked", ...args], { cwd: root, encoding: "utf8", shell: true });
  if (r.status) throw Error(`supabase db query 失敗（結束碼 ${r.status}）：${`${r.stdout}${r.stderr}`.slice(0, 800)}`);
  return r.stdout;
}
const runFile = (f) => {
  console.log(`  執行 ${f}`);
  sup(["--file", f]);
};
function query(sql) {
  const file = path.join(os.tmpdir(), `b6-wr-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(file, sql);
  try {
    const out = sup(["--file", file, "-o", "json"]);
    return JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)).rows;
  } finally {
    fs.rmSync(file, { force: true });
  }
}
const poListDef = () =>
  query(`SELECT pg_get_functiondef('public.ga_ws_po_list(jsonb,integer,integer)'::regprocedure) AS d`)[0].d;
const exists = (sig) => query(`SELECT to_regprocedure('public.${sig}') IS NOT NULL AS e`)[0].e;
const configs = () =>
  query(`SELECT s AS sig, (SELECT p.proconfig::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.' || s)) AS cfg
           FROM unnest(ARRAY[${SIGS.map((s) => `'${s}'`).join(",")}]) s`);
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` ${extra}`}`);
  if (!ok) failed += 1;
  return ok;
};
const allNull = (rows) => rows.every((r) => r.cfg === null);
const allPinned = (rows) => rows.every((r) => r.cfg && r.cfg.includes("search_path"));
const NEW_FORM = "(SELECT has_permission(v_uid, 'general_affairs.purchase_order.approve'))";

let snapshot = null;
try {
  console.log(`DEV（${ref.slice(0, 4)}…）開始：撤回 49 → 撤回 46 → 再套用 46 → 再套用 49`);
  console.log("0. 快照");
  snapshot = poListDef();
  check("開始：ga_po_list 含 attention 新寫法（純量子查詢）", snapshot.includes(NEW_FORM));
  check("開始：八個述詞函式 proconfig 皆為 NULL", allNull(configs()), JSON.stringify(configs()));
  check("開始：ga_ws_home_summary 存在", exists("ga_ws_home_summary()"));
  if (failed) throw Error("起始狀態不是完整套用（請先用 scripts/apply-workspace-m7m8-b6-dev.cjs 套用），停止");

  console.log("1. 撤回 49");
  runFile(F49R);
  check("撤回 49：八個函式 search_path 已設回", allPinned(configs()), JSON.stringify(configs()));

  console.log("2. 撤回 46");
  runFile(F46R);
  const d2 = poListDef();
  check("撤回 46：ga_ws_po_list 不含 v_attention", !d2.includes("v_attention"));
  check("撤回 46：ga_ws_po_list 不含 ga_att_po", !d2.includes("ga_att_po"));
  check("撤回 46：ga_ws_po_list 不含 has_permission 的純量子查詢新寫法", !d2.includes(NEW_FORM));
  check("撤回 46：ga_ws_po_list 仍保留 v_approvals 篩選", d2.includes("v_approvals"));
  check("撤回 46：ga_ws_home_summary 與 ga_att_po 已移除", !exists("ga_ws_home_summary()") && !exists("ga_att_po(text,date,boolean)"));

  console.log("3. 再套用 46");
  runFile(F46);
  const d3 = poListDef();
  check("再套用 46：ga_ws_po_list 含 attention 新寫法", d3.includes(NEW_FORM));
  check("再套用 46：ga_ws_home_summary 存在", exists("ga_ws_home_summary()"));

  console.log("4. 再套用 49");
  runFile(F49);
  check("再套用 49：八個函式 proconfig 皆為 NULL", allNull(configs()), JSON.stringify(configs()));
  check("最後 ga_ws_po_list 定義與開始時逐字相同", poListDef() === snapshot);
} catch (e) {
  failed += 1;
  console.log(`FAIL  ${e.message}`);
  console.log("嘗試補回完整套用狀態（再套用 120000、150000）…");
  try {
    runFile(F46);
    runFile(F49);
  } catch (e2) {
    console.log(`補回失敗：${e2.message}`);
  }
}
console.log(failed ? `結果：${failed} 項失敗` : "結果：全部通過，DEV 已回到完整套用狀態");
process.exit(failed ? 1 : 0);

// 在 DEV 執行 00c 並把「缺」的項目分類（只連 DEV，ref 必須以 mjpd 開頭）。
// 用法：node scripts/m9-coverage/run-dev.cjs [輸出 json 路徑]
// DEV 的 supabase_migrations 只套用到 20260813063209，之後的舊版 migration 本來就沒走 migration 流程套用（多半改由 workspace-dev 草稿補），
// 所以 DEV 有缺是預期的。這支把缺的項目分成三類，第三類（無法解釋）必須是 0，否則代表產生器誤判：
//   not_in_dev_history      建立它的 migration 不在 DEV 的 migration 歷史，且 workspace-dev 草稿也沒補
//   superseded_by_workspace 後來被 workspace-dev 草稿刻意刪除或改名（對照 SUPERSEDED）
//   unexplained             無法解釋 -> 產生器誤判或 DEV 異常
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const root = path.resolve(__dirname, "..", "..");
const { assertDevEnvironment, applyDevEnv } = require("../../tests/support/env-guard.cjs");
const { env } = assertDevEnvironment({ root });
applyDevEnv(env);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (!ref.startsWith("mjpd")) throw Error("連線目標不是 DEV（ref 不是 mjpd 開頭），停止");
if (fs.readFileSync(path.join(root, "supabase/.temp/project-ref"), "utf8").trim() !== ref) throw Error("supabase CLI 連結的專案不是 DEV，停止");

// workspace-dev 草稿刻意刪掉舊版政策（改成 insert／update 分開的新政策）
const SUPERSEDED = [
  /^p1e_ga_(vendors|service_categories|service_regions)_write on public\./,
];

function query(sqlText) {
  const tmp = path.join(os.tmpdir(), `m9cov-${process.pid}.sql`);
  fs.writeFileSync(tmp, sqlText);
  try {
    const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", `supabase db query --linked --file '${tmp}'`], { encoding: "utf8", cwd: root, maxBuffer: 256 * 1024 * 1024 });
    if (r.status) throw Error(r.stderr);
    return JSON.parse(r.stdout).rows;
  } finally { fs.rmSync(tmp, { force: true }); }
}

const file = path.join(root, "docs/vue-workspace/parity-plan/m9-sql/00c_prod_legacy_migration_coverage.readonly.sql");
const result = query(fs.readFileSync(file, "utf8"))[0].result;
const history = new Set(query("select version from supabase_migrations.schema_migrations").map((r) => r.version));
const classify = (m) => {
  if (SUPERSEDED.some((re) => re.test(m.name))) return "superseded_by_workspace";
  if (!history.has(m.migration.slice(0, 14))) return "not_in_dev_history";
  return "unexplained";
};
const groups = { not_in_dev_history: [], superseded_by_workspace: [], unexplained: [] };
for (const m of result.missing) groups[classify(m)].push(m);
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 1));
console.log(JSON.stringify({
  generated_at: result.generated_at, total_checked: result.total_checked, present_count: result.present_count,
  missing_total: result.missing.length, migrations_checked: result.migrations_checked,
  migrations_all_missing: result.migrations_all_missing, migrations_partial: result.migrations_partial,
  dev_history_latest: [...history].sort().pop(),
  counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])),
  unexplained: groups.unexplained,
}, null, 1));
process.exit(groups.unexplained.length ? 2 : 0);

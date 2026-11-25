// 在 DEV 執行 00d 並把「缺」的標記分類（只連 DEV：supabase/.temp/project-ref 必須以 mjpd 開頭；不讀任何 .env*）。
// 用法：node scripts/m9-coverage/run-dev-markers.cjs [輸出 json 路徑]
// DEV 的 supabase_migrations 只記到 20260813063209，之後的舊版 migration 本來就多半沒走 migration 流程套用（改由 workspace-dev 草稿補），
// 所以 DEV 有缺是預期的。下面 DEV_EXPECTED 逐項寫明原因；不在清單內的缺項（unexplained）必須是 0，否則代表標記或 DEV 異常，結束碼 2。
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..", "..");
const ref = fs.readFileSync(path.join(root, "supabase/.temp/project-ref"), "utf8").trim();
if (!ref.startsWith("mjpd")) throw Error("supabase CLI 連結的專案不是 DEV（ref 不是 mjpd 開頭），停止");

const DEV_EXPECTED = [
  { migration: "20260826023000", reason: "DEV 沒走這支 migration（DEV 的 migration 歷史只到 20260813063209）；DEV 這兩個政策還是 baseline 版，只認 employee.manage／store.manage／employee.movement.manage，沒有 employee.promotion.batch。" },
  { migration: "20260926153000", reason: "DEV 沒有 general_affairs 與 store_manager_role 兩個角色代碼（DEV 的總務與店長角色用別的代碼，授權由 workspace-dev 草稿決定）；DEV 的 admin 也沒有 maintenance_request.view_own_store、work_order.view_own_store 兩碼。正式區有這三個角色，這三項才有意義。" },
  { migration: "20261004100000", reason: "DEV 的 store_performance.business_days 型別已是 numeric(4,1)（型別標記成立），但欄位沒有這支 migration 附的 COMMENT。" },
  { migration: "20261004110000", reason: "DEV 的 monthly_store_summary.business_days 型別已是 numeric(4,1)（型別標記成立），但沒有這支 migration 附的 COMMENT。" },
  { migration: "20261007120000", reason: "DEV 的 valid_movement_type 約束已含 acting_manager（約束標記成立，由 workspace-dev 的異動批次草稿改的），但 movement_type 欄位沒有這支 migration 附的 COMMENT。" },
];

const r = spawnSync("supabase", ["db", "query", "--linked", "--file", path.join(root, "docs/vue-workspace/parity-plan/m9-sql/00d_prod_legacy_content_markers.readonly.sql"), "-o", "json"], { encoding: "utf8", cwd: root, maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
if (r.status) throw Error(r.stderr);
const result = JSON.parse(r.stdout).rows[0].result;
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 1));
const explained = [], unexplained = [];
for (const m of result.missing) {
  const e = DEV_EXPECTED.find((x) => m.migration.startsWith(x.migration));
  (e ? explained : unexplained).push(e ? { ...m, dev_reason: e.reason } : m);
}
console.log(JSON.stringify({
  generated_at: result.generated_at, total_checked: result.total_checked, present_count: result.present_count,
  missing_total: result.missing.length, explained: explained.length, unexplained: unexplained.length,
  observations: result.observations, unexplained_items: unexplained,
}, null, 1));
process.exit(unexplained.length ? 2 : 0);

// 套用 W06（異動回寫每月人員名冊）的 DEV SQL；加 --rollback 則依相反順序執行 rollback。
const { spawnSync } = require("child_process");
const fs = require("fs");
require("@next/env").loadEnvConfig(process.cwd(), true);
const e = process.env;
const ref = new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (
  ref !== "mjpdfpxqttbhzeimmtqr" ||
  e.EXPECTED_SUPABASE_PROJECT_REF !== ref ||
  e.ALLOW_DEV_DATABASE_OPERATIONS !== "true" ||
  e.ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS !== "true" ||
  fs.readFileSync("supabase/.temp/project-ref", "utf8").trim() !== ref
)
  throw Error("DEV environment mismatch");
for (const script of [
  "verify-dev-supabase-environment.js",
  "verify-dev-supabase-cli-environment.js",
]) {
  const r = spawnSync(process.execPath, ["scripts/" + script], {
    stdio: "inherit",
  });
  if (r.status) process.exit(r.status);
}
const rollback = process.argv.includes("--rollback");
const base = [
  "20261106100000_w06_roster_recompute",
  "20261106110000_w06_c_movement_edit_delete",
];
const files = (rollback ? base.slice().reverse() : base).map(
  (n) => `supabase/workspace-dev/${n}${rollback ? ".rollback" : ""}.sql`,
);
for (const file of files) {
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `supabase db query --linked --file ${file}`],
    { stdio: "inherit" },
  );
  if (r.status) process.exit(r.status);
}
if (!rollback)
  console.log(
    "提醒：workspace_movement_save／promotion_save／transfer_confirm 只定義在 P02 檔，全新環境請接著執行 apply-workspace-p02-dev.cjs，最後執行 apply-workspace-m2h-dev.cjs（H 組欄位與限制）。",
  );

// 套用 M2 後續問卷 H 組（階段欄位、調店確認改任一方督導、代理結束）的 DEV SQL；加 --rollback 則依相反順序執行 rollback。
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
  "20261107100000_m2h_stage_and_transfer_confirm",
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
    "提醒：函式新定義在 W05／W06／W06 C／P02 各檔內，全新環境請依序套用 w05、w06、p02，最後套用本檔（本檔只含欄位、限制與回填）。",
  );

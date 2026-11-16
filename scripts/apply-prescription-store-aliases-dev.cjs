// 把「處方箋簡稱對照表」migration 套用到 DEV（mjpdfpxqttbhzeimmtqr）。
// 用法：node scripts/apply-prescription-store-aliases-dev.cjs [--rollback]
// 只允許 DEV；任何環境不符一律中止，不會連到正式區。不輸出任何金鑰。
const { spawnSync } = require("child_process");
const fs = require("fs");
require("@next/env").loadEnvConfig(process.cwd(), true);
const e = process.env;
const ref = new URL(e.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (
  ref !== "mjpdfpxqttbhzeimmtqr" ||
  ref.startsWith("odvk") ||
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
const file = process.argv.includes("--rollback")
  ? "supabase/rollback_prescription_store_aliases.sql"
  : "supabase/migrations/20261116100000_prescription_store_aliases.sql";
const r = spawnSync(
  "powershell.exe",
  ["-NoProfile", "-Command", `supabase db query --linked --file ${file}`],
  { stdio: "inherit" },
);
process.exit(r.status || 0);

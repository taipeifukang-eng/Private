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
const r = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    "supabase db query --linked --file supabase/workspace-dev/20261029120000_vue_transfer_version.sql",
  ],
  { stdio: "inherit" },
);
process.exit(r.status || 0);






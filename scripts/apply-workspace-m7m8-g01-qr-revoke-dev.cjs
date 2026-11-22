// 套用 M7M8 第 1 批的 QR 自動作廢觸發器（ga_revoke_asset_qr_on_terminal_status）到 DEV；加 --rollback 則依相反順序執行 rollback。
// DEV 原本缺這個函式與觸發器（正式區 migration 20260826030000 有）。可重複執行。
// 環境守衛只解析 .env.development.local（不讀 .env.local），並確認 supabase CLI 連結的專案是 DEV。
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { assertDevEnvironment, applyDevEnv } = require("../tests/support/env-guard.cjs");
const { env } = assertDevEnvironment({ root });
applyDevEnv(env);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (fs.readFileSync(path.join(root, "supabase/.temp/project-ref"), "utf8").trim() !== ref)
  throw Error("supabase CLI 連結的專案不是 DEV，停止");
const rollback = process.argv.includes("--rollback");
const base = ["20261109120000_m7m8_g01_asset_qr_auto_revoke"];
const files = (rollback ? base.slice().reverse() : base).map(
  (n) => `supabase/workspace-dev/${n}${rollback ? ".rollback" : ""}.sql`,
);
for (const file of files) {
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `supabase db query --linked --file ${file}`],
    { stdio: "inherit", cwd: root },
  );
  if (r.status) process.exit(r.status);
}

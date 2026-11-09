// 套用 M7M8 第 1 批的分類、料件、型號、適用料件資料庫函式（ga_ws_*）到 DEV；加 --rollback 則執行 rollback。
// 只新增函式，不改既有資料表與舊版函式。可重複執行。
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
const base = ["20261109130000_m7m8_g01_catalog_rules"];
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

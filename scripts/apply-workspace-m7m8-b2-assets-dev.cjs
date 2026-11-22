// 套用 M7M8 第 2 批（G06-G10）資料庫物件到 DEV：A 異動紀錄與轉移單、B 設施貼標與設備／設施貼標流程、C Excel 匯入與維修紀錄；加 --rollback 則反向執行 rollback。
// 不修改舊版函式與既有資料欄位（B 只新增 ga_facilities 的貼標欄位，並擴充附件管理函式讓店長能替自己門市的設施上傳貼標照）。可重複執行。
// 環境守衛只解析 .env.development.local（不讀 .env.local），並確認 supabase CLI 連結的專案是 DEV。
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { assertDevEnvironment, applyDevEnv } = require("../tests/support/env-guard.cjs");
const { env } = assertDevEnvironment({ root });
applyDevEnv(env);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (!ref.startsWith("mjpd")) throw Error("連線目標不是 DEV（ref 不是 mjpd 開頭），停止");
if (fs.readFileSync(path.join(root, "supabase/.temp/project-ref"), "utf8").trim() !== ref)
  throw Error("supabase CLI 連結的專案不是 DEV，停止");
const rollback = process.argv.includes("--rollback");
const base = [
  "20261110100000_m7m8_b2_asset_events_transfers",
  "20261110110000_m7m8_b2_onboarding",
  "20261110120000_m7m8_b2_import_history",
];
const files = (rollback ? base.slice().reverse() : base).map(
  (n) => `supabase/workspace-dev/${n}${rollback ? ".rollback" : ""}.sql`,
);
for (const file of files) {
  console.log(`${rollback ? "rollback" : "apply"} ${file}`);
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `supabase db query --linked --file ${file}`],
    { stdio: "inherit", cwd: root },
  );
  if (r.status) process.exit(r.status);
}

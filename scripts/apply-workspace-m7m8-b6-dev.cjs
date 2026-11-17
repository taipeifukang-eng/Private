// 套用 M7M8 第 6 批（G20 分類區域、G21 廠商、G22 統計、G23 水電網費、G24 首頁）資料庫物件到 DEV：090000 欄位與收緊版 RLS 與縣市行政區、100000 廠商與分類區域函式、110000 水電帳單、120000 統計與首頁、130000 DEV 測試角色；加 --rollback 則反向執行 rollback。
// 檔案不存在（該階段還沒做）就略過。可重複執行。
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
  "20261118090000_m7m8_b6_vendor_columns_rls",
  "20261118100000_m7m8_b6_vendor_rpc",
  "20261118110000_m7m8_b6_utility_bills",
  "20261118120000_m7m8_b6_stats_home",
  "20261118130000_m7m8_b6_dev_seed",
];
const files = (rollback ? base.slice().reverse() : base)
  .map((n) => `supabase/workspace-dev/${n}${rollback ? ".rollback" : ""}.sql`)
  .filter((f) => {
    const exists = fs.existsSync(path.join(root, f));
    if (!exists) console.log(`skip (not present) ${f}`);
    return exists;
  });
for (const file of files) {
  console.log(`${rollback ? "rollback" : "apply"} ${file}`);
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `supabase db query --linked --file ${file}`],
    { stdio: "inherit", cwd: root },
  );
  if (r.status) process.exit(r.status);
}

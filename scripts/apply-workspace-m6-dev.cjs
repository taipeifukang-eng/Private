// 套用 M6 資料庫物件到 DEV：20261121100000 關係會員銷售明細去重匯入函式、20261122100000 商品主檔操作紀錄表、20261122110000 缺貨回報交易函式、20261122130000 督導日誌軟刪除函式；加 --rollback 則反向執行 rollback。
// 檔案不存在就略過。可重複執行。環境守衛只解析 .env.development.local，並確認 supabase CLI 連結的專案是 DEV（ref 以 mjpd 開頭）。
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
const base = ["20261121100000_m6_relationship_sales_import", "20261122100000_m6_products_master_logs", "20261122110000_m6_stockout_rpc", "20261122130000_m6_supervisor_log_rpc"];
const files = (rollback ? base.slice().reverse() : base)
  .map((n) => `supabase/workspace-dev/${n}${rollback ? ".rollback" : ""}.sql`)
  .filter((f) => {
    const exists = fs.existsSync(path.join(root, f));
    if (!exists) console.log(`skip (not present) ${f}`);
    return exists;
  });
for (const file of files) {
  console.log(`${rollback ? "rollback" : "apply"} ${file}`);
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", `supabase db query --linked --file ${file}`], { stdio: "inherit", cwd: root });
  if (r.status) process.exit(r.status);
}

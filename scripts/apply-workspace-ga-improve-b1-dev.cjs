// 套用 總務採購與請款改善第一批（ga-improve-b1）資料庫物件到 DEV：100000 買受人公司、110000 含稅與調整列、120000 付款方式與同仁代墊、130000 預付款、140000 DEV 測試資料與清除函式；加 --rollback 反向執行 rollback。
// 檔案不存在（該階段還沒做）就略過。可重複執行。可用 --only=100000 只跑一份。
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
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const base = [
  "20261125100000_ga_improve_b1_buyer_companies",
  "20261125110000_ga_improve_b1_po_tax_adjust",
  "20261125120000_ga_improve_b1_pay_methods_payee",
  "20261125130000_ga_improve_b1_prepay",
  "20261125140000_ga_improve_b1_dev_seed",
].filter((n) => !only || n.includes(only));
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

// 套用 M7M8 第 4.5 批（G45 進貨憑證、發票、請款單、付款標記、作廢進貨）資料庫物件到 DEV：100000 進貨憑證與發票表、110000 請款單表、120000 廠商銀行欄位、130000 附件資源類型、140000 權限碼、145000 DEV 測試角色與清除函式、150000 函式、160000 統計與徽章、170000 作廢進貨、20261120 追加（100000 廠商銀行修改歷程、110000 請款規則 F1／F3／尾差重驗、120000 草稿逾 14 天提醒）；加 --rollback 則反向執行 rollback。
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
  "20261119100000_m7m8_b45_receipt_voucher",
  "20261119110000_m7m8_b45_payment_requests",
  "20261119120000_m7m8_b45_vendor_bank",
  "20261119130000_m7m8_b45_attachment_types",
  "20261119140000_m7m8_b45_permissions",
  "20261119145000_m7m8_b45_dev_seed",
  "20261119150000_m7m8_b45_functions",
  "20261119160000_m7m8_b45_analysis",
  "20261119170000_m7m8_b45_receipt_void",
  "20261120100000_m7m8_b45f_vendor_bank_log",
  "20261120110000_m7m8_b45f_pay_rules",
  "20261120120000_m7m8_b45f_stale_draft",
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

// 套用 M7M8 第 4 批（G25 採購單等）資料庫物件到 DEV：A 需求單規則資料結構、B 採購單、（C 到貨驗入與配發、D 資產移轉搬單由後續階段新增）、DEV 專用測試清除與測試角色；加 --rollback 則反向執行 rollback。
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
  "20261112100000_m7m8_b4_request_rules",
  "20261112110000_m7m8_b4_purchase_orders",
  "20261112120000_m7m8_b4_receipt_dispatch",
  "20261112130000_m7m8_b4_asset_transfer_follow",
  "20261112140000_m7m8_b4_dev_test_cleanup",
  "20261112150000_m7m8_b4_dev_roles",
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

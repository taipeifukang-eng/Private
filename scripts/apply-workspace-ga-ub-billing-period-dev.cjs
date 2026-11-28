// 套用「水電帳單計費期間」欄位、函式到 DEV：supabase/workspace-dev/20261127130000_ga_ub_billing_period.sql；加 --rollback 反向執行。
// 環境守衛只解析 .env.development.local（不讀 .env.local），並確認 supabase CLI 連結的專案是 DEV。可重複執行。
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { assertDevEnvironment, applyDevEnv } = require("../tests/support/env-guard.cjs");
const { env } = assertDevEnvironment({ root });
applyDevEnv(env);
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (!ref.startsWith("mjpd")) throw Error("連線目標不是 DEV（ref 不是 mjpd 開頭），停止");
if (fs.readFileSync(path.join(root, "supabase/.temp/project-ref"), "utf8").trim() !== ref) throw Error("supabase CLI 連結的專案不是 DEV，停止");
const rollback = process.argv.includes("--rollback");
const file = `supabase/workspace-dev/20261127130000_ga_ub_billing_period${rollback ? ".rollback" : ""}.sql`;
console.log(`${rollback ? "rollback" : "apply"} ${file}`);
const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", `supabase db query --linked --file ${file}`], { stdio: "inherit", cwd: root });
process.exit(r.status || 0);

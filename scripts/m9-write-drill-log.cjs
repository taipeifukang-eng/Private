// 把 M9 F01S 備援開關的 DEV 演練結果寫成 docs/vue-workspace/parity-plan/m9-fallback-drill.md。
// 資料來源：e2e 劇本（tests/e2e/M9-F01S.fallback-journey.e2e.spec.ts）跑完留下的 tests/reports/_shots_m9/drill-*.json，
// 以及整合測試的 summary（只引用 runId，不複製機密）。這支不連資料庫、不讀任何 env 檔。
// 用法：node scripts/m9-write-drill-log.cjs [--integration-run <runId>]
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const dir = path.join(root, "tests", "reports", "_shots_m9");
const out = path.join(root, "docs", "vue-workspace", "parity-plan", "m9-fallback-drill.md");
const idx = process.argv.indexOf("--integration-run");
const integrationRun = idx > 0 ? process.argv[idx + 1] : "";

const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^drill-.*\.json$/.test(f)).sort() : [];
if (!files.length) {
  console.error("找不到演練紀錄（tests/reports/_shots_m9/drill-*.json），請先跑 e2e：node tests/run-all.cjs --layers e2e --page M9-F01S");
  process.exit(2);
}
const taipei = (iso) => new Date(iso).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
const lines = [];
lines.push("# M9 F01S 備援開關演練紀錄（DEV）");
lines.push("");
lines.push("這份紀錄由 `scripts/m9-write-drill-log.cjs` 依 e2e 劇本跑完的結果自動產生，不是手寫。環境：DEV 資料庫（ref 以 mjpd 開頭）、測試站 3002（整合模式）。");
lines.push("");
lines.push("## 演練目的");
lines.push("");
lines.push("2026-11-23 上線準備問卷 N2：上線後某一頁出問題時，系統管理員要能單獨把它切回舊版、之後再切回新版，**不需要重新部署**，並預先在 DEV 演練過。");
lines.push("");
lines.push("## 演練內容（每個裝置各跑一次；第 1 至 6 步列在結果表，第 7 步只在整合測試）");
lines.push("");
lines.push("1. 管理員逐頁檢查「回舊版」連結（網址正確、另開分頁、手機沒有水平溢出、點擊區夠大；沒有舊版對應的頁面不顯示）。");
lines.push("2. 店長開著新版「商品部」（缺貨回報）。");
lines.push("3. 管理員到「角色權限管理 > 頁面回舊版設定」把商品部切回舊版（必填原因；沒填會被擋）。");
lines.push("4. 店長開選單：商品部改開舊版 `/cross-dept/merchandise`（另開分頁）；原本開著的新版頁籤顯示通知與舊版連結。");
lines.push("5. 管理員改回新版；店長選單的商品部恢復開新版，頁籤通知消失。");
lines.push("6. 稽核：資料庫留下「切回舊版」「改回新版」各一筆（誰、何時、原因）。這一步已寫進下表。");
lines.push("7. 還原演練（整合測試）：執行 rollback SQL 後 session 照常運作、全部視為開新版，再套用後恢復。這一步不在下表：只在整合測試 `tests/integration/M9-F01S.page-fallbacks.spec.ts` 驗證。");
lines.push("");
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  lines.push(`## 結果：${d.project}（runId ${d.runId}）`);
  lines.push("");
  lines.push("| 時間（台北） | 步驟 | 結果 | 耗時（毫秒） |");
  lines.push("|---|---|---|---|");
  for (const s of d.steps) lines.push(`| ${taipei(s.at)} | ${s.step}${s.note ? "（" + s.note + "）" : ""} | ${s.ok ? "通過" : "失敗"} | ${s.ms ?? ""} |`);
  lines.push("");
  lines.push(d.problems && d.problems.length ? `console 錯誤或 pageerror：${d.problems.length} 筆（${d.problems.join("；")}）` : "console 錯誤與 pageerror：0 筆。");
  lines.push("");
}
lines.push("## 生效時間與快取（明確）");
lines.push("");
lines.push("- 伺服端：`/api/workspace/session` 每次請求都直接讀資料庫（`force-dynamic`，`Cache-Control: no-store`），**沒有任何伺服端快取**。管理員儲存成功後，下一個 session 請求就會看到新狀態（整合測試逐一驗證）。");
lines.push("- 前端：每 60 秒、視窗取得焦點、開啟選單時重新讀取 session。因此使用者最慢 60 秒內生效（開選單時通常立即生效，見上表耗時）。");
lines.push("- 備援表不存在或讀取失敗：視為沒有任何頁面切回舊版，不讓工作台壞掉。");
lines.push("");
lines.push("## 還原（rollback）");
lines.push("");
lines.push("- DEV：`node scripts/apply-workspace-m9-dev.cjs --rollback`（再套用：不帶參數）。整合測試 `tests/integration/M9-F01S.page-fallbacks.spec.ts` 最後一題實際執行還原與重新套用" + (integrationRun ? `（runId ${integrationRun}）` : "") + "。");
lines.push("- 正式區草稿：`docs/vue-workspace/parity-plan/m9-sql/`（含 rollback 與說明），尚未套用。");
lines.push("");
lines.push("## 上線當天實際操作步驟（給系統管理員）");
lines.push("");
lines.push("1. 登入工作台 > 選單「角色權限管理」> 右上角「頁面回舊版設定」。");
lines.push("2. 找到有問題的頁面，填寫原因，按「切回舊版」。最慢一分鐘內所有人的選單就會改開舊版。");
lines.push("3. 問題修好後，同一頁按「改回新版」。");
lines.push("4. 想看是誰、什麼時候、為什麼切換：同一頁每一列下方會顯示最後一次修改的人、時間與原因。");
lines.push("");
fs.writeFileSync(out, lines.join("\n"), "utf8");
console.log("已寫入", path.relative(root, out));

// 清除 M7M8 第 4.5 批（G45 進貨憑證、發票、請款單）在 DEV 留下的測試資料。只連 DEV（mjpd 開頭），只清「廠商名稱帶 QA-GA45-」「採購單備註帶 [自動測試]M7M8 T」或「建立者是 m7m8-test-* 測試帳號」的資料。
// 做法：呼叫 DEV 專用函式 ga_dev_cleanup_m7m8_b45（20261119145000_m7m8_b45_dev_seed）。請款單事件表有不可改刪觸發器，函式在單一交易內只對該表暫停觸發器、立刻恢復，任何錯誤整個交易回復。
// 會刪的：請款單與明細與事件、發票與連結、發票與進貨單附件紀錄（連實體檔）、測試帳號動過的尾差與買受人設定、沒有採購單參照的 QA-GA45- 測試廠商。
// 不會刪的：採購單、進貨、庫存、測試帳號本身（那些由 tests/support/m7m8-fixtures.ts 的 cleanupM7M8 與 teardown 清除）；vue_workspace_ga45_ 角色（DEV 專用種子，保留）。
// 用法：node scripts/cleanup-m7m8-b45-dev.cjs
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const { assertDevEnvironment } = require("../tests/support/env-guard.cjs");
const { env } = assertDevEnvironment({ root });
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (!ref.startsWith("mjpd")) throw Error("連線目標不是 DEV（ref 不是 mjpd 開頭），停止");
if (fs.readFileSync(path.join(root, "supabase/.temp/project-ref"), "utf8").trim() !== ref) throw Error("supabase CLI 連結的專案不是 DEV，停止");
const { createClient } = require("@supabase/supabase-js");
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

(async () => {
  let total = { payment_requests: 0, events: 0, invoices: 0, attachments: 0, vendors: 0 };
  // 兩輪：第一輪清請款資料；若還有採購單參照廠商，廠商留到採購單清掉後（測試的 cleanupM7M8 會處理）。
  for (let round = 1; round <= 2; round += 1) {
    const r = await db.rpc("ga_dev_cleanup_m7m8_b45");
    if (r.error) {
      if (r.error.code === "PGRST202") { console.log("清除函式尚未套用（略過）"); return; }
      throw new Error(r.error.message);
    }
    const d = r.data || {};
    for (const k of Object.keys(total)) total[k] += Number(d[k] || 0);
    const paths = d.storage_paths || [];
    if (paths.length) {
      const rm = await db.storage.from("general-affairs-attachments").remove(paths);
      if (rm.error) throw new Error(`刪除附件實體檔失敗：${rm.error.message}`);
    }
  }
  console.log(`第 4.5 批測試資料已清除：請款單 ${total.payment_requests}（事件 ${total.events}）、發票 ${total.invoices}、附件 ${total.attachments}、測試廠商 ${total.vendors}`);
  const left = await db.from("ga_vendors").select("id", { count: "exact", head: true }).like("name", "QA-GA45-%");
  if (left.error) throw new Error(left.error.message);
  if (left.count) console.log(`注意：仍有 ${left.count} 個 QA-GA45- 測試廠商被採購單參照（請先清採購單：cleanupM7M8）`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; });

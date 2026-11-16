// 由 DEV 已測過的 SQL（supabase/workspace-dev/）產生第 5 批正式區草稿（docs/vue-workspace/parity-plan/m7m8-sql/ 的 37 至 40）。
// 規則：內容與 DEV 檔相同，只是換成草稿標頭、包 BEGIN ... COMMIT、結尾加核對查詢；rollback 同樣包交易。不連線任何資料庫。
// 36-b5-preview-before-apply.sql 是手寫的唯讀預覽，不在這裡產生。用法：node scripts/build-m7m8-b5-prod-drafts.cjs
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const devDir = path.join(root, "supabase/workspace-dev");
const outDir = path.join(root, "docs/vue-workspace/parity-plan/m7m8-sql");

const DRAFTS = [
  {
    no: "37-b5-work-order-rules",
    dev: "20261117100000_m7m8_b5_work_order_rules",
    title: "第 5 批 A（G18 工單中心規則函式：讀取、流轉、強制結案、補資料、刪除、新增舊式回報、改分類、列印資料）",
    summary:
      "性質：只新增函式、不改任何資料表結構與既有資料（Q19 不拆表）。12 個對外函式 ga_ws_wo_*（list、get、summary、print、transition、store_confirm、report_unresolved、reply_supplement、delete、create_legacy、category；領用料件在 39）\n" +
      "--   與 25 個內部輔助函式 ga_wo_*（登入者不能直接呼叫）。全部 SECURITY DEFINER、固定 search_path、權限一律用 has_permission（只看角色權限；profiles.role = admin 不是後備，沒有更新角色的管理員只能看）。\n" +
      "-- 行為（與舊版不同處已登記白名單、問卷 W1 至 W9 與 Q19 至 Q21 已核可）：伺服端檢查工單狀態與合法流轉；存進度「有填才更新」不覆蓋承辦人、處理方式、廠商；寫入同交易、失敗全回復、帶版本（409 STALE）；\n" +
      "--   需求單已完成、退回、取消時工單存進度不翻回；強制結案原因只有內部看得到（門市只看到「總務已結案」）；已受理或已連需求單的工單不能刪、只能強制結案，刪除時附件只標記不實刪；\n" +
      "--   列表伺服端分頁、精確筆數、焦點卡全量計數、搜尋跳脫；新增舊式回報（跨部門頁，最多 5 張圖片走共用附件）；舊式單送門市確認不再報錯。\n" +
      "-- 先決條件：先套第 4 批 32（ga_rq_* 輔助函式）、33（ga_po_like_escape、ga_po_fmt）；maintenance_*、ga_resource_attachments 資料表已存在。套用前先跑 36-b5-preview-before-apply.sql（不能有 MISSING）。",
    verify:
      "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND (proname LIKE 'ga_ws_wo_%' OR proname LIKE 'ga_wo_%') ORDER BY 1;\n" +
      "-- 核對：應列出 11 個 ga_ws_wo_*（38 之後再加領用料件 39 的 1 個）與 25 個 ga_wo_*\n" +
      "SELECT count(*) FILTER (WHERE has_function_privilege('anon', p.oid, 'EXECUTE')) AS anon_can_run, count(*) FILTER (WHERE proname LIKE 'ga_wo_%' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS internal_open_to_users\n" +
      "  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (proname LIKE 'ga_ws_wo_%' OR proname LIKE 'ga_wo_%');\n" +
      "-- 核對：兩個數字都應是 0",
    rollbackSummary:
      "撤回 37：移除第 5 批工單函式（沒有資料表變更，不影響既有資料）。要先撤回 39（領用料件）與 38（第 4 批兩個函式會呼叫這裡的內部函式）。撤回後新版工單中心無法使用；舊版畫面完全不受影響。",
    backup: "-- 撤回前不需要備份（只有函式）。",
  },
  {
    no: "38-b5-request-supplement-sync",
    dev: "20261117105000_m7m8_b5_request_supplement_sync",
    title: "第 5 批 B（W1 補資料兩邊同步；覆蓋第 4 批 ga_ws_req_transition 與 ga_ws_req_store_action）",
    summary:
      "性質：以 CREATE OR REPLACE 覆蓋第 4 批兩個函式（簽章不變，只多三處呼叫第 5 批內部函式；其餘逐字不動，與 DEV 備份逐行比對過）：\n" +
      "--   1. request_supplement：需求單進「待門市補資料」時，連結的維修工單同交易進「等待門市補充資料」；\n" +
      "--   2. request_store_confirmation：送門市確認改呼叫與工單端共用的 ga_wo_apply_completion_request（取代原本內嵌的工單更新，單一邏輯）；\n" +
      "--   3. submit_supplement：門市在「我的追蹤」回覆補資料時，連結的維修工單回到「初步評估」，需求單照原本進「待總務複核」。\n" +
      "-- 套用前一定要先看 36 第 3 區：兩個函式現有 md5 必須與 DEV 備份一致（store_action=20a40759bb4488685c08cd885f785158、transition=a962e584ccd1679a2c246fddde688d3c），否則先比對差異再決定。\n" +
      "-- 套用前請用 pg_get_functiondef 把正式區現有兩個函式存檔備份（撤回檔內附 DEV 備份的第 4 批原定義，與正式區一致時可直接用）。\n" +
      "-- 先決條件：先套 37。套用後必須重跑第 4 批相關驗收（G16、G17、G27）與補資料往返。",
    verify:
      "SELECT proname, md5(pg_get_functiondef(p.oid)) AS md5 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND proname IN ('ga_ws_req_transition', 'ga_ws_req_store_action') ORDER BY 1;\n" +
      "-- 核對：兩個函式的 md5 應與 DEV 套用後相同（DEV：store_action=1d3120e2e3a889819d8a4013055f2269、transition=f2d106d5468fdfb0d26d188f70ebc977；換行字元不同時 md5 可能不同，以內容比對為準）\n" +
      "SELECT proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND proname IN ('ga_ws_req_transition', 'ga_ws_req_store_action') AND pg_get_functiondef(p.oid) LIKE '%ga_wo_apply_%';\n" +
      "-- 核對：兩個函式都應列出",
    rollbackSummary:
      "撤回 38：把 ga_ws_req_transition、ga_ws_req_store_action 還原成第 4 批原定義（內容是 DEV 套用前的 pg_get_functiondef 備份，與正式區第 4 批一致時 md5 相同）。還原後補資料不再同步工單、送門市確認又回到內嵌的工單更新（行為與第 4 批相同）。",
    backup: "-- 撤回前備份：SELECT pg_get_functiondef('public.ga_ws_req_transition'::regproc), pg_get_functiondef('public.ga_ws_req_store_action'::regproc);（把結果存檔）",
  },
  {
    no: "39-b5-work-order-parts",
    dev: "20261117110000_m7m8_b5_work_order_parts",
    title: "第 5 批 C（W2 工單內領用料件）",
    summary:
      "性質：只新增 1 個函式 ga_ws_wo_issue_part，不改表。同一交易呼叫第 3 批 ga_ws_inv_post 扣庫存（先設內部旗標 app.ga_inv_internal_post，用畢設回 false，做法同第 4 批 ga_ws_req_stock_issue），\n" +
      "--   庫存流水 reference_type = MAINTENANCE_REQUEST、reference_id = 工單 id、原因帶工單編號；工單用料紀錄寫成內部事件 PART_ISSUED（數量以庫存流水為準）。\n" +
      "-- 規則：需要「工單更新」＋「庫存交易管理」＋「料件查看或料件管理」，缺哪個講清楚；工單需為已受理或處理中且不在待門市確認；不可超過庫存（位置不允許負庫存）；防重複識別必填，同識別重送回原結果。\n" +
      "-- 不動第 4 批需求單規則（維修單仍不能走需求單的採購評估與需求單出庫）。36 第 10 區確認流水 reference_type 與事件類型沒有值域 CHECK。\n" +
      "-- 先決條件：先套 37；第 3 批 ga_ws_inv_post 已套用。",
    verify:
      "SELECT proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND proname = 'ga_ws_wo_issue_part';\n-- 核對：應列出 1 個函式",
    rollbackSummary:
      "撤回 39：移除領用料件函式。已經過帳的庫存流水與 PART_ISSUED 事件不動（流水有不可改刪觸發器，庫存餘額不會被回沖）。",
    backup: "-- 撤回前不需要備份（只有函式；已過帳的流水本來就不會被刪）。",
  },
  {
    no: "40-b5-work-order-rls",
    dev: "20261117120000_m7m8_b5_work_order_rls",
    title: "第 5 批 D（Q20／Q21 RLS 收緊；名單確認前不得套用）",
    summary:
      "性質：改 3 條 RLS 政策（影響舊 Next 工單頁與直連 API；新版函式是 SECURITY DEFINER，不受影響）：\n" +
      "--   p1e_maintenance_requests_update：移除「只有查看全部」（maintenance_request.view_all、work_order.view_all、cross_dept.maintenance.view_all）；\n" +
      "--   p1e_maintenance_requests_delete：移除 view_all 三碼與「回報人本人無條件可刪」，改為只有「未受理且沒連需求單」的單可以刪（回報人本人，或有更新／管理權限）；\n" +
      "--   p1e_maintenance_updates_write：移除 view_all 三碼（本人署名與更新／管理權限維持）。\n" +
      "-- 重要（未經使用者確認 36 號第 6、7 區名單與補授權前，不得套用）：套用後，名單上「只有查看全部、沒有更新或管理權限」的角色與人，在舊版工單頁不能再改、不能再刪；\n" +
      "--   請先替他們補授權（工單更新或工單管理），再套用。profiles.role = admin 但沒有更新角色的管理員（第 7 區）新版也只能看。\n" +
      "-- 先決條件：先套 37、38、39 並完成驗收；撤回檔把三條政策還原成 20260727021000 的原定義。",
    verify:
      "SELECT policyname, cmd, (qual LIKE '%view_all%' OR with_check LIKE '%view_all%') AS still_has_view_all FROM pg_policies WHERE schemaname = 'public' AND policyname IN ('p1e_maintenance_requests_update', 'p1e_maintenance_requests_delete', 'p1e_maintenance_updates_write') ORDER BY 1;\n" +
      "-- 核對：三條都應存在，still_has_view_all 都應是 false",
    rollbackSummary:
      "撤回 40：把 3 條政策還原成 20260727021000 的原定義（view_all 可改、可刪、回報人本人無條件可刪）。",
    backup: "-- 撤回前不需要備份（只有政策；原定義在撤回檔內）。",
  },
];

function stripHeader(sql) {
  const lines = sql.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && lines[i].startsWith("--")) i += 1;
  while (i < lines.length && lines[i].trim() === "") i += 1;
  return lines.slice(i).join("\n").replace(/\s+$/, "\n");
}

for (const d of DRAFTS) {
  const body = stripHeader(fs.readFileSync(path.join(devDir, `${d.dev}.sql`), "utf8"));
  const rb = stripHeader(fs.readFileSync(path.join(devDir, `${d.dev}.rollback.sql`), "utf8")).replace(/\n*NOTIFY pgrst, 'reload schema';\n?$/, "\nNOTIFY pgrst, 'reload schema';\n");
  const head =
    `-- ${d.no}.sql\n-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/${d.dev}.sql 相同。\n` +
    `-- ${d.title}（2026-11-16 第 5 批問卷 W1 至 W9）。\n-- ${d.summary}\n` +
    `-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：${d.no}-rollback.sql。套用前先跑 36-b5-preview-before-apply.sql，備份後經使用者核可才執行。\nBEGIN;\n\n`;
  fs.writeFileSync(path.join(outDir, `${d.no}.sql`), `${head}${body}\nCOMMIT;\n\n-- 核對\n${d.verify}\n`);
  const rhead = `-- ${d.no}-rollback.sql\n-- ${d.rollbackSummary}\n${d.backup}\nBEGIN;\n\n`;
  fs.writeFileSync(path.join(outDir, `${d.no}-rollback.sql`), `${rhead}${rb}\nCOMMIT;\n`);
  console.log(`wrote ${d.no}.sql, ${d.no}-rollback.sql`);
}

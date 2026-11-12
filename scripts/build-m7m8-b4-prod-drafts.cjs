// 由 DEV 已測過的 SQL（supabase/workspace-dev/）產生第 4 批正式區草稿（docs/vue-workspace/parity-plan/m7m8-sql/ 的 32 至 35）。
// 規則：內容與 DEV 檔相同，只是換成草稿標頭、包 BEGIN ... COMMIT、結尾加核對查詢；rollback 同樣包交易。不連線任何資料庫。
// 用法：node scripts/build-m7m8-b4-prod-drafts.cjs
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const devDir = path.join(root, "supabase/workspace-dev");
const outDir = path.join(root, "docs/vue-workspace/parity-plan/m7m8-sql");

const DRAFTS = [
  {
    no: "32-b4-request-rules",
    dev: "20261112100000_m7m8_b4_request_rules",
    title: "第 4 批 A（需求單與處理單規則的資料結構）",
    summary:
      "性質：會寫入，但只新增 2 張表（流程設定、設定變更紀錄）與 9 個可為空或有預設值的欄位（處理單待交付時間、單據作廢 3 欄、留言原文、事件代按標記、需求單取消原因與重新開啟次數、報價作廢標記），不改任何既有資料、函式與觸發器；舊版畫面完全不受影響。\n" +
      "-- 設定表預設值：採購核准啟用、核准門檻 5000 元（含稅總額大於才需核准）、稅率 0.05、需求單待門市確認逾期天數 7、歷史價筆數 5。登入者不能直接讀寫設定表，只有 33 的函式（SECURITY DEFINER）與 service_role 能存取。\n" +
      "-- 先決條件：需求單、處理單、單據、留言、事件、採購評估報價、profiles 資料表已存在（先跑 31 確認）。",
    verify:
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND (table_name, column_name) IN (('ga_part_fulfillments', 'ready_to_deliver_at'), ('ga_part_fulfillment_documents', 'voided_at'), ('ga_part_fulfillment_documents', 'void_reason'), ('ga_part_fulfillment_documents', 'voided_by'), ('ga_service_request_comments', 'original_body'), ('ga_service_request_events', 'proxy_for_store'), ('ga_service_requests', 'cancel_reason'), ('ga_service_requests', 'reopened_count'), ('ga_purchase_review_quotes', 'superseded_at')) ORDER BY 1, 2;\n-- 核對：應列出 9 個欄位；設定表應有 5 列\nSELECT key, value_num FROM public.ga_workflow_settings ORDER BY key;",
    rollbackSummary:
      "撤回 32：移除第 4 批 A 新增的 2 張表與 9 個欄位。會刪除：流程設定與變更紀錄、處理單待交付時間、單據作廢紀錄、留言原文、事件代按標記、需求單取消原因與重新開啟次數、報價作廢標記。需求單、處理單、單據、留言、事件、報價本身不動。要先撤回 33（採購單函式會讀設定表）。",
    backup:
      "-- 撤回前備份（只備份會被刪掉的欄位與表）：\n--   CREATE TABLE public.zz_bak_b4_32_settings AS SELECT * FROM public.ga_workflow_settings;\n--   CREATE TABLE public.zz_bak_b4_32_setting_events AS SELECT * FROM public.ga_workflow_setting_events;\n--   CREATE TABLE public.zz_bak_b4_32_request_cols AS SELECT id, cancel_reason, reopened_count FROM public.ga_service_requests WHERE cancel_reason IS NOT NULL OR reopened_count > 0;",
  },
  {
    no: "33-b4-purchase-orders",
    dev: "20261112110000_m7m8_b4_purchase_orders",
    title: "第 4 批 B（採購單、核准、單號、歷史價；D1、D2、D3、D6 至 D11）",
    summary:
      "性質：會寫入，新增 3 張表（採購單、品項、事件紀錄）、1 個權限碼 general_affairs.purchase_order.approve（採購核准，不指派給任何角色）、2 個觸發器（採購單更新時間、事件表不可改刪）與 ga_ws_po_* 函式；另新增庫存流水表的觸發器 trg_ga_inventory_transactions_block_legacy_po_receipt：\n" +
      "--   舊版需求單「採購到貨入庫」（參考單據 GA_PURCHASE_REVIEW）遇到「評估已有未取消的新版採購單」時，資料庫層擋下，避免新舊並存時雙記庫存；沒有新版採購單的評估不受影響。這是對舊版也生效的唯一一項。\n" +
      "-- 三張表登入者不能直接讀寫（供應商統編、付款條件快照屬帳務欄位，要依權限遮蔽），一律走函式。\n" +
      "-- 重點規則：含稅總額「大於」門檻（預設 5000 元，剛好 5000 免核准）才需系統內核准；核准人需有「採購核准」權限、不可是開單人也不可是最後送核准的人、管理員不繞過；\n" +
      "--   開單、下訂、取消、短收結案、結案需要「採購評估管理」「庫存交易管理」「料件查看」三個權限（缺哪個講清楚）；供應商必須是合作中（status = active）的既有廠商，下訂時複製名稱、統編、付款條件快照；\n" +
      "--   下訂後品項、數量、單價鎖定；需求單的所有未取消採購單加總超過需求量要填超量原因；歷史價只算已下訂以上。\n" +
      "-- 套用後要做：到「角色權限」頁，替要擔任核決的角色勾選「採購核准」（可多個角色；建議至少兩位核准人，或讓核准人不開單）。詳見 README「第 4 批」。\n" +
      "-- 先決條件：先套 32（設定表）；ga_vendors 有 status、tax_id、payment_terms 欄位；庫存位置有預設的中央倉庫（沒有也能用，開單時手動選收貨位置）。",
    verify:
      "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname LIKE 'ga_ws_po_%' ORDER BY 1;\n-- 核對：應列出 11 個函式（create、update、from_review、action、get、list、price_history、vendor_options、settings_get、settings_set、request_remaining）\nSELECT code, action, is_active FROM public.permissions WHERE code = 'general_affairs.purchase_order.approve';\n-- 核對：應有 1 列（尚未指派給任何角色，要到角色權限頁勾選）",
    rollbackSummary:
      "撤回 33：移除第 4 批 B 新增的採購單資料表、函式、觸發器（含庫存流水表上的舊版收貨保護）與採購核准權限碼。會刪除全部採購單、品項、事件紀錄；若已有角色勾選「採購核准」會先中止，請先到角色權限頁取消勾選。\n" +
      "-- 要先撤回 34（到貨驗入與配發參照這些表）。撤回後新版採購單頁無法使用；舊版畫面（含舊版收貨）恢復原行為。",
    backup:
      "-- 撤回前備份（採購單資料）：\n--   CREATE TABLE public.zz_bak_b4_33_orders AS SELECT * FROM public.ga_purchase_orders;\n--   CREATE TABLE public.zz_bak_b4_33_items AS SELECT * FROM public.ga_purchase_order_items;\n--   CREATE TABLE public.zz_bak_b4_33_events AS SELECT * FROM public.ga_purchase_order_events;",
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
  const rb = stripHeader(fs.readFileSync(path.join(devDir, `${d.dev}.rollback.sql`), "utf8"));
  const head =
    `-- ${d.no}.sql\n-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/${d.dev}.sql 相同。\n` +
    `-- ${d.title}（2026-11-12 第 4 批問卷 D1 至 D21）。\n-- ${d.summary}\n` +
    `-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：${d.no}-rollback.sql。套用前先跑 31-b4-preview-before-apply.sql，備份後經使用者核可才執行。\nBEGIN;\n\n`;
  fs.writeFileSync(path.join(outDir, `${d.no}.sql`), `${head}${body}\nCOMMIT;\n\n-- 核對\n${d.verify}\n`);
  const rhead = `-- ${d.no}-rollback.sql\n-- ${d.rollbackSummary}\n${d.backup}\nBEGIN;\n\n`;
  fs.writeFileSync(path.join(outDir, `${d.no}-rollback.sql`), `${rhead}${rb}\nCOMMIT;\n`);
  console.log(`wrote ${d.no}.sql, ${d.no}-rollback.sql`);
}

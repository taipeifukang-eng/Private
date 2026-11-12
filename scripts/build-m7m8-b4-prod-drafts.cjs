// 由 DEV 已測過的 SQL（supabase/workspace-dev/）產生第 4 批正式區草稿（docs/vue-workspace/parity-plan/m7m8-sql/ 的 32 至 35；目前做到 34，35 由後續階段新增）。
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
    title: "第 4 批 A（需求單與處理單規則：資料結構與 G14 至 G17 規則函式）",
    summary:
      "性質：會寫入。新增 2 張表（流程設定、設定變更紀錄）、10 個可為空或有預設值的欄位（處理單待交付時間、單據作廢 3 欄、留言原文、事件代按標記、需求單取消原因、重新開啟次數、待門市確認起算時間、報價作廢標記）、2 個觸發器（需求單進入待門市確認時記錄起算時間、處理單達需求量時記錄待交付時間）、13 個 ga_ws_req_*／ga_ws_ful_* 函式（受理與 D4 擋、合法流轉、門市動作與總務代按標記、留言改刪保留原文、逾期天數設定、庫存出庫守衛、採購評估、處理單決定／異常／作廢／送門市確認）與內部輔助函式；\n" +
      "--   採購單連結處理單的同步觸發器（有採購單表才會裝，先套 32 再套 33 或相反都行）。不改任何既有資料；舊版畫面與舊版 API 不受影響，只有一處行為改變（見下）。\n" +
      "-- 行為改變（要使用者核可）：以 CREATE OR REPLACE 覆蓋第 3 批 ga_inv_tr_sync_fulfillment——調撥單全數收貨後，料件處理單維持「調撥」狀態並成為「待交付」，要總務按「送門市確認」處理單與需求單才一起往下（原本收貨後處理單會自動跳到等門市確認，需求單卻停在處理中，兩邊不同步）。\n" +
      "-- 設定表預設值：採購核准啟用、核准門檻 5000 元（含稅總額大於才需核准）、稅率 0.05、需求單待門市確認逾期天數 7、歷史價筆數 5。登入者不能直接讀寫設定表，只有函式（SECURITY DEFINER）與 service_role 能存取。\n" +
      "-- 先決條件：需求單、處理單、單據、留言、事件、採購評估報價、profiles、maintenance_requests 資料表已存在，第 3 批 28（ga_ws_inv_post、調撥同步）已套用（先跑 31 確認）。採購評估選「進入採購」要 33 的 ga_ws_po_from_review（沒套 33 時該決策會失敗，其餘功能不受影響）。",
    verify:
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND (table_name, column_name) IN (('ga_part_fulfillments', 'ready_to_deliver_at'), ('ga_part_fulfillment_documents', 'voided_at'), ('ga_part_fulfillment_documents', 'void_reason'), ('ga_part_fulfillment_documents', 'voided_by'), ('ga_service_request_comments', 'original_body'), ('ga_service_request_events', 'proxy_for_store'), ('ga_service_requests', 'cancel_reason'), ('ga_service_requests', 'reopened_count'), ('ga_service_requests', 'waiting_confirm_since'), ('ga_purchase_review_quotes', 'superseded_at')) ORDER BY 1, 2;\n-- 核對：應列出 10 個欄位；設定表應有 5 列\nSELECT key, value_num FROM public.ga_workflow_settings ORDER BY key;\nSELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND (proname LIKE 'ga_ws_req_%' OR proname LIKE 'ga_ws_ful_%') ORDER BY 1;\n-- 核對：應列出 13 個函式",
    rollbackSummary:
      "撤回 32：移除第 4 批 A 新增的 2 張表、10 個欄位、觸發器與函式，並把第 3 批 ga_inv_tr_sync_fulfillment 還原成原版。會刪除：流程設定與變更紀錄、處理單待交付時間、單據作廢紀錄、留言原文、事件代按標記、需求單取消原因與重新開啟次數與待確認起算時間、報價作廢標記。需求單、處理單、單據、留言、事件、報價本身不動。要先撤回 33（採購單函式會讀設定表）。",
    backup:
      "-- 撤回前備份（只備份會被刪掉的欄位與表）：\n--   CREATE TABLE public.zz_bak_b4_32_settings AS SELECT * FROM public.ga_workflow_settings;\n--   CREATE TABLE public.zz_bak_b4_32_setting_events AS SELECT * FROM public.ga_workflow_setting_events;\n--   CREATE TABLE public.zz_bak_b4_32_request_cols AS SELECT id, cancel_reason, reopened_count, waiting_confirm_since FROM public.ga_service_requests WHERE cancel_reason IS NOT NULL OR reopened_count > 0 OR waiting_confirm_since IS NOT NULL;\n--   CREATE TABLE public.zz_bak_b4_32_comment_orig AS SELECT id, original_body FROM public.ga_service_request_comments WHERE original_body IS NOT NULL;\n--   CREATE TABLE public.zz_bak_b4_32_doc_void AS SELECT id, voided_at, void_reason, voided_by FROM public.ga_part_fulfillment_documents WHERE voided_at IS NOT NULL;\n--   （ga_inv_tr_sync_fulfillment 的原版由撤回檔自帶；撤回前先 SELECT pg_get_functiondef 存一份更保險。）",
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
  {
    no: "34-b4-receipt-dispatch",
    dev: "20261112120000_m7m8_b4_receipt_dispatch",
    title: "第 4 批 C（到貨驗入、配發轉設備、型號對應料件、序號補填；D3、D12 至 D16）",
    summary:
      "性質：會寫入，新增 4 張表（進貨紀錄、進貨明細、配發單、設備序號補填紀錄）、ga_parts 1 個欄位（equipment_template_id，料件對應設備型號）與 1 個觸發器、ga_equipment 8 個可為空的欄位（來源採購單／品項／進貨明細／配發單／需求單、供應商與名稱快照、保固起算日）、\n" +
      "--   ga_ws_po_receive／ga_ws_po_dispatch／ga_ws_po_receipts_get／ga_ws_onboarding_set_serial 四個對外函式與內部輔助函式；並以 CREATE OR REPLACE 覆蓋 ga_ws_update_part_guarded（只在「允許修改的欄位」清單多一個 equipment_template_id，其餘與 10-g01 逐字相同；撤回時還原成 10-g01 的版本）。\n" +
      "-- 不改任何既有資料；舊版畫面與舊版 API 完全不受影響（舊版建立設備、料件頁都不帶新欄位）。四張新表登入者不能直接讀寫，一律走函式。\n" +
      "-- 重點規則：登錄到貨即驗入（同一交易以 ga_ws_inv_post 入總部倉庫存）；到貨量不得超過剩餘可收量（訂購量減已驗入量，破損拒收不算已驗入）；驗入量不得大於到貨量；\n" +
      "--   驗入量小於到貨量（破損、拒收）或到貨量小於剩餘量（短收）須原因；改收貨位置或改收替代料須變更原因；同識別重送回原結果、併發不超收；STOCK 品項入庫存、DIRECT_ASSET 品項直接建設備送門市（整數量、不入庫）、NO_STOCK 只登錄。\n" +
      "--   配發＝同一交易內出庫 N、建 N 筆設備（資產編號沿用舊版規則，需分類有第二層分類代碼）、依進貨明細先進先出（每台帶自己那批的到貨日當保固起算日與購置日期）、可分次、序號可空；任一步失敗整筆回復；不另要求設備管理權限（D11）。\n" +
      "--   序號補填限該門市店長與設備管理權限者，已有值要改須原因並留紀錄，同型號序號不可重複。設備購價（既有 purchase_amount 欄位）填未稅單價並在備註註明（含稅與否待確認）。\n" +
      "-- 先決條件：先套 32、33；設備與設備型號、庫存位置、廠商、需求單事件等既有資料表存在；ga_ws_inv_post（第 3 批）與 ga_ws_update_part_guarded（10-g01）已套用。",
    verify:
      "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname IN ('ga_ws_po_receive', 'ga_ws_po_dispatch', 'ga_ws_po_receipts_get', 'ga_ws_onboarding_set_serial') ORDER BY 1;\n" +
      "-- 核對：應列出 4 個函式\n" +
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'ga_parts' AND column_name = 'equipment_template_id') OR (table_name = 'ga_equipment' AND column_name IN ('source_purchase_order_id', 'source_po_item_id', 'source_receipt_item_id', 'source_dispatch_id', 'source_request_id', 'vendor_id', 'vendor_name_snapshot', 'warranty_start_date'))) ORDER BY 1, 2;\n" +
      "-- 核對：應列出 9 個欄位\n" +
      "SELECT to_regclass('public.ga_purchase_receipts') AS receipts, to_regclass('public.ga_purchase_receipt_items') AS receipt_items, to_regclass('public.ga_stock_dispatches') AS dispatches, to_regclass('public.ga_equipment_serial_events') AS serial_events;\n" +
      "-- 核對：四個都不是空的",
    rollbackSummary:
      "撤回 34：移除第 4 批 C 新增的 4 張表、ga_parts.equipment_template_id（含觸發器）、ga_equipment 的 8 個來源與保固欄位與相關函式，並把 ga_ws_update_part_guarded 還原成 10-g01 的版本。會刪除：進貨紀錄與明細、配發單、設備序號補填紀錄、料件的對應設備型號、設備的來源連結與保固起算日。\n" +
      "-- 不會刪除：已經由配發或直接到貨建立的設備本身與庫存流水（只是失去來源連結與保固起算日）；庫存餘額不會被回沖。要先撤回 35，且撤回後採購單的「登錄到貨」與「配發」無法使用。",
    backup:
      "-- 撤回前備份（只備份會被刪掉的表與欄位）：\n" +
      "--   CREATE TABLE public.zz_bak_b4_34_receipts AS SELECT * FROM public.ga_purchase_receipts;\n" +
      "--   CREATE TABLE public.zz_bak_b4_34_receipt_items AS SELECT * FROM public.ga_purchase_receipt_items;\n" +
      "--   CREATE TABLE public.zz_bak_b4_34_dispatches AS SELECT * FROM public.ga_stock_dispatches;\n" +
      "--   CREATE TABLE public.zz_bak_b4_34_serial_events AS SELECT * FROM public.ga_equipment_serial_events;\n" +
      "--   CREATE TABLE public.zz_bak_b4_34_part_templates AS SELECT id, equipment_template_id FROM public.ga_parts WHERE equipment_template_id IS NOT NULL;\n" +
      "--   CREATE TABLE public.zz_bak_b4_34_equipment_src AS SELECT id, source_purchase_order_id, source_po_item_id, source_receipt_item_id, source_dispatch_id, source_request_id, vendor_id, vendor_name_snapshot, warranty_start_date FROM public.ga_equipment WHERE source_purchase_order_id IS NOT NULL OR warranty_start_date IS NOT NULL;",
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

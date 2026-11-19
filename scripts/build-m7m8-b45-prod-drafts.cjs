// 由 DEV 已測過的 SQL（supabase/workspace-dev/）產生第 4.5 批正式區草稿（docs/vue-workspace/parity-plan/m7m8-sql/ 的 51 至 55；56 至 58 由後續階段補檔後加入 DRAFTS）。
// 規則：內容與 DEV 檔相同，只是換成草稿標頭、包 BEGIN ... COMMIT、結尾加核對查詢；rollback 同樣包交易。不連線任何資料庫。145000（DEV 測試角色與清除函式）是 DEV 專用，不產正式區草稿。
// 用法：node scripts/build-m7m8-b45-prod-drafts.cjs
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const devDir = path.join(root, "supabase/workspace-dev");
const outDir = path.join(root, "docs/vue-workspace/parity-plan/m7m8-sql");

const DRAFTS = [
  {
    no: "51-b45-receipt-voucher",
    dev: "20261119100000_m7m8_b45_receipt_voucher",
    title: "第 4.5 批 A（進貨憑證欄位、進貨明細未稅金額、進貨發票與連結表；D17、D18）",
    summary:
      "性質：會寫入（回填）。進貨明細新增 amount_untaxed（未稅金額）並以「採購單品項單價 × 驗入量」回填既有資料（品項各自四捨五入到整數元；50 第 2 區先看筆數與單價為 0 的筆數），\n" +
      "--   並裝 1 個 BEFORE INSERT 觸發器（之後新增的進貨明細自動凍結金額，不改第 4 批到貨函式）；進貨單新增 updated_at／updated_by（既有列以建立時間回填）、voucher_*（憑證狀態）、voided_*（作廢進貨）共 9 個欄位與 2 條檢查、1 個部分索引；\n" +
      "--   新增 2 張表 ga_purchase_invoices（五種類型、同廠商同發票號碼非作廢唯一、含稅＝未稅＋稅額）與 ga_purchase_invoice_receipts（發票與進貨多對多）；兩張新表啟用 RLS 且不開放 policy，登入者不能直接讀寫。\n" +
      "-- 不改舊版任何資料與畫面；舊版沒有發票與請款功能。\n" +
      "-- 先決條件：第 4 批 33（採購單）與 34（到貨驗入）已套用；ga_vendors、profiles 存在（50 第 1 區不能有 MISSING）。回填前請先備份進貨兩表（README 第 4.5 批有備份指令）。",
    verify:
      "SELECT count(*) AS receipt_items, count(*) FILTER (WHERE amount_untaxed IS NULL) AS null_amount FROM public.ga_purchase_receipt_items;\n" +
      "-- 核對：null_amount 必須是 0\n" +
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'ga_purchase_receipt_items' AND column_name = 'amount_untaxed') OR (table_name = 'ga_purchase_receipts' AND column_name IN ('updated_at', 'updated_by', 'voucher_status', 'voucher_note', 'voucher_recorded_by', 'voucher_recorded_at', 'voided_at', 'voided_by', 'void_reason'))) ORDER BY 1, 2;\n" +
      "-- 核對：應列出 10 個欄位\n" +
      "SELECT to_regclass('public.ga_purchase_invoices') AS invoices, to_regclass('public.ga_purchase_invoice_receipts') AS invoice_receipts;\n" +
      "-- 核對：兩個都不是空的",
    rollbackSummary:
      "撤回 51：移除發票表與連結表、進貨明細金額觸發器與 amount_untaxed 欄位、進貨單新增的 9 個欄位與檢查。會刪除：所有發票與連結、進貨憑證狀態與作廢進貨標記、進貨明細的未稅金額。\n" +
      "-- 要先撤回 52（請款單參照發票與進貨單）與 56 至 58（函式參照這些欄位）。撤回後新版發票與請款頁無法使用。",
    backup:
      "-- 撤回前備份（只備份會被刪掉的表與欄位）：\n" +
      "--   CREATE TABLE public.zz_bak_b45_51_invoices AS SELECT * FROM public.ga_purchase_invoices;\n" +
      "--   CREATE TABLE public.zz_bak_b45_51_invoice_receipts AS SELECT * FROM public.ga_purchase_invoice_receipts;\n" +
      "--   CREATE TABLE public.zz_bak_b45_51_receipt_items AS SELECT id, amount_untaxed FROM public.ga_purchase_receipt_items;\n" +
      "--   CREATE TABLE public.zz_bak_b45_51_receipts AS SELECT id, updated_at, updated_by, voucher_status, voucher_note, voucher_recorded_by, voucher_recorded_at, voided_at, voided_by, void_reason FROM public.ga_purchase_receipts;",
  },
  {
    no: "52-b45-payment-requests",
    dev: "20261119110000_m7m8_b45_payment_requests",
    title: "第 4.5 批 B（請款單、明細、操作紀錄、請款單號與尾差預設；D19、P1 至 P7）",
    summary:
      "性質：會寫入，新增 3 張表 ga_payment_requests（狀態 DRAFT／SUBMITTED／PAID／VOID，沒有核准欄位）、ga_payment_request_lines、ga_payment_request_events（觸發器擋 UPDATE／DELETE／TRUNCATE，操作紀錄不可改刪）、\n" +
      "--   取號函式 ga_next_pr_no（PY-YYYYMMDD-NNN，台北日期，advisory lock）、1 筆設定預設列 pay_tolerance_amount = 5（尾差 5 元；ga_workflow_settings）。三張新表啟用 RLS 且不開放 policy，登入者不能直接讀寫。\n" +
      "-- 規則：請款單只當付款申請紀錄，不接金流；不核准（P3）；有 purchase_payment.manage 的人可建立、送出、退回、標已付款、作廢，申請人可自己標已付款（P4）；所有動作留事件紀錄（誰、何時、原因、金額）。\n" +
      "-- 先決條件：先套 51；ga_workflow_settings 存在（第 4 批 32／33）。",
    verify:
      "SELECT to_regclass('public.ga_payment_requests') AS requests, to_regclass('public.ga_payment_request_lines') AS request_lines, to_regclass('public.ga_payment_request_events') AS request_events;\n" +
      "-- 核對：三個都不是空的\n" +
      "SELECT key, value_num FROM public.ga_workflow_settings WHERE key = 'pay_tolerance_amount';\n" +
      "-- 核對：value_num = 5\n" +
      "SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_ga_payment_request_events_immutable', 'trg_ga_payment_request_events_no_truncate') ORDER BY 1;\n" +
      "-- 核對：應列出 2 個觸發器",
    rollbackSummary:
      "撤回 52：移除請款單三張表（整張 DROP，包含不可改刪的操作紀錄）、取號函式、事件觸發器函式與 pay_tolerance_amount、買受人設定列。會刪除：全部請款單、明細與操作紀錄——**撤回前務必先備份**。\n" +
      "-- 要先撤回 56 至 58（函式參照這些表）與 54（附件守門觸發器參照請款明細）。",
    backup:
      "-- 撤回前備份（請款資料與操作紀錄，這是付款依據）：\n" +
      "--   CREATE TABLE public.zz_bak_b45_52_requests AS SELECT * FROM public.ga_payment_requests;\n" +
      "--   CREATE TABLE public.zz_bak_b45_52_lines AS SELECT * FROM public.ga_payment_request_lines;\n" +
      "--   CREATE TABLE public.zz_bak_b45_52_events AS SELECT * FROM public.ga_payment_request_events;\n" +
      "--   CREATE TABLE public.zz_bak_b45_52_settings AS SELECT * FROM public.ga_workflow_settings WHERE key LIKE 'pay\\_%';",
  },
  {
    no: "53-b45-vendor-bank",
    dev: "20261119120000_m7m8_b45_vendor_bank",
    title: "第 4.5 批 C（廠商銀行資料：銀行名稱、分行、帳號、戶名；P8）",
    summary:
      "性質：會寫入（只加欄位）。ga_vendors 新增 bank_name、bank_branch、bank_account、bank_account_name 四個可為空的欄位與長度檢查。屬帳務機密（與第 6 批 V1 同規則：只有廠商查看或管理權限者看得到）；請款單建立時快照。\n" +
      "-- 不改既有資料；函式（ga_ws_vendor_save、ga_vd_json）的擴充在 56。\n" +
      "-- 先決條件：ga_vendors 存在。上線後請人逐一補廠商銀行資料（50 第 6 區有廠商筆數）。",
    verify:
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_vendors' AND column_name LIKE 'bank%' ORDER BY 1;\n" +
      "-- 核對：應列出 4 個欄位",
    rollbackSummary:
      "撤回 53：移除廠商銀行四欄與長度檢查。會刪除已填的銀行資料（請款單上的銀行快照在請款單裡，不受影響）。要先撤回 56（函式參照這四欄）。",
    backup:
      "-- 撤回前備份：\n--   CREATE TABLE public.zz_bak_b45_53_vendor_bank AS SELECT id, bank_name, bank_branch, bank_account, bank_account_name FROM public.ga_vendors WHERE bank_name IS NOT NULL OR bank_account IS NOT NULL;",
  },
  {
    no: "54-b45-attachment-types",
    dev: "20261119130000_m7m8_b45_attachment_types",
    title: "第 4.5 批 D（附件資源類型 PURCHASE_INVOICE、PURCHASE_RECEIPT、缺圖判斷與最後一張圖守門；A5、P10）",
    summary:
      "性質：會改共用函式（要特別小心）。重建 ga_resource_attachments 的 resource_type CHECK（8 值加 PURCHASE_INVOICE、PURCHASE_RECEIPT）；對 ga_resource_attachment_can_manage 與 ga_resource_attachment_can_read（讀取函式實名是 can_read，不是 can_view）\n" +
      "--   各補一個分支：不整支覆蓋，讀出現行定義、只在最後的 RETURN false 前插入分支再重建；已有就略過；結尾格式不符就中止（請人工處理）。寫入需 purchase_payment.manage（發票未作廢、進貨單未作廢），讀取需 purchase_payment.view 或 manage。\n" +
      "--   另新增 ga_pay_invoice_image_count、ga_pay_invoice_missing_image（缺圖判斷）與軟刪除守門觸發器：已被有效（非作廢）請款單引用的發票，最後一張圖片不可刪除。\n" +
      "-- 既有資源類型（含水電帳單）的行為不變；套用後請用 DEV 已測過的 G45-db 附件回歸項目自己抽查（水電帳單、料件、設備附件上傳與讀取）。\n" +
      "-- 先決條件：先套 51、52（觸發器參照發票與請款明細）；建議第 6 批 45 已套用（can_manage 已含 UTILITY_BILL 分支；沒套也不影響本檔）。**套用前一定要做**：跑 50 第 3 區並把兩個函式現行定義與 CHECK 存檔（撤回 54 要照這份）。",
    verify:
      "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.ga_resource_attachments'::regclass AND conname = 'ga_resource_attachments_resource_type_check';\n" +
      "-- 核對：10 個類型，含 PURCHASE_INVOICE、PURCHASE_RECEIPT\n" +
      "SELECT p.proname, position('PURCHASE_INVOICE' in pg_get_functiondef(p.oid)) > 0 AS has_branch FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('ga_resource_attachment_can_manage', 'ga_resource_attachment_can_read') ORDER BY 1;\n" +
      "-- 核對：兩個都是 true\n" +
      "SELECT tgname FROM pg_trigger WHERE tgname = 'trg_ga_pay_attachment_last_image_guard';\n" +
      "-- 核對：應列出 1 個觸發器",
    rollbackSummary:
      "撤回 54：拿掉兩個附件判斷函式的 PURCHASE_ 分支、移除最後一張圖守門觸發器與缺圖函式，並把 resource_type CHECK 還原成 8 值。若附件表已有 PURCHASE_INVOICE／PURCHASE_RECEIPT 的紀錄，還原 CHECK 會失敗而整份中止（先自行決定那些附件怎麼處理；本檔不刪附件紀錄與檔案）。\n" +
      "-- **正式區兩個函式原定義若與 DEV 不同，以 50 第 3 區存檔的定義為準**。要先撤回 56 至 58。",
    backup:
      "-- 撤回前備份：先存 50 第 3 區的兩個函式定義與 CHECK；另存附件紀錄：\n--   CREATE TABLE public.zz_bak_b45_54_attachments AS SELECT * FROM public.ga_resource_attachments WHERE resource_type IN ('PURCHASE_INVOICE', 'PURCHASE_RECEIPT');",
  },
  {
    no: "55-b45-permissions",
    dev: "20261119140000_m7m8_b45_permissions",
    title: "第 4.5 批 E（請款權限碼 purchase_payment.view、purchase_payment.manage；P4）",
    summary:
      "性質：會寫入，只新增 2 個權限碼（general_affairs.purchase_payment.view、general_affairs.purchase_payment.manage），**不自動授權給任何角色**（角色授權由你決定，見 README 第 4.5 批建議授權對象）。\n" +
      "-- 不新增 approve、pay 權限碼（P3 請款不核准；P4 manage 一把抓，制衡靠不可改刪的操作紀錄）。權限語意以正式區 has_permission 為準：不檢查 roles.is_active 的部分、資料庫沒有管理員後備（profiles.role = admin 看不到請款入口也寫不了）。\n" +
      "-- 先決條件：permissions 表存在（50 第 5 區看撞名）。",
    verify:
      "SELECT code, action, is_active FROM public.permissions WHERE code LIKE 'general_affairs.purchase_payment.%' ORDER BY 1;\n" +
      "-- 核對：應列出 2 個權限碼\n" +
      "SELECT count(*) AS granted_roles FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id WHERE p.code LIKE 'general_affairs.purchase_payment.%';\n" +
      "-- 核對：套用當下是 0（尚未授權任何角色）",
    rollbackSummary: "撤回 55：移除兩個請款權限碼與角色對它們的授權（若已授權，授權一併移除）。",
    backup: "-- 撤回前備份：\n--   CREATE TABLE public.zz_bak_b45_55_role_permissions AS SELECT rp.* FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id WHERE p.code LIKE 'general_affairs.purchase_payment.%';",
  },
  {
    no: "56-b45-functions",
    dev: "20261119150000_m7m8_b45_functions",
    title: "第 4.5 批 F（進貨憑證、進貨發票、請款單、付款標記、請款設定、對帳匯出、採購單摘要函式，以及廠商銀行欄位讀寫擴充）",
    summary:
      "性質：會寫入（只新增與替換函式，不動資料）。新增對外函式 ga_ws_pay_*（settings_get／set、voucher_set、invoice_save／get／list／void、receipt_candidates、request_create／update／action／get／list、export、po_summary）與內部輔助 ga_pay_*（只開給 service_role）；\n" +
      "--   全部 SECURITY DEFINER、固定 search_path、必須是登入使用者、權限只用 has_permission(auth.uid(), 碼)（正式區語意：資料庫沒有管理員後備，profiles.role = admin 不放行）、回 {ok,status,data,error,code}、寫入同交易鎖列、固定識別冪等、expected_updated_at 版本檢查。\n" +
      "--   另讀出 ga_vd_json 與 ga_ws_vendor_save 的現行定義做文字替換，加入銀行四欄（形狀不符就中止，請人工處理；已套用就略過）。\n" +
      "-- 先決條件：先套 51、52、53、54、55；第 4 批 33（ga_rq_*、ga_po_*）、第 6 批 44（ga_vd_*、ga_ws_vendor_save）已套用。套用後請用 DEV 已測過的 G45-db 與 G45-att-inv 測試項目自己抽查權限矩陣與遮蔽。",
    verify:
      "SELECT count(*) AS pay_functions FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'ga\\_ws\\_pay\\_%';\n" +
      "-- 核對：對外函式數量與 DEV 相同\n" +
      "SELECT position('bank_name' in pg_get_functiondef('public.ga_vd_json(public.ga_vendors,boolean)'::regprocedure)) > 0 AS vd_json_has_bank;\n" +
      "-- 核對：true",
    rollbackSummary:
      "撤回 56：移除 ga_ws_pay_* 與 ga_pay_* 函式，並把 ga_vd_json、ga_ws_vendor_save 的銀行欄位擴充拿掉。不刪任何資料表資料。要先撤回 57、58（它們參照這些函式）。",
    backup: "-- 撤回前備份：先存 ga_vd_json 與 ga_ws_vendor_save 的現行定義（pg_get_functiondef）；函式本身可由 56 重新套用還原。",
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
    `-- ${d.title}（2026-11-19 第 4.5 批問卷 P1 至 P10）。\n-- ${d.summary}\n` +
    `-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：${d.no}-rollback.sql。套用前先跑 50-b45-preview-before-apply.sql，備份後經使用者核可才執行。\nBEGIN;\n\n`;
  fs.writeFileSync(path.join(outDir, `${d.no}.sql`), `${head}${body}\nCOMMIT;\n\n-- 核對\n${d.verify}\n`);
  const rhead = `-- ${d.no}-rollback.sql\n-- ${d.rollbackSummary}\n${d.backup}\nBEGIN;\n\n`;
  fs.writeFileSync(path.join(outDir, `${d.no}-rollback.sql`), `${rhead}${rb}\nCOMMIT;\n`);
  console.log(`wrote ${d.no}.sql, ${d.no}-rollback.sql`);
}

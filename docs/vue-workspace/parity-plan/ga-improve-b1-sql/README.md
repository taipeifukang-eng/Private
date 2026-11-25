# 總務採購與請款改善第一批（ga-improve-b1）正式區 SQL 草稿

對應設計：`docs/vue-workspace/parity-plan/ga-improve-b1-design.md`。範圍：G1 預付款、G2 含稅單價、G3 調整列、G4 付款方式與同仁代墊、G11 多家買受人公司、G12 權限顯示名稱。

**這些是草稿，沒有在正式區執行過。** 內容與 DEV 實測檔（`supabase/workspace-dev/20261125090000` 至 `20261125130000`）的 SQL 完全相同（單元測試 `tests/unit/GAIB1/sql-files.test.ts` 逐檔比對），每份都在 DEV 做過「套用 → 撤回 → 再套用」往返，撤回後被改動的函式定義與套用前逐字相同。

## 先決條件

1. 正式區已經套用水電話費請款（G46）草稿 `ga-utility-payment-sql/01 至 04`（`ga_payment_request_bill_lines` 存在）。**本批在 G46 上線後才上，不併入 12/8 切換當晚步驟。**
2. 第 4.5 批請款單與採購單（G25）已在正式區。
3. 先跑 `00-preview-before-apply.sql`（只讀）：確認先決條件、資料量、`pay_buyer_*` 設定鍵、約束現況、`permissions` 欄位、各被加掛函式的現行定義雜湊與 `has_permission` 雜湊。

## 套用順序與內容

| 順序 | 檔案 | 內容 | 風險 |
|---|---|---|---|
| 1 | `01-ga-improve-b1-buyer-companies` | G11：公司表與事件表、採購單與請款單的抬頭欄位、既有設定搬成預設公司（兩個值都有且統編 8 碼才搬）、設定讀寫相容、送出時凍結抬頭快照 | 低：新欄位可為空；舊設定鍵保留並雙寫 |
| 2 | `02-ga-improve-b1-po-tax-adjust` | G2、G3：`price_mode`（預設未稅）、含稅欄位、調整列表與進貨承接表、總額與進貨金額計算改走同一支函式（未稅分支與原式相同） | 中：改了金額計算函式本體，所以黃金比對要過 |
| 3 | `03-ga-improve-b1-pay-methods-payee` | G4：付款方式約束放寬成超集、卡號末四碼與平台欄位、代墊欄位、同仁匯款帳戶表（RLS 全封）、付款對象守門觸發器、我的代墊款 | 低：約束只放寬 |
| 4 | `04-ga-improve-b1-prepay` | G1：預付欄位、預付餘額帳、核銷與回復、結案守門、逾期篩選、待請款計算改為「一般請款＋核銷」 | 中：改了累計請款與待請款計算 |
| 5 | `05-ga-improve-b1-permission-label` | G12：函式裡的白話訊息「水電網費管理」改為「水電話網費管理」；permissions 表如果有名稱類文字欄位或 description 含舊名稱，只更新含舊名稱的列 | 低：只換字串，權限碼不變 |

05 與 01 至 04 互不相依，可以在任何時間點套用。**全部不新增任何權限碼，也不授權給任何角色。**

## 每份檔案的樣式

- `NN-*.sql`：套用。可重複執行（欄位用 `IF NOT EXISTS`、既有函式採「讀現行定義＋文字替換」：已套用就略過、**形狀與預期不符就中止，不整支覆蓋**）。
- `NN-*.rollback.sql`：撤回，逐字還原被加掛的函式本體。撤回前會檢查「已經有資料用了新功能」的情況並中止（例如已有預付請款單、含稅採購單、同仁代墊單、信用卡付款單），避免撤回後資料失去意義；測試資料請先清除。
- `NN-*.verify.sql`：只有 SELECT，每列回 `pass` 或 `fail`，全部 `pass` 才算成功（資料表與 RLS、欄位、函式存在與權限、加掛標記、約束、觸發器、沒有新增權限碼）。

## 還原順序（與套用相反）

`05 → 04 → 03 → 02 → 01`。每一步先跑該份的 rollback，再用對應 verify 的「失敗」確認已撤回。01 撤回時，已有採購單或請款單引用買受人公司就會中止（先確認這些單據可以失去抬頭選擇）。舊設定鍵 `pay_buyer_title`／`pay_buyer_tax_id` 在雙寫期間內容與預設公司一致，撤回後舊畫面照常讀取。

## 套用後的驗證步驟

1. 逐份跑 `.verify.sql`，確認沒有 `fail`。
2. 再跑一次 `00-preview-before-apply.sql`，對照函式雜湊（被加掛的函式雜湊應該改變，`has_permission` 雜湊不變）。
3. 零影響檢查：用同一批既有採購與請款資料，呼叫 `ga_ws_pay_request_list`／`get`、`ga_ws_pay_export`（不帶 `extended`）、`ga_ws_pay_po_summary`、`ga_ws_po_get`／`list`，輸出與套用前相同（只多新增的鍵）。DEV 已用 `tests/integration/GAIB1.db-golden.regression.spec.ts` 做過。
4. 買受人設定：若 `pay_buyer_title` 與 `pay_buyer_tax_id` 只有其中一個有值、或統編不是 8 碼，不會搬移；請總務到請款設定新增公司並設為預設。

## 與 G46 草稿的相依

- `ga_ws_pay_request_action`、`ga_pay_request_json`、`ga_ws_pay_request_list`、`ga_ws_pay_export` 在 G46 草稿 04 已被加掛（`GAUP` 標記）；本批在它之上再加掛（`GAIB1-Sn` 標記），兩者的標記互不影響，撤回順序要先撤本批再撤 G46。
- 水電請款單也能選同仁代墊（帳單自動標已繳的行為不變）：不需要額外 SQL，由 `payee_type`／`payee_profile_id` 欄位與 `ga_ib1_pay_set_buyer` 延伸點處理。

## 與 DEV 不同的地方

- DEV 專用的測試資料清除函式（`20261125140000_ga_improve_b1_dev_seed`）**不進正式區**。
- 正式區 `has_permission` 不看 `roles.is_active`、資料庫端不放行 admin；本批所有新函式只用 `has_permission` 與既有的 `ga_pay_can_*`／`ga_po_can_*`，語意與正式區一致。
- 若正式區的 `permissions` 表有名稱欄位而且含舊名稱，05 會一併更新；DEV 沒有這個欄位，所以 DEV 這一步是空操作（05 的 verify 會檢查 `to_jsonb(permissions)` 不含舊名稱）。

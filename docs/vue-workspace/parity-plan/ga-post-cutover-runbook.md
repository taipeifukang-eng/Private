# 水電話費請款（G46）與採購請款改善（B1）正式區執行順序

這份文件是「第二份」正式區操作順序，不併入 `m9-sql/README.md` 的 92 步總表（那份一個字都沒動）。
由 `scripts/m9-runbook/build.cjs --ga` 讀這份總表與兩個資料夾裡的 SQL，產生第二份逐步操作頁。

## 時間點（老闆 2026-11-25 決定）

- G46 與 B1 的 SQL **和這次新版部署一起上正式區**，不再等 12/15。
- 兩個資料夾（`ga-utility-payment-sql/README.md`、`ga-improve-b1-sql/README.md`）裡寫的「12/8 之後約 12/15 那週」「本批不併入 12/8 當晚步驟」是舊的排程說明，以這份文件為準。
- 仍然是「另一份」操作頁：92 步主流程先做完並驗收，再做這一份；不要混在同一頁貼。
- G46 選用的 `05-backfill-payee` **不跑**（正式區目前廠商是 0 筆，沒有東西可補），改用畫面補填繳費單位。

## 前置條件（做這份之前）

1. 老闆同意日期。
2. m9 主流程中，總務相關的第 44、45、48 步，第 50 至 61 步，第 68 至 75 步都已完成並驗收通過。
3. 正式區 `has_permission` 的行為和預期一致（不檢查 `roles.is_active`、資料庫端不放行 admin）。

## 全部正式區執行順序總表

這是這份操作頁的唯一順序依據：先 G46（先預覽與備份、再 4 份、黃金快照比對、畫面操作與驗收），G46 穩定後才做 B1。
**性質**：唯讀 = 只有 SELECT；新增 = 只建立新物件；新增＋改既有 = 新物件加上對既有函式或欄位的加掛；改既有資料 = 會改資料或金額計算。

| 序號 | 檔案 | 做什麼 | 性質 | 備份 | 撤回 | 檢查 |
|---|---|---|---|---|---|---|
| **階段 1　水電話費請款（G46）** | | | | | | |
| 1 | `ga-utility-payment-sql/00-preview-before-apply.sql` | 套用前預覽：先決條件、帳單現況、公用事業分類、9 支函式的加掛位置形狀、函式全文、授權名單 | 唯讀 | 否（唯讀） | 無（唯讀） | 看輸出：A 區無 MISSING、D 區無 SHAPE_MISMATCH |
| 2 | `ga-utility-payment-sql/01-ga-utility-payment-schema.sql` | 請款單加來源欄位、水電明細表、帳單加繳費單位欄位、設定鍵與公用事業分類、守門觸發器 | 新增＋改既有 | 是：四張表加 9 支函式全文（操作頁內建備份） | `01-ga-utility-payment-schema.rollback.sql` | `01-ga-utility-payment-schema.verify.sql` |
| 3 | `ga-utility-payment-sql/02-ga-utility-payment-bill-side.sql` | 帳單觸發器改版、繳費單位相關函式、帳單附件鎖 | 新增＋改既有 | 否（沿用第 2 步已做的備份） | `02-ga-utility-payment-bill-side.rollback.sql` | `02-ga-utility-payment-bill-side.verify.sql` |
| 4 | `ga-utility-payment-sql/03-ga-utility-payment-request-core.sql` | 送出前檢查（每張帳單至少一個附件）、自動標記與回復、候選／建立／修改／匯出函式 | 新增＋改既有 | 否（沿用第 2 步已做的備份） | `03-ga-utility-payment-request-core.rollback.sql` | `03-ga-utility-payment-request-core.verify.sql` |
| 5 | `ga-utility-payment-sql/04-ga-utility-payment-request-hooks.sql` | 對 5 支既有請款單函式做最小加掛（來源是水電才分流） | 新增＋改既有 | 否（沿用第 2 步已做的備份） | `04-ga-utility-payment-request-hooks.rollback.sql` | `04-ga-utility-payment-request-hooks.verify.sql` |
| **階段 2　採購請款改善第一批（B1）** | | | | | | |
| 6 | `ga-improve-b1-sql/00-preview-before-apply.sql` | 套用前預覽：先決條件（第一列必須是 ok）、資料量、設定鍵、約束現況、函式雜湊 | 唯讀 | 否（唯讀） | 無（唯讀） | 看輸出：第一列是 ok |
| 7 | `ga-improve-b1-sql/01-ga-improve-b1-buyer-companies.sql` | G11：多家買受人公司、抬頭欄位、既有設定搬成預設公司 | 新增＋改既有 | 是：B1 會動到的表加函式全文（操作頁內建備份） | `01-ga-improve-b1-buyer-companies.rollback.sql` | `01-ga-improve-b1-buyer-companies.verify.sql` |
| 8 | `ga-improve-b1-sql/02-ga-improve-b1-po-tax-adjust.sql` | G2、G3：含稅單價、調整列、金額計算函式改版 | 改既有資料 | 否（沿用第 7 步已做的備份） | `02-ga-improve-b1-po-tax-adjust.rollback.sql` | `02-ga-improve-b1-po-tax-adjust.verify.sql` |
| 9 | `ga-improve-b1-sql/03-ga-improve-b1-pay-methods-payee.sql` | G4：付款方式約束放寬、同仁代墊、同仁匯款帳戶表 | 新增＋改既有 | 否（沿用第 7 步已做的備份） | `03-ga-improve-b1-pay-methods-payee.rollback.sql` | `03-ga-improve-b1-pay-methods-payee.verify.sql` |
| 10 | `ga-improve-b1-sql/04-ga-improve-b1-prepay.sql` | G1：預付款、預付餘額帳、累計請款與待請款計算改版 | 改既有資料 | 否（沿用第 7 步已做的備份） | `04-ga-improve-b1-prepay.rollback.sql` | `04-ga-improve-b1-prepay.verify.sql` |
| 11 | `ga-improve-b1-sql/05-ga-improve-b1-permission-label.sql` | G12：白話訊息「水電網費管理」改成「水電話網費管理」（與 01 至 04 互不相依） | 改既有資料 | 否（沿用第 7 步已做的備份） | `05-ga-improve-b1-permission-label.rollback.sql` | `05-ga-improve-b1-permission-label.verify.sql` |

合計 **11 步**（另有前置確認、黃金快照、畫面操作、驗收、授權與收尾等額外步驟，由產生器加入）。

---

## 順序與規則

1. **閘門**：老闆同意日期；m9 第 44、45、48、50 至 61、68 至 75 步已驗收；正式區 `has_permission` 如預期。
2. **G46**：
   1. 跑第 1 步預覽並整份存檔。A 區不能有 MISSING；D 區不能有 SHAPE_MISMATCH；看 B 區（金額有小數、0 元）與 C 區（是否已有公用事業分類）。
   2. 先存一份「黃金快照」（各狀態張數與金額、各採購單累計請款、清單指紋）。
   3. 備份四張表（`ga_utility_bills`、`ga_payment_requests`、`ga_workflow_settings`、`ga_service_categories`）與預覽 E 區的 9 支函式全文。
   4. 依序套用 01、02、03、04，每份各自跑 verify，全部 `pass` 才進下一步；任何一份出錯，從該份開始往前依序撤回。
   5. 再跑一次黃金快照，必須和套用前完全相同。
   6. 總務在畫面新增水電廠商（勾公用事業、統編必填）。
   7. 畫面補填既有帳單的繳費單位（不跑 05）。
   8. 驗收：用一張標記清楚的測試帳單走完建立、缺附件被擋、補附件送出、退回、作廢，之後清除。
   9. 角色授權是老闆的決定，不在這份 SQL 裡。
3. **B1**（G46 穩定後）：
   1. 跑第 6 步預覽，第一列必須是 `ok`。
   2. 備份 B1 會動到的表與函式全文（B1 自己的 README 沒附備份，所以操作頁內建）。
   3. 依序套用 01 至 04，每份各自跑 verify；05 與其他互不相依。
   4. 重跑預覽、對照雜湊：被加掛的函式雜湊會變，`has_permission` 雜湊不能變。
   5. 零影響檢查：02 有資料回填與金額計算改版，做完立刻跑黃金比對；全部做完再比對一次。
   6. 若 `pay_buyer_title` 與 `pay_buyer_tax_id` 只有其中一個有值、或統編不是 8 碼，不會自動搬成預設公司，請總務手動新增並設為預設。

## 撤回順序（和套用相反）

- B1：05、04、03、02、01。
- G46：04、03、02、01（選用的 05 不跑，所以沒有它）。
- 兩批的撤回在已有測試資料時會中止；測試資料請先清除。
- 先撤 B1 再撤 G46（B1 在 G46 的函式之上再加掛，標記互不影響，但撤回順序要反過來）。

## 絕對不要送上正式區

- `20261124140000_ga_utility_payment_dev_seed*` 與 `20261125140000_ga_improve_b1_dev_seed*`（DEV 專用測試資料與清除函式）。
- `vue_workspace_gaup_*` 開頭的 DEV 測試角色。
- `scripts/cleanup-ga-utility-payment-dev.cjs`。
- 任何帶 `QA-GAUP-` 或 `QA-GAIB1-` 標記的資料。

## 關於頁面「回舊版」

G46、B1 的新頁面如果要有單頁「回舊版」備援，需要 `workspace_page_fallbacks` 有對應的列；這兩批 SQL 都沒有動那張表，由管理員在「頁面回舊版設定」管理頁處理。

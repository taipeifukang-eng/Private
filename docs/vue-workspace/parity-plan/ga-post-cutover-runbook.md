# 水電話費請款（G46）、採購請款改善（B1）與巡店定位例外寫入（96）正式區執行順序

這份文件是「第二份」正式區操作順序，不併入 `m9-sql/README.md` 的 92 步總表（那份一個字都沒動）。
由 `scripts/m9-runbook/build.cjs --ga` 讀這份總表與資料夾裡的 SQL，產生第二份逐步操作頁。

## 上線當天的先後順序（結論：先跑這份 SQL，再合併 PR）

建議順序（理由和逐檔檢查在下一節）：

1. **先做總表第 12 步（唯讀前置檢查）**：確認舊版「巡店定位例外」的 SQL 已經在正式區。這一步同時是「合併前」的閘門：main 上現有的舊版巡店頁（這次合併沒有改它）本來就讀 `gps_exempt` 欄位，所以第一列不是 `ok` 代表正式區現況和「舊版定位例外已上線」的說法不符，要先查清楚。第一列不是 `ok` 就**整個上線先停**，SQL 與合併都不做。
2. **再跑這份 SQL**：G46（總表第 1 至 5 步）、B1（第 6 至 11 步）、96（第 13 步）。
3. **然後才合併 PR 到 `main`**（此時 `WORKSPACE_ENABLED` 沒設，新版是關閉的），等 Production 部署 Ready。
4. 再把 `WORKSPACE_ENABLED` 設成 `true`（`admin_only`，只有管理員）；隔天早上改成 `all`。

為什麼是 SQL 先：

- 這份 SQL 全部是「只加不拆」，對**現在正式區的舊版程式（合併前的 main）**沒有影響，先做不會有任何人察覺。
- SQL 若中途失敗，只要不合併，就沒有新版程式在線上，退回只要撤 SQL；若反過來先合併，失敗時線上已經是新版程式，要同時處理程式與資料庫兩邊。
- 先合併的話，會有一段時間「新版程式已上線、資料庫還沒備齊」：新版目前是關閉的所以看不出問題，但這段時間若有人提早打開 `WORKSPACE_ENABLED`、或預覽／冒煙檢查先跑，新版頁面會呼叫還不存在的函式而出錯。
- 舊版定位例外的 SQL 檔頭本身也寫「先執行 SQL，再部署新版程式」。

### 逐檔相容性檢查（對照「現在正式區的舊版程式」與「新版程式先合併」兩種情況）

檢查方式：逐檔看 SQL 內容，再搜尋舊版程式（`app/`、`lib/`，不含新版工作台）有沒有用到它動到的欄位或函式。舊版程式碰到這一批的只有水電帳單表 `ga_utility_bills`（直接讀寫表，不呼叫任何 `ga_ws_*` 函式）；請款單、採購單、買受人公司、預付款、`workspace_save_inspection` 都只有新版工作台會用。

| 檔案 | 做了什麼 | 對「現在的舊版程式」安全嗎 | 新版程式先合併、SQL 還沒跑會怎樣 |
|---|---|---|---|
| G46 01 | 請款單加 3 欄（都有預設值）、新明細表、水電帳單加 2 個可空欄位、新設定鍵與「公用事業」分類 | 安全：只新增，舊版 `select *` 多出的欄位不會用到；沒有刪欄、改名、改 RLS | 只有新版水電請款頁會用到新欄位；新版關閉時沒人用 |
| G46 02 | 水電帳單觸發器改版、帳單 JSON 與清單函式加欄位、最後附件守門 | 安全：新增的鎖定只對「已在送出請款單內的帳單」生效，上線前沒有這種帳單；手動改繳費日只是多清一個空欄位 | 同上，只有新版水電頁呼叫新函式 |
| G46 03 | 新函式與觸發器（送出前檢查、自動標已繳），只在「水電來源」的請款單生效 | 安全：舊版不碰請款單表 | 同上 |
| G46 04 | 對 5 支既有請款單函式最小加掛（簽名不變，來源不是水電時行為完全不變） | 安全：舊版不呼叫這 5 支 | 新版請款頁用舊版函式本體照常運作，水電分流要 04 才有 |
| B1 01 | 買受人公司新表、抬頭新欄位（可空）、舊設定搬成預設公司（舊設定鍵保留雙寫） | 安全：舊設定鍵還在 | 新版買受人公司頁會因缺表而出錯（關閉時看不到） |
| B1 02 | 含稅單價與調整列：新欄位、預設「未稅」；金額計算改走同一支函式（未稅分支與原式相同） | 安全：舊版不碰採購單；既有金額由「黃金快照比對」保證不變 | 新版採購單頁缺含稅欄位會出錯 |
| B1 03 | 付款方式約束**放寬**（舊值全部還能用）、同仁代墊與匯款帳戶新表 | 安全：只放寬，沒有收緊 | 新版選「同仁代墊」「信用卡」會被舊約束擋下 |
| B1 04 | 預付款欄位與預付餘額帳、累計請款與待請款計算改版（沒有預付資料時結果相同） | 安全：舊版不碰；既有數字由黃金比對保證不變 | 新版預付款頁缺表而出錯 |
| B1 05 | 函式內的白話訊息「水電網費管理」改成「水電話網費管理」；權限表若有含舊名稱的文字才換字（權限碼不變） | 安全：只改顯示文字，權限碼、授權都不變 | 只是訊息文字還是舊名稱 |
| 96 | `workspace_save_inspection` 同簽名替換：新增巡店時多寫 `gps_exempt`（沒帶就是 false）；其餘與步驟 50 相同 | 安全：舊版新增巡店是直接寫表，不經這支函式 | 新版「定位例外」勾了也寫不進去（存成一般巡店），可能被定位檢查擋下 |

結論：這份 SQL 的每一檔都「對舊版安全」，所以 SQL 先做是安全的；反過來「新版先合併」在新版關閉的期間也不會出事，但不比 SQL 先做更好，還多一段不一致的空窗。

逐項核對時另外確認的三件小事（都不影響先跑 SQL）：
- 舊版水電帳單頁（`app/api/general-affairs/utility-bills`）直接讀寫 `ga_utility_bills` 表，G46 02 的帳單觸發器會對它生效；新增的鎖定與繳費單位檢查只在「帳單已在送出或已付款的水電請款單內」或「寫入了繳費單位」時才動作，上線前兩者都沒有；舊版新增與改繳費日期的流程不受影響。舊版附件刪除（`ga_soft_delete_resource_attachment`）會經過 G46 02 新增的附件守門，同樣只對「已在送出請款單內的水電帳單」生效。
- G46 01 會新增一筆「公用事業」廠商分類，舊版總務服務中心的分類與廠商頁看得到這一列（只是多一列，可正常使用）。
- B1 05 會把 public 結構內「函式本體含舊名稱『水電網費管理』」的所有函式換字，包含舊版水電帳單觸發器的錯誤訊息；舊版程式沒有比對這段文字（已搜尋 app/、components/、lib/），只是訊息文字變成新名稱。

唯一要特別注意的跨界前置（不是這份 SQL，但兩種順序都要它）：main 上現有的**舊版巡店頁**（`app/inspection/`，與這次合併的分支內容相同，不是這次新增）就會讀 `inspection_masters.gps_exempt`，所以舊版定位例外 SQL（`docs/inspection-gps-exemption-prod.sql`）必須在**合併之前**就已套用。這就是總表第 12 步要在合併前先做的原因。另外，96 要在 M9 步驟 50 之後做，**96 做完後絕對不要再重跑步驟 50**（會把函式蓋回不寫 `gps_exempt` 的版本）。

## 時間點（老闆 2026-11-25 決定）

- G46、B1 與 96 的 SQL **和這次新版部署一起上正式區**，不再等 12/15；先後順序是「先跑 SQL、再合併 PR」（見上一節）。
- 兩個資料夾（`ga-utility-payment-sql/README.md`、`ga-improve-b1-sql/README.md`）裡寫的「12/8 之後約 12/15 那週」「本批不併入 12/8 當晚步驟」是舊的排程說明，以這份文件為準。
- 仍然是「另一份」操作頁：92 步主流程先做完並驗收，再做這一份；不要混在同一頁貼。
- G46 選用的 `05-backfill-payee` **不跑**（正式區目前廠商是 0 筆，沒有東西可補），改用畫面補填繳費單位。

## 前置條件（做這份之前）

1. 老闆同意日期。
2. m9 主流程中，總務相關的第 44、45、48 步，第 50 至 61 步，第 68 至 75 步都已完成並驗收通過。
3. 正式區 `has_permission` 的行為和預期一致（不檢查 `roles.is_active`、資料庫端不放行 admin）。
4. 舊版「巡店定位例外」SQL（`docs/inspection-gps-exemption-prod.sql`）已在正式區套用（老闆說已上線；由總表第 12 步唯讀檢查證明，不是靠口頭）。

## 全部正式區執行順序總表

這是這份操作頁的唯一順序依據：先 G46（先預覽與備份、再 4 份、黃金快照比對、畫面操作與驗收），G46 穩定後才做 B1，最後做 96（前置檢查在階段 3 開頭；它和 G46、B1 互不相依，但前置檢查的結果同時是「能不能合併」的閘門）。
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
| **階段 3　巡店定位例外寫入（96）** | | | | | | |
| 12 | `m9-sql/96_inspection_gps_exempt_save.precheck.readonly.sql` | 前置檢查：舊版定位例外 SQL 已套用（gps_exempt 欄位、inspection.gps_exempt 權限碼、can_use 函式、新版定位 trigger 與防竄改 trigger）、M9 步驟 50 已套用；缺任何一項就停（也不要合併新版程式） | 唯讀 | 否（唯讀） | 無（唯讀） | 看輸出：第一列是 ok |
| 13 | `m9-sql/96_inspection_gps_exempt_save.sql` | 新版巡店「定位例外」寫入：只替換 workspace_save_inspection 一支函式，新增巡店時多寫 gps_exempt；不改任何資料列 | 改既有資料 | 是：函式全文（操作頁內建備份，唯讀 SELECT） | `96_inspection_gps_exempt_save.rollback.sql` | `96_inspection_gps_exempt_save.verify.sql` |

合計 **13 步**（另有前置確認、黃金快照、畫面操作、驗收、授權與收尾等額外步驟，由產生器加入）。

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

4. **96**（B1 之後；和 G46、B1 互不相依）：
   1. 跑總表第 12 步前置檢查，第一列必須是 `ok`。不是 `ok` 就停：96 不做，**新版程式也不要合併**。
   2. 先貼第 13 步的「備份」區塊（唯讀，`workspace_save_inspection` 函式全文），整份存檔。
   3. 貼 96 主檔（只替換一支函式、不改資料列），再跑 `.verify.sql`，6 列全部 `ok = true`。
   4. 之後**不要再重跑 M9 步驟 50**。
5. **合併 PR**：以上全部完成並驗收後才合併（`WORKSPACE_ENABLED` 不設），再依序 `admin_only`、隔天 `all`。

## 撤回順序（和套用相反）

- B1：05、04、03、02、01。
- G46：04、03、02、01（選用的 05 不跑，所以沒有它）。
- 96：獨立還原（`96_inspection_gps_exempt_save.rollback.sql` 換回步驟 50 的函式版本），不影響 G46、B1。
- 96 的函式不能靠重跑步驟 50 還原或「修復」：步驟 50 一重跑就會把函式蓋回不寫 `gps_exempt` 的版本。
- 兩批的撤回在已有測試資料時會中止；測試資料請先清除。
- 先撤 B1 再撤 G46（B1 在 G46 的函式之上再加掛，標記互不影響，但撤回順序要反過來）。
- 若 SQL 做完但還沒合併就要中止上線：只需要撤 SQL（舊版程式一直是原樣，沒有東西要退）。

## 絕對不要送上正式區

- `20261124140000_ga_utility_payment_dev_seed*` 與 `20261125140000_ga_improve_b1_dev_seed*`（DEV 專用測試資料與清除函式）。
- `vue_workspace_gaup_*` 開頭的 DEV 測試角色。
- `scripts/cleanup-ga-utility-payment-dev.cjs`。
- 任何帶 `QA-GAUP-` 或 `QA-GAIB1-` 標記的資料。

## 關於頁面「回舊版」

G46、B1 的新頁面如果要有單頁「回舊版」備援，需要 `workspace_page_fallbacks` 有對應的列；這兩批 SQL 都沒有動那張表，由管理員在「頁面回舊版設定」管理頁處理。

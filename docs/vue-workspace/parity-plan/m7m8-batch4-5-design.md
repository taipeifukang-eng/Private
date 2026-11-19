# M7/M8 第 4.5 批設計（定稿，2026-11-19，使用者 P1–P10 已回答）：進貨單憑證、進貨發票、請款單與付款標記、作廢進貨

> 狀態：定稿（2026-11-19）。使用者問卷 P1 至 P10 已回答，問卷 assumptions（A1 至 A10）全部視為核可；§9 為最終決定。尚未動工，實作分五階段（§11）。
> 來源：D17（進貨單憑證、發票、請款單另立第 4.5 批）、D18（發票）、D19（請款單）原文見 `m7m8-batch4-design.md` §10；第 4 批採購單、到貨驗入、配發已完成（§12），第 6 批廠商績效與採購分析已完成（`m7m8-batch6-design.md`）。
> 重要前提：**舊版沒有此功能**（沒有發票、憑證、請款、應付、對帳、付款申請的資料表、API、頁面）。因此本批是「新功能」，不是移植；parity 無法做舊新比對，測試基準是 D18、D19 與本文件。舊版只有願景敘述（`GENERAL-AFFAIRS-SERVICE-CENTER-SPEC.md` §4.5、§7.3）從未實作。
> 範圍：進貨單憑證登記、進貨發票（含圖片）、請款單（草稿、送出、退回、已付款、作廢）、請款權限與導覽、作廢進貨明細、廠商銀行資料、請款單列印與 CSV 對帳、採購分析與廠商績效補上請款維度。不做：金流串接、請款核准流程與門檻、工單維修費請款、獨立退貨單與折讓單、預付款。
> 實作限制：只連 DEV（`supabase/.temp/project-ref` 以 mjpd 開頭，DB 指令前先確認）；不 push；不動 `supabase/migrations`；不連正式區（odvk）；測試資料只用 VW／ZT 測試門市，年份優先 2038；`test:page` 與 e2e 一律循序；權限語意以正式區 `has_permission` 為準（不檢查 `roles.is_active`、DB 無 admin bypass；應用層 `profiles.role==='admin'` 不放行請款入口與任何請款寫入）。

## 1. 舊版功能清單與缺陷（以程式碼為準）

### 1.1 舊版有什麼、沒什麼
| 項目 | 舊版現況 | 檔案 |
|---|---|---|
| 進貨憑證（送貨單號、發票、日期、金額、稅額、統編） | **沒有**。採購評估到貨入庫（`purchase-receipt`）只寫庫存交易，無任何憑證欄位或附件入口 | `app/api/general-affairs/requests/[id]/purchase-receipt/route.ts` |
| 發票登記 | **沒有**。唯一與發票沾邊：設備與設施建檔的保固文件分類 `WARRANTY_DOCUMENT`（說明可傳發票、收據）與保固方式 `INVOICE_OR_RECEIPT`，屬設備層級購買證明，與採購單無關聯、無結構欄位 | `EquipmentCreatePageClient.tsx`、`FacilityCreatePageClient.tsx` |
| 請款單、應付、付款申請、對帳 | **完全沒有**（全 repo 無對應表、API、頁面、狀態機、列印、匯出） | 僅規格書 §4.5、§7.3 願景 |
| 付款概念 | 只有水電網費 `ga_utility_bills.paid_at`（門市據點對公用事業，與廠商採購無關）；新版第 6 批 V6 至 V8 已補已繳規則 | `20260925103000_general_affairs_utility_bills.sql` |
| 採購金額 | `ga_purchase_reviews`／`ga_purchase_review_quotes` 只有預估、報價、議價、最終金額（含稅與否未定義），是評估價不是實付價 | `20260908093000_general_affairs_purchase_reviews.sql` |
| 共用附件 | 新版 `RESOURCE_TYPES` 現有八種（EQUIPMENT、FACILITY、PART、MAINTENANCE_REQUEST、MAINTENANCE_UPDATE、SERVICE_REQUEST、SERVICE_REQUEST_COMMENT、UTILITY_BILL），不含採購單、進貨單、發票；舊版路由單檔 20MB、一次 10 個，但主機單次約 4.5MB；舊版刪除會真的移除實體檔 | `lib/workspace/general-affairs/upload-rules.ts`、`app/api/general-affairs/attachments/route.ts` |
| 廠商帳務欄位 | `tax_id`、`billing_title`、`billing_address`、`invoice_type`（二聯式、三聯式、電子發票）、`payment_terms`（自由文字）、`payment_methods`；**沒有銀行帳號**；`total_amount` 無更新來源永遠 0 | `20260724092830_general_affairs_vendor_form_sections.sql` |
| 買受人（本公司抬頭、統編） | 沒有基準資料 | 無 |
| 舊版廠商列印表單（紙本） | 「發票與付款資料」區有發票類型、付款條件勾選（月結30天、月結45天、現結、其他）、付款方式勾選（匯款、支票、現金、其他），沒有銀行帳號欄。可見實務偏月結，請款需支援一次請一整月 | `VendorInformationPrintForm.tsx` 約 116 至 126 行 |
| 需求單備註 | 到貨相關備註提示「可填發票、配送或驗收資訊」，只是自由文字 | `ServiceRequestIntakeClient.tsx` 約 2830 行 |
| 員工購買匯入的 `invoice_number` | 是 POS 銷售資料，與進貨無關 | `app/api/employee-purchases/import/route.ts` |

### 1.2 缺陷與落差（本批如何處理）
1. 無法對帳：付款依據只有紙本。處理：發票、請款單進系統，採購分析加請款與已付款維度。
2. 發票類型兩套值：處理：統一為五種（三聯式、二聯式、電子發票、收據、免開發票）。
3. 附件資源類型與路徑規則不含發票；`ga_resource_attachment_can_manage` 對新類型會回 false（第 6 批 §12 對 `UTILITY_BILL` 已踩過），**讀取函式實名是 `ga_resource_attachment_can_read`（不是 can_view），且現行定義同樣沒有 UTILITY_BILL 分支**（§13.1）。處理：新增資源類型與兩個函式的分支。
4. 舊版到貨非原子。新版第 4 批已用單一交易；本批所有寫入也以單一資料庫函式完成。
5. 進貨明細填錯沒有更正機制（第 4 批 §12.7 SQL 審查 2）。處理：P6 納入作廢進貨。
6. 進貨明細沒有單價與金額。處理：進貨明細凍結未稅金額。
7. `ga_vendors.total_amount` 假資料。處理：不回寫此欄；已請款、已付款由真實單據計算。
8. 送貨單號無唯一性、無附件。處理：同廠商重複送貨單號警示（不擋）。
9. 廠商統編與付款條件只在下訂時快照。處理：請款單建立時快照廠商名稱、統編、銀行資訊。
10. 付款條件自由文字，無法算應付日。處理：手填預計付款日，不做自動逾期推算。

## 2. 已決定事項

### 2.1 先前批次已決定（引用，不再問）
| 決定 | 本批落點 |
|---|---|
| D17 進貨單憑證、發票、請款單另立第 4.5 批 | 本批 |
| D18 發票類型、號碼、日期、未稅額、稅額（5% 自動算、可手改尾差）、含稅額、可上傳圖片；請款畫面採購單、進貨單、發票逐品項並排，有差異須填原因但可送出 | §3.3、§4 |
| D19 請款單只當付款申請紀錄；付款方式轉帳、現金、支票與日期手填，不接金流；一張請款單可帶多張進貨單與發票；累計請款不得超過累計進貨；**不簽核（P3 維持）**；退貨暫以庫存調整出加原因，已轉設備者不可退、走報廢 | §3.1、§3.4 |
| 使用者記憶：設備採購先進總部庫存、配發轉設備；採購單、歷史價、下訂、請款都要 | 請款以進貨為上限，不影響庫存／配發 |
| 第 4 批 D8：銀行帳號等廠商機密不複製進採購單；統編、付款條件下訂時快照 | 發票統編核對以採購單快照為準 |
| 第 4 批 D10：下訂後鎖定；已有到貨只能短收結案 | 請款上限用累計驗入量，不是訂購量 |
| 第 4 批 D13、§12.7：品項各自進位、金額記未稅 | 進貨凍結未稅金額，含稅在請款端換算 |
| 第 6 批 V1：廠商帳務欄位為機密，僅 `vendor.view`／`vendor.manage` 可見 | 銀行欄位、請款單廠商快照照此遮蔽 |
| 第 6 批 V8：水電帳單標記已繳憑證不強制 | 水電費不納入本批請款 |
| m7m8-spec Q3：照片瀏覽器端縮到長邊約 2000px、其他檔最大 4MB、刪除只標記不刪檔 | 發票附件沿用 |
| 通則：分頁與精確筆數、搜尋跳脫、使用者身分、白話錯誤訊息、`expected_updated_at` 回 `409 STALE`、事件表不可改刪、固定識別防重複 | 全部 |

### 2.2 直接採用的假設（問卷 assumptions，全部視為核可）
A1 發票採「獨立資料表＋與進貨單多對多關聯表」。A2 請款單限單一廠商、可含該廠商多張採購單的進貨單。A3 發票類型統一五種，廠商預設類型可預填（無廠商帳務查看權限者不預填）。A4 新增買受人（本公司抬頭、統編）設定，三聯式統編不符只警示、填原因可送出。A5 發票圖片新增資源類型 `PURCHASE_INVOICE`、`PURCHASE_RECEIPT`，附件讀寫走伺服端權限閘。A6 付款條件維持自由文字，請款單手填預計付款日。A7 請款只來自採購單進貨，工單維修費、需求單報價、水電費請款另批。A8 採購單結案不被「未請款」擋住，只顯示提醒。A9 已付款單鎖定，只能看與加備註（與作廢）。A10 不改既有採購單狀態（不新增「已請款」狀態），請款狀態另列，避免動 G25-db 63 項既有測試。

## 3. 新版做法

### 3.1 狀態機（P1、P3、P4、P7）
請款單 `ga_payment_requests.status`：

```
DRAFT --送出(submit)--> SUBMITTED --標已付款(mark_paid：付款方式、日期、參考號)--> PAID
SUBMITTED --退回草稿(return，必填原因)--> DRAFT
DRAFT / SUBMITTED / PAID --作廢(void，原因)--> VOID   （終態；作廢釋放請款額度）
DRAFT/SUBMITTED/PAID --備註(note)--> 狀態不變，只加一筆事件
```
- **沒有核准關卡**（P3）：沒有 APPROVED 狀態、沒有 `approval_required`、沒有門檻設定、沒有 approve 權限碼。
- P1 兩段記錄：「總務請款」＝ `submitted_by/at`（總務把彙整好的紙本發票與請款單送出）；「會計付款」＝ `paid_by/at` 加付款方式、日期、參考號（會計實際付款後標記）。
- P4：有 `purchase_payment.manage` 的人可建立、編輯草稿、送出、退回、標已付款、作廢；申請人可自己標已付款，**不做申請人≠付款人限制**。
- 作廢原因：SUBMITTED、PAID 必填；DRAFT 選填（等於刪除草稿）。已付款鎖定：不可改金額、明細、發票連結、付款資料，只能「加備註」與「作廢」。作廢後釋放累計請款額度，被引用的發票與進貨恢復可請款。
- 草稿可以「重新抓取廠商帳號」（`refresh_bank` 動作，只改銀行快照並留事件），因為建立當下廠商可能還沒填銀行資料；其餘狀態不可。
- 每個動作寫 `ga_payment_request_events`（不可改刪，資料表層級觸發器擋 UPDATE／DELETE）：actor、from、to、原因、金額快照、固定識別。誰、何時都能追。
- 動作皆帶固定識別（同一識別重送回原結果）與 `expected_updated_at`（版本不符回 `409 STALE`）。
- 發票狀態：`ACTIVE`／`VOID`；已被有效（非 VOID）請款單引用的發票不可作廢，須先作廢或退回請款單。
- 進貨憑證狀態（`voucher_status`）：`NONE`（尚未登錄）／`LINKED`（已連發票）／`NO_INVOICE`（免開發票或僅收據，附說明）。

### 3.2 資料模型（欄位以實作時 `information_schema` 與函式定義再核）
既有表擴充（重用兩張進貨表；開工前實測見 §13.1）：
- `ga_purchase_receipt_items` 加 `amount_untaxed numeric(14,0)`（登錄當下由 `po_item.unit_price × accepted_qty` 品項各自進位後凍結；既有資料以 join 回填）。單價是進貨單位計價，計算用 `accepted_qty`（採購單位），不是 `accepted_base`。
- `ga_purchase_receipts` 加 `updated_at`、`updated_by`、`voucher_status`（預設 `NONE`）、`voucher_note`、`voucher_recorded_by`、`voucher_recorded_at`、`voided_at`、`voided_by`、`void_reason`（作廢後不計入累計驗入與任何統計）。`delivery_note_no` 維持選填，同廠商重複時警示不擋。
- `ga_vendors` 加 `bank_name`、`bank_branch`、`bank_account`、`bank_account_name`（P8，一組），列入 `VENDOR_SECRET_FIELDS`。
- `ga_workflow_settings`（key 文字主鍵、`value_num`、`value_text`、`updated_by`、`updated_at`）新增列：`pay_tolerance_amount`（`value_num`，預設 5，範圍 0 至 100 整數）、`pay_buyer_title`、`pay_buyer_tax_id`（`value_text`）。現有 `ga_ws_po_settings_get/set` 只管 `po_` 設定，另寫 `ga_ws_pay_settings_get/set`（以 `pay\_%` 取版本），不改採購設定函式。**不建 `pay_approval_*`**。

新表（登入者不能直接讀寫，一律走 `ga_ws_*` 函式；金額、統編、銀行資訊伺服端遮蔽）：
- `ga_purchase_invoices`：id、`invoice_type`（`TRIPLE`、`DUPLEX`、`E_INVOICE`、`RECEIPT`、`NO_INVOICE`）、`invoice_no`（免開發票可空）、`invoice_date`（台北、不可未來）、`vendor_id`、`seller_tax_id_snapshot`、`buyer_tax_id`、`amount_untaxed`、`tax_amount`、`amount_total`（DB 驗證：含稅＝未稅＋稅額）、`diff_reason`（尾差超過容許）、`tax_mismatch_reason`（統編不符）、`no_image_reason`（收據不傳圖的原因）、`status`、`notes`、`idempotency_key`、`payload_hash`、`created_by/at`、`updated_by/at`。同廠商同發票號碼（排除 VOID）部分唯一索引。收據與免開發票：稅額固定 0，未稅＝含稅（使用者輸入含稅總額）。
- `ga_purchase_invoice_receipts`：`invoice_id`、`receipt_id`、`allocated_untaxed`、`allocated_tax`（多對多；一張發票對多次到貨，或一次到貨多張發票）。分攤合計須等於發票金額，不等須填 `diff_reason`。
- `ga_payment_requests`：`pr_no`（`PY-YYYYMMDD-NNN`，台北日期流水，建立時以 advisory lock 取號）、`vendor_id`、`vendor_name_snapshot`、`vendor_tax_id_snapshot`、`bank_snapshot`（jsonb，機密）、`status`、`amount_untaxed`、`tax_amount`、`amount_total`、`expected_pay_date`、`pay_method`（`TRANSFER`、`CASH`、`CHECK`）、`paid_date`（台北、不可未來）、`paid_ref`、`submitted_by/at`、`paid_by/at`、`void_reason`、`voided_by/at`、`notes`、`idempotency_key`、`payload_hash`、`created_by/at`、`updated_by/at`。
- `ga_payment_request_lines`：`pr_id`、`po_id`、`receipt_id`、`invoice_id`（可空）、`claim_untaxed`、`claim_tax`、`claim_total`、`diff_reason`。
- `ga_payment_request_events`（不可改刪）。

不變式（資料庫函式強制，不信任前端）：
1. 每個採購單：有效請款單（非 VOID）累計 `claim_total` ≤ 該採購單累計驗入含稅額 ＋ `pay_tolerance_amount`。累計驗入含稅額 = `round(Σ amount_untaxed(未作廢進貨) × (1 + 採購單 tax_rate 快照))`；短收結案以累計驗入為準，不用訂購量。超過直接擋（硬擋，不能填原因過關）。
2. 請款單線只能掛 `accepted_qty > 0` 且未作廢的進貨；拒收量不可請款。
3. 請款單線引用的發票必須通過圖片規則（P10，見 §3.3）。
4. 發票統編：廠商統編以採購單下訂快照為準；不符須填 `tax_mismatch_reason`；三聯式買受人統編與設定不符同樣須填原因（可送出）。
5. 同廠商同發票號碼（有效）不可重複。
6. 沒有驗入的採購單不能請款（不做預付，P2）。
7. 進貨被有效請款單引用時不可作廢（P6）。

### 3.3 發票、圖片與金額差異（D18、P5、P10）
- 輸入未稅額，稅額預設 `round(未稅 × 採購單 tax_rate)`，含稅額為未稅加稅額；可手改稅額。**稅率來自採購單 tax_rate 快照**；免稅廠商＝該採購單 tax_rate 為 0，稅額固定 0（請款端不新增廠商免稅欄位；開工時讀 `ga_ws_po_create` 確認採購單可否建立 tax_rate=0，若不行，免稅情境以發票類型「收據／免開發票」與手改稅額處理，不改採購單）。
- **尾差（P5）**：發票金額與進貨金額差異絕對值 ≤ `pay_tolerance_amount`（預設 5 元）視為尾差，免原因；超過須填 `diff_reason`，**仍可送出**。累計請款超過累計進貨含稅額＋尾差，**直接擋下**。尾差金額在設定頁調整，需 `purchase_payment.manage`。
- 稅額各品項進位：進貨 `amount_untaxed` 以品項各自進位（延續 D13）；含稅額在採購單層級 `round(Σ未稅 × (1+稅率))`，因此「各品項進位」與「發票整張進位」可能差數元，由尾差容許與差異原因吸收；單元測試要涵蓋多品項、部分到貨、稅率 0 與 5% 的邊界。
- **圖片規則（P10）**：三聯式、二聯式、電子發票一定要有至少一張圖片（`PURCHASE_INVOICE`）；收據可不傳，但須填 `no_image_reason`；免開發票不需要。因為附件要先有 resource id 才能上傳，發票可先存（畫面標紅色「缺圖」），**缺圖發票不可被請款單引用（建立與送出兩處都擋）**；已被有效請款單引用的發票，其最後一張圖片不可刪除（伺服端閘擋，附件只標記刪除）。
- 請款畫面逐品項並排三欄：採購單（訂購量、單價）、進貨單（驗入量、金額）、發票（金額）。差異超過尾差須填原因但可送出。

### 3.4 與採購單、到貨、廠商、採購分析的接點
- 採購單詳情新增「發票與請款」分頁：此單進貨的憑證狀態、已連發票、已請款、已付款、尚可請款額。`PoReceiptDialog` 送貨單號欄位不動，登錄後可到進貨列按「登錄憑證」。
- 採購單結案（`close`、`short_close`）不被未請款擋住，顯示「尚有 N 元未請款」提醒（A8）；清單 attention 述詞與首頁徽章加「待請款」（有驗入且未請款額 > 尾差）與「待付款」（SUBMITTED），均需 `purchase_payment.view`／`manage`。
- 廠商：新增銀行欄位（機密）；廠商頁 V1 規則不變；請款單廠商快照（建立時抓一次，草稿可手動重抓，之後不因廠商改帳號而變）。
- 採購分析 `ga_ws_purchase_analysis` 增 `claimed_amount`、`paid_amount`、`unclaimed_received_amount`；`ga_ws_vendor_perf` 增已付款金額；原有欄位與口徑不動，G22 既有測試加新斷言；新欄位只有同時具備 `purchase_payment.view`／`manage` 者看得到。已作廢進貨不計入任何統計。
- **作廢進貨明細（P6）**：條件與效果見 §3.8。
- 退貨：D19 維持庫存調整出加原因，已配發轉設備者走報廢；本批不做退貨單、折讓單，折讓暫以請款差異原因記錄。

### 3.5 附件與儲存
- `RESOURCE_TYPES` 新增 `PURCHASE_INVOICE`、`PURCHASE_RECEIPT`（`upload-rules.ts` 與 DB CHECK 同步）；路徑維持 `lower(resource_type)/resource_id/purpose/…`（DB 有 `storage_path LIKE lower(resource_type)||'/%'` 檢查）；用途 `INVOICE_IMAGE`、`DELIVERY_NOTE`（`purpose` 必為大寫）。
- DB：`ga_resource_attachment_can_manage`（寫）與 **`ga_resource_attachment_can_read`**（讀；設計初稿誤稱 can_view）只在結尾 `RETURN false` 前插入分支（讀現行定義再改，仿第 6 批 45 號做法，已有就略過、結尾格式不符就中止）：寫入需 `purchase_payment.manage`；讀取需 `purchase_payment.view` 或 `manage`。同時重建 `resource_type` CHECK 加兩個值。
- 手機原圖：瀏覽器端縮到長邊約 2000px，其他檔最大 4MB，PDF 超過 4MB 提示改傳圖片；刪除只標記（Q3）。
- 附件讀寫另走伺服端閘（水電帳單既有做法），DB 分支是第二道防線。

### 3.6 權限與導覽（以資料庫為準；DB 無 admin bypass）
權限碼完整格式 `general_affairs.<名稱>.<動作>`。**本批只新增兩個碼**（P4）：`general_affairs.purchase_payment.view`、`general_affairs.purchase_payment.manage`（`permissions` 表欄位：module、feature、code、action、description、is_active；module=`general_affairs`、feature=`purchase_payment`）。`manage` 涵蓋 `view` 的讀取能力（函式內判斷「view 或 manage」）。不新增 approve、pay 碼。

下表碼省略前綴 `general_affairs.`；「並需」表示另需的既有碼。

| 頁面／API／按鈕 | 需要 |
|---|---|
| 導覽入口「進貨發票」「請款單」 | `purchase_payment.view` 或 `manage`（用資料庫語意，管理員 `profiles.role==='admin'` 不放行，避免有入口卻 403） |
| 進貨發票清單、詳情、圖片檢視；`GET purchase-invoices`、`purchase-invoices/:id` | `purchase_payment.view` 或 `manage` |
| 新增、編輯發票；上傳發票／憑證圖片；進貨「登錄憑證」按鈕；`POST/PATCH purchase-invoices`、`PATCH …/voucher` | `purchase_payment.manage` |
| 作廢發票按鈕；`POST purchase-invoices/:id/actions` | `purchase_payment.manage` |
| 請款單清單、詳情、事件時間軸；`GET payment-requests`、`:id`、`candidates` | `purchase_payment.view` 或 `manage`；看採購單明細另需 `purchase_review.view` |
| 新增、編輯草稿請款單；送出、退回草稿、標已付款、作廢、加備註、重抓廠商帳號；`POST/PATCH payment-requests`、`:id/actions` | `purchase_payment.manage`（申請人可自己標已付款） |
| 請款單 A4 列印頁 | `purchase_payment.view` 或 `manage` |
| CSV 對帳匯出；`GET payment-requests/export` | `purchase_payment.view` 或 `manage` |
| 請款設定（尾差、買受人）；`GET payment-settings`／`PUT payment-settings` | GET：view 或 manage；PUT：`purchase_payment.manage` |
| 採購單詳情「發票與請款」分頁；`GET purchase-orders/:id/payment-summary` | `purchase_payment.view` 或 `manage`，並需 `purchase_review.view` |
| 廠商統編快照、銀行資訊（廠商頁、請款單、列印、CSV、發票賣方統編） | 並需 `vendor.view` 或 `vendor.manage`，否則伺服端遮蔽（顯示「已遮蔽」，CSV 與列印整欄省略） |
| 採購分析／廠商績效的已請款、已付款欄位；首頁與導覽「待請款」「待付款」徽章；採購單清單 attention | `purchase_payment.view` 或 `manage` |
| 廠商銀行欄位編輯（廠商頁）；`ga_ws_vendor_save` | `vendor.manage`（既有） |
| 作廢進貨明細按鈕；`POST purchase-orders/:id/receipts/:rid/void` | `purchase_review.manage` ＋ `inventory_transaction.manage` ＋ `part.view`（與第 4 批到貨同） |

店長（只有服務中心入口）與只有採購權限者（例如 `vue_workspace_ga_purchaser`）：沒有 `purchase_payment.*`，看不到入口、金額、徽章，API 回 403；採購單頁不出現「發票與請款」分頁。

DEV 測試角色（前綴 `vue_workspace_ga45_`；**已查 `roles` 表與 `tests/integration/role-matrix.spec.ts`，無 `ga45` 撞名**，見 §13.1；DEV 專用，無正式區草稿）：
- `vue_workspace_ga45_clerk`（總務採購）：`vue_workspace_ga_purchaser` 的全部碼 ＋ `purchase_payment.manage` ＋ `vendor.view`（能看銀行與統編）＋ `inventory_transaction.manage`、`part.view`（作廢進貨用）。
- `vue_workspace_ga45_accountant`（會計）：`purchase_payment.manage`＋`view`、`purchase_review.view`、`vendor.view`。權限與總務請款權限相同（P4），只是劇本上用來「換一個人標已付款」。
- `vue_workspace_ga45_viewer`：只有 `purchase_payment.view`、`purchase_review.view`（沒有 `vendor.view`），用於遮蔽與唯讀測試。
- `vue_workspace_ga45_novendor`：`purchase_payment.manage`、`purchase_review.view`，沒有 `vendor.view`，驗證「能建請款單但看不到銀行與統編」。
- 沒有 `purchase_payment.*` 的對照組：既有 `vue_workspace_ga_purchaser`、店長類角色（`vue_workspace_ga_store_manager_b`），不新增角色、不修改。
正式區兩個權限碼寫入草稿 55，**角色授權由使用者決定**（草稿 README 列出建議授權對象，不自動授權）。

### 3.7 DB 函式（`ga_ws_*`，SECURITY DEFINER、`has_permission(auth.uid(), …)`、必須使用者身分、回 `{ok,status,data,error,code}`、寫入帶固定識別與 `expected_updated_at`）
`ga_ws_pay_receipt_candidates`（可請款進貨清單與尚可請款額）、`ga_ws_pay_invoice_save`／`get`／`list`／`void`、`ga_ws_pay_voucher_set`（進貨憑證狀態）、`ga_ws_pay_request_create`／`update`／`action`（`submit`、`return`、`mark_paid`、`void`、`note`、`refresh_bank`）／`get`／`list`、`ga_ws_pay_settings_get`／`set`、`ga_ws_vendor_save`（擴充銀行欄位）、`ga_ws_po_receipt_void`（P6）、`ga_ws_pay_export`（P9，回傳列資料，CSV 由伺服端組）、`ga_ws_pay_po_summary`（採購單分頁）。內部輔助 `ga_pay_*`（述詞與額度計算；為效能比照第 6 批 49 號，SQL 述詞函式不帶固定 `search_path`，並以 EXPLAIN 實測）。

### 3.8 作廢進貨明細（P6）
`ga_ws_po_receipt_void(po_id, receipt_id, reason, idempotency_key, expected_updated_at)`：
- 允許：未被有效請款單引用、未配發（所有明細 `dispatched_qty = 0`）、未連 ACTIVE 發票（先作廢發票或解除連結）、採購單不是 CLOSED／CANCELED（已結案要更正先請總務處理，列為待確認）、尚未作廢。
- 擋下：已被請款單用到 → 白話「這筆進貨已被請款單 PY-… 使用，請先作廢或退回該請款單」；已配發成設備 → 「已配發成設備，不能作廢，請走報廢」；庫存已被其他單據消耗致沖回後為負 → 擋下並說明（依該位置是否允許負庫存）。
- 效果（單一交易）：寫反向庫存交易沖回、`po_item.received_qty` 扣回、採購單狀態重算（RECEIVED→PARTIALLY_RECEIVED／ORDERED）、進貨標記 `voided_*`（保留原紀錄不刪除）、寫採購單事件與庫存交易的原因（必填）。作廢後不計入累計驗入、請款上限、採購分析與廠商績效。
- 權限：`purchase_review.manage` ＋ `inventory_transaction.manage` ＋ `part.view`。需固定識別與 `expected_updated_at`。

### 3.9 列印與對帳匯出（P9）
- A4 列印頁（Vue 路由加列印樣式，不產 PDF 檔）：抬頭（買受人設定）、請款單號、廠商名稱與統編與銀行資訊（有 `vendor.view` 才有，否則整區省略）、採購單／進貨單／發票明細、金額（未稅、稅額、含稅）、付款資訊、事件簽章區（總務請款、會計付款的人與時間）。
- CSV：`GET /api/workspace/general-affairs/payment-requests/export?vendor_id=…&month=YYYY-MM`（台北月份，以**請款單建立日**的台北月份為準；可加狀態篩選），需 `purchase_payment.view`／`manage`。UTF-8 含 BOM，欄位：請款單號、狀態、廠商、統編（有權限才有）、採購單號、進貨單號、發票號碼、發票類型、未稅、稅額、含稅、請款額、付款日、付款方式、參考號、總務請款人與時間、付款人與時間；**一律防 CSV 公式注入**（開頭為 `=`、`+`、`-`、`@`、Tab、CR 的文字前加單引號）；筆數上限 5000，超過回 400 白話提示縮小範圍；伺服端不回銀行帳號全碼給無 `vendor.view` 者。

## 4. 頁面與 API

### 4.1 頁面與導覽
| 頁面 | 路徑 | 說明 |
|---|---|---|
| 進貨發票清單與編輯 | `/general-affairs/purchase-invoices`、`/…/:id` | 類型、號碼、日期、未稅、稅額、含稅、圖片（缺圖紅標）；連結進貨單；統編不符警示 |
| 請款單清單 | `/general-affairs/payment-requests` | 篩選狀態、廠商、月份；「待付款」（SUBMITTED）頁籤；匯出 CSV 按鈕 |
| 請款單編輯／檢視 | `/general-affairs/payment-requests/:id` | 只能選「可請款進貨」；採購單、進貨單、發票逐品項並排；差異原因；付款資訊；事件時間軸；按鈕依狀態與權限 |
| 請款單列印 | `/general-affairs/payment-requests/:id/print` | A4 列印樣式 |
| 採購單詳情「發票與請款」分頁 | 既有頁新增 | §3.4 |
| 進貨列「登錄憑證」「作廢進貨」 | 既有採購單詳情新增 | §3.4、§3.8 |
| 設定（尾差、買受人） | 既有採購設定頁新增區塊 | `purchase_payment.manage` |
| 廠商頁銀行欄位 | 既有廠商頁新增 | 機密，`vendor.view`／`manage` 才見 |
導覽依權限顯示（`lib/workspace/navigation.ts` 設 kind，`App.vue` 對照表登錄頁面與權限）。

### 4.2 API（`/api/workspace/general-affairs/**`，`router.ts` 分派；共通：非 GET 要 `checkOrigin`、使用者身分、`GaError`、`page/pageSize ≤ 100` 回 `{data,total}`、`409 STALE`、伺服端欄位遮蔽）
- `purchase-invoices`（GET 清單、POST）、`purchase-invoices/:id`（GET、PATCH）、`purchase-invoices/:id/actions`（void）
- `purchase-orders/:id/receipts/:rid/voucher`（PATCH）、`purchase-orders/:id/receipts/:rid/void`（POST）、`purchase-orders/:id/payment-summary`（GET）
- `payment-requests`（GET、POST）、`payment-requests/:id`（GET、PATCH）、`payment-requests/:id/actions`（submit、return、mark_paid、void、note、refresh_bank）、`payment-requests/candidates`（GET）、`payment-requests/export`（GET）
- `payment-settings`（GET、PUT）
- 附件沿用現有 attachments 路由，擴充資源類型與權限判斷（伺服端閘＋DB 分支）。

## 5. SQL 計畫（檔名與順序）

### 5.1 DEV（`supabase/workspace-dev/`，現有最大為 `20261118150000`；各附 `.rollback.sql`；套用腳本 `scripts/apply-workspace-m7m8-b45-dev.cjs [--rollback]`，比照 b6 腳本用 `tests/support/env-guard.cjs` 只連 DEV，執行前確認 project-ref 以 mjpd 開頭，檔案不存在就略過）
1. `20261119100000_m7m8_b45_receipt_voucher.sql`：進貨兩表加欄位與回填（`amount_untaxed`、`updated_*`、`voucher_*`、`voided_*`）、發票表與關聯表、索引。
2. `20261119110000_m7m8_b45_payment_requests.sql`：請款單、明細、事件表（不可改刪觸發器）、設定預設列、`ga_next_pr_no`。
3. `20261119120000_m7m8_b45_vendor_bank.sql`：廠商銀行欄位。
4. `20261119130000_m7m8_b45_attachment_types.sql`：`resource_type` CHECK 與 `can_manage`／`can_read` 分支（讀現行定義，只在結尾 `RETURN false` 前插入，已有就略過）。
5. `20261119140000_m7m8_b45_permissions.sql`：兩個權限碼（`purchase_payment.view`／`manage`）。
6. `20261119145000_m7m8_b45_dev_seed.sql`：DEV 專用 `vue_workspace_ga45_*` 測試角色（四個，§3.6；套用前再查一次撞名；**無正式區草稿**）。rollback 只刪這四個角色與其成員紀錄（不得動既有角色）。
7. `20261119150000_m7m8_b45_functions.sql`：`ga_ws_pay_*`、`ga_pay_*`、`ga_ws_vendor_save` 擴充、設定函式、匯出函式。
8. `20261119160000_m7m8_b45_analysis.sql`：採購分析、廠商績效、清單 attention、首頁與導覽徽章擴充（以讀現行定義＋文字替換，形狀不符就中止；效能實測）。
9. `20261119170000_m7m8_b45_receipt_void.sql`：`ga_ws_po_receipt_void`，並在進貨讀取、累計驗入處排除已作廢進貨。
測試資料清除：`scripts/cleanup-m7m8-b45-dev.cjs`（只清 VW、ZT、2038、`QA-GA45-` 標記的資料；請款事件表因不可改刪，清除腳本在單一交易內只對該表暫停觸發器、僅限 DEV、僅刪標記資料，仿第 4 批 G25 清理做法）。

### 5.2 正式區草稿（`docs/vue-workspace/parity-plan/m7m8-sql/`，現有最大號 49，故從 **50** 起，均附 `-rollback.sql`；**會寫入正式區的步驟前一定有唯讀預覽檔 50**）
| 檔名 | 性質 |
|---|---|
| `50-b45-preview-before-apply.sql` | 唯讀（只有 SELECT；本檔無 rollback）：先決（資料表、函式、第 4／6 批 SQL 是否已套用）、進貨兩表現況欄位與筆數（回填影響範圍）、`ga_resource_attachment_can_manage`／`can_read` 現行定義全文（請存檔）與 `resource_type` CHECK、`ga_workflow_settings` 現況、權限碼與 role 撞名檢查、廠商表有無銀行欄位、`has_permission` 現行語意、哪些角色目前有採購與廠商權限（建議授權對象名單） |
| `51-b45-receipt-voucher.sql`＋`-rollback` | 對應 DEV 100000；回填用小交易並附驗證查詢 |
| `52-b45-payment-requests.sql`＋`-rollback` | 對應 DEV 110000 |
| `53-b45-vendor-bank.sql`＋`-rollback` | 對應 DEV 120000 |
| `54-b45-attachment-types.sql`＋`-rollback` | 對應 DEV 130000；讀正式區現行函式定義，不整支覆蓋；前提：第 6 批 45 已套用 |
| `55-b45-permissions.sql`＋`-rollback` | 只新增兩個權限碼，**不自動授權給任何角色**（授權由使用者決定，README 列名單）；等價測試以正式區語意（不檢查 `roles.is_active`、無 admin bypass） |
| `56-b45-functions.sql`＋`-rollback` | 對應 DEV 150000 |
| `57-b45-analysis.sql`＋`-rollback` | 對應 DEV 160000；前提：第 6 批 46、49 已套用 |
| `58-b45-receipt-void.sql`＋`-rollback` | 對應 DEV 170000 |
README 新增「第 4.5 批」章節與套用順序：`50（唯讀）→ 51 → 52 → 53 → 54 → 55 → 56 → 57 → 58 →` 驗收 → 使用者決定角色授權；撤回順序相反。流程：草稿 → 備份 → 使用者核可才執行；**不得由實作者直接套正式區**。DEV 實測要做「套用 → 撤回 → 再套用」。

## 6. 測試計畫
四層循序執行，編號 G45。測試資料只用 VW、ZT 門市，年份優先 2038，標記 `QA-GA45-`；跑完只清自己的。

**1. 單元（vitest，`G45-unit`）**：稅額進位（多品項各自進位、含稅等式、稅率 0 與 5%、手改尾差）；尾差 5 元邊界（5 免原因、6 要原因、可調整設定）；累計請款上限邊界（含兩張請款單合計、短收以累計驗入計）；狀態轉移合法表與非法轉移（DRAFT→SUBMITTED→PAID、退回、作廢終態、已付款鎖定）；發票類型與圖片必傳規則（三聯／二聯／電子必傳、收據填原因、免開發票）；統編核對；日期（台北、未來）；`upload-rules` 新資源類型與大小；機密欄位遮蔽（`VENDOR_SECRET_FIELDS` 含銀行四欄）；同廠商重複發票號碼；CSV 公式注入防護與欄位；請款單號格式；作廢進貨可否判斷表。

**2. 資料庫（`G45-db`，並含 `G45-att`、`G45-void`、`G45-stat` 的資料庫部分）**：以正式區 `has_permission` 語意跑等價測試；每個函式缺權限被擋、管理員角色本身不繞過；固定識別重送回原結果、內容不同回 409；累計請款超過上限被擋（含兩張請款單合計、短收結案後）；作廢請款單釋放額度；已被有效請款單引用的發票不可作廢；進貨拒收量不可請款；無驗入不可請款；缺圖發票不可被引用、最後一張圖不可刪；已付款請款單鎖定（只能備註與作廢）；退回草稿可改；申請人自己標已付款成功；事件表不可改刪；`STALE` 衝突；附件分支（有／無權限、`can_manage`、`can_read`、既有資源類型回歸）；廠商銀行與統編遮蔽（`vendor.view` 有無）；請款單銀行快照不因廠商改帳號而變、重抓只在草稿；作廢進貨（未請款可作廢沖庫存、已請款被擋、已配發被擋、庫存不足被擋、採購單狀態重算、作廢後不計累計驗入）；統計（已請款、已付款、未請款驗入、已作廢進貨不計、attention 與徽章與清單筆數一致）；回歸：第 4 批 G25-db 63 項、G26、第 6 批 G22 既有斷言不變。

**3. 頁面／API（`test:page`，`G45-inv`、`G45-pay` 的畫面與 API；循序）**：發票金額自動算與手改、尾差免原因與超過要原因、缺圖紅標、並排三欄顯示、狀態按鈕依權限與狀態顯示、已付款只剩備註與作廢、錯誤訊息白話、無權限不顯示金額與入口、圖片縮圖與 4MB 提示、清單分頁與搜尋跳脫、列印頁內容、CSV 內容與公式注入、設定頁（尾差、買受人）、廠商頁銀行欄位遮蔽。

**4. e2e 多角色劇本（`G45-e2e`，循序，桌機 1440 與手機 390 各至少一條）**
- **主劇本**：總務（`ga45_clerk`）建採購單並下訂 → **分批到貨**（兩次驗入，STOCK 品項）→ 登錄進貨憑證與發票（必傳圖片規則、統編不符警示、尾差 5 元內免原因、超過 5 元要填原因）→ 建請款單（只能選可請款進貨；超過上限被擋）→ 送出 → **退回草稿（填原因）→ 修改再送出** → 會計角色（`ga45_accountant`）標已付款（選付款方式與日期）→ **已付款鎖定**（改金額被擋）→ 作廢已付款需原因並釋放額度（可重新請款）→ 採購分析顯示已請款、已付款；採購單結案不受請款影響。
- **作廢進貨**：未請款可作廢並沖回庫存、留紀錄；已請款被擋（提示請款單號）；已配發成設備被擋。
- **廠商銀行**：只有 `vendor.view`／`manage` 的人看得到銀行與統編；請款單銀行快照不因廠商改帳號而變（改帳號後原請款單與列印不變，草稿重抓才更新）。
- **無權限**：沒有 `purchase_payment.view` 的店長與只有採購權限者（`vue_workspace_ga_purchaser`）看不到入口、分頁、徽章與金額，API 回 403；`ga45_viewer`、`ga45_novendor` 的遮蔽與唯讀行為。
- **列印與 CSV**：列印頁與 CSV 匯出內容正確（金額、發票號碼、付款資訊、依廠商與月份篩選、遮蔽欄位）。
- **其他例外**：同廠商重複發票號碼被擋；拒收量不可請款；STALE 並發；重複送出同一請款單不重複建立；與現有劇本（設備添購、料件補貨、設備轉移）串接：配發轉設備後不影響請款，請款不影響配發。
- 每個劇本結束後以 service role 回讀 DB；資料衛生：sweeper 孤兒為 0。run-all 結束碼 1 若只因 sweeper 基準孤兒或 fetch failed，視為通過但要在回報說明。

**Parity／allowlist 驗證**：舊版無此功能，無舊新比對；只做回歸（舊版附件上傳規則、水電帳單附件行為不被破壞；廠商機密遮蔽 V1 不變；採購單、到貨既有對等測試不退步）。

## 7. 預計與舊版差異（登記 `tests/parity/allowlist.json`，id 前綴 `m7m8-b45-`）
新功能（舊版沒有發票、請款、付款）不必逐項登 allowlist；**凡改到既有行為（採購單、到貨、廠商、採購分析、附件、首頁）且與舊版不同者才登錄**。`approvedBy`：屬問卷或已核可決定者填 `"user (2026-11-19 batch 4.5 spec survey)"`；新發現者設 `null`（`decision` 為 `fix` 的條目依驗證器規則維持 `null`），且在 `docs/vue-workspace/parity-plan/allowlist-review/plain.json` 補白話稿（topic 用既有的 `purchase` 或新增 `payments`），供 `scripts/allowlist-review` 產生確認頁。

| # | 差異 | 影響的既有行為 | approvedBy |
|---|---|---|---|
| 1 | 採購單詳情新增「發票與請款」分頁與進貨列「登錄憑證」 | 採購單 | 問卷（A8、D17、D18） |
| 2 | 新增作廢進貨明細（沖回庫存、重算採購單狀態；舊版填錯只能庫存調整） | 到貨 | 問卷（P6） |
| 3 | 廠商新增銀行名稱、分行、帳號、戶名（機密，`vendor.view`／`manage` 才可見） | 廠商 | 問卷（P8） |
| 4 | 附件新增資源類型 `PURCHASE_INVOICE`、`PURCHASE_RECEIPT`；縮圖、4MB、刪除只標記 | 附件 | 問卷（A5、Q3） |
| 5 | 採購單結案不被未請款擋住，只顯示提醒 | 採購單 | 問卷（A8） |
| 6 | 採購分析與廠商績效新增已請款、已付款、未請款驗入欄位 | 採購分析 | `null`（新發現） |
| 7 | 首頁與導覽徽章、採購單清單 attention 新增「待請款」「待付款」 | 首頁 | `null`（新發現） |
| 8 | 已作廢進貨不計入累計驗入與統計；已結案（CLOSED）採購單的進貨不可作廢 | 到貨、採購分析 | `null`（新發現） |
| 9 | 已被有效請款單引用的發票，最後一張圖片不可刪除（附件刪除新增限制） | 附件 | `null`（新發現） |
| 10 | 請款入口用資料庫語意（管理員不放行） | 導覽 | `null`（新發現，與第 4 批 `m7m8-b4-rv-po-nav-db-semantics` 同類） |

另：新增請款權限碼與導覽、請款單與付款標記、列印與 CSV、發票五種類型、買受人設定與統編核對、請款單作廢與退回（P3 不核准、P4 manage、P7）都是新功能，不登 allowlist，但規格決定同步寫入 `m7m8-spec.md`「第 4.5 批規格決定」。通則（白話錯誤訊息、分頁、搜尋跳脫、固定識別防重複）不登。

## 8. 風險與待確認
1. 稅額尾差：品項各自進位、部分到貨分次請款會累積尾差；以容許尾差（預設 5 元，可調）與差異原因處理，仍可能與會計實務有數元出入。
2. 進貨金額凍結需回填既有進貨資料（DEV 目前 0 筆，正式區上線時可能已有資料）；回填前先備份，`50` 預覽先看筆數。
3. 作廢進貨牽動庫存沖回、已配發設備、已請款、發票連結、採購單狀態五處，是最大技術風險；已結案採購單的進貨不可作廢是保守設計，列入使用者確認（allowlist #8）。
4. 附件：主機單次約 4.5MB；手機原圖靠縮圖；PDF 超過 4MB 無法上傳。
5. 正式區權限碼需使用者核可與授權；`has_permission` 在正式區不檢查 `roles.is_active`、無 admin bypass，等價測試要以此為準。
6. 動到 `ga_resource_attachment_can_manage`／`can_read` 是共用函式，插入分支錯誤會影響所有附件；需完整回歸（含水電帳單）。
7. 請款單機密：銀行資訊、統編、金額外洩風險；伺服端遮蔽與 `ga45_viewer`、`ga45_novendor` 測試必做。
8. 新增請款維度可能動到採購清單 attention 述詞與首頁徽章效能（第 6 批 49 號已內聯述詞），須以十萬級資料量測。
9. 舊版 `ga_purchase_reviews.final_amount` 與採購單含稅額是兩套金額；請款只以採購單進貨為準。
10. P4 不分權（manage 一把抓、申請人可自己付款）：制衡完全靠不可改刪的事件紀錄；上線後建議定期稽核請款事件（寫進 README）。
11. 免稅廠商以「採購單 tax_rate=0」表達，需開工時確認採購單可建立稅率 0（§3.3）。

## 9. 已決定（2026-11-19，使用者 P1–P10；問卷全文與 assumptions 視為核可）
| 編號 | 決定 | 最終行為 |
|---|---|---|
| P1 | `paper_by_ga`：總務收紙本發票，彙整後交會計付款 | 系統記兩段：總務請款（送出）與會計付款（標已付款）。發票紙本仍由人保管，系統存影像與欄位 |
| P2 | `after_receipt`：有驗收進貨就能請款 | 分批到貨可分批請款；不做預付；拒收部分不能請；累計請款 ≤ 累計驗收入庫含稅金額（含尾差）；無驗入的採購單不可請款 |
| P3 | `none`：請款不核准（維持 D19） | 沒有核准流程、門檻設定與 approve 權限碼 |
| P4 | `manage_all`（與建議不同） | 權限只分 `purchase_payment.view` 與 `manage`；有 manage 者可建立、送出、退回、標已付款、作廢；申請人可自己標已付款；所有動作寫不可修改的事件紀錄（誰、何時） |
| P5 | `tol5` | 5 元內視為尾差免原因；超過要填原因但可送出；累計請款超過累計進貨（含尾差）直接擋；尾差可在設定調整（manage）；稅額各品項進位與免稅廠商（採購單稅率 0）處理照 §3.3 |
| P6 | `include`：本批納入作廢進貨 | 未請款、未配發的進貨可作廢，沖回庫存並留紀錄；已被請款單用到要先作廢或退回請款單；已配發成設備不能作廢（§3.8） |
| P7 | `return_void` | 已送出可退回草稿（填原因）；已付款鎖定，只有 manage 者可作廢並填原因；作廢釋放額度；所有動作留不可刪改紀錄 |
| P8 | `add` | 廠商新增銀行名稱、分行、帳號、戶名（一組）；屬帳務機密（V1 遮蔽規則）；請款單建立時快照 |
| P9 | `both` | 請款單 A4 列印；依廠商、月份的 CSV 對帳匯出（需 `purchase_payment.view`） |
| P10 | `required_by_type` | 三聯式、二聯式、電子發票必傳圖片；收據可不傳但要填原因；免開發票不需要 |

## 10. 開工前核對（已完成，結果見 §13.1）
1. 進貨兩表現況欄位與筆數。2. `ga_resource_attachment_can_manage`／`can_read` 現行定義。3. `ga_workflow_settings` 值型別與買受人存放處。4. role-matrix 與 `roles` 表撞名、權限碼命名。5. DEV 進貨表筆數與回填策略。

## 11. 實作分組與階段（五階段，依相依順序）
| 階段 key | 內容 |
|---|---|
| `G45-db` | DEV SQL 100000 至 150000（含 145000 測試角色）與 `apply-workspace-m7m8-b45-dev.cjs`、正式區草稿 50 至 55 與 README 章節；資料庫整合測試（G45-db，含附件分支）；回歸 G25-db、G26 |
| `G45-att-inv` | 附件資源類型與上傳規則、伺服端閘（G45-att）；進貨憑證、發票頁面與 API（G45-inv）；廠商銀行欄位；單元測試 |
| `G45-pay` | 請款單頁面、API、狀態機、設定、A4 列印、CSV 匯出（G45-pay）；SQL 150000 的匯出與採購單摘要 |
| `G45-void-stat` | SQL 160000、170000（正式區草稿 56 補完、57、58）；作廢進貨（G45-void）；採購分析、廠商績效、清單 attention、首頁與導覽徽章（G45-stat）；回歸 G22、G24 |
| `G45-e2e` | 多角色劇本與無權限劇本（G45-e2e）、allowlist 與 plain.json、README 與完成定義紀錄（verification、route-inventory、CURRENT-DEV-STATUS）、全套 run-all |

## 12. 審查紀錄（2026-11-19，獨立審查）
已核實無誤：SQL 編號（正式區草稿現有最大 49、新批從 50；DEV 現有最大 `20261118150000`）；舊版無發票、請款、付款功能（全 repo 僅廠商帳務欄位、設備保固文件類別、水電 `paid_at`、員工購買匯入 `invoice_number`）；採購核准門檻 5,000 元以含稅大於比較（`ga_po_refresh_totals`、`ga_ws_po_action`）；採購單 `tax_rate`、`vendor_tax_id_snapshot`、`vendor_payment_terms_snapshot` 已存在，可直接接。
已修正：(1) `ga_workflow_settings` 是鍵值表且有 `value_text`，不必新增欄位或買受人表；設定函式需另寫 `pay_` 版。(2) 權限碼補完整前綴。(3) 進貨表無 `updated_at`，需補。(4) `unit_price_snapshot` 可省。(5) 補列舊版廠商列印表單（月結、無銀行欄）、需求單備註、報價表。(6) 資源類型清單出處改引新版 `upload-rules.ts`。(7) P3 建議改回 D19 的「不核准」。(8) P5 補稅額與免稅廠商。
定稿時再修正：(9) 附件讀取函式實名為 `ga_resource_attachment_can_read`，設計初稿的 `can_view` 不存在（§13.1）。(10) 依 P3、P4 刪除核准流程、approve／pay 權限碼與 `ga45_approver`、`ga45_accountant` 的專責性（保留一個權限相同的會計角色供劇本使用）。(11) 補圖片必傳的「先存後傳」處理（缺圖發票不可被請款引用）與「最後一張圖不可刪」。(12) 補請款單草稿「重抓廠商帳號」，因銀行快照在建立當下可能為空。

## 13. 實作紀錄

### 13.1 開工前 DEV 唯讀實測（2026-11-19，專案 mjpd…，僅 SELECT 與系統目錄，未寫入；`supabase/.temp/project-ref` 已確認以 mjpd 開頭）
| 項目 | 結果 | 對設計的影響 |
|---|---|---|
| 進貨兩表欄位 | `ga_purchase_receipts` 10 欄：id、receipt_no、po_id、received_date、delivery_note_no、notes、idempotency_key、payload_hash、created_by、created_at（**沒有 `updated_at`／`updated_by`**）。`ga_purchase_receipt_items` 14 欄：id、receipt_id、po_item_id、delivered_qty、accepted_qty、rejected_qty、accepted_base、reason、received_part_id、location_id、change_reason、inventory_transaction_id、dispatched_qty（預設 0）、created_at（**沒有單價與金額欄**）。兩表都沒有使用者自訂觸發器。採購單明細 `ga_purchase_order_items` 有 `unit_price`、`line_amount`、`quantity`、`received_qty`、`dispatched_qty`；`ga_purchase_orders` 有 `tax_rate`、`subtotal`、`tax_amount`、`total_amount`、三個快照欄（`vendor_name_snapshot`、`vendor_tax_id_snapshot`、`vendor_payment_terms_snapshot`） | 與 §3.2 一致：補 `updated_*`、`voucher_*`、`voided_*`；金額用 `po_item.unit_price × accepted_qty` 回填 |
| 資料筆數 | `ga_purchase_receipts` 0、`ga_purchase_receipt_items` 0、`ga_purchase_orders` 0；DEV 沒有發票、請款相關資料表（名稱含 invoice 或 `ga_payment` 的表 0 個） | DEV 回填是空操作，回填邏輯要靠測試自建資料驗證；正式區筆數由草稿 50 預覽查 |
| `ga_resource_attachment_can_manage` | DEV 現行定義：`SECURITY DEFINER`、`search_path` 為 `public, pg_temp`；分支依序 EQUIPMENT、FACILITY、PART、MAINTENANCE_REQUEST、MAINTENANCE_UPDATE、SERVICE_REQUEST、SERVICE_REQUEST_COMMENT、**UTILITY_BILL**（第 6 批 45 已插入，條件 `utility_bill.manage` 且帳單未刪除），結尾為 `RETURN false;`＋`END;`，結尾格式符合「插入分支」做法 | 新分支插在 UTILITY_BILL 之後、`RETURN false` 之前；正式區須先套第 6 批 45 |
| 「can_view」 | **資料庫沒有 `ga_resource_attachment_can_view`**；讀取函式實名 `ga_resource_attachment_can_read(p_resource_type text, p_resource_id uuid)`，DEV 現行定義分支只有 SERVICE_REQUEST_COMMENT、SERVICE_REQUEST、EQUIPMENT、FACILITY、PART、MAINTENANCE_REQUEST、MAINTENANCE_UPDATE，**沒有 UTILITY_BILL 分支**，結尾 `RETURN false;`。附件表政策：`ga_resource_attachments_insert`（INSERT）與 `ga_resource_attachments_read`（SELECT：`deleted_at IS NULL AND can_read(...)`）；沒有 UPDATE／DELETE 政策（軟刪除走 `ga_soft_delete_resource_attachment`）。其他附件函式：`ga_validate_resource_attachment`、兩個 onboarding 同步函式 | 設計文件改稱 `can_read`；新增兩個類型的讀取分支；水電帳單附件讀取目前靠伺服端閘（不在本批範圍，不順手補，避免擴大範圍）；軟刪除函式與驗證函式要確認新類型可通過 |
| 附件表 CHECK | `resource_type` 限 8 值；`purpose` 必為大寫去空白；`storage_path` 必須以 `lower(resource_type)/` 開頭且不得有協定、反斜線、`..`；`content_type` 限 jpeg、png、webp、heic、heif、pdf；`size_bytes` ≤ 20971520；刪除欄位三者同為空或同有值（原因不可空白）；`storage_bucket` 固定 `general-affairs-attachments` | 130000 要重建 `resource_type` CHECK；路徑與用途規則照舊 |
| `ga_workflow_settings` | 欄位：`key`（text，主鍵索引 `ga_workflow_settings_pkey`）、`value_num`（numeric）、`value_text`（text）、`updated_by`（uuid）、`updated_at`。DEV 現有列：`po_approval_enabled`=1、`po_tax_rate`=0.05、`po_price_history_limit`=5、`po_approval_threshold`=5000、`request_overdue_confirm_days`=7。現有 `ga_ws_po_*` 函式 14 個（含 `ga_ws_po_settings_get/set`、`ga_ws_po_receive`、`ga_ws_po_receipts_get`） | 能存文字：買受人抬頭、統編放 `value_text`；尾差放 `value_num`；不另建表 |
| 撞名檢查 | `roles` 表代碼含 `ga45`、`payment`、`accountant` 者 0 個（只有 `vue_workspace_ga_po_approver` 因含 approver 被關鍵字撈到，與本批無關）；現有 ga 相關角色 34 個（`vue_workspace_ga_*`、`vue_workspace_ga6_*`）；`tests/integration/role-matrix.spec.ts` 與 `tests`、`supabase`、`docs`、`lib`、`vue-workspace/src` 全文搜 `ga45` 只有本設計文件 | `vue_workspace_ga45_` 前綴安全；套用 145000 前仍須再查一次 |
| 權限碼 | 與採購、廠商相關的現有碼：`purchase_order.approve`、`purchase_review.view`／`manage`、`vendor.view`／`manage`、`employee_purchase.import`／`view`；**沒有** `purchase_payment.*`、`invoice`、`payment` 相關碼。`permissions` 表欄位：id、module、feature、code、action、description、is_active、created_at | 新增兩碼：module=`general_affairs`、feature=`purchase_payment`、action=`view`／`manage` |
| `has_permission`（DEV） | DEV 定義：`auth.uid()` 必須等於傳入使用者；`admin` 角色代碼 bypass；**檢查 `roles.is_active`** 與 `ur.is_active`、到期日（與正式區語意不同：正式區不檢查 `roles.is_active`、無 admin bypass） | 新函式只用 `has_permission(auth.uid(), 碼)`；測試角色明確帶權限碼，不依賴 admin bypass；等價測試以正式區語意（沿用第 6 批做法） |
| 廠商銀行欄位 | `ga_vendors` 沒有任何 `bank%` 欄位 | 120000 新增四欄 |

結論：設計 §3.2、§3.5、§3.6 的假設除「`can_view` 名稱」外全部成立，已在上文修正；**無需改動使用者已決定的 P1 至 P10**。

### 13.2 實作進度

#### G45-db（資料庫層，2026-11-19 完成，DEV only）
- **DEV SQL**（`supabase/workspace-dev/`，各附 `.rollback.sql`）：`20261119100000_m7m8_b45_receipt_voucher`、`110000_payment_requests`、`120000_vendor_bank`、`130000_attachment_types`、`140000_permissions`、`145000_dev_seed`（四個 `vue_workspace_ga45_*` 測試角色與 `ga_dev_cleanup_m7m8_b45` 清除函式）、`150000_functions`。`160000_analysis`、`170000_receipt_void` 留給後續階段（套用腳本遇到不存在的檔會略過）。套用腳本 `scripts/apply-workspace-m7m8-b45-dev.cjs [--rollback]`；清理腳本 `scripts/cleanup-m7m8-b45-dev.cjs`；正式區草稿產生器 `scripts/build-m7m8-b45-prod-drafts.cjs`。
- **正式區草稿**（`m7m8-sql/`）：`50-b45-preview-before-apply`（唯讀，已在 DEV 實跑確認語法與欄位）、`51` 至 `55` 各附 `-rollback`；README 新增「第 4.5 批」章節與套用順序（50→51→…→58，56 至 58 後續補檔）。51 至 55 草稿已在 DEV 實跑（重複套用無錯誤）。
- **套用 → 撤回 → 再套用已實測**：撤回後五張新表、45 個函式、權限碼、角色、廠商銀行欄位、進貨欄位、觸發器全部消失，附件 CHECK 回到 8 值、兩個附件函式的 PURCHASE_ 分支與 `ga_vd_json`／`ga_ws_vendor_save` 的銀行欄位都被拿掉（水電帳單分支保留）；再套用回到完整狀態。
- **開工讀 `ga_ws_po_create` 的結論（§3.3、§8-11）**：採購單稅率在草稿時取設定 `po_tax_rate`（設定函式允許 0 至 0.3，可設 0），下訂後快照；免稅廠商用「採購單 tax_rate = 0」表達可行（測試以 service role 把已下訂採購單改成 0 驗證：發票稅額與請款稅額都自動為 0）。
- **實作時的決定與修正**：(1) 為了不改第 4 批到貨函式，進貨明細金額用 BEFORE INSERT 觸發器凍結（欄位不能設預設值，否則觸發器看不出沒給金額；已踩過並修正）。(2) 發票金額差異要原因的比較對象是「連結進貨單含稅合計」與「分攤合計」，兩者任一超過尾差就要填原因。(3) 已被有效請款單引用的發票，修改檢查在原因檢查之前先擋（回 INVOICE_IN_USE，而不是被要求補原因）。(4) 附件讀取判斷對 PURCHASE_ 類型資源「存在即可讀」（含已作廢發票，保留歷史），寫入要求發票 ACTIVE、進貨單未作廢。(5) `ga_ws_pay_po_summary` 的 `can_manage` 與其他函式一致放在回傳最外層。(6) 內部輔助 `ga_pay_*` 一律收回登入者執行權（只有 service_role），避免繞過 `ga_ws_pay_*` 的權限與遮蔽。(7) 建立用 `idempotency_key`（同識別同內容回原結果、內容不同 409）；動作的固定識別存在事件表（同一請款單內唯一），內容雜湊不同回 409。
- **測試 G45-db**（`tests/integration/G45-db.payment-requests-rpc.spec.ts`，28 項，循序）：結構與直接讀寫被擋、權限矩陣（未登入、nobody、purchaser、store_mgr、profiles.role=admin、vendor_mgr 全部擋；viewer 唯讀；只有請款查看者不看採購單明細）、設定（尾差、買受人、STALE、範圍）、進貨金額凍結與各品項進位、進貨憑證、發票（新增、重複號碼、免稅、收據與免開發票、統編不符、尾差邊界 4／5／6 元與可調、編輯、查詢、遮蔽、分頁、搜尋跳脫）、附件分支（新類型讀寫、CHECK、既有類型回歸含水電帳單與料件、最後一張圖守門）、請款單（建立、快照、累計上限含兩張請款單合計與短收與拒收與作廢釋放與尾差設定與併發、缺圖不可引用、狀態機完整劇本、申請人自己標已付款、動作併發、銀行快照、查詢、候選進貨與摘要、對帳匯出與遮蔽）、廠商銀行欄位。通過 28／28；sweeper 孤兒 0。
- **回歸**：G25-db（21 項 Playwright ＋單元 43 項）、G26-db（22 項＋單元 37 項）、G20-G21-db-api（40 項）、G22-G24（48 項）、G23（58 項）全部通過；`npm run test:unit` 2141 項、`npx tsc --noEmit` 通過。
- **待後續階段**：`lib/workspace/general-affairs/vendor-rules.ts` 的 `VENDOR_SECRET_FIELDS` 還是 8 欄，銀行四欄要在 G45-att-inv 加入並更新 `tests/unit/G20-G21-db-api/vendor-rules.test.ts` 的 8 欄斷言（資料庫層已把銀行欄位放在 `ga_vd_json` 的機密段，只有 `ga_ws_vendor_get`／`save` 回傳，列表函式不含）；`ga_ws_pay_export` 回傳列資料，CSV 與公式注入防護在 G45-pay 的伺服端；採購分析、廠商績效、attention、首頁徽章（160000／57）與作廢進貨（170000／58）；`has_permission` 在 DEV 與正式區語意不同（DEV 檢查 `roles.is_active` 並有 admin 後備），本批測試角色都明確帶權限碼，等價性以「profiles.role=admin 無角色被擋」與角色皆啟用驗證。

#### G45-att-inv（附件規則、進貨憑證、發票頁面與 API、廠商銀行欄位；2026-11-20 完成，DEV only）
- **API**：`purchase-invoices`（GET 清單、POST；`/:id` GET、PATCH；`/:id/actions` void；`/meta` 權限與尾差設定；`/receipt-options` 可連結進貨單）、`purchase-orders/:id/receipts/:rid/voucher`（PATCH）、`purchase-orders/:id/payment-summary`（GET）。純函式在 `lib/workspace/general-affairs/payment-rules.ts`。
- **附件**：`RESOURCE_TYPES` 加 PURCHASE_INVOICE、PURCHASE_RECEIPT（用途固定 INVOICE_IMAGE、DELIVERY_NOTE）；伺服端閘寫入需請款管理、讀取需請款檢視或管理；最後一張圖被鎖回 409 `INVOICE_LAST_IMAGE_LOCKED`。水電帳單附件回歸通過。
- **頁面**：進貨發票清單與編輯頁、採購單詳情「發票與請款」分頁（含登錄憑證）、廠商表單與詳情銀行四欄；入口用資料庫語意（`gaPurchaseInvoices`、`gaPaymentManage`）。
- **決定**：`ga_ws_pay_po_summary` 的 `can_manage` 在回傳最外層，API 併入 data；`VENDOR_SECRET_FIELDS` 改 12 欄，batch 6 SQL 測試只對原 8 欄驗原檔；進貨列的「登錄憑證」按鈕與分頁內按鈕共用同一對話框；「作廢進貨」留給 170000 階段。
- **測試**：單元 `tests/unit/G45-att-inv`（36 項）；整合 `G45-att-inv.invoices-api`（16 項）；冒煙 6 項 × 桌機／手機；e2e 劇本 5 項 × 桌機／手機。
- **待登 allowlist（階段五）**：核可類（採購單新分頁與登錄憑證、廠商銀行欄位、附件新資源類型）；待確認類（請款入口用資料庫語意、已被引用發票最後一張圖不可刪）。

#### G45-pay（請款單 API、頁面、狀態機、設定、列印與 CSV；2026-11-20 完成，DEV only）
- **API**：`payment-requests`（GET 清單、POST 建立；`/:id` GET、PATCH 草稿；`/:id/actions` 含 submit、return、mark_paid、void、note、refresh_bank；`/candidates` 可請款進貨與尚可請款額；`/export` 對帳 CSV）與 `payment-settings`（GET 需檢視或管理、PUT 需管理）。全部走資料庫函式 `ga_ws_pay_*`，伺服端檢查 Origin、版本（expected_updated_at）與固定識別（idempotency_key）；沒有核准、沒有 approve 或 pay 權限碼，申請人可自己標已付款。
- **規則純函式**：`lib/workspace/general-affairs/payment-request-rules.ts`（狀態轉移表、累計上限與尾差、請款單號、輸入驗證、CSV 組檔與公式注入防護、機密遮蔽），API、頁面與單元測試共用。
- **頁面**：請款單清單（狀態、月份、廠商、搜尋、「待付款」頁籤、匯出 CSV、請款設定）、請款單建立與編輯與檢視（只能選可請款進貨、採購單／進貨單／發票逐品項、超過累計上限直接擋、差異原因必填但可送出、事件時間軸、按鈕依狀態與權限）、A4 列印頁（買受人抬頭、無廠商查看權限時銀行與統編整區省略、簽章區顯示總務請款與會計付款）、請款設定對話框（尾差、買受人）。入口旗標 `gaPaymentRequests`（資料庫語意，管理員身分無角色不顯示）。
- **決定**：(1) 列印頁是頁籤內的 A4 預覽，`@media print` 只輸出紙張；沒有獨立網址路由（既有頁面也是頁籤制）。(2) 請款設定放在請款單清單頁的「請款設定」按鈕，沒有塞進採購核准設定對話框（那個對話框限採購核准權限者）。(3) CSV 沒有廠商權限者整欄省略統編與銀行，不是留空欄。(4) 編輯草稿時，原有明細的累計上限交給伺服端把關，畫面只檢查新加入的進貨。
- **測試**：單元 `tests/unit/G45-pay`（37 項）；整合 `G45-pay.requests-api`（11 項）；冒煙 `G45-pay.pages`（4 項 × 桌機 1440／手機 390）；e2e 劇本 `G45-pay.journey-payment`（6 項 × 桌機／手機：總務建立送出、會計退回、總務改後再送、版本衝突、會計標已付款鎖定、檢視者唯讀與列印簽章、超過上限被擋、已付款作廢釋放額度）。`npm run test:page -- G45-pay` 循序全綠（31 項 Playwright ＋ 37 項單元）。全套單元 2214 項通過。
- **allowlist**：`m7m8-b45-` 前綴 7 條。已核可（approvedBy 為本批問卷）：採購單「發票與請款」分頁、登錄憑證、廠商銀行欄位、附件新資源類型、結案不被未請款擋住。待確認（approvedBy 為 null，plain.json 已補白話稿，topic 新增 payments）：請款入口用資料庫語意、已被引用發票最後一張圖不可刪。
- **未做（後續階段）**：採購分析與廠商績效的已請款／已付款欄位、首頁與導覽徽章與採購單清單 attention 的「待請款」「待付款」、作廢進貨（`ga_ws_po_receipt_void`）、正式區草稿 57、58；對應的 allowlist 條目（已作廢進貨不計統計、已結案採購單進貨不可作廢、分析新欄位、徽章）在那一階段登錄。

#### G45-void-stat（作廢進貨、採購分析與廠商績效擴充、清單 attention 與首頁／導覽徽章；2026-11-20 完成，DEV only）
- **DEV SQL**（各附 `.rollback.sql`）：`20261119170000_m7m8_b45_receipt_void`（`ga_purchase_receipts.void_key`＋唯一索引、`ga_ws_po_receipt_void`、文字替換 `ga_ws_po_receipts_get` 與 `ga_ws_po_dispatch` 排除已作廢進貨）；`20261119160000_m7m8_b45_analysis`（`ga_pay_unclaimed_po_ids`、`ga_pay_po_amounts`，以讀現行定義加文字替換擴充 `ga_hm_counts`、`ga_ws_home_badges`、`ga_ws_home_summary`、`ga_ws_po_list`、`ga_ws_purchase_analysis`、`ga_ws_vendor_perf`；形狀不符就中止、已套用就略過）。正式區草稿 `57-b45-analysis`、`58-b45-receipt-void`（各附 `-rollback`），`50` 第 8 區補 57、58 的形狀檢查，README 第 4.5 批章節更新；產生器 `scripts/build-m7m8-b45-prod-drafts.cjs`。
- **套用 → 撤回 → 再套用已實測**：`scripts/apply-workspace-m7m8-b45-dev.cjs --rollback` 九個檔反向全部成功（對外與內部函式 0 個、請款表消失、`voided_at`／`void_key` 欄位消失、`ga_hm_counts`／`receipts_get` 還原），再套用回到 46 個函式與完整狀態；160000 單獨撤回後六個被改的函式與撤回前保存的原定義逐字相同。
- **作廢進貨規則**：權限沿用到貨（採購評估管理＋庫存交易管理＋料件查看）；必填原因（200 字內）、固定識別、`expected_updated_at`；同識別重送回原結果。單一交易：沖回庫存（反向庫存交易 ISSUE，原因含進貨單號與作廢原因，metadata 標 void）、扣回品項已驗入量、重算採購單狀態（無驗入 ORDERED、未收滿 PARTIALLY_RECEIVED、收滿 RECEIVED）、進貨標記 `voided_*`、寫採購單事件 `receipt_void`。擋下（白話）：被有效請款單引用（指出請款單號）、連結有效發票（指出發票號）、已配發（`dispatched_qty > 0`，請走報廢）、驗入時直接建立設備的品項、採購單已結案或已取消、沖回後庫存為負（即使該位置允許負庫存）、已作廢、版本過期。已作廢進貨不計入累計驗入、請款上限、請款候選、可配發量與採購分析（品項 `received_qty` 已扣回）。
- **待請款與待付款**：待請款採購單＝累計驗入含稅額（未作廢進貨）減有效請款累計（非作廢請款單）大於尾差（剛好等於尾差不算），述詞函式 `ga_pay_unclaimed_po_ids(尾差)` 是單一 SQL、不帶 `search_path`、可被規劃器內嵌；待付款＝請款單 SUBMITTED。徽章（`pay_unclaimed`、`pay_submitted`、選單 `payment_requests`）、首頁兩個待辦、採購單列表（新增 `payUnclaimed` 篩選，`attention` 聯集也加入待請款）用同一個述詞，數字等於點進去的筆數；只給有 `purchase_payment.view`／`manage` 者（待請款另需能看採購單），沒有權限的人鍵不存在。採購單選單徽章 `po_menu` 聯集加待請款。
- **統計新欄位**：`ga_ws_purchase_analysis` 的 `confirmed` 與每張採購單新增 `claimed_amount`、`paid_amount`、`unclaimed_received_amount`（含稅），回應帶 `can_view_payment`；`ga_ws_vendor_perf` 新增每家 `po_paid_amount`、合計 `po_paid_total` 與 `can_view_pay_amount`。沒有請款權限者欄位不存在（分析）或為 null（績效）；原有欄位與口徑不動。
- **效能實測（DEV，十萬級，比照第 6 批 49 號）**：十萬張採購單（各 1 進貨、1 進貨明細）、四萬張請款單（PAID 2 萬、SUBMITTED 1 萬、DRAFT 5 千、VOID 5 千），六萬五千張採購單待請款（最壞情況）：待請款述詞 0.56 秒、採購單選單徽章（聯集）0.68 秒、列表待我處理第一頁 0.64 秒、待付款徽章 1 毫秒、單月（約 8 千張）分析請款彙總 0.18 秒；EXPLAIN 顯示述詞被內嵌成雜湊聚合（沒有逐列呼叫函式，對照第 6 批未內嵌時首頁 14.8 秒），不需新增索引。實際資料量遠小於此。測試資料標記 `PERF-B45-`（2038 年、無門市），量完已刪除並驗證筆數歸零。
- **API／頁面**：`POST purchase-orders/:id/receipts/:rid/void`（Origin、驗證、`GaError`，回新的採購單與進貨資料）；採購單詳情進貨列「作廢進貨」按鈕與原因必填視窗（前端預判用 `receiptVoidBlock`，最終以資料庫為準；已作廢標紅並顯示原因與時間）；採購分析頁新增請款三卡與表格三欄、廠商績效新增已付款欄與合計卡（都只給有請款權限者）；首頁與側欄新增待請款、待付款（徽章可點，帶 `payUnclaimed`／`status=SUBMITTED` 篩選）。純函式：`isPayUnclaimed`、`unclaimedAmount`（payment-rules）、`receiptVoidBlock`、`validateReceiptVoidPayload`（purchase-receipt-rules）、`home-rules` 新增兩項。
- **測試**：單元 `tests/unit/G45-void-stat`（25 項）；整合 `G45-void-stat.receipt-void-api`（11 項，G45-void）與 `G45-void-stat.stat-api`（9 項，G45-stat）；冒煙 4 項 × 桌機 1440／手機 390；e2e 劇本 6 項 × 桌機／手機（總務作廢登錯進貨→重登請款→被擋→會計付款→統計→付款退回→再作廢進貨→檢視者唯讀）。既有測試同步：G22-G24 單元（首頁十一項）、T02（待確認清單）。
- **allowlist**：`m7m8-b45-receipt-void`（approvedBy 為問卷）；`m7m8-b45-analysis-pay-columns`、`m7m8-b45-badges-pay-attention`、`m7m8-b45-void-excluded-closed-blocked`（approvedBy 為 null，`plain.json` 已補白話稿，topic 為 purchase 與 payments）。
- **決定**：(1) 待付款徽章放在請款單選單與首頁、待請款放在採購單選單與首頁，不把待付款併入採購單聯集（待付款是請款單的事）。(2) 直接建立設備的品項、有效發票連結的進貨一律不能作廢，已結案採購單不能作廢進貨（保守；已登 allowlist 待確認）。(3) 沖回後庫存為負一律擋，不看位置是否允許負庫存。(4) 內部述詞與彙總函式只開給 service_role，登入者直接呼叫被擋。(5) 連結或作廢發票會更新進貨單版本，畫面作廢進貨前需用最新版本（畫面每次載入都帶最新 `updated_at`）。

#### G45-e2e（全批驗收與總串接劇本；2026-11-20 完成，DEV only）
- **新增**：`tests/e2e/G45-e2e.journey-full-chain.e2e.spec.ts`，7 項 × 桌機 1440／手機 390 = 14 項全過（`npm run test:page -- G45-e2e`，循序；`run-all` 結束碼 1 只因 sweeper 基準 17 筆孤兒，前後相同）。串接前四階段沒有涵蓋的跨功能路徑：缺圖發票不能被請款單引用、重複號碼、尾差邊界、拒收量不可請、重複送出不重複建立、STALE 並發、已付款作廢釋放額度後合併重新請款、銀行快照不隨廠商改帳號、列印與 CSV、配發轉設備後請款不受影響、已配發或已請款的進貨不可作廢、無請款權限角色（採購、店長、管理員身分無角色）入口與 API 403。
- **allowlist**：`m7m8-b45-` 共 11 條（6 條已核可、5 條 approvedBy 為 null）；5 條都有 `plain.json` 白話稿，確認頁以 `scripts/allowlist-review/build.cjs` 產生（未代填答案）。
- **驗收**：`node --check`、`tsc`、`vue-tsc`、`test:unit` 2239 項全過；Vue build 與 public/workspace 同步由測試站自動完成。
- **待使用者確認清單（approvedBy 為 null）**：(1) `m7m8-b45-entry-db-semantics` 請款入口用資料庫語意，管理員身分沒掛權限不放行；(2) `m7m8-b45-invoice-last-image-lock` 已被請款單引用的發票最後一張圖不可刪；(3) `m7m8-b45-analysis-pay-columns` 採購分析與廠商績效新增已請款、已付款欄位；(4) `m7m8-b45-badges-pay-attention` 首頁與選單新增「待請款」「待付款」；(5) `m7m8-b45-void-excluded-closed-blocked` 已作廢進貨不計統計、已結案採購單的進貨不可作廢。
- **未做**：全量 `test:all`（約 10 小時以上，改逐頁循序重跑）；Remote Control 1920×1080 截圖；正式區草稿 50 至 58 尚未由使用者核可與套用。

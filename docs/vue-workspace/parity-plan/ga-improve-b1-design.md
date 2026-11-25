# 總務採購與請款改善 第一批設計（G1 預付款、G2 含稅單價、G3 調整列、G4 付款方式與同仁代墊、G11 多家買受人公司、G12 權限名稱、兩個小錯字）

> 狀態：設計定稿待實作（2026-11-25）。依老闆 2026-11-25 問卷 m9-ga-improve 與對話確認的第一批規格寫成。**這份文件只有設計，沒有改任何程式與資料庫。**
> 第二批（G5 至 G10）這次不做。
> 範圍：採購單（G25）、進貨驗入（G24 前後）、請款單（G45 系列）、水電請款（G46）、請款設定。
> 實作限制（全批共用）：只連 DEV（`supabase/.temp/project-ref` 以 mjpd 開頭，DB 指令前先確認）；不讀 `.env.local`、`.env.production*`、`*.bak`，不連正式區（ref odvk 開頭）；不改 `supabase/migrations`；DEV 的 DB 變更放 `supabase/workspace-dev/20261125xxxxxx_ga_improve_b1_*.sql`（各附 `.rollback.sql`）；正式區草稿放 `docs/vue-workspace/parity-plan/ga-improve-b1-sql/`（各附 `.rollback.sql` 與只有 SELECT 的 `.verify.sql`、加 README、可重複執行、**不授權任何權限碼給任何角色**）；測試資料只在 VW／ZT 測試門市、2038 年；不 push。
> 權限語意依正式區 `has_permission`：不看 `roles.is_active`、資料庫端不放行 admin；只有應用層 `profiles.role==='admin'` 的既有後援。

## 0. 白話摘要（給老闆）

1. **預付款（G1）**：採購單「核准並下訂」之後，就可以開一張「預付」請款單（不必等到貨）。貨到驗入的當下，系統自動把預付金額「核銷」掉這張進貨單該付的錢，之後再開一般請款單時只會請「還沒付的差額」。超過預計到貨日還沒到貨、而預付款還沒核銷完的採購單，會在採購單列表、請款單列表與總務首頁既有的「逾期未到貨採購單」裡標出「已預付 NT$x」。預付單被退回或作廢時，已經核銷的金額會自動回復；廠商退款用「登記退款」處理。
2. **含稅單價（G2）**：每張採購單選「單價含稅」或「單價未稅」。選含稅時，系統用「含稅總額」反推未稅與稅額（總額÷1.05 四捨五入、稅額＝總額減未稅），進貨、發票、請款金額都用同一套算法，不會差一兩塊。既有採購單全部維持未稅，完全不受影響。
3. **調整列（G3）**：採購單可加「運費」「折扣」「折價券」「點數折抵」「其他」調整列，金額算進總額（折扣是負數），原價與活動名稱可填。調整列在**第一張有效進貨單**時併進進貨金額，所以發票比對與請款金額自然包含運費與折扣。
4. **付款方式（G4）**：標已付款時多兩個選項「信用卡」（可填卡號末四碼）與「網購平台／第三方支付」（可填平台名稱）。另外請款單可以選「同仁代墊」並指定是哪位同仁，付款對象變成該同仁、錢還給同仁（採購與水電請款都可以）；廠商仍記在採購單／請款單上。同仁的匯款帳戶由同仁自己或會計登錄，一般畫面只露末四碼。
5. **多家買受人公司（G11）**：請款設定改成「買受人公司清單」（名稱＋統編，可新增多家、指定一家預設）。每張採購單與請款單選抬頭，請款單列印印出所選公司。既有那一組抬頭與統編自動轉成預設公司。
6. **權限名稱（G12）**：畫面與訊息裡的「水電網費管理」改為「水電話網費管理」，權限碼不變。
7. **兩個小錯字**：店長確認後提示「確認完成完成。」改成「確認完成。」；已付款或已連結發票的進貨單不再顯示「登錄憑證」連結。
8. **對既有零影響**：所有新欄位都有預設值或可空、約束只放寬不收緊、既有函式只加「新功能才走的分支」，沒用到新功能時輸出與現在逐位相同；上線前後用同一批資料跑黃金比對。
9. **正式區**：水電請款（G46）上線後才上，草稿獨立資料夾 `ga-improve-b1-sql/`，不併入其他批次。

## 1. 現況盤點（已讀程式與 DEV 資料表）

| 項目 | 現況 | 本批影響 |
|---|---|---|
| 採購單 `ga_purchase_orders` | `tax_rate` 預設 0.05、`subtotal`／`tax_amount`／`total_amount` 整數；總額由 `ga_po_refresh_totals` 計算：小計＝品項 `line_amount` 加總，稅額＝`round(小計×稅率)`；草稿用設定稅率，下訂後鎖快照 | 加計價模式與調整列，改這支函式的計算分支 |
| 採購單品項 `ga_purchase_order_items` | `unit_price numeric(14,4)`（未稅）、`line_amount`＝`round(數量×單價)`；下訂時鎖品項、數量、單價 | 加含稅單價欄位，未稅單價改為推算 |
| 進貨明細 `ga_purchase_receipt_items.amount_untaxed` | 登錄當下由觸發器 `ga_pay_freeze_receipt_item_amount` 凍結為 `round(單價×驗入量)`；進貨單含稅額＝未稅＋`round(未稅×稅率)`（`ga_pay_receipt_total`） | 含稅採購單改走「含稅額反推」分支 |
| 請款單 `ga_payment_requests` | `vendor_id NOT NULL`、狀態 DRAFT／SUBMITTED／PAID／VOID、`pay_method` 只允許 TRANSFER／CASH／CHECK、`bank_snapshot`（廠商帳戶快照）、`source`（PURCHASE／UTILITY）、`amount_total＝未稅＋稅額`約束 | 加預付、代墊、抬頭、付款方式欄位 |
| 請款明細 `ga_payment_request_lines` | `po_id`、`receipt_id` 皆 NOT NULL、`claim_total>0`；累計上限 `OVER_CLAIM`（累計請款 ≤ 累計驗入含稅額＋尾差）與 `OVER_PO_TOTAL`（≤ 採購單含稅總額＋尾差） | 預付沒有進貨單，不能放進這張表；核銷要計入累計 |
| 水電請款（G46） | `source='UTILITY'`，明細在 `ga_payment_request_bill_lines`；`vendor_id` 是繳費單位（公用事業廠商）；送出後可自動標帳單已繳 | 代墊同仁選項要加在這裡 |
| 請款設定 | `ga_workflow_settings` 三個鍵：`pay_tolerance_amount`、`pay_buyer_title`、`pay_buyer_tax_id`；`ga_ws_pay_settings_get/set` 讀寫；請款單列印（`PaymentRequestPrint.vue`）與三聯式發票統編核對用同一組 | 改成公司清單，三個鍵保留相容 |
| 員工匯款帳戶 | DEV 全庫沒有員工銀行欄位（只有 `ga_vendors.bank_*` 與請款單快照）；`profiles` 只有 id、email、full_name、role、department、job_title、employee_code | 要新增員工帳戶表 |
| 權限名稱 | `permissions` 表在 DEV 沒有「名稱」欄位（module、feature、code、action、description）；`general_affairs.utility_bill.manage` 的 description 是「新增與管理總務水費、電話費與網路費紀錄」；「水電網費管理」這個叫法出現在畫面與訊息字串與測試斷言（約 24 個檔） | 見 §9 |
| DEV 資料量 | 採購單 1 張、進貨單 1 張、請款單：採購已付款 1、水電已送出 1、水電已付款 2 | 回填量極小，零影響驗證用黃金比對即可 |
| 逾期未到貨 | 首頁待辦 `po_overdue`（ORDERED、PARTIALLY_RECEIVED 且預計到貨日已過）已存在；首頁項目數與導覽徽章有既有單元測試斷言 | 預付逾期併入這個項目，不新增首頁項目（見 §3.7） |
| 兩個小錯字 | `RequestDetail.vue` 第 105 行 `${ACTION_TITLE[a]}完成。`，而 `ACTION_TITLE.confirm_complete` 本身是「確認完成」；`PoDetailDialog.vue` 第 212 行「登錄憑證」按鈕只判斷有請款管理權限與未作廢 | §10 |

## 2. 共用原則

### 2.1 金額四捨五入

- 一律「整數元、四捨五入、0.5 進位（遠離零）」，與資料庫 `round(numeric)` 及 `roundYuan()`（`purchase-order-rules.ts`，對負數取絕對值後進位再還原正負號）相同。折扣為負數時 -2.5 進位為 -3。
- **未稅模式（既有）**：品項金額＝`round(數量×未稅單價)`；小計＝品項加總＋調整列加總；稅額＝`round(小計×稅率)`；含稅總額＝小計＋稅額。（與現行公式相同，沒有調整列時結果逐位相同。）
- **含稅模式（新）**：品項含稅金額＝`round(數量×含稅單價)`；含稅總額＝品項含稅金額加總＋調整列加總（調整列在含稅模式下輸入的就是含稅金額）；未稅小計＝`round(含稅總額÷(1＋稅率))`；稅額＝含稅總額－未稅小計。**以含稅總額為準，稅額用減的**，所以「含稅總額」永遠等於使用者輸入合計，不會因反推而少一塊。
- **進貨單**（含稅模式）：進貨單含稅額 G＝驗入品項含稅金額加總（各品項 `round(驗入量×含稅單價)`，加上調整列若本單承接）；未稅＝`round(G÷(1＋稅率))`；稅額＝G－未稅。未稅模式維持現行：進貨單稅額＝`round(未稅×稅率)`。
- **請款預設金額**：預設請款含稅額＝進貨單含稅額（扣掉本單已預付核銷額）；未稅與稅額依採購單計價模式拆：含稅模式用上式（稅額＝含稅額－`round(含稅額÷(1＋稅率))`），未稅模式且無預付核銷時維持現行（未稅＝進貨單未稅、稅額＝`round(未稅×稅率)`），未稅模式有預付核銷時，扣完後含稅額按 `稅額＝round(含稅額×稅率÷(1＋稅率))` 拆。
- **尾差**：沿用請款設定 `pay_tolerance_amount`（預設 5 元）；分批進貨各自進位造成的 1 至 2 元誤差由尾差吸收（既有行為）。

### 2.2 不影響既有資料與測試的做法（全批共用）

1. 新欄位一律有預設值（`NOT NULL DEFAULT`）或可為 NULL；舊資料不回填就能運作（回填只限公司清單由既有設定轉入，見 §7）。
2. 約束只放寬：`pay_method` 的 CHECK 與請款事件類型的 CHECK 改成「舊值＋新值」超集（先 DROP 再 ADD，同一交易）；新的 CHECK 只針對新欄位，且預設值滿足。
3. 既有函式不重寫，用「讀現行定義→文字替換→已套用就略過、形狀不符就中止」的樣式（沿用 `ga_b45f_swap`、`ga_gaup_swap` 的做法）加掛；每處加掛都是 `IF 新功能條件 THEN 新邏輯 ELSE 原邏輯`，沒用到新功能時走原邏輯。
4. 既有 API／RPC 回傳 JSON 只加新 key、不改既有 key 的型別與值。階段 0 先掃描既有測試有沒有 `toEqual`／`toStrictEqual` 整個物件比對的地方；有的話，新 key 改成「功能有被使用時才輸出」。
5. 黃金比對：階段 0 在 DEV 用固定的未稅採購單＋進貨＋發票＋請款（含水電單）情境，錄下相關 RPC 輸出（`ga_ws_po_get`、`ga_ws_po_receipts_get`、`ga_ws_pay_po_summary`、`ga_ws_pay_request_get/list`、`ga_ws_pay_export`、`ga_ws_pay_settings_get`、`ga_ws_home_counts`）成 JSON；每個階段套用後重跑，與黃金檔逐位比對（沿用 `G46.db-golden.purchase-regression` 的做法並擴充）。
6. 既有測試的斷言文字若會因本批規格而必須變（只有 G12 改名與錯字兩處，見 §9、§10），在同一個 commit 一併更新並在 commit 訊息註明；其餘斷言不得修改。
7. 與舊版行為不同的地方：採購與請款是新版專有功能（舊版沒有），沒有舊新比對；只有「確認完成完成。」錯字會被 parity 測試比對到（若比對到舊版文字，於 `tests/parity/allowlist.json` 與 `plain.json` 加條目，id `ga-improve-b1-confirm-complete-typo`）。

## 3. G1 預付款

### 3.1 資料模型

`ga_payment_requests` 新增欄位：

| 欄位 | 型別 | 說明 |
|---|---|---|
| `pay_kind` | text NOT NULL DEFAULT 'NORMAL'，CHECK IN ('NORMAL','PREPAY') | 一般請款或預付款 |
| `prepay_po_id` | uuid NULL → `ga_purchase_orders(id)` | 預付對應的採購單（一張預付單只對一張採購單） |

CHECK：`(pay_kind='NORMAL' AND prepay_po_id IS NULL) OR (pay_kind='PREPAY' AND prepay_po_id IS NOT NULL AND source='PURCHASE')`。預設值使既有資料全部成立。

預付單沒有 `ga_payment_request_lines` 明細（那張表要求進貨單與大於 0 的金額）；金額直接放請款單的 `amount_untaxed／tax_amount／amount_total`。拆稅：`amount_untaxed＝round(含稅額÷(1＋稅率))`，`tax_amount＝含稅額－amount_untaxed`（稅率用採購單快照；含稅模式與未稅模式相同）。預付單「發票」不用處理：發票在到貨後連到進貨單。

新表 `ga_payment_prepay_ledger`（預付餘額帳，**事件式、不修改只作廢**）：

| 欄位 | 說明 |
|---|---|
| `id`、`created_at`、`created_by` | |
| `prepay_pr_id` | → `ga_payment_requests`（pay_kind='PREPAY'） |
| `po_id` | → `ga_purchase_orders` |
| `kind` | 'OFFSET'（核銷進貨）或 'REFUND'（廠商退款／轉抵登記） |
| `receipt_id` | OFFSET 必填 → `ga_purchase_receipts`；REFUND 為 NULL |
| `amount` | 整數元，大於 0 |
| `reason` | REFUND 必填（退款或轉抵說明），OFFSET 為 NULL |
| `reversed_at`、`reversed_reason` | 回復時填（不刪列，保留軌跡） |

RLS 開啟且無政策、收回直接權限，僅 SECURITY DEFINER 函式存取（與 `ga_payment_requests` 同做法）。

`ga_payment_request_lines` 新增 `prepay_offset numeric(14,0) NOT NULL DEFAULT 0`（建立明細當下，該進貨單已被預付核銷的金額快照；舊資料為 0）。

### 3.2 餘額定義（每張採購單）

- T＝採購單含稅總額（含調整列）。
- N＝一般請款明細（非作廢請款單）的 `claim_total` 加總（即現行 `ga_pay_po_claimed`）。
- P＝預付請款單（非作廢，含草稿）的 `amount_total` 加總。
- 有效預付 Pa＝預付請款單狀態為 SUBMITTED 或 PAID 的 `amount_total` 加總（草稿不核銷）。
- O＝帳本中未回復的 OFFSET 加總；F＝未回復的 REFUND 加總。
- **預付餘額 B＝Pa－O－F**（以單張預付單計算時只取該單）。
- **累計請款（對上限檢查用）＝N＋O**。

### 3.3 規則

1. **建立預付單**：採購單狀態必須是 ORDERED 或 PARTIALLY_RECEIVED（已核准並下訂；未下訂、已全收、已結案、已取消都不行）；需「請款管理」＋能看採購單（與現行請款單建立相同）；廠商＝採購單廠商；金額必須大於 0；上限 `P＋N ≤ T＋尾差`，超過回 `OVER_PO_TOTAL`（沿用既有錯誤碼與訊息樣式，補「預付」字樣）。同一張採購單可開多張預付單（如訂金、尾款）。
2. **狀態機不變**：DRAFT→SUBMITTED→PAID，可退回、作廢；沒有核准關卡。預付單送出前不需要明細（現行「沒有任何明細不能送出」檢查對 PREPAY 略過）。
3. **自動核銷（到貨驗入時）**：進貨單建立後（`AFTER INSERT` 在 `ga_purchase_receipts` 完成明細後；實作上掛在 `ga_ws_po_receive` 結尾，同一交易），計算本進貨單含稅額 R，可核銷額＝`min(R－該進貨單已有請款與核銷, 該採購單可用預付餘額 B)`；依預付單建立時間先後逐張寫入 OFFSET 帳本列。核銷額大於 0 才寫。
4. **預付晚於進貨**：預付單在採購單已有進貨後才送出時，送出動作（`ga_pay_request_action` submit 後的觸發器）把餘額依進貨單先後（只對「R－已請款－已核銷」大於 0 的進貨單）補核銷。建立時的上限檢查（`P＋N ≤ T＋尾差`）保證不會預付已請款部分。
5. **退回、作廢預付單**：該單所有未回復的 OFFSET、REFUND 帳本列自動回復（`reversed_at`＋原因）；該進貨單回到「需要請款」狀態（待請款提醒重新出現）。送出狀態的預付單被退回再送出會重新核銷。已付款的預付單作廢需要填原因（既有規則），事件備註自動註記「已核銷 NT$x 已回復；此單已付款，需向廠商追回款項」。
6. **作廢進貨單**：該進貨單的 OFFSET 自動回復（餘額回到預付單，後續進貨可再核銷）。既有規則「被有效請款單引用的進貨單不能作廢」不變。
7. **一般請款扣除預付**：建立或修改草稿明細時，進貨單預設請款金額＝進貨單含稅額－該進貨單已核銷額；明細存入 `prepay_offset`。若扣完為 0 或負，該進貨單不產生請款明細（候選清單標示「已由預付款核銷，免再請款」，但仍可登錄憑證與連結發票）。
8. **發票差異檢查**：現行比較「請款額 vs 發票分攤額」，改為比較「請款額＋`prepay_offset` vs 發票分攤額」，超過尾差仍要填差異原因。
9. **送出前重驗**：`ga_pay_check_live` 檢查每條明細的 `prepay_offset` 是否等於該進貨單目前未回復核銷額，不同回 `PREPAY_CHANGED`（409，「預付核銷有變動，請重新整理明細後再送出」）。
10. **登記退款（`prepay_refund`）**：已付款的預付單，餘額大於 0 時，可登記一筆退款或轉抵（金額 ≤ 餘額、必填原因）；寫 REFUND 帳本列與請款單事件。新 RPC `ga_ws_pay_prepay_settle(p_id, p_amount, p_reason, p_key, p_expected_updated_at)`，需請款管理。
11. **採購單結案守門**：採購單 `cancel`、`short_close`、`close` 時，若有預付餘額 B>尾差，擋下（`PREPAY_BALANCE_OPEN`，409，「這張採購單還有預付款 NT$x 未核銷，請先登記退款或等到貨核銷」）。以 `ga_ws_po_action` 的函式文字替換加一段前置檢查，沒有預付單時不執行任何查詢（直接略過）。
12. **逾期提醒**：條件＝採購單狀態 ORDERED 或 PARTIALLY_RECEIVED、預計到貨日早於今天（台北）、預付餘額 B>0。呈現位置：(a) 採購單列表加篩選 `prepaid=1`（已預付）與行內標籤「已預付 NT$x（逾期）」；(b) 請款單列表加篩選 `prepay_overdue=1` 與表頭提示條；(c) 總務首頁既有 `po_overdue` 項目的列表自動帶出（該項目的計數口徑不變，其中已預付的列顯示標籤）；(d) 採購單詳情與請款單詳情顯示逾期天數。**不新增首頁待辦項目**，避免改動既有項目數量斷言（`home-rules` 單元測試與 G22–G24 測試）；若老闆要獨立項目，屬疑義 Q3。
13. **操作紀錄**：沿用請款單事件（`ga_payment_request_events`，不可修改刪除）；事件類型 CHECK 超集加入 `prepay_refund`；核銷、回復寫在帳本，並在對應請款單與採購單事件備註一行。

### 3.4 狀態與核銷回復對照

| 預付單動作 | 帳本影響 | 其他影響 |
|---|---|---|
| 建立（DRAFT） | 無 | 佔用上限額度（P） |
| 送出（SUBMITTED） | 依既有進貨補核銷；之後到貨自動核銷 | 出現在「待付款請款單」 |
| 標已付款（PAID） | 不變 | 鎖定，只能備註與作廢 |
| 退回（→DRAFT） | 全部回復 | 待請款提醒回來 |
| 作廢（→VOID） | 全部回復、釋放上限額度 | 已付款者事件註記需追回 |
| 登記退款 | 新增 REFUND | 餘額減少 |

### 3.5 函式與介面改動

- 資料庫：新增 `ga_pay_po_offset(po)`、`ga_pay_prepay_balance(pr)`、`ga_pay_prepay_apply(po, receipt)`、`ga_pay_prepay_release(pr)`、`ga_ws_pay_prepay_create(payload,key)`（建立預付單，不放在 `ga_ws_pay_request_create` 以免改動其 payload 驗證與既有測試）、`ga_ws_pay_prepay_settle`、`ga_ws_pay_prepay_overview(po)`（採購單頁的預付摘要）。
- 加掛（文字替換）：`ga_pay_po_claimed`（`p_status IS NULL` 時回傳 N＋O，舊資料 O＝0 所以逐位相同）、`ga_pay_apply_lines`（預設金額扣核銷、寫 `prepay_offset`、差異比較）、`ga_pay_check_live`（`PREPAY_CHANGED`）、`ga_ws_pay_request_action`（submit 略過 PREPAY 的明細檢查；submit／return／void 呼叫帳本補核銷與回復）、`ga_ws_po_receive`（結尾呼叫核銷）、`ga_ws_po_receipt_void`（回復核銷）、`ga_ws_po_action`（結案守門）、`ga_pay_unclaimed_po_ids` 與 `ga_pay_po_amounts`（待請款計算改用 N＋O）、`ga_ws_pay_request_list`（`prepay_overdue` 篩選、`pay_kind` 欄位）、`ga_ws_po_list`（`prepaid` 篩選）、`ga_ws_pay_export`（預付列）。
- API：新增 `POST /api/workspace/general-affairs/payment-requests/prepay`（建立）、`POST …/payment-requests/:id/prepay-refund`；請款單列表與詳情 JSON 加 `pay_kind`、`prepay_po`（採購單號）、`prepay_balance`、`prepay_overdue`。
- 純函式（`payment-request-rules.ts` 新增匯出）：`PR_KINDS`、`PR_KIND_LABELS`（一般／預付）、`prepayCap(T, N, P, tol)`、`prepayOffsetFor(receiptTotal, receiptClaimedAndOffset, balance)`、`prepayOverdue(po, balance, today)`。
- 畫面：`PurchaseOrders.vue`／`PoDetailDialog.vue`／`PoPaymentPanel.vue` 在已下訂的採購單加「新增預付請款」按鈕與「預付摘要」（已預付、已核銷、餘額、退款）；`PaymentRequestEdit.vue` 預付單用簡化表單（採購單固定、金額、預計付款日、備註）；`PaymentRequests.vue` 加「類型」欄（一般／預付）與篩選；`PaymentRequestPrint.vue` 預付單標題加「（預付款）」並列出採購單號。

## 4. G2 含稅單價

### 4.1 資料模型

`ga_purchase_orders` 新增：`price_mode text NOT NULL DEFAULT 'EXCL' CHECK IN ('EXCL','INCL')`。下訂後與稅率快照一樣鎖定（`ga_po_header_apply` 在非草稿時不接受修改，沿用既有「下訂鎖」）。

`ga_purchase_order_items` 新增：`unit_price_gross numeric(14,4) NULL`（含稅單價，僅 INCL 使用）、`line_gross numeric(14,0) NULL`（含稅品項金額）。INCL 時 `unit_price`（未稅單價）＝`round(unit_price_gross÷(1＋稅率),4)`、`line_amount`（未稅品項金額）＝`round(line_gross÷(1＋稅率))`，**這兩欄僅供顯示與歷史價比較，不參與總額計算**（總額以含稅為準，見 §2.1）。

`ga_purchase_receipt_items` 新增：`amount_gross numeric(14,0) NULL`（INCL 進貨品項含稅金額，EXCL 為 NULL）。

### 4.2 計算位置

- `ga_po_items_apply`：INCL 模式輸入欄位 `unit_price` 解釋為含稅單價，存 `unit_price_gross`，推算未稅欄位。EXCL 行為不變。
- `ga_po_refresh_totals`：INCL 走含稅總額反推分支；EXCL 走現行分支加上調整列加總。總額必須大於或等於 0（折扣超過品項金額回 `PO_TOTAL_NEGATIVE`，400，「折扣與折抵超過品項金額，請調整」）。核准門檻仍比較含稅總額（含調整列）。
- `ga_pay_freeze_receipt_item_amount`（觸發器）：INCL 時 `amount_gross＝round(驗入量×含稅單價)`、`amount_untaxed＝round(amount_gross÷(1＋稅率))`；EXCL 完全走原式。
- `ga_pay_receipt_untaxed`／`ga_pay_receipt_total`／`ga_pay_po_received`：新增 `ga_pay_receipt_tax(receipt)`（EXCL＝`round(未稅×稅率)`，INCL＝含稅額－未稅），三個函式 EXCL 分支與原式相同；INCL 分支以含稅額為準。`ga_pay_apply_lines` 的預設稅額改呼叫 `ga_pay_receipt_tax`／上述拆稅規則。
- 前端 `computeTotals`（`purchase-order-rules.ts`）新增 `computeTotalsV2({items, adjustments, tax_rate, price_mode})`，與資料庫逐條對齊，單元測試比對；舊 `computeTotals` 保留不動。

### 4.3 發票與請款對得上

- 三聯式／電子發票金額輸入維持：未稅、稅額、含稅；進貨單分攤預設用進貨單未稅與稅額（含稅模式＝上式拆法），所以含稅採購單的發票通常在尾差內吻合。
- 三聯式發票統編核對：由「等於設定買受人統編」改為「等於任一啟用中的買受人公司統編」（只有一家公司時行為不變），見 §7。
- 請款預設金額、列印、CSV 的未稅／稅額／含稅一律來自請款單與明細快照，不重算。

### 4.4 畫面

`PurchaseOrderEdit.vue`：表頭加「單價」選項（單價未稅／單價含稅，預設未稅）；品項欄位標題隨之顯示「單價（未稅）」或「單價（含稅）」；合計列顯示「含稅總額（輸入合計）／未稅小計／稅額」；切換計價模式時，已輸入的單價保留數字不換算，並提示「切換後單價意義改變，請確認金額」。唯讀頁與列印同步顯示模式。價格歷史（`ga_ws_po_price_history`）一律比較未稅單價，含稅採購單顯示推算未稅單價並標註「含稅單價 NT$x」。

## 5. G3 調整列（運費、折扣、折價券、點數）

### 5.1 資料模型

新表 `ga_purchase_order_adjustments`：

| 欄位 | 說明 |
|---|---|
| `id`、`po_id`（→ `ga_purchase_orders` ON DELETE CASCADE）、`line_no` | 每張採購單最多 10 列 |
| `kind` | 'FREIGHT' 運費、'DISCOUNT' 折扣、'COUPON' 折價券、'POINTS' 點數折抵、'OTHER' 其他 |
| `label` | 顯示名稱，≤ 60 字 |
| `amount` | 整數元、不得為 0；FREIGHT 必須為正，DISCOUNT／COUPON／POINTS 必須為負，OTHER 正負皆可；金額意義跟採購單計價模式（含稅模式＝含稅金額，未稅模式＝未稅金額） |
| `original_price` | 原價（選填，僅供備註） |
| `campaign_name` | 活動名稱（選填，≤ 100 字） |
| `note` | 備註（選填，≤ 200 字） |

RLS 與 `ga_purchase_orders` 相同（不開放直接讀寫）。調整列隨採購單「核准並下訂」鎖定（與品項相同；之後不能增刪改）——要補運費等情況見疑義 Q6。

### 5.2 計算與流向

1. **採購單總額**：見 §2.1，調整列加進小計（未稅模式）或含稅合計（含稅模式）。調整列計入核准門檻比較。
2. **進貨**：調整列併入「承接進貨單」。承接規則：同一張採購單中，第一張「未作廢，且該單品項含稅額加上全部調整列金額大於 0」的進貨單承接**全部**調整列。寫入新表 `ga_purchase_receipt_adjustments`（`receipt_id`、`po_adjustment_id`、`amount`、`created_at`；進貨時凍結，與 `amount_untaxed` 凍結同做法）。進貨單含稅額＝品項含稅額＋承接調整列加總。進貨單未稅／稅額依 §2.1（未稅模式：調整列金額併入未稅；含稅模式：併入含稅額後反推）。
3. **作廢承接進貨單**：調整列轉給下一張符合條件的進貨單；沒有則釋放（之後新進貨依同規則承接）。承接進貨單若已被有效請款單引用本來就不能作廢（既有規則）。
4. **發票比對與請款金額**：因為調整列包在進貨單金額裡，進貨單預設請款額＝含調整後的進貨單含稅額（扣預付核銷）；發票分攤預設也是含調整後金額。運費若廠商另開發票，使用者自行把兩張發票連到同一張進貨單（現行即支援一單多票）。
5. **上限檢查**：累計驗入含稅額（`OVER_CLAIM`）已含調整列；採購單總額上限（`OVER_PO_TOTAL`）用含調整列的 `total_amount`。
6. **庫存成本**：運費、折扣**不攤入**庫存單位成本（維持品項單價推算成本，`ga_ws_po_receive` 既有算式不動）。若老闆要攤入，見疑義 Q7。
7. **稅務處理預設**：所有調整列都納入稅基（運費要稅、折扣降低稅基），使請款總額與廠商實開發票一致；折價券／點數若廠商發票不降稅基，會造成稅額差 1 至 數元，由尾差與「差異原因」吸收，見疑義 Q5。

### 5.3 函式與畫面

- 資料庫：`ga_po_adjustments_apply(po, jsonb)`（驗證、整批取代、僅草稿可改）、擴充 `ga_po_data`（回 `adjustments`）、`ga_ws_po_create`／`ga_ws_po_update` 接受 `adjustments` 陣列（新 key，缺省視為不動）、`ga_po_header_apply` 接受 `price_mode`、`buyer_company_id`；`ga_ws_po_receive` 結尾呼叫承接；`ga_ws_po_receipt_void` 呼叫轉移；`ga_pay_receipt_*` 計入承接額。
- 純函式：`ADJ_KINDS`、`ADJ_KIND_LABELS`、`validateAdjustments(raw, priceMode)`、`adjustmentSignOk(kind, amount)`、`carrierReceiptIndex(receipts)`（承接進貨單判斷，單元測試對照資料庫）。
- 畫面：`PurchaseOrderEdit.vue` 在品項下方加「調整列」區塊（新增運費、折扣、折價券、點數折抵、其他；每列金額、原價、活動名稱、備註；折扣類輸入正數，系統自動轉負並顯示負號）；合計列顯示調整後的總額；`PoDetailDialog.vue` 顯示調整列與「已併入進貨單 RC-xxx」；進貨驗入視窗在承接進貨時提示「本次進貨單會併入調整列：運費 +100、折扣 -200」。

## 6. G4 付款方式與同仁代墊

### 6.1 付款方式

- `pay_method` CHECK 超集：TRANSFER、CASH、CHECK、**CREDIT_CARD**、**ONLINE_PLATFORM**。標籤：轉帳、現金、支票、信用卡、網購平台／第三方支付。`payment-request-rules.ts` 的 `PAY_METHODS`、`PAY_METHOD_LABELS`、`validateActionPayload('mark_paid')` 同步；資料庫 `ga_ws_pay_request_action` 的 mark_paid 方法清單用文字替換加兩個值。
- 新欄位：`pay_card_last4 text NULL`（CHECK `~ '^[0-9]{4}$'`，僅 CREDIT_CARD 可填，選填）、`pay_platform text NULL`（≤ 40 字，僅 ONLINE_PLATFORM 可填，如蝦皮、PChome；訂單編號沿用 `paid_ref`）。標已付款的 payload 新增 `card_last4`、`platform`（驗證：方法不符卻帶值回 `PAY_FIELD_MISMATCH`）。
- 不收完整卡號（只收末四碼），符合個資最小化；事件 payload 不含卡號以外資料。
- **代墊同仁的標已付款**：付款對象為同仁時只允許 TRANSFER、CASH、CHECK（公司還錢給同仁，不可選信用卡或網購平台）。

### 6.2 同仁代墊

**請款單欄位**（`ga_payment_requests` 新增，皆有預設）：

| 欄位 | 說明 |
|---|---|
| `payee_type` | text NOT NULL DEFAULT 'VENDOR'，CHECK IN ('VENDOR','EMPLOYEE') |
| `payee_profile_id` | uuid NULL → `profiles(id)`，EMPLOYEE 必填 |
| `payee_name_snapshot` | 同仁姓名與員工編號快照 |
| `payee_account_snapshot` | jsonb NOT NULL DEFAULT '{}'，同仁匯款帳戶快照（銀行、分行、帳號、戶名），結構同廠商 `bank_snapshot` |

廠商仍記在 `vendor_id`、`vendor_name_snapshot`（採購單廠商；水電單為繳費單位）。`bank_snapshot` 在 EMPLOYEE 時**保留廠商帳戶快照不動**（對帳與追溯用），付款對象的帳戶走 `payee_account_snapshot`，兩者分開，現有遮蔽與快照邏輯完全不用改。CHECK：EMPLOYEE 時 `payee_profile_id` 必填、VENDOR 時為 NULL。

**同仁帳戶表**（新）：

- `ga_employee_payout_accounts`：`profile_id` PK → `profiles`；`bank_name`、`bank_branch`、`bank_account`、`bank_account_name`；`updated_by`、`updated_at`。RLS 開啟、無政策、收回直接權限。
- `ga_employee_payout_account_events`（不可修改刪除，仿 `ga_vendor_bank_events`）：誰在何時改了哪些欄位；**事件內容不含帳號本文**，只記「哪些欄位變了」與末四碼。
- RPC：`ga_ws_payout_account_get_own()`／`ga_ws_payout_account_set_own(payload)`（任何登入者，只能讀寫自己）；`ga_ws_payout_account_get_for(profile)`／`ga_ws_payout_account_set_for(profile, payload)`（需請款管理**且**廠商帳務檢視權限，即現行 `ga_pay_can_vendor`；會計代同仁登錄用）。
- **遮蔽原則**（沿用既有個資／帳務遮蔽）：沒有廠商帳務檢視權限者，請款單 JSON 的 `payee_account_snapshot` 回 `{}` 並加 `payee_account_masked: true`，只露 `account_last4`；同仁本人看自己的完整帳戶（`payee_profile_id＝auth.uid()`）；請款單列表、CSV 的同仁帳戶欄位遵守同一判斷（沒有權限整欄省略）；匯款帳號在畫面與 CSV 以文字格式輸出（沿用 `csvTextCell`）。
- 事先不存在帳戶時：可以建立草稿；**送出時必須有帳戶快照**（否則回 `PAYEE_NO_ACCOUNT`，403 以外的 409，「這位同仁還沒有登錄匯款帳戶，請同仁到「我的代墊款」登錄，或由會計代為登錄」）。`refresh_bank` 動作對 EMPLOYEE 重抓同仁帳戶（草稿限定，與現行廠商相同）。

**同仁挑選**：`ga_ws_pay_employee_options(q, page)`（需請款管理）回 id、姓名、員工編號、部門、`has_account`（是否已登錄，不含帳戶內容）；排除已離職者（以 m9 員工管理的在職狀態欄位為準，實作時以唯讀查詢確認欄位名稱）。

**規則**：

1. 採購請款單與水電請款單都可選付款對象（草稿階段可改，送出後鎖定，納入既有守門觸發器 `ga_pay_request_guard` 的鎖定欄位清單，用新觸發器 `ga_pay_payee_guard` 另管，不改舊觸發器）。
2. EMPLOYEE 請款單送出後，「標已付款」的人**不可以就是付款對象本人**（`SELF_PAYEE`，403，「不能自己核付自己的代墊款，請其他同仁處理」）；其他既有「申請人可自己標已付款」規則（P4）不變。
3. 水電請款單選同仁代墊：`vendor_id` 仍是繳費單位、帳單明細與自動標已繳行為不變（同仁先繳了，帳單送出即標已繳；請款單金額＝還給同仁的金額）。
4. 預付單可以選代墊嗎？可以（同仁先替公司預付訂金）。核銷、回復規則同 §3。
5. 同仁代墊與信用卡／網購不互斥的情境（同仁用個人信用卡網購）：付款對象選同仁，付款方式是公司還錢給同仁的方式（轉帳等），不另記同仁當時刷哪張卡；需要記備註即可。

**我的代墊款（同仁自助）**：新頁 `MyReimbursements.vue`（路徑 `/general-affairs/my-reimbursements`，頁面 kind `ga-my-reimbursements`，任何登入者可進，不要求總務權限）：上方「我的匯款帳戶」（登錄、修改、只露末四碼確認）；下方「我的代墊款」清單（請款單號、日期、廠商名稱、金額、狀態、付款日），RPC `ga_ws_pay_my_reimbursements(page)` 只回 `payee_profile_id＝auth.uid()` 的列、不含廠商帳戶與統編、草稿不顯示（同仁只看已送出與之後）。導覽放在總務選單最下方「我的代墊款」，總務角色以外的人需要入口時由個人頁連結帶入（疑義 Q8）。

### 6.3 列表、列印與 CSV

- 列表新增「付款對象」欄（廠商名／同仁姓名）與篩選 `payee_type`；詳情與列印顯示「付款對象」，EMPLOYEE 時標示「同仁代墊」並顯示同仁姓名與員編，帳戶資訊依遮蔽規則。
- CSV：預設欄位與順序**完全不動**；新增 `extended=1` 參數（畫面的匯出按鈕帶此參數）才追加欄位：類型（一般／預付）、付款對象類型、付款對象、抬頭、信用卡末四碼、平台。既有測試不帶參數所以不受影響。

## 7. G11 多家買受人公司

### 7.1 資料模型

新表 `ga_buyer_companies`：`id`、`name`（≤ 100，必填）、`tax_id`（8 碼數字，必填）、`is_default boolean NOT NULL DEFAULT false`、`is_active boolean NOT NULL DEFAULT true`、`sort_order`、`created_by／at`、`updated_by／at`；唯一約束：統編不重複（啟用中）、**預設公司至多一家**（`UNIQUE (is_default) WHERE is_default AND is_active`）。RLS 開啟無政策，RPC 存取。事件表 `ga_buyer_company_events`（新增、改名、停用、改預設；不可修改刪除）。

引用欄位：`ga_purchase_orders.buyer_company_id uuid NULL`、`ga_payment_requests.buyer_company_id uuid NULL`、`buyer_title_snapshot text NULL`、`buyer_tax_id_snapshot text NULL`。

### 7.2 搬移與相容

- **搬移**：套用 SQL 時，若 `pay_buyer_title` 與 `pay_buyer_tax_id` 有值（統編為 8 碼），建立一家公司並設為預設；只有其中之一有值或統編格式不符則不搬移並在 verify 提示（疑義 Q9）。DEV 目前這兩個鍵不存在（無設定），所以 DEV 搬移是空操作，測試自己建假公司。
- **相容**：`ga_ws_pay_settings_get` 的 `buyer_title`／`buyer_tax_id` 回傳「預設公司」的值（沒有預設公司時回原鍵值，再沒有回 null），既有測試與列印 fallback 不變；`ga_ws_pay_settings_set` 帶 `buyer_title`／`buyer_tax_id` 時改為「更新預設公司（沒有就建立並設預設）」同時寫回原兩個鍵（雙寫，供舊版 UI 與回退）。
- **採購單**：草稿可選公司，預設＝預設公司；下訂後鎖定。**請款單**：草稿可選公司，建立時預設取第一條明細的採購單公司（水電單、預付單取其採購單或預設公司），沒有則取預設公司，都沒有則為空（列印沿用 fallback）；**送出時凍結快照** `buyer_title_snapshot`／`buyer_tax_id_snapshot`（寫入當下公司名稱與統編，之後公司改名不影響已送出請款單）。草稿階段列印跟隨目前選擇。
- **列印**：`PaymentRequestPrint.vue` 的抬頭與統編依序用請款單快照→請款單選的公司→設定值（舊單 fallback，行為同現在）。
- **發票統編核對**：三聯式發票買受人統編可為任一啟用中公司統編；預設值取請款單／採購單所選公司，沒有就用預設公司。

### 7.3 權限與介面

- 公司清單的讀取：請款檢視或管理、採購單檢視／管理者（下拉選單需要）可讀名稱與統編；新增、修改、停用、改預設需請款管理（與現行「調整尾差與買受人設定」相同）。不新增權限碼。
- RPC：`ga_ws_buyer_company_list()`、`ga_ws_buyer_company_save(payload, key, expected_updated_at)`、`ga_ws_buyer_company_set_default(id)`、`ga_ws_buyer_company_deactivate(id)`（有採購單或請款單引用時只能停用不能刪除；停用的公司在既有單據仍顯示）。
- 畫面：`PaymentSettingsDialog.vue` 的「買受人抬頭／統編」兩欄改為「買受人公司」清單（新增、編輯、設為預設、停用）；`PurchaseOrderEdit.vue` 與 `PaymentRequestEdit.vue` 表頭加「買受人抬頭」下拉；測試區一律用假公司名（如「富康測試公司甲」，統編用測試專用 8 碼）。

## 8. 權限

- **不新增任何權限碼，不授權給任何角色**。預付、代墊、公司設定、同仁帳戶代登錄皆用既有碼：
  - 建立與修改預付單、代墊請款單、登記退款：`general_affairs.purchase_payment.manage`（請款管理）＋能看採購單（`ga_po_can_view`，與現行請款建立相同）；水電請款單加代墊仍需再加 `general_affairs.utility_bill.manage`（與 G46 相同，缺一不可）。
  - 讀取同仁帳戶本文與代登錄：請款管理＋廠商帳務檢視（`ga_pay_can_vendor`）；同仁本人讀寫自己的帳戶：登入即可。
  - 買受人公司：讀＝請款檢視／管理或採購檢視／管理；寫＝請款管理。
  - 採購單計價模式與調整列：沿用採購單編輯權限（採購評估管理、庫存交易管理、料件查看，`ga_po_perm_error`）。
- 語意一律 `has_permission(auth.uid(), …)`；資料庫不放行 admin；應用層 `profiles.role==='admin'` 後援維持現行（不放行請款入口與寫入）。
- 核准規則不變：採購單含稅總額（含調整列）大於門檻仍需核准，核准人不可是開單人或最後送核准者。
- 若老闆日後要求同仁帳戶用獨立權限碼控管，屬疑義 Q4（預設沿用廠商帳務檢視）。

## 9. G12 權限顯示名稱

- 範圍：`水電網費管理` → `水電話網費管理`。**權限碼 `general_affairs.utility_bill.manage` 不變**。只改顯示字串：`lib/workspace/general-affairs/`（`access.ts` 註解不算、`payment-requests.ts`、`utility-bills.ts`、`utility-payment-rules.ts`、`attachments.ts` 的錯誤訊息）、`vue-workspace/src/pages/ga/PaymentRequests.vue`、`vue-workspace/src/components/ga/UtilityPayeeBackfill.vue`，以及資料庫函式中的白話錯誤訊息（`ga_ub_can_manage` 相關的 403 訊息，DEV 以文字替換、正式區草稿同步）。
- 集中成常數：新增 `UTILITY_BILL_MANAGE_LABEL = "水電話網費管理"`（`utility-bill-rules.ts`），所有 TS 與 Vue 訊息改用常數，避免再次散落。
- **既有測試**：下列檔案有「水電網費管理」斷言，字串因本規格必然改變，需在同一個 commit 改為新名稱（這是老闆明定的改名，不算改壞斷言）：`tests/integration/G46.api.utility-payment-api.spec.ts`、`tests/integration/G46.db-core.create-submit.spec.ts`（2 處）、`tests/smoke/G46.pages.spec.ts`、`tests/unit/G46/utility-payment-rules.test.ts`（4 處）、`tests/integration/G45-db.payment-requests-rpc.spec.ts`、`tests/parity/G23.ga-utility-bills.spec.ts`（註解）、`tests/support/m7m8-ga45-fixtures.ts`（註解）。除這些字串外，不得改動任何斷言。階段 0 另用 `grep` 全面盤點一次（含 `public/workspace` 打包輸出不用手改，重建同步即可）。
- **permissions 表**：DEV 的 `permissions` 沒有名稱欄位，description 也不含「水電網費管理」字樣，「顯示名稱」實際來自權限勾選頁／角色矩陣的標籤來源。階段 0 以唯讀方式確認該頁的標籤來源（程式常數或資料庫欄位）：若在程式內，隨本批改；若在正式區 `permissions` 有名稱欄位或 description 帶舊名稱，正式區草稿 `06-permission-label` 以「只更新含舊名稱的列、可重複執行、附 rollback」處理（見 §12）。見疑義 Q10。

## 10. 兩個小錯字

1. `vue-workspace/src/components/ga/RequestDetail.vue` 第 105 行：`notice.value = \`${ACTION_TITLE[a]}完成。\``。「確認完成」本身已含「完成」造成「確認完成完成。」。改為輔助函式 `doneNotice(a)`：標題已以「完成」結尾時只加句號（「確認完成。」），其餘維持「xxx完成。」（例如「受理完成。」）。同時盤點 `ACTION_TITLE` 其他以「完成」結尾的標題（目前只有 `confirm_complete`）。測試：單元測試 `doneNotice`；e2e 店長確認流程斷言「確認完成。」且不含「完成完成」。parity：若舊版比對到此提示文字，加 allowlist 與 plain 條目。
2. `vue-workspace/src/components/ga/PoDetailDialog.vue` 第 212 行：「登錄憑證」按鈕條件改為：`canPayManage && showPay && !r.voided_at && r.voucher_status !== 'LINKED' && !r.has_paid_claim`。`r.voucher_status` 已在進貨單資料（`ga_po_receipt_data` 回傳進貨單欄位，階段 0 確認；若未回傳則由 `ga_po_receipt_data` 加 `voucher_status` 與 `claim_status`，純新增 key）。與 `PoPaymentPanel.vue` 第 104 行的判斷口徑一致（該處已排除 LINKED）。「已付款」指該進貨單被已付款請款單引用，或有預付核銷且對應預付單已付款。測試：e2e 於已連結發票的進貨單與已付款請款的進貨單，確認 `reg-voucher-RC…` 按鈕不存在；未連結的仍存在。

## 11. 對既有資料與既有測試的零影響清單

| 風險點 | 做法 | 驗證 |
|---|---|---|
| 既有採購單總額被新公式改動 | `price_mode` 預設 EXCL；無調整列時 `ga_po_refresh_totals` 結果與原式逐位相同 | 黃金比對、單元測試新舊公式對照表（1000 組隨機品項） |
| 進貨明細金額 | 觸發器 EXCL 分支同原式；`amount_gross` 為 NULL | 既有 G24／G45 測試 |
| 累計請款上限 | `ga_pay_po_claimed` 的 O 在沒有預付時為 0 | G45、G46 黃金比對 |
| 請款單 JSON／CSV | 只加 key；CSV 預設欄位不動，新欄位需 `extended=1` | G45 匯出測試不改 |
| `pay_method` 與事件類型 CHECK | 超集 | 既有付款測試 |
| 狀態機 | 不新增狀態、不新增 `PR_ACTIONS`（退款走獨立 RPC） | `payment-request-rules` 單元測試不改 |
| 首頁待辦項目數量 | 不新增項目 | `home-rules` 與 G22–G24 測試不改 |
| 買受人設定 | 原三個鍵保留並雙寫；`settings_get` 回預設公司值 | `ga_ws_pay_settings_get` 黃金比對 |
| 發票統編核對 | 單一公司時行為相同 | G45 發票測試 |
| 水電請款（G46） | 水電單加掛只在 `payee_type='EMPLOYEE'` 才走新分支 | G46 全部測試與黃金比對 |
| 權限名稱 | 只改字串與常數 | §9 清單 |

## 12. 正式區草稿清單（`docs/vue-workspace/parity-plan/ga-improve-b1-sql/`）

先決：正式區已套用水電請款（G46）草稿 `ga-utility-payment-sql/01～05`；**不併入 12/8 切換當晚步驟**。每份附 `.rollback.sql`（只還原本批新增物件與加掛）與只有 SELECT 的 `.verify.sql`，可重複執行，不新增權限碼、不授權給任何角色。

| 檔案 | 內容 | 對應 DEV 檔 |
|---|---|---|
| `00-preview-before-apply.sql` | 只讀：目前採購單／進貨／請款筆數、設定鍵 `pay_buyer_*` 現值、`pay_method` 與事件 CHECK 定義、各被加掛函式的現行定義雜湊、permissions 欄位清單與含舊名稱列 | — |
| `01-ga-improve-b1-buyer-companies.sql` | G11：公司表、事件表、引用欄位、設定搬移、設定讀寫相容函式 | `20261125100000_ga_improve_b1_buyer_companies.sql` |
| `02-ga-improve-b1-po-tax-adjust.sql` | G2、G3：計價模式、含稅欄位、調整列表、進貨承接表、總額與進貨函式加掛 | `20261125110000_ga_improve_b1_po_tax_adjust.sql` |
| `03-ga-improve-b1-pay-methods-payee.sql` | G4：付款方式 CHECK、卡號末四碼、平台、代墊欄位、員工帳戶表與 RPC、守門觸發器 | `20261125120000_ga_improve_b1_pay_methods_payee.sql` |
| `04-ga-improve-b1-prepay.sql` | G1：預付欄位、帳本、核銷與回復、結案守門、逾期篩選、待請款改用 N＋O | `20261125130000_ga_improve_b1_prepay.sql` |
| `05-ga-improve-b1-permission-label.sql` | G12：只在 permissions 有名稱欄位或 description 含舊名稱時更新（階段 0 結論決定要不要放；不放就留 `.verify.sql` 只讀） | — |
| `README.md` | 套用順序、前置條件、每份的風險、回復順序（倒序）、驗證步驟、與 G46 草稿的相依 | — |

DEV 另有 `20261125140000_ga_improve_b1_dev_seed.sql`（測試用假公司、同仁、`ga_dev_cleanup_ga_improve_b1(p_marker text DEFAULT 'QA-GAIB1-%')` 清除函式，只清自己建立的資料；正式區不放）。

## 13. 測試計畫

測試資料只放 VW／ZT 測試門市、年份 2038，標記 `QA-GAIB1-`；只清自己建立的資料；全部循序執行；不用 pkill，要停只用 PID；`run-all` 不包 timeout；vitest 用 PowerShell 大寫 `F:\` 路徑；playwright 只能從 repo 目錄解析；3002 埠已有測試站就沿用，重建前端後同步到 `public/workspace`。

### 13.1 單元測試（`tests/unit/GAIB1/`）

- 金額：`computeTotalsV2`（未稅、含稅、有無調整列、負數進位 -2.5→-3、折扣超過品項、1 元尾差情境）；含稅反推與稅額用減法；進貨單稅額 EXCL／INCL 兩分支；請款預設金額與預付扣除拆稅。
- 預付：`prepayCap`、`prepayOffsetFor`、`prepayOverdue`、餘額計算（含退款與回復）。
- 調整列：`validateAdjustments`（正負號依種類、上限 10 列、金額為 0）、`carrierReceiptIndex`。
- 付款方式與代墊：`validateActionPayload` 新方法與末四碼／平台欄位互斥、代墊限制方法、`SELF_PAYEE`、遮蔽函式、CSV `extended` 欄位與預設欄位不變。
- 買受人：統編驗證、預設唯一、抬頭解析順序（快照→所選→設定）。
- 小錯字：`doneNotice`。
- SQL 文字比對：新舊函式加掛處的樣式比對（仿既有 home-rules 單元測試比對 SQL 內容）。

### 13.2 整合測試（`tests/integration/GAIB1.*`，DEV 資料庫與 API）

- 黃金：階段 0 錄的黃金檔在每階段後逐位比對（採購、進貨、發票、請款、水電、設定、首頁計數）。
- G2／G3：含稅採購單建立→核准→下訂→進貨→發票→請款，金額逐步對帳（含稅總額＝輸入合計；進貨單稅額＝總額－未稅；請款預設額＝進貨單含稅額）；調整列承接（單次進貨、分批進貨、第一張進貨被作廢後轉移、折扣大於第一批品項額時延後承接）；`OVER_CLAIM`／`OVER_PO_TOTAL` 邊界含尾差。
- G1：預付建立限制（未下訂、已全收、超額）；送出→進貨自動核銷；預付晚於進貨補核銷；退回與作廢回復；作廢進貨回復；一般請款預設扣除與 `prepay_offset`、`PREPAY_CHANGED`；登記退款；結案守門 `PREPAY_BALANCE_OPEN`；逾期篩選；併發（兩人同時預付同一採購單、進貨與預付送出同時發生，沿用 `ga_pay_lock_po` 採購單鎖）；冪等鍵。
- G4：新付款方式與欄位驗證；代墊建立、改付款對象、送出需帳戶、遮蔽（無帳務權限者看不到本文、同仁本人看得到自己）、`SELF_PAYEE`、水電單代墊（帳單自動標已繳照常、退回作廢回復照常）、帳戶變更事件不含帳號本文、同仁自助 RPC 只回自己的資料。
- G11：搬移既有設定、雙寫相容、預設唯一、停用不影響既有單、送出凍結快照、列印抬頭 API、發票統編核對多公司。
- 權限矩陣：每個新 RPC 對「無權限、只有檢視、有管理、缺水電管理、admin 應用層」逐一驗證 403 與訊息（使用 DEV 臨時測試角色，角色代碼先查 role-matrix 避免撞名，事後清除）。
- 回歸：G22–G25、G45 全系列、G46 全系列原樣重跑，不得修改斷言（除 §9 字串）。

### 13.3 e2e 多角色劇本（Playwright，`tests/e2e/GAIB1.*`）

沿用印表機劇本（`tests/reports/_shots_ga_journey/report.md`）的做法，每個劇本走到結案並留截圖、記錄 console 錯誤與版面溢出（桌面 1440 與手機 390）。

1. **預付款接力**：總務建立含稅採購單（含運費與折價券）→ 主管核准（高於門檻）→ 總務下訂 → 總務開預付單並送出 → 會計標已付款 → 到貨驗入（確認自動核銷、承接調整列）→ 總務登錄發票、開一般請款（確認預設額為差額）→ 會計付清 → 採購單結案；另一支路徑：逾期未到貨提醒出現在首頁／列表，退回預付單後核銷回復。
2. **同仁代墊採購**：店長端不需要；總務為採購單開代墊請款單、選同仁 A（尚無帳戶）→ 送出被擋並提示 → 同仁 A 在「我的代墊款」登錄帳戶 → 總務重抓帳戶、送出 → 會計（有帳務權限）看到帳戶、同仁 A 本人只看到自己的單 → 會計標已付款（轉帳）→ 同仁 A 看到已付款；另測會計即同仁本人時不能核付自己的單（`SELF_PAYEE`）。
3. **同仁代墊水電**：水電管理＋請款管理的總務為門市先繳的帳單建立水電請款單、付款對象選同仁 B → 帳單自動標已繳 → 會計付款；退回與作廢時帳單回復（沿用 G46 行為）。
4. **付款方式與多公司抬頭**：總務在設定新增兩家假公司、指定預設 → 採購單與請款單各選不同抬頭 → 會計標已付款選信用卡（末四碼）與網購平台 → 列印預覽確認所選抬頭、對帳 CSV（extended）含新欄位。
5. **小錯字**：店長確認完成後提示為「確認完成。」；已連結發票與已付款進貨單不顯示「登錄憑證」。
6. **既有劇本回歸**：印表機採購劇本、水電請款劇本（`10404759`）原樣重跑。

### 13.4 角色與帳號

總務（請款管理＋採購管理）、會計（請款管理＋廠商帳務檢視）、主管（採購核准）、水電管理員、代墊同仁 A／B（僅登入，無總務權限）、只有請款檢視者、無權限者。使用 DEV 既有測試角色與 `m7m8-ga45-fixtures` 的臨時帳號機制，新增角色代碼先對照 role-matrix 與 roles 表避免撞名，並於結束後移除（rollback 不得刪到既有成員）。

## 14. 分階段實作順序

每階段結束條件：DEV SQL 與 rollback 已驗證可往返、黃金比對通過、單元與整合測試循序全過、前端重建並同步到 `public/workspace`、commit（不 push）。

| 階段 | 內容 | 依賴 |
|---|---|---|
| 0 | 準備：掃描測試中的整物件比對與舊名稱字串；錄黃金檔；確認權限標籤來源、`ga_po_receipt_data` 回傳欄位、員工在職欄位；寫黃金比對腳本 | — |
| 1 | 小錯字（§10）＋ G12 改名（§9）＋常數與測試字串更新 | 0 |
| 2 | G11 多家買受人公司（資料庫、API、設定畫面、採購單與請款單選抬頭、列印、發票統編核對）＋DEV 檔 `…100000` | 0 |
| 3 | G2 含稅單價與 G3 調整列（資料庫、純函式、採購單編輯與詳情、進貨承接、請款預設金額）＋DEV 檔 `…110000` | 2（採購單抬頭欄位同一支函式） |
| 4 | G4 付款方式與同仁代墊（欄位、員工帳戶、遮蔽、我的代墊款頁、請款單編輯與水電請款整合、列印與 CSV extended）＋DEV 檔 `…120000` | 2 |
| 5 | G1 預付款（建立、核銷、回復、退款、守門、逾期提醒、畫面）＋DEV 檔 `…130000` | 3、4 |
| 6 | DEV 測試資料與清除函式 `…140000`；整合測試全套、e2e 多角色劇本、手機與桌面截圖與版面檢查 | 1–5 |
| 7 | 正式區草稿 `ga-improve-b1-sql/`（含 README、rollback、verify）、與 DEV 檔逐行比對；回歸 G22–G25、G45、G46 全系列；文件收尾 | 6 |

## 15. 疑義與預設值（不停下等回答，老闆可事後改）

| 編號 | 疑義 | 預設 | 若老闆不同意 |
|---|---|---|---|
| Q1 | 預付單在「已全收」或已有部分請款的採購單可否建立？ | 只在 ORDERED／PARTIALLY_RECEIVED 且 `P＋N ≤ 含稅總額＋尾差` 可建立 | 放寬或收緊狀態條件，只動一支驗證函式 |
| Q2 | 預付未核銷、採購單要結案怎麼辦？ | 預付餘額大於尾差時擋 cancel／short_close／close，需先「登記退款／轉抵」 | 改為只警告不擋 |
| Q3 | 預付逾期提醒要不要獨立首頁項目？ | 不新增，併入既有「逾期未到貨採購單」並加標籤與請款單篩選，避免改既有項目數量測試 | 新增 `pay_prepay_overdue` 項目，需同步更新 `home-rules` 單元測試與 G22–G24 測試的項目數量斷言（12→13） |
| Q4 | 同仁匯款帳戶用什麼權限看？ | 沿用「廠商帳務檢視」，本人看自己；不新增權限碼 | 新增 `general_affairs.employee_payout.view`（屬新權限碼，需老闆決定授權對象） |
| Q5 | 折價券、點數折抵是否降低稅基？ | 全部納入稅基（與廠商實開發票金額一致），發票若不降稅基以尾差與差異原因吸收 | 調整列加「是否計稅」欄位，不計稅者另列 |
| Q6 | 下訂後才知道的運費怎麼補？ | 調整列隨下訂鎖定，需補時撤回核准或另開採購單 | 開放 ORDERED 後「補運費」專用調整動作（需事件紀錄與重新檢查核准門檻） |
| Q7 | 運費、折扣是否攤入庫存單位成本？ | 不攤入 | 依品項金額比例攤入（影響庫存交易成本計算） |
| Q8 | 「我的代墊款」入口放哪？ | 總務選單最下方，且任何登入者可直接用網址進入；非總務同仁另由個人頁連結導入（實作時確認個人頁位置） | 放在個人頁或員工自助區 |
| Q9 | 既有買受人設定只有抬頭沒有統編（或反之）？ | 不搬移，verify 提示由總務補齊後手動新增公司 | 以空統編建立但標「待補」 |
| Q10 | 「permissions 表名稱」實際指什麼？DEV 表沒有名稱欄位 | 階段 0 唯讀查明標籤來源；DEV 與正式區若只有程式內標籤就只改程式，正式區草稿 05 退化為只有 verify | 老闆指定正式區要改的欄位後再補 SQL |
| Q11 | 代墊請款單的付款人不可是同仁本人 | 是（`SELF_PAYEE`） | 取消限制（沿用 P4 申請人可自己標已付款） |
| Q12 | 同仁沒有登錄帳戶可否送出？ | 不可，送出時要求有帳戶快照 | 允許送出，標已付款（轉帳）時才檢查 |
| Q13 | 付款方式是否也要在草稿先填「預計付款方式」？ | 否，只在標已付款時記錄 | 草稿加預計付款方式欄位（只提示不鎖） |
| Q14 | 含稅切換計價模式時，已填單價是否自動換算？ | 不換算，只提示 | 自動依稅率換算 |
| Q15 | 調整列承接進貨單：第一張「品項額加調整額大於 0」的進貨單承接全部 | 是 | 改為按各進貨單品項金額比例分攤（整數進位尾差放最後一張） |

## 16. 範圍外（這次不做）

第二批 G5 至 G10；工單維修費與需求單報價的請款；舊版（Next.js 舊頁）任何改動；信用卡對帳單匯入；同仁代墊的簽核流程（維持沒有核准關卡）；完整卡號儲存。

## 17. 實作紀錄（資料庫與後端，2026-11-25）與設計的不同處

資料庫與後端已依本設計實作並在 DEV 驗證；畫面（Vue）與 e2e 劇本是下一步。實作與設計不同的地方：

1. **G12 的資料庫部分獨立成階段檔 `20261125090000_ga_improve_b1_perm_label`**（排在 100000 之前）：把函式本體裡的「水電網費管理」換成新名稱；`permissions` 表若有名稱類文字欄位或 description 含舊名稱就只更新含舊名稱的列（DEV 沒有名稱欄位，這一步是空操作）。正式區草稿 `05-ga-improve-b1-permission-label` 與它相同，不是「只有 verify」。畫面標籤來源確認在程式內：新增常數 `UTILITY_BILL_MANAGE_LABEL`。
2. **調整列走表頭 `header.adjustments`**（建立與草稿修改），沒有另開 RPC 參數；缺省代表不動，空陣列代表清空，下訂後與計價方式、買受人抬頭一起鎖定（PO_LOCKED）。
3. **「延伸點函式」**：多個階段要加掛同一個地方（採購單表頭、採購單輸出、進貨登錄、作廢進貨、請款單設定抬頭與付款對象、請款單輸出、列表篩選、匯出）時，每個既有函式只加掛一次、呼叫階段 2 建立的 `ga_ib1_*_ext` 函式，後續階段用 `CREATE OR REPLACE` 重新定義它們；撤回時各階段把它們還原成前一階段的版本。
4. **一般請款單作廢也會觸發補核銷**：預付單若還有餘額、被作廢的一般請款單釋放出的進貨單金額會再由預付餘額核銷（`ga_ib1_prepay_sync` 對一般請款單的作廢也生效）。設計只寫了預付單自己的退回與作廢。
5. **在職判斷**：`profiles` 沒有在職欄位，用 `store_employees`（以員編對應）：有員編且有紀錄時，要有一筆啟用且非離職才算在職；沒有員編或沒有紀錄（總部同仁）視為在職。
6. **對帳匯出 `extended`**：用 `ga_ib1_export_enrich` 包在兩個回傳點（採購與水電），沒帶 `extended` 時原樣回傳；帶了才在每列補類型、付款對象類型、付款對象、抬頭、信用卡末四碼、平台（同仁帳戶銀行與帳號只有廠商帳務檢視者看得到，沒有權限整欄省略），並追加預付單列（預付單沒有明細列）。
7. **付款方式錯誤訊息**：「付款方式只能是轉帳、現金或支票，或是信用卡、網購平台／第三方支付」，保留原句「轉帳、現金或支票」讓既有 G45 單元測試斷言不必修改。
8. **沒有新增 DEV 測試角色**：整合測試沿用既有 DEV 角色與臨時角色（沒有新增角色代碼，所以也沒有撞名風險）；清除函式 `ga_dev_cleanup_ga_improve_b1` 只處理 `QA-GAIB1-` 標記的廠商與公司、以及 `m7m8-test-` 測試帳號的同仁帳戶與事件，採購單與進貨單仍由既有 `cleanupM7M8` 清除。
9. **黃金比對**：`tests/integration/GAIB1.db-golden.regression.spec.ts` 必須在「套用前」錄製（`GAIB1_GOLDEN=capture`）、套用後比對（`compare`）；DEV 已用「全撤回→錄製→全套用→比對」做過，27 組輸出只有首頁摘要與徽章的 `generated_at` 不同。
10. **尚未做（前端與劇本）**：兩個小錯字（`RequestDetail.vue`、`PoDetailDialog.vue`）、所有 Vue 畫面與列印、e2e 多角色劇本與截圖。後端 API 已提供畫面需要的欄位與端點：`/buyer-companies`、`/payee-accounts/own|:profileId`、`/payee-options`、`/my-reimbursements`、`/payment-requests/prepay`、`/payment-requests/prepay/:poId`、`/payment-requests/:id/prepay-refund`、匯出 `extended=1`、採購單與請款單列表新篩選。

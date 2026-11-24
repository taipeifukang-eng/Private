# 水電話費請款設計（水電網費帳單接進請款單）

> 狀態：設計定稿（2026-11-24），尚未動工。老闆問卷 U1 至 U8 已回答，本文件是依這些答案寫的實作設計。
> 範圍：把水電網費帳單（G23，`ga_utility_bills`）接到既有請款單（第 4.5 批，`ga_payment_requests`）。這是新功能，舊版沒有水電請款，所以沒有舊新比對，測試基準是本文件與第 4.5 批設計（`m7m8-batch4-5-design.md`）。
> 第 4.5 批設計 A7 原本寫「水電費請款另批」，現在就是這批。工單維修費、需求單報價的請款不做。
> 實作限制（全批共用）：只連 DEV（`supabase/.temp/project-ref` 以 mjpd 開頭，DB 指令前先確認）；不讀 `.env.local`、`.env.production*`、`*.bak`，不連正式區；不改 `supabase/migrations`；DEV 的 DB 變更放 `supabase/workspace-dev/`（各附 `.rollback.sql`）；正式區草稿放 `docs/vue-workspace/parity-plan/ga-utility-payment-sql/`（各附 `.rollback.sql` 與只有 SELECT 的 `.verify.sql`、可重複執行、**不授權給任何角色**）；測試資料只在 VW／ZT 測試門市、2038 年，標記 `QA-GAUP-`，只清自己的；不 push。
> 權限語意依正式區 `has_permission`：不檢查 `roles.is_active`、資料庫沒有 admin 繞過；應用層 `profiles.role==='admin'` 不放行請款入口與請款寫入（與第 4.5 批相同）。

## 0. 白話摘要（給老闆）

- 請款單多一種「來源」：採購，或水電話費。兩種共用同一個列表、同一套狀態（草稿、送出、已付款，可退回、作廢）、同一個列印與 CSV，用「來源」標籤區分並可篩選。
- 水電請款單只付給一個「公用事業」繳費單位（台電、台水、中華電信這類），而且只含同一個帳單月份。建立時系統自動把該單位該月還沒請款的帳單全部帶進來，總務可以手動拿掉或加回（只能加同單位同月份的）。
- 繳費單位放在既有「廠商資料」，新增一個「公用事業」分類。水電帳單新增「繳費單位」欄位（指向廠商），舊帳單可以補填；沒填繳費單位的帳單不能請款。銀行帳號照舊只有看得到廠商帳務的人才看得到。
- 送出前，每張帳單至少要有一個附件（帳單照片或 PDF），缺的會列出是哪幾張並擋下。
- 請款單上有「送出後帳單自動標記已繳」選項，預設勾選：勾選時，送出當下帳單自動標已繳（繳費日期＝送出日）並記錄是哪張請款單標的；請款單被退回或作廢時，只把「這張請款單自動標的」改回待繳，總務手動標的不動。不勾則帳單維持原狀，由總務確認付款後手動標。會計標已付款不影響帳單。
- 同一張帳單同時只能在一張有效請款單裡；已刪除、已繳、金額有小數或為 0 的帳單不能請款；已送出或已付款請款單內的帳單，金額與繳費單位會鎖住。
- 對現有採購請款零影響：水電明細放在獨立的新資料表，不動採購明細表；對舊函式只做「來源是水電才動作」的最小加掛；上線前後用同一批採購資料比對輸出必須一致。
- 12/8 全面切換後才上線（約 12/15 那週），正式區 SQL 獨立一個資料夾，不併入 12/8 當晚的步驟。

## 1. 現況盤點（已讀程式與資料表）

| 項目 | 現況 | 對本批的影響 |
|---|---|---|
| 請款單主表 `ga_payment_requests` | 狀態 DRAFT／SUBMITTED／PAID／VOID；`vendor_id` 必填；金額三欄 `amount_untaxed + tax_amount = amount_total`（整數）；`pr_no` 為 `PY-YYYYMMDD-NNN`；有狀態機守門觸發器 `ga_pay_request_guard`（非草稿鎖金額、廠商、銀行快照） | 水電請款單重用這張表與號碼、狀態、事件、快照 |
| 請款明細 `ga_payment_request_lines` | `po_id`、`receipt_id` 皆 NOT NULL，`claim_total > 0`；有草稿才能改的守門觸發器；採購額度函式 `ga_pay_po_claimed`、匯出、分析、待請款述詞都靠它與採購單做內連接 | **不放寬這張表**，水電明細另開新表，採購的所有查詢自然看不到水電列 |
| 請款單函式 | `ga_ws_pay_request_create／update／action／get／list`、`ga_ws_pay_export`；動作函式 submit 有「沒有明細不能送出」檢查；事件表 `event_type` 有 CHECK 清單（create、update、submit、return、mark_paid、void、note、refresh_bank），不可改刪 | 水電另寫 create／update；action 只在 submit 的明細檢查多認水電明細；事件類型不新增 |
| 廠商 `ga_vendors` | 分類以 `service_category_ids uuid[]` 存放；分類由總務自建、沒有預置；帳務機密欄位（統編、銀行四欄等）只給 `vendor.view／manage`；`ga_pay_vendor_snapshot` 建立請款單時快照名稱、統編、銀行 | 「公用事業」分類新增一筆；快照函式直接沿用 |
| 水電帳單 `ga_utility_bills` | `amount numeric(12,2)`（可有小數）、`billing_month`（月初日期）、`paid_at date`、`provider_name` 自由文字、`deleted_at` 軟刪除；唯一索引含 `provider_name`；**沒有指向廠商的欄位** | 新增 `payee_vendor_id`、`paid_by_pr_id` |
| 水電帳單寫入 | `ga_ws_ub_save／pay／unpay／delete`（SECURITY DEFINER、`has_permission`）；資料表上的 `ga_utility_bill_before_write` 觸發器要求 `current_user_has_permission(utility_bill.manage)`；標記已繳會檢查「不可未來、不可早於帳單月份前 1 個月」 | 會計退回或作廢請款單時要把帳單改回待繳，但會計沒有水電管理權限，必須讓觸發器在「請款單同步」情境放行；自動標記繳費日期＝送出日，不套用「帳單月份前 1 個月」限制（否則 2038 年測試帳單與未來月份帳單會被擋） |
| 水電附件 | `ga_resource_attachments`，`resource_type='UTILITY_BILL'`、用途 `BILL_DOCUMENT`；讀寫走 `app/api/general-affairs/attachments/route.ts` 的伺服端閘（水電檢視／管理＋帳單未刪除，以 admin client 讀寫）；DB 的 `ga_resource_attachment_can_manage` 已有 UTILITY_BILL 分支（G23 45 號），`can_read` 沒有 | 送出前的「至少一個附件」檢查直接數 `ga_resource_attachments`（未標記刪除）；刪除最後一個附件的守門另開觸發器 |
| 權限 | `utility_bill.view／manage`、`purchase_payment.view／manage`、`vendor.view／manage`；請款入口旗標 `gaPaymentRequests`、`gaPaymentManage`，水電旗標 `gaUtilityBills`、`gaUtilityBillManage`，都用資料庫語意 | **不新增權限碼**（老闆 U7 沿用） |
| 首頁與徽章 | 「待付款」＝全部 SUBMITTED 請款單；「草稿逾 14 天」（F7）＝全部 DRAFT | 水電請款單自然被計入，這是預期行為（見 §9） |
| 列印／CSV | 列印頁是請款單頁籤內的 A4 預覽；CSV `GET payment-requests/export`，預設含已送出＋已付款、防公式注入、5000 筆上限 | 列印與 CSV 依來源切換欄位 |

## 2. 老闆定案規格與實作對照

| 規格 | 內容 | 實作位置 |
|---|---|---|
| U1 | 全部由總部直接繳，付款對象只有公用事業繳費單位，不做墊款人 | 請款單 `vendor_id` 必須是「公用事業」分類且合作中的廠商（建立時檢查）；不新增墊款人欄位；§4、§6 |
| U2 | 一張請款單＝同一付款對象＋同一帳單月份；建立時自動帶入該單位該月尚未請款的帳單，可手動增減（只能加同單位的帳單） | 主表 `bill_month`；`ga_ws_pay_ub_create` 未帶 `bill_ids` 時自動帶入；`ga_ws_pay_ub_candidates` 供增減；明細表觸發器檢查帳單的單位與月份必須與主表相同；§4、§6 |
| U3 | 同一列表、同一狀態流程、同一列印與 CSV；來源標籤與篩選；列印明細改列門市、費用類型、帳單月份、識別號碼、金額 | `ga_payment_requests.source`；列表函式加 `source` 篩選；列印頁與 CSV 依來源分支；§6、§7 |
| U4 | 繳費單位放進廠商資料新增「公用事業」分類；帳單新增欄位指向廠商，舊帳單可補填；請款時必須有對應單位；銀行等帳務欄位沿用遮蔽 | 分類種子與設定指標（§4.3）；`ga_utility_bills.payee_vendor_id`；批次補填；沿用 `ga_pay_vendor_snapshot` 與 `vendor.view／manage` 遮蔽 |
| U5 | 送出前每張帳單至少一個附件，缺的列出並擋下 | 送出前檢查觸發器 `ga_pay_ub_submit_check`，錯誤碼 `BILL_MISSING_ATTACHMENT`，回傳缺附件帳單清單；畫面事先標紅；§5 |
| U6 | 「送出後帳單自動標記已繳」預設勾選；勾選時送出當下標已繳，繳費日期＝送出日（台北），記錄由哪張請款單標的；不勾維持原狀；作廢或退回只回復「因這張請款單自動標記」的帳單；會計標已付款不影響帳單 | 主表 `auto_mark_paid`；帳單 `paid_by_pr_id`；狀態同步觸發器 `ga_pay_ub_sync`；手動標記或改回待繳一律清掉 `paid_by_pr_id`；§5 |
| U7 | 權限沿用採購請款：建立／送出需水電帳單管理＋請款管理；付款標記沿用請款付款權限；查看需對應查看權限 | §8 權限表 |
| U8 | 12/8 全面切換後再上線（約 12/15 週），正式區草稿獨立資料夾 | §11 |
| 不變 | 同一張帳單同時只能在一張有效（非作廢）請款單；已刪除帳單不能請款；已付款請款單鎖定 | 明細表部分唯一索引（`active`）；候選條件；既有主表守門觸發器；§5 |

## 3. 我自行決定的事項（依規格精神，理由附後）

| 編號 | 決定 | 理由 |
|---|---|---|
| D1 | 水電明細用**獨立新表** `ga_payment_request_bill_lines`，不放寬採購明細表 | 採購明細的 `po_id`、`receipt_id`、`claim_total>0`、累計額度、匯出、分析全依賴它；分開才能保證零影響 |
| D2 | 請款單主表金額：`amount_untaxed = amount_total`、`tax_amount = 0`；水電帳單金額視為含稅應繳金額，畫面與 CSV 水電列只顯示「金額」，不顯示未稅與稅額 | 水電帳單本來就只有應繳金額；主表有等式檢查，沿用不改 |
| D3 | 帳單金額有小數或為 0 者**不能請款**（白話訊息：「金額有小數，請先到水電帳單修正」「0 元帳單不需要請款」） | 請款金額欄位是整數且 `claim_total>0`；台灣帳單實務為整數，不自行四捨五入以免付錯錢；上線前唯讀預覽列出現有幾筆有小數 |
| D4 | 已繳帳單不能加入請款單；送出時若發現帳單已被標已繳（無論誰標）也擋下 | 避免同一筆帳單被付兩次；自動標記的前提是送出時帳單仍是待繳 |
| D5 | 「公用事業」分類以設定鍵 `utility_payee_category_id`（存分類 id）指向，不靠分類名稱或代碼判斷 | 正式區若總務已自行建過同名分類，可直接指過去而不重複新增；分類改名、停用不影響請款（用 id 判斷，不看分類啟用狀態） |
| D6 | 作廢「已付款」的水電請款單：依規格仍把自動標記的帳單改回待繳，但畫面作廢前跳確認視窗提醒「款項已付，帳單會改回待繳，請確認是否需要追回款項」 | 規格明講作廢要回復；確認視窗只是防誤按，不擋 |
| D7 | 帳單位於已送出或已付款請款單時，鎖住金額、繳費單位、帳單月份、費用類型、據點、識別號碼、刪除；若該單勾了自動標記，繳費日期也由系統管理（不能手動改回待繳或改日期）；其他欄位（備註、到期日）仍可改。草稿內的帳單不鎖，但送出時比對金額快照，不符回 `BILL_CHANGED`，請款單編輯頁按「重新帶入」即更新快照 | 避免請款金額與帳單對不上；草稿階段保持彈性 |
| D8 | CSV 以 `source` 區分匯出，**預設仍是採購**（既有行為不變），水電要在匯出視窗選「水電話費」；兩種來源欄位不同，不混在同一份檔 | 混合會讓欄位大半留空，也會改變既有採購 CSV；列表與列印仍是同一個入口 |
| D9 | 查看水電請款單的明細（門市、識別號碼、各帳單金額）除請款檢視外另需水電帳單檢視；只有請款檢視者看得到請款單頭與總額，明細顯示「已遮蔽」 | 與採購「看採購單明細另需採購評估檢視」完全對稱；會計角色在 DEV 與建議授權名單中都帶水電檢視 |
| D10 | 退回草稿後，明細仍保留並繼續占用帳單（同一張帳單不能同時在兩張有效請款單）；只有作廢才釋放 | 與採購相同（草稿也算有效單） |
| D11 | 採購單廠商下拉**不**排除公用事業廠商 | 不動採購單行為；若老闆希望排除再另開（見 §13 的低優先事項） |
| D12 | 沒有填繳費單位的帳單：不能請款，候選畫面上方提示「這個月還有 N 張帳單沒有指定繳費單位」並連到水電帳單頁；批次補填工具放水電帳單頁 | 舊帳單補填的主要入口 |

## 4. 資料表與欄位變更

### 4.1 新增與擴充（DEV 與正式區相同，皆 `IF NOT EXISTS`／`ADD COLUMN IF NOT EXISTS`，可重複執行）

**`ga_payment_requests`（擴充三欄，皆有預設值，不重寫整張表）**
| 欄位 | 型別 | 說明 |
|---|---|---|
| `source` | `text NOT NULL DEFAULT 'PURCHASE'`，CHECK in (`PURCHASE`,`UTILITY`) | 既有列自動是採購；建立後不可改（觸發器擋） |
| `bill_month` | `date` | 僅水電：帳單月份（月初）；CHECK：`source='UTILITY'` 時必填且為月初，`PURCHASE` 時必為空 |
| `auto_mark_paid` | `boolean NOT NULL DEFAULT false` | 僅水電有意義；CHECK：`source='PURCHASE'` 時必為 false；水電建立預設 true（由函式寫入）；非草稿鎖定 |
| 索引 | `(source, status, created_at DESC)` | 列表來源篩選 |

**`ga_payment_request_bill_lines`（新表，水電明細）**
| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | uuid 主鍵 | |
| `pr_id` | uuid NOT NULL，FK `ga_payment_requests` ON DELETE CASCADE | 與採購明細同（DEV 清理用） |
| `line_no` | integer NOT NULL，`UNIQUE (pr_id, line_no)` | |
| `bill_id` | uuid NOT NULL，FK `ga_utility_bills` ON DELETE RESTRICT | |
| `active` | boolean NOT NULL DEFAULT true | 請款單未作廢時為 true；作廢時由同步觸發器改 false；**部分唯一索引 `UNIQUE (bill_id) WHERE active`**＝同一張帳單同時只能在一張有效請款單（最後一道防線） |
| `claim_total` | numeric(14,0) NOT NULL，CHECK `> 0` | 建立（與重新帶入）時凍結的帳單金額 |
| `store_id`、`location_name`、`expense_type`、`billing_month`、`identifier`、`service_label`、`due_date` | 快照欄位 | 列印與 CSV 用（`identifier` 用既有 `ga_ub_ident` 取電號、水號、用戶號碼或設備序號） |
| `auto_paid_date` | date | 送出時自動標記的繳費日期（沒勾選或沒標就空） |
| `auto_reverted_at`、`auto_revert_reason` | timestamptz、text | 退回或作廢時自動改回待繳的時間與原因（`RETURN`／`VOID`），留痕用 |
| `created_at` | timestamptz | |
| 索引 | `(bill_id)`、`(pr_id)` | |
| 守門觸發器 | 新增、修改、刪除只在父請款單為草稿時允許；唯一例外：父單剛變成 VOID 時只允許把 `active` 改 false 與寫入留痕欄位；父單 `source` 必須是 `UTILITY`；帳單必須與父單的 `vendor_id`（對應 `payee_vendor_id`）和 `bill_month`（對應 `billing_month`）相同 | 比照 `ga_pay_request_lines_guard` |

RLS 全封（啟用 RLS、不開 policy、收回 `authenticated`、只給 `service_role`），與 `ga_payment_request_lines` 同；讀寫一律走 `ga_ws_*` 函式。

**`ga_utility_bills`（擴充兩欄）**
| 欄位 | 型別 | 說明 |
|---|---|---|
| `payee_vendor_id` | `uuid REFERENCES ga_vendors(id) ON DELETE RESTRICT` | 繳費單位（U4）；既有列為空；索引 `(payee_vendor_id, billing_month) WHERE deleted_at IS NULL` |
| `paid_by_pr_id` | `uuid REFERENCES ga_payment_requests(id) ON DELETE SET NULL` | 「這筆已繳是由哪張請款單自動標記的」；手動標記為空 |

不新增採購明細表欄位，不新增事件類型，不新增權限碼。

**守門觸發器（皆為新增，不改既有函式本體）**
1. `ga_payment_request_lines`（採購明細）加 BEFORE INSERT 觸發器：父單 `source` 必須是 `PURCHASE`，否則擋（防止呼叫錯函式把採購明細塞進水電請款單）。對採購單既有流程無影響（父單一律是 PURCHASE）。
2. `ga_payment_requests` 加 BEFORE UPDATE 觸發器 `ga_pay_ub_guard`：`source` 永遠不可改；`bill_month`、`auto_mark_paid` 非草稿時不可改。與既有 `ga_pay_request_guard` 並存，各管各的欄位。
3. 附件守門 `ga_pay_ub_attachment_last_guard`（`ga_resource_attachments` BEFORE UPDATE，另一個觸發器，不改 `ga_pay_attachment_last_image_guard`）：水電帳單位於「已送出或已付款」請款單內時，最後一個附件不可標記刪除（訊息 `BILL_LAST_ATTACHMENT_LOCKED: 這筆帳單已在請款單 PY-… 內，最後一個附件不能刪除…`；`lib/workspace/general-affairs/server.ts` 補一行對應 409，比照 `INVOICE_LAST_IMAGE_LOCKED`）。草稿內的帳單不鎖（送出時才檢查）。
4. 帳單觸發器 `ga_utility_bill_before_write` 改版（讀現行定義＋文字替換，形狀不符就中止，比照 4.5 批做法）：
   - 在「請款單同步」情境（交易內設定值 `ga.ub_sync_pr` 為一張存在且 `source='UTILITY'` 的請款單 id，且變動欄位只限 `paid_at`、`paid_by_pr_id`）略過 `utility_bill.manage` 檢查（仍要求已登入）。這是讓會計退回、作廢時能回復帳單的唯一缺口，設定值只由 SECURITY DEFINER 同步函式在交易內設定。
   - 非同步情境下，`paid_at` 有變動就把 `paid_by_pr_id` 清成空（手動標記、手動改回待繳、手動改日期都變成「手動」，之後退回或作廢不會動它）。
   - 帳單位於已送出或已付款請款單內時，擋金額、繳費單位、帳單月份、費用類型、據點、識別號碼、刪除（D7）；若該單勾了自動標記，另擋 `paid_at` 變動。訊息：`BILL_IN_REQUEST: 這筆帳單已在請款單 PY-… 內（已送出），金額、繳費單位與刪除已鎖定；請先請款單退回或作廢`（走 `ga_rq_raise` 結構化錯誤，409）。

### 4.2 設定鍵

`ga_workflow_settings` 新增一列 `utility_payee_category_id`（`value_text`＝公用事業分類 id）。現有 `ga_ws_pay_settings_get/set` 只處理 `pay_` 開頭的鍵，不受影響。

### 4.3 「公用事業」分類的種子與正式區既有資料怎麼補

1. 分類：種子邏輯＝先找現有 `code='UTILITY'` 或名稱為「公用事業」的分類，找得到就用它；找不到才新增（`code='UTILITY'`、名稱「公用事業」、`sort_order=90`、啟用）；再把 id 寫入 `utility_payee_category_id`。可重複執行，不重複新增。前一次的「分類由總務自建、不預置」決定維持，這裡只預置這一個，原因是請款流程要靠它找繳費單位。
2. 廠商：正式區不自動建廠商。總務上線前（或上線當週）在廠商頁自行新增台電、台水、中華電信等並勾「公用事業」分類（廠商統編為必填，公司類型不可空；這些單位本來就有統編）。上線前清單把這件事列為前置。
3. 既有水電帳單補填繳費單位（共三條路，不強制）：
   - **主要路徑（畫面）**：水電帳單頁新增「補填繳費單位」批次工具——列出尚未指定繳費單位的帳單，依「供應商（`provider_name`）」分組顯示筆數，總務對每一組選一個繳費單位按「套用到這一組」。函式 `ga_ws_ub_set_payee(p_ids uuid[], p_vendor uuid)` 只填空值（已有繳費單位的跳過並回報）、一次最多 200 筆、已刪除跳過、需水電管理權限；不更動版本號以外的欄位（`payee_vendor_id` 不是 V6 的關鍵欄位，已繳帳單不需二次確認）。
   - **選用路徑（SQL）**：草稿 `05-backfill-payee.sql`（選用、須使用者核可後才跑）：只在「供應商名稱經 `ga_vd_norm_name` 正規化後，與恰好一間公用事業分類廠商的正規化名稱完全相同」時才填；先把將要填的 `(bill_id)` 寫入備份表 `ga_utility_bills_payee_backfill_bak`，rollback 依備份表把這些列的 `payee_vendor_id` 清回空。多筆或零筆對應者一律不動。
   - **新帳單**：新增帳單時繳費單位為選填（不改既有 G23 流程）；請款時才強制。帳單表單新增繳費單位下拉（只列公用事業分類、合作中的廠商），選了可順便帶入 `provider_name`（沒填才帶）。
4. 既有 4.5 批資料：`source` 預設 `PURCHASE`（PostgreSQL 預設值新增欄位不重寫資料表），不需回填；`auto_mark_paid` 全為 false；既有帳單的 `paid_by_pr_id` 全為空（都是手動）。

### 4.4 DEV 檔案（`supabase/workspace-dev/`，各附 `.rollback.sql`，套用腳本 `scripts/apply-workspace-ga-utility-payment-dev.cjs [--rollback]`，比照 b45 腳本用 `tests/support/env-guard.cjs` 只連 DEV、先確認 project-ref 以 mjpd 開頭、檔案不存在就略過）

| 檔案 | 內容 |
|---|---|
| `20261124100000_ga_utility_payment_schema.sql` | §4.1 的欄位、新表、索引、設定鍵、分類種子、採購明細與主表守門觸發器（觸發器函式先建，不呼叫尚未存在的東西） |
| `20261124110000_ga_utility_payment_bill_side.sql` | 帳單觸發器改版、`ga_ub_json` 加欄位、`ga_ws_ub_save` 接受 `payee_vendor_id`、`ga_ws_ub_list` 加篩選、`ga_ws_ub_payees`、`ga_ws_ub_set_payee`、附件守門觸發器 |
| `20261124120000_ga_utility_payment_request_core.sql` | 內部輔助 `ga_pay_ub_*`、送出檢查與狀態同步觸發器、`ga_ws_pay_ub_candidates／create／update`、水電匯出函式 |
| `20261124130000_ga_utility_payment_request_hooks.sql` | 對既有函式的最小加掛（`ga_pay_request_json`、`ga_ws_pay_request_list`、`ga_ws_pay_request_update`、`ga_ws_pay_request_action`、`ga_ws_pay_export`），皆讀現行定義＋文字替換、形狀不符就中止、已套用就略過 |
| `20261124140000_ga_utility_payment_dev_seed.sql` | DEV 專用測試角色（§10.1）與清除函式 `ga_dev_cleanup_ga_utility_payment`；**無正式區草稿**；角色代碼前綴 `vue_workspace_gaup_`，套用前先查 `roles` 表與 `tests/integration/role-matrix.spec.ts` 是否撞名（撞名會覆蓋權限並讓 rollback 刪到別人的成員），rollback 只刪這幾個角色與其成員 |

DEV 要實測「套用 → 撤回 → 再套用」。清除腳本 `scripts/cleanup-ga-utility-payment-dev.cjs` 只清 `QA-GAUP-` 標記、VW／ZT 門市、2038 年的帳單、廠商、請款單與附件；請款單事件表有不可改刪觸發器，沿用 `ga_dev_cleanup_m7m8_b45` 在單一交易內暫停觸發器、僅限 DEV 的做法。

## 5. 狀態與規則

### 5.1 狀態

沿用第 4.5 批狀態機，不新增狀態：`DRAFT → SUBMITTED → PAID`，`SUBMITTED → DRAFT`（退回，必填原因），`DRAFT／SUBMITTED／PAID → VOID`（SUBMITTED、PAID 作廢必填原因），已付款鎖定只能備註與作廢，事件不可改刪，動作帶固定識別與 `expected_updated_at`。水電請款單與採購請款單的差別只在送出、退回、作廢時帳單跟著動。

### 5.2 帳單能不能請款（候選條件，建立、重新帶入、送出三處用同一支判斷 `ga_pay_ub_eligible`）

| 條件 | 不符時的白話訊息與代碼 |
|---|---|
| 帳單未刪除 | 「這筆帳單已被刪除，不能請款」`BILL_DELETED` |
| 帳單 `payee_vendor_id` ＝請款單的繳費單位 | 「這筆帳單的繳費單位不是 ○○」`BILL_PAYEE_MISMATCH`；未填者「這筆帳單還沒有指定繳費單位，請先到水電帳單補填」`BILL_NO_PAYEE` |
| 帳單月份＝請款單的帳單月份 | 「這筆帳單是 ○ 月，不能放進 ○ 月的請款單」`BILL_MONTH_MISMATCH` |
| 帳單未繳（`paid_at` 為空） | 「這筆帳單已標記已繳（日期），不需要再請款」`BILL_ALREADY_PAID` |
| 金額為正整數 | 「金額有小數／為 0，請先到水電帳單修正」`BILL_AMOUNT_INVALID` |
| 不在其他有效（非作廢）請款單內 | 「這筆帳單已在請款單 PY-… 內」`BILL_IN_OTHER_REQUEST`（附該單號） |

繳費單位本身：廠商必須屬公用事業分類且 `status='active'`（建立時檢查，`PAYEE_NOT_UTILITY`、`VENDOR_INACTIVE`）；送出時不重驗分類（以建立當下為準，與採購對廠商的處理一致）。

### 5.3 建立與修改（草稿）

- `ga_ws_pay_ub_create`：權限＝請款管理且水電管理（缺一回 403，訊息指出缺哪一個）；必填 `vendor_id`、`bill_month`；選填 `bill_ids`（未帶＝系統自動帶入該單位該月全部可請款帳單；帶了＝只放指定帳單，逐張檢查 §5.2）、`auto_mark_paid`（預設 true）、`expected_pay_date`、`notes`。同一交易：以 `FOR UPDATE` 依 id 排序鎖帳單列、快照廠商、取單號、寫主表與明細、重算金額、寫 `create` 事件（payload 含筆數與月份）。固定識別與內容雜湊沿用採購做法（同識別同內容回原結果、內容不同 409）。自動帶入沒有任何可請款帳單時回 `NO_BILLS`（「○○ ○ 月沒有可以請款的帳單」，並附未納入帳單的原因統計）。
- `ga_ws_pay_ub_update`：草稿才能改；可改 `bill_ids`（整批取代並重新快照金額）、`auto_mark_paid`、`expected_pay_date`、`notes`；需同樣兩個權限與 `expected_updated_at`。`bill_ids` 不能為空（要整張不要就作廢）。
- 候選：`ga_ws_pay_ub_candidates(月份, 可選廠商)`：未指定廠商時回「各公用事業單位在該月的可請款張數與金額、尚未指定繳費單位的帳單張數」；指定廠商時回該單位該月全部帳單，每張標 `eligible` 或不可請款原因（§5.2），並附 `attachment_count`（缺附件標紅用）、所在請款單號。

### 5.4 送出（`DRAFT → SUBMITTED`）

動作函式 `ga_ws_pay_request_action` 的送出分支只改一處：「沒有任何明細」檢查改成「沒有採購明細且沒有水電明細」才擋。其餘全部由新增的 BEFORE UPDATE 觸發器 `ga_pay_ub_submit_check`（只在 `source='UTILITY'` 且狀態由 DRAFT 變 SUBMITTED 時動作）完成，依序：

1. 權限：除了函式已查的請款管理外，再要求水電管理（`has_permission(auth.uid(), 'general_affairs.utility_bill.manage')`），缺回 403（U7：送出需兩個權限）。
2. 鎖定明細內全部帳單列（依 id 排序 `FOR UPDATE`，鎖順序固定為「請款單 → 帳單」，帳單端函式只鎖帳單列、不回頭鎖請款單，所以不會死結）。
3. 逐張重驗 §5.2（刪除、單位、月份、已繳、金額、其他單）；金額與請款單快照不同回 `BILL_CHANGED`（「帳單金額已被修改，請在請款單按『重新帶入』」）。
4. **附件（U5）**：數 `ga_resource_attachments` 中 `resource_type='UTILITY_BILL'`、`resource_id`＝帳單、`deleted_at IS NULL` 的筆數，任何一張為 0 就整張擋下，回 409 `BILL_MISSING_ATTACHMENT`，訊息「有 N 張帳單還沒有附件（帳單照片或 PDF），請先上傳：…」，結構化資料帶缺附件的帳單清單（門市、費用類型、識別號碼、金額），畫面據此逐張列出並連到該帳單。全部或全無，不做部分送出。

通過後主表狀態變 SUBMITTED（既有函式寫 `submit` 事件），接著 AFTER UPDATE 觸發器 `ga_pay_ub_sync` 處理 §5.5。

### 5.5 自動標記已繳與回復（U6）

由 AFTER UPDATE OF status 觸發器 `ga_pay_ub_sync` 做（單一入口，不論從哪個函式或腳本改狀態都一致；所有改動與狀態變更同一交易，任何一步失敗整筆回復）：

| 狀態變化 | 動作 |
|---|---|
| DRAFT → SUBMITTED，且 `auto_mark_paid = true` | 設 `ga.ub_sync_pr`；把明細內每張帳單 `paid_at = 台北今天`（`ga_po_today()`）、`paid_by_pr_id = 該請款單`；明細寫 `auto_paid_date`。**不套用「繳費日期不得早於帳單月份前 1 個月」**（繳費日期定義就是送出日） |
| DRAFT → SUBMITTED，`auto_mark_paid = false` | 帳單不動 |
| SUBMITTED → DRAFT（退回） | 對明細內每張帳單，**只有 `paid_by_pr_id = 這張請款單` 且 `paid_at` 不為空者**改回 `paid_at = NULL、paid_by_pr_id = NULL`，明細寫 `auto_reverted_at`、`auto_revert_reason='RETURN'`；手動標記者（`paid_by_pr_id` 為空或指向別張）不動；明細保留、`active` 仍為 true |
| DRAFT／SUBMITTED／PAID → VOID（作廢） | 同上回復（`auto_revert_reason='VOID'`），並把明細 `active` 改 false（釋放帳單，可重新請款） |
| SUBMITTED → PAID（會計標已付款） | **帳單不動** |

補充規則：
- 手動標記已繳、改回待繳、改繳費日期，一律由帳單觸發器把 `paid_by_pr_id` 清空，因此「先自動標記、後來有人手動改回待繳又手動標回」的帳單，退回或作廢時不會被請款單誤動。
- 勾選自動標記時，請款單內帳單的繳費狀態由系統管理，手動改回待繳會被擋（D7）；不勾選時帳單可隨時手動標已繳，標記時沿用既有 `ga_ws_ub_pay` 的日期規則。
- 不勾選且送出前有人手動把帳單標已繳：送出時 §5.2「已繳」檢查擋下並請該帳單從請款單移除。

### 5.6 其他動作

`mark_paid`（付款標記）、`note`、`refresh_bank`（草稿重抓廠商銀行快照）沿用既有函式與規則，**不改**：付款日期 F3 規則、申請人可自己標已付款、已付款鎖定、事件不可改刪、廠商名稱統編銀行在建立時快照等全部與採購相同。

### 5.7 錯誤碼

新增代碼（走既有 `ga_rq_raise` 結構化錯誤，API 轉成白話 `GaError`；`payErrorMessage` 補對應白話）：`BILL_DELETED`、`BILL_NO_PAYEE`、`BILL_PAYEE_MISMATCH`、`BILL_MONTH_MISMATCH`、`BILL_ALREADY_PAID`、`BILL_AMOUNT_INVALID`、`BILL_IN_OTHER_REQUEST`、`BILL_CHANGED`、`BILL_MISSING_ATTACHMENT`、`BILL_IN_REQUEST`、`BILL_LAST_ATTACHMENT_LOCKED`、`PAYEE_NOT_UTILITY`、`NO_BILLS`、`SOURCE_MISMATCH`（用採購函式操作水電單或反之）。既有代碼不變。

## 6. RPC 與 API

### 6.1 資料庫函式（SECURITY DEFINER、固定 `search_path`、只用 `has_permission(auth.uid(), …)`、必須使用者身分、回 `{ok,status,data,error,code}`）

**新增對外函式**
| 函式 | 說明 | 權限 |
|---|---|---|
| `ga_ws_pay_ub_candidates(p_filters)` | §5.3 候選；內部輔助只開給 service_role | 請款檢視或管理；帳單明細另需水電檢視（否則只回張數與總額） |
| `ga_ws_pay_ub_create(p_payload, p_key)` | §5.3 建立 | 請款管理＋水電管理 |
| `ga_ws_pay_ub_update(p_id, p_payload, p_expected_updated_at)` | §5.3 修改草稿 | 請款管理＋水電管理 |
| `ga_ws_pay_export_ub(p_filters)` | 水電對帳列（每張帳單一列，含自動標記資訊） | 請款檢視或管理 |
| `ga_ws_ub_payees()` | 公用事業分類且合作中的廠商（只回 id、名稱，不含統編與銀行），給帳單表單與補填工具下拉 | 水電檢視或管理 |
| `ga_ws_ub_set_payee(p_ids, p_vendor)` | 批次補填（只填空值，最多 200 筆） | 水電管理 |

**對既有函式的最小加掛**（讀現行定義＋文字替換、形狀不符就中止、已套用就略過，比照 `ga_b45f_swap`；每處都以 `source = 'UTILITY'` 為條件，採購路徑的程式碼與行為不變）
| 既有函式 | 加掛內容 |
|---|---|
| `ga_pay_request_json` | 輸出多 `source`、`bill_month`、`auto_mark_paid`；`p_detail` 時水電單多 `bill_lines`（門市、費用類型、帳單月份、識別號碼、金額、附件數、自動標記資訊；無水電檢視權限者回 `bills_masked: true` 不含明細）；採購單 `lines` 輸出不變 |
| `ga_ws_pay_request_list` | 篩選多 `source`（`PURCHASE`／`UTILITY`，空＝全部）；列多 `source` 與水電的 `bill_month`、帳單張數；摘要與全域數字口徑不變 |
| `ga_ws_pay_request_update` | 開頭加：來源是水電就轉呼叫 `ga_ws_pay_ub_update` |
| `ga_ws_pay_request_action` | 送出分支的明細存在檢查多認水電明細（§5.4）；其餘不動 |
| `ga_ws_pay_export` | 篩選多 `source`；`UTILITY` 轉呼叫 `ga_ws_pay_export_ub`；未帶 `source` 與 `PURCHASE` 行為完全不變（D8） |

`ga_ws_pay_request_create`、`mark_paid`、`note`、`refresh_bank`、所有採購額度與發票函式不動。

**既有水電帳單函式的更動**：`ga_ub_json` 多 `payee_vendor_id`、`payee_vendor_name`、`attachment_count`、`paid_by_pr_id`、`payment_request`（`{id, pr_no, status}`，有效請款單；呼叫者沒有請款檢視權限時只回 `{in_request: true}` 不含單號）、`locked`（D7 鎖定的欄位清單）；`ga_ws_ub_save` 在 payload 有 `payee_vendor_id` 時才處理（驗證是公用事業分類且合作中；未帶時行為與現在完全相同）；`ga_ws_ub_list` 篩選多 `request`（`none`＝未在有效請款單、`in_request`）與 `payee`（廠商 id 或 `none`）。`ga_ws_ub_pay／unpay／delete` 本體不改（鎖定與清除標記由帳單觸發器處理，§4.1）。

### 6.2 API（`/api/workspace/general-affairs/**`，`router.ts` 不新增路由前綴，沿用 `payment-requests`、`utility-bills`；共通規則同第 4.5 批：非 GET 檢查 Origin、使用者身分、`GaError`、`pageSize ≤ 100`、`409 STALE`、伺服端機密遮蔽）

| 路徑 | 說明 |
|---|---|
| `GET payment-requests?source=` | 列表加來源篩選，列帶 `source` |
| `GET payment-requests/utility-candidates?month=&vendor_id=` | 候選（§5.3） |
| `POST payment-requests`（body `source:'UTILITY'`） | 建立水電請款單（`vendor_id`、`bill_month`、`bill_ids?`、`auto_mark_paid`、`expected_pay_date`、`notes`、`idempotency_key`）；未帶 `source` 視為採購，行為不變 |
| `PATCH payment-requests/:id` | 資料庫依來源分流，API 不用先判斷 |
| `POST payment-requests/:id/actions` | 不變 |
| `GET payment-requests/export?month=&source=&…` | 加來源；水電匯出同樣防公式注入、5000 筆上限、無廠商權限者省略統編與銀行整欄 |
| `GET utility-bills/payees` | 繳費單位下拉（名稱而已） |
| `POST utility-bills/set-payee` | 批次補填 |
| `GET/POST/PATCH utility-bills…` | 列表與詳情多新欄位；儲存可帶 `payee_vendor_id`；列表加 `request`、`payee` 篩選 |

純函式：`lib/workspace/general-affairs/utility-payment-rules.ts`（新檔，與資料庫逐條對齊：候選條件與原因代碼、金額檢查、鎖定欄位判斷、來源標籤、送出前缺附件計算、CSV 欄位與公式注入、錯誤白話）；`payment-request-rules.ts` 只加 `source` 欄位型別與 `PR_SOURCES`、`PR_SOURCE_LABELS`（採購／水電話費），不改既有函式簽章。伺服端補：`server.ts` 加 `BILL_LAST_ATTACHMENT_LOCKED` 對應（比照 `INVOICE_LAST_IMAGE_LOCKED`）；附件上傳路由不改。

## 7. 畫面（Vue，`vue-workspace/src/pages/ga/`）

### 7.1 請款單列表（`PaymentRequests.vue`）
- 新增「來源」篩選（全部／採購／水電話費），列上顯示來源標籤；水電列顯示「帳單月份」，採購列沿用原欄位；狀態頁籤、搜尋、「待付款」頁籤、逾期草稿篩選不變。
- 「新增請款單」改為先選來源（採購／水電話費）；採購走原流程完全不變；水電需同時有 `gaPaymentManage` 與 `gaUtilityBillManage`，否則選項反灰並說明缺哪個權限。
- 匯出視窗加來源選項（預設採購）；選水電時顯示水電的月份與狀態勾選，欄位 §7.4。

### 7.2 請款單建立／編輯（`PaymentRequestEdit.vue`，水電模式）
1. 選「繳費單位」（下拉只列公用事業分類、合作中的廠商，旁邊顯示該月可請款張數與金額）＋「帳單月份」。
2. 選完立刻自動帶入該單位該月全部可請款帳單，預設全選；表格欄位：勾選、門市、費用類型、帳單月份、電號／水號／用戶號碼、金額、附件數（0 張標紅「缺附件」）。
3. **手動增減**：取消勾選即拿掉；「加入其他帳單」展開同單位同月份尚未勾選的帳單（含不可請款者，灰字並寫原因：已繳、在別張請款單、金額有小數…），只有可請款的可勾。不能加別的單位或別的月份（下拉與候選都只回同單位同月份）。
4. 頂部提示「還有 N 張帳單沒指定繳費單位」連到水電帳單頁。
5. 選項「送出後帳單自動標記已繳」，預設勾選，說明文字：「勾選：送出請款單時，這些帳單會標記為已繳（繳費日期＝送出日）；請款單被退回或作廢時，會一併改回待繳。不勾選：帳單維持原狀，請你確認付款後自己到水電帳單標記。」
6. 送出：先在畫面算缺附件張數預警（紅字）；按送出後若伺服端回 `BILL_MISSING_ATTACHMENT`，跳視窗逐張列出缺的帳單（門市、類型、識別號碼、金額）與「前往上傳」連結，請款單維持草稿。送出前再次顯示「將標記 N 張帳單為已繳」確認（有勾自動標記時）。
7. 檢視（已送出、已付款、已作廢）：顯示來源、單位、月份、自動標記狀態與「已標記 ○ 張、已回復 ○ 張」；作廢已付款單前跳確認視窗（D6）；退回、作廢原因輸入與既有相同；沒有水電檢視權限者明細區顯示「明細已遮蔽（需要水電帳單檢視權限）」。
8. 手機 390px：表格改為卡片列，勾選、金額、附件狀態在同一張卡內。

### 7.3 水電帳單頁（`UtilityBills.vue`）
- 列表新增「繳費單位」欄（空值顯示「未指定」警示色）與「請款單」欄：有效請款單顯示單號與狀態（可點進請款單，無請款檢視權限只顯示「已在請款單內」）；未請款顯示「—」。新增篩選「請款狀態」（未請款／已在請款單）與「繳費單位」（含「未指定」）。
- 已繳標籤：由請款單自動標記者顯示「已繳（請款單 PY-… 自動標記）」，手動者顯示現狀；詳情與編輯視窗顯示「已在哪張請款單」與鎖定欄位說明（D7），鎖定欄位反灰。
- 編輯視窗新增「繳費單位」下拉（選填）。
- 新增「補填繳費單位」按鈕（水電管理者）：依供應商分組列出未指定帳單，選單位後套用到該組；完成後顯示成功筆數與略過原因。
- 附件區：帳單位於已送出或已付款請款單內，刪除最後一個附件會跳白話錯誤。

### 7.4 列印與 CSV
- 列印（`PaymentRequestPrint.vue`，A4 預覽）：水電單抬頭沿用買受人設定；顯示請款單號、繳費單位（名稱；統編與銀行只給廠商檢視／管理）、帳單月份；明細表欄位「門市、費用類型、帳單月份、電號／水號／用戶號碼、金額」＋合計；付款資訊與簽章區（總務請款、會計付款）沿用；不顯示採購單、進貨單、發票、未稅、稅額欄。無水電檢視權限者明細區省略並註明。
- CSV（來源＝水電話費）欄位：請款單號、狀態、繳費單位、統編（有廠商權限才有）、帳單月份、門市、費用類型、電號／水號／用戶號碼、帳單金額、付款日、付款方式、參考號、總務請款人與時間、付款人與時間、是否自動標記已繳；UTF-8 含 BOM、一律防公式注入、統編與帳號輸出為文字格式、5000 筆上限、預設含已送出與已付款（沿用 F2 規則）。

### 7.5 導覽、首頁
入口旗標不變（`gaPaymentRequests`）。「待付款」徽章與首頁待辦自然含水電請款單（§9）；店長沒有任何請款或水電權限，看不到入口、徽章與 API。

## 8. 權限

權限碼完整格式 `general_affairs.<名稱>.<動作>`，**不新增權限碼，不授權給任何角色**（授權由老闆決定，上線前 README 列建議名單）。

| 操作 | 需要 |
|---|---|
| 建立、修改草稿、**送出**水電請款單 | `utility_bill.manage` ＋ `purchase_payment.manage`（缺一回 403，函式與觸發器雙重檢查） |
| 退回、作廢、標已付款、備註、重抓銀行（水電單） | `purchase_payment.manage`（沿用請款權限；不要求水電管理，自動回復帳單時由同步情境放行） |
| 列表、請款單頭、列印、CSV、候選張數與總額 | `purchase_payment.view` 或 `manage` |
| 請款單明細（門市、識別號碼、各帳單金額）、候選帳單明細 | 另需 `utility_bill.view` 或 `manage` |
| 廠商統編、銀行 | 另需 `vendor.view` 或 `manage`（沿用遮蔽，列印、CSV、請款單回應皆省略） |
| 水電帳單頁看「已在哪張請款單」單號 | 水電檢視；單號另需請款檢視，否則只顯示「已在請款單內」 |
| 繳費單位下拉、補填繳費單位 | 下拉：水電檢視或管理；補填：水電管理 |
| 公用事業分類與廠商的建立與修改 | 既有 `vendor.manage`、`service_category.manage`，不變 |

語意依正式區：沒有角色勾選就是沒有權限；`profiles.role==='admin'` 不放行請款入口與請款寫入；DEV 的 `has_permission` 與正式區不同（DEV 檢查 `roles.is_active` 並有 admin 後備），所以測試角色一律明確帶權限碼，並以「`profiles.role=admin` 無角色被擋」做等價驗證。店長（只有服務中心入口）沒有這些權限：入口、頁面、API 全部 403。

## 9. 對既有採購請款零影響的保證

**結構面**
1. 採購明細表、額度函式、發票、進貨、採購分析、廠商績效函式一個欄位都不動；水電明細是新表，採購的「內連接採購單」查詢天生看不到水電列。
2. 主表新增欄位全有預設值（`source='PURCHASE'`、`bill_month` 空、`auto_mark_paid=false`），既有資料不重寫、不回填。
3. 既有函式只做「來源是水電才分流或多做事」的加掛，加掛位置與條件列在 §6.1；每處加掛以文字替換套用並在形狀不符時中止，不整支覆蓋。
4. 採購明細表新增的 BEFORE INSERT 觸發器只在父單不是採購時才擋；採購單既有流程父單一律是採購。
5. 不新增事件類型、不改事件表約束、不新增權限碼、不改 RLS。
6. CSV 預設行為不變（D8）；採購請款單詳情與列印版面不變。

**預期且合理的可見變化（不算影響，但要告知）**
- 「待付款」徽章與首頁待辦、「草稿逾 14 天」待辦會把水電請款單算進去（它們本來就是「請款單」口徑）；沒有水電請款單時數字與現在完全相同。
- 請款單列表列與詳情 JSON 多了 `source` 等欄位（只增不減）。
- 水電帳單列表與詳情 JSON 多了新欄位；既有篩選與排序不變。

**驗證方式（做不到就不算完成）**
1. **黃金快照比對**：在 DEV 以同一批固定的採購、發票、請款測試資料，套用本批 SQL 前後各呼叫一次 `ga_ws_pay_request_list／get`、`ga_ws_pay_export`、`ga_ws_pay_po_summary`、`ga_ws_purchase_analysis`、`ga_ws_vendor_perf`、`ga_ws_home_summary／badges`、`ga_ws_po_list`，輸出去掉新增鍵（`source`、`bill_month`、`auto_mark_paid` 等）後必須逐位元相同；腳本放 `tests/integration/GU-db.purchase-regression.spec.ts`。
2. **既有測試全部原樣通過（不改斷言）**：G45 全部（db、att-inv、pay、void-stat、followup、e2e）、G22-G24、G23、G20-G21-db-api、`test:unit`、`tsc --noEmit`；若某條既有測試因為新增鍵而失敗，要先判斷是不是「只增不減」的合理變化並明列於報告，不得悄悄改斷言。
3. **混合資料**：同一個測試廠商以外，另在 DEV 並存採購請款單與水電請款單，驗證採購額度、待請款述詞、分析、績效、採購 CSV 數字不受水電單影響。
4. **來源隔離測試**：用採購函式操作水電單（建立明細、`lines` 更新）與反向操作，都回 `SOURCE_MISMATCH`，資料不變。
5. **撤回測試**：DEV「套用 → 撤回 → 再套用」，撤回後函式定義與撤回前保存的原定義逐字相同、新表與欄位消失、黃金快照仍一致。
6. 正式區草稿先跑唯讀預覽與驗證檔（§11），套用後再跑 `.verify.sql` 與黃金快照等價查詢。

## 10. 測試計畫

測試一律循序（不平行）：跑 `run-all` 或 playwright 之前先確認沒有其他 `run-all`、playwright、next 測試伺服器程序在跑（另一個總務劇本測試可能正在跑），有就等它結束再跑，不殺別人的程序；自己起的程序以 PID 結束，不用 `pkill`，不用 `timeout` 包 `run-all`。vitest 用 PowerShell 與大寫 `F:\` 路徑。測試資料只用 VW／ZT 測試門市、2038 年、標記 `QA-GAUP-`，結束只清自己的（`cleanup-ga-utility-payment-dev.cjs`）；不 push。

### 10.1 DEV 測試角色（前綴 `vue_workspace_gaup_`，DEV 專用，無正式區草稿；套用前再查撞名）
| 角色 | 權限 | 用途 |
|---|---|---|
| `gaup_clerk`（總務） | `utility_bill.manage`＋`view`、`purchase_payment.manage`＋`view`、`vendor.view`、`purchase_review.view` | 建立、送出、補填、補附件 |
| `gaup_accountant`（會計） | `purchase_payment.manage`＋`view`、`utility_bill.view`、`vendor.view`、`purchase_review.view`（**沒有** `utility_bill.manage`） | 退回、作廢、標已付款（驗證不需水電管理也能回復帳單；不能建立／送出水電單） |
| `gaup_billonly` | `utility_bill.manage`＋`view`（沒有請款權限） | 驗證不能建立請款單、帳單頁看得到「已在請款單內」但看不到單號 |
| `gaup_payview` | `purchase_payment.view`（沒有水電權限、沒有廠商權限） | 驗證明細遮蔽與唯讀 |
| 對照組 | 既有店長角色 `vue_workspace_ga_store_manager_b`、`vue_workspace_ga45_clerk`（有請款、沒水電）、`vue_workspace_ga_purchaser` | 看不到入口與 403；有請款沒水電者不能建立水電單 |

### 10.2 單元（vitest，`tests/unit/GU/`）
候選條件與原因代碼（刪除、單位不符、無單位、月份不符、已繳、小數、0 元、在別單）；自動帶入排除邏輯；缺附件計算；鎖定欄位判斷（D7）；自動標記與回復的規則表（勾選／不勾、手動標記不動、退回、作廢、已付款後作廢）；繳費日期＝台北日期（含跨午夜、UTC 邊界）；金額整數與合計；來源標籤與篩選整形；CSV 欄位與公式注入、統編帳號文字格式、無廠商權限整欄省略；列印欄位；錯誤碼白話；權限矩陣（兩個權限缺一的組合）；靜態檢查 SQL 檔含必要的守門與 `.rollback.sql`、`.verify.sql` 只有 SELECT。

### 10.3 資料庫整合（`GU-db`，用 `has_permission` 正式區語意）
- 結構：新表 RLS 全封、直接讀寫被擋；部分唯一索引使同一帳單不能同時在兩張有效單；主表 CHECK（水電必有月份、採購不可有月份與自動標記）。
- 建立：自動帶入只含同單位同月份可請款帳單；手動指定 `bill_ids` 逐張驗；非公用事業廠商、停用廠商被擋；固定識別重送、內容不同 409；缺其中一個權限被擋（兩種缺法）；管理員身分無角色被擋。
- 修改草稿：增減帳單、重新快照；非草稿被擋；STALE。
- 送出：缺附件列清單並整張擋下（含只有部分缺）；補附件後成功；帳單金額在草稿期間被改回 `BILL_CHANGED`；帳單被刪除／被標已繳／被別單占用被擋；勾選時帳單被標已繳且 `paid_by_pr_id` 正確、繳費日期＝台北今天（含 2038 年帳單不被「前 1 個月」規則擋）；不勾選帳單不動；送出只有請款管理沒有水電管理者被擋。
- 退回與作廢（以會計角色執行）：只回復 `paid_by_pr_id` 為本單者；手動標記者不動；先手動改回待繳再手動標回者不動；作廢釋放 `active`、帳單可重新請款；PAID → VOID 同樣回復；DRAFT → VOID（無自動標記）帳單不動；明細留痕欄位正確。
- 會計標已付款：帳單狀態不變；已付款鎖定。
- 帳單端：請款單內帳單改金額、改單位、刪除、手動改回待繳（勾選自動標記時）被擋；備註、到期日仍可改；補填繳費單位只填空值；ga_ub_json 新欄位與遮蔽（無請款檢視者看不到單號）；附件最後一個鎖。
- 並發：兩人同時建立含同一帳單的請款單只有一個成功；送出與手動標已繳並發結果一致（不重複標、不遺漏）；退回與作廢並發。
- 事件：不可改刪；各動作事件完整（誰、何時）。
- 匯出：水電匯出列正確、5000 上限、遮蔽。
- **零影響回歸**：§9 的黃金快照、`SOURCE_MISMATCH`、G45 全部既有測試。

### 10.4 頁面／API（`test:page`，`GU-api`、`GU-page`）
API：各端點權限（401／403／404／409）、Origin 檢查、來源篩選、候選、建立／修改／動作的錯誤訊息白話、缺附件清單格式、水電帳單新篩選與批次補填、CSV 內容。頁面冒煙（桌機 1440、手機 390）：請款單列表來源標籤與篩選、新增選來源、水電建立流程（自動帶入、增減、缺附件標紅、自動標記選項預設勾選與說明文字）、檢視頁、列印頁欄位、水電帳單頁新欄位與篩選、補填工具、鎖定欄位反灰。

### 10.5 e2e 多角色劇本（`tests/e2e/GU.journey-utility-payment.e2e.spec.ts`，循序，桌機 1440 與手機 390 各至少一條）
1. **主劇本（總務→會計）**：總務（`gaup_clerk`）新增公用事業廠商與三張 2038-03 電費帳單（VW、ZT 兩店）並補填繳費單位 → 建水電請款單（自動帶入 3 張）→ 取消勾選 1 張再加回 → 其中一張缺附件送出被擋並列出該帳單 → 補附件後送出（自動標記勾選）→ 帳單頁看到已繳、繳費日期＝今天、顯示「請款單 PY-… 自動標記」→ 會計（`gaup_accountant`）看得到請款單與明細、退回（填原因）→ 三張帳單回到待繳 → 總務修改後再送出 → 會計標已付款（帳單狀態不變）→ 已付款鎖定（改帳單被擋）→ 會計作廢（確認視窗）→ 帳單回到待繳、可再請款。
2. **手動與自動並存**：兩張請款單，一張勾自動、一張不勾；不勾那張送出後帳單仍待繳，總務手動標已繳；作廢兩張請款單 → 自動標的回待繳、手動標的不動；另測「自動標後手動改回再手動標回」不被動。
3. **雙重請款防護**：同一帳單加入第二張請款單被擋並指出單號；已刪除、已繳、小數金額、0 元、別單位、別月份帳單被擋；兩個瀏覽器同時建立只有一個成功。
4. **權限**：店長看不到入口、API 403；`gaup_billonly` 不能建立；`ga45_clerk`（有請款沒水電）建立被擋、但能退回／作廢／標已付款；`gaup_payview` 只讀、明細遮蔽、列印明細區省略；無廠商權限者看不到統編與銀行（畫面、列印、CSV）；管理員身分無角色看不到入口。
5. **列表與匯出**：採購與水電請款單並存，來源篩選、列表標籤、待付款徽章數字與點進去筆數一致；CSV 預設採購不變、選水電欄位正確、公式注入與文字格式；列印頁水電欄位。
6. **帳單頁**：顯示已在哪張請款單、鎖定欄位反灰、最後附件刪除被擋、補填繳費單位工具。
7. **採購回歸串接**：同一個 e2e 內先跑一條既有採購請款主線（沿用 4.5 劇本函式），確認數字不受水電單影響。
8. 每個劇本結束以 service role 回讀資料庫確認；資料衛生：sweeper 孤兒為 0（`run-all` 結束碼 1 若只因 sweeper 基準孤兒或 fetch failed，視為通過但要在回報說明）。完成網頁後依 Remote Control 規則以 1920×1080 截圖上傳（版面破損或 console 錯誤一併回報）。

### 10.6 效能
水電請款不增加新的大查詢；仍須實測：帳單列表加入請款單與附件計數後 `ga_ws_ub_list` 在十萬級帳單下 EXPLAIN（對照第 6 批目標 < 1,000 ms）、`ga_ws_pay_request_list` 加來源篩選後不退步、`BILL_MISSING_ATTACHMENT` 檢查對 100 張帳單的耗時；必要時為 `ga_resource_attachments (resource_type, resource_id)` 補索引（先看現有索引）。測試資料標記 `PERF-GAUP-`，量完刪除並驗證筆數歸零。

## 11. 上線步驟

**前置（在 12/8 全面切換之後才開始）**
1. 12/8 切換完成並穩定（老闆確認），再排約 12/15 週的上線日；本批不放進 12/8 當晚 SQL 步驟頁。
2. 前置條件：第 4.5 批草稿 50 至 61 與第 6 批 G23（45）、廠商（44、48）已在正式區套用且驗收通過（唯讀預覽檔會檢查，缺哪個就 MISSING 並停止）。

**開發階段（DEV）**
3. 依 §14 分階段實作，每階段測完才進下一階段；全部在 DEV 做「套用 → 撤回 → 再套用」。

**正式區草稿（資料夾 `docs/vue-workspace/parity-plan/ga-utility-payment-sql/`；實作者只產生草稿，不得直接套正式區；使用者核可後才執行）**
| 檔名 | 性質 |
|---|---|
| `00-preview-before-apply.sql` | 唯讀（只有 SELECT，本檔免附 rollback）：先決檢查（4.5 批函式與表、G23 函式、廠商表）；`ga_utility_bills` 筆數、有小數金額的筆數與清單、0 元帳單筆數、未指定繳費單位筆數、供應商名稱分組筆數；是否已有名為「公用事業」的分類（顯示 id、代碼）；現行 `ga_utility_bill_before_write`、`ga_ub_json`、`ga_ws_ub_save`、`ga_ws_ub_list`、`ga_pay_request_json`、`ga_ws_pay_request_list／update／action`、`ga_ws_pay_export` 現行定義全文與「形狀檢查」結果（請存檔）；`has_permission` 現行語意；目前有水電管理、請款管理、廠商檢視的角色與人（建議授權名單，只列不授權） |
| `01-ga-utility-payment-schema.sql` ＋ `.rollback.sql` ＋ `.verify.sql` | 對應 DEV 100000 |
| `02-ga-utility-payment-bill-side.sql` ＋ 同上三件 | 對應 DEV 110000 |
| `03-ga-utility-payment-request-core.sql` ＋ 同上三件 | 對應 DEV 120000 |
| `04-ga-utility-payment-request-hooks.sql` ＋ 同上三件 | 對應 DEV 130000 |
| `05-backfill-payee.sql` ＋ 同上三件 | **選用**：依正規化名稱唯一對應補填既有帳單的繳費單位（先寫備份表），需總務先建好公用事業廠商 |
| `README.md` | 套用順序、前置、備份清單、驗收、撤回、建議授權名單 |

規則：每份 `.verify.sql` 只有 SELECT（回傳 pass／fail 列：表、欄位、索引、觸發器、函式、設定鍵、分類種子、約束是否到位，以及加掛函式是否含加掛標記）；全部可重複執行；**不含任何 GRANT 給角色**；`.rollback.sql` 的安全規則：若已有 `source='UTILITY'` 的非作廢請款單或 `paid_by_pr_id` 不為空的帳單，rollback 開頭就 RAISE EXCEPTION 並列出筆數，要求先把這些請款單作廢、確認帳單狀態後才可撤回（避免撤回後留下孤兒或帳單狀態無法回復）；撤回順序與套用相反。

**正式區套用順序**
`00`（唯讀，看過所有 MISSING 與筆數）→ **備份**（`ga_utility_bills`、`ga_payment_requests`、`ga_workflow_settings`、`ga_service_categories`，及上述被加掛的函式現行定義存檔）→ `01` → `01.verify` → `02` → `02.verify` → `03` → `03.verify` → `04` → `04.verify` → 黃金快照等價查詢（採購請款的列表、金額彙總與套用前相同）→ 總務建立公用事業廠商 → 批次補填繳費單位（畫面工具，或核可後跑 `05`）→ 驗收（用一張小額真實帳單或標記清楚的測試帳單走完建立、缺附件、送出、退回、作廢，再清除）→ **老闆決定角色授權**（水電管理＋請款管理的總務才能建立／送出；會計建議給請款管理、水電檢視、廠商檢視）。撤回順序：`04` → `03` → `02` → `01`。

**上線當週**：公告「請款單新增水電話費來源」、更新總務與會計的角色說明；上線後第一個月底請總務與會計對一次第一批水電請款單與實際付款；建議定期稽核請款事件（沿用 4.5 批建議）。

## 12. 風險

1. **帳單觸發器改版**是唯一動到 G23 寫入路徑的地方（同步放行、清除標記、鎖定欄位）：用讀現行定義＋文字替換、完整跑 G23 全部既有測試（58 項＋單元）與 G20-G21 回歸。
2. **自動標記與回復的一致性**：靠狀態同步觸發器集中處理與 `paid_by_pr_id` 單一來源；並發（送出對手動標記、退回對作廢）列為資料庫測試必測項。
3. **作廢已付款單回復帳單**（依規格）可能讓已付款項的帳單變回待繳而被重複請款：以確認視窗與事件留痕降低；是否改成「已付款單作廢時不回復」見 §13。
4. **舊帳單補填繳費單位**需要人工作業量；補填前不能請款，上線前請總務先建廠商、先補填至少最近幾個月。
5. **小數金額與 0 元帳單**：若正式區有大量小數金額帳單，會無法請款；預覽檔先量，必要時改為「請款時四捨五入並記錄差額」另議。
6. **附件閘不一致**：水電附件的讀寫目前靠伺服端閘（DB 的 `can_read` 沒有 UTILITY_BILL 分支），本批不順手補，避免擴大範圍；送出前的附件計數直接查表，不受閘影響。
7. 對既有函式的文字替換形狀不符：套用時中止並印出差異，不整支覆蓋。
8. 待付款徽章口徑含水電後，既有徽章與列表筆數一致性測試（G45-stat）需重跑確認。
9. 與 12/8 切換的排程衝突：本批延後到 12/8 之後，不佔用當晚的 SQL 與驗收時間。

## 13. 需老闆確認的疑義

我已盡量用規格精神自行決定（§3 與全文），真正需要你拍板的只有下面這些；每一項都已附預設做法，不回答就照預設做。

1. **作廢「已付款」的水電請款單時，帳單要不要改回待繳？**（規格寫「作廢時把自動標記的改回待繳」，沒分是否已付款）預設：照規格改回待繳，並在作廢前跳確認視窗提醒「款項已付，請確認是否需要追回」。另一種做法是已付款單作廢時帳單維持已繳，避免已付款的帳單又變成待繳被重複請款。
2. **帳單金額有小數的處理**：預設不能請款（要先修成整數）。若正式區預覽發現有不少帶小數的帳單，要不要改成「請款時四捨五入、差額記在備註」？（上線前看預覽筆數再定，筆數很少就維持預設。）
3. **水電請款 CSV 預設不含在採購 CSV 裡**：預設匯出時要自己選「水電話費」才會匯出水電那份（欄位不同所以分開），採購那份維持現狀。若希望預設兩種合成一份，欄位會有一半是空的。
4. **公用事業廠商要不要從採購單的廠商下拉隱藏**：預設不隱藏（不動採購單行為，總務選到只是不合理，不會壞資料）。要隱藏的話另外開小改動。

## 14. 實作分階段（Sonnet 子代理依序執行，每階段測完才進下一階段；本設計不含實作）

| 階段 | 內容 | 驗收 |
|---|---|---|
| GU-1 資料庫 | DEV 100000 至 140000、套用與清除腳本、DEV 角色與固定測試工具；`GU-db` 整合測試與零影響黃金快照；回歸 G45、G23、G22-G24 | 套用→撤回→再套用；全部既有測試原樣通過 |
| GU-2 規則與 API | `utility-payment-rules.ts`、`payment-request-rules.ts` 擴充、`payment-requests.ts` 與 `utility-bills.ts` 擴充、`server.ts` 錯誤對應；單元與 API 測試 | `tsc`、`test:unit` 全過 |
| GU-3 畫面 | 請款單列表與建立／檢視（水電模式）、列印、匯出視窗；水電帳單頁新欄位與補填工具；頁面冒煙 | 桌機 1440／手機 390；無 console 錯誤；1920×1080 截圖回報 |
| GU-4 e2e 與驗收 | 多角色劇本、效能實測、allowlist 登記（新功能不必逐項登，凡改到既有行為者才登：帳單頁新欄位與鎖定、待付款徽章含水電；`approvedBy` 為 null 者補 `plain.json` 白話稿）、`verification.md` 與 README 紀錄 | 全套循序通過 |
| GU-5 正式區草稿 | 產生 `ga-utility-payment-sql/` 全部檔案（含 README、00 預覽、四組＋選用 05 的 `.sql`／`.rollback.sql`／`.verify.sql`），在 DEV 實跑驗證可重複執行與撤回 | 草稿通過獨立審查；等老闆核可才進入 §11 |

實作 commit 訊息一律英文，結尾空一行加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

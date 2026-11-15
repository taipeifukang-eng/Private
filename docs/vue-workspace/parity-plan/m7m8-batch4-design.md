# M7/M8 第 4 批設計（定稿）：回報、我的追蹤、需求單、料件處理、採購單與核准、到貨驗入、配發轉設備、資產移轉單子跟著走

> 狀態：定稿（2026-11-12）。使用者已完成問卷 docId `m7m8-batch4-spec` 的 21 題（D1 至 D21），其中 **D6、D12 與建議不同**，D8 有補充；各組 assumptions 視為核可。另有使用者 2026-11-12 決定：印表機這類設備「庫存與設備兩者都要」。本文件已刪除未選分支。
> 範圍：G14 `/general-affairs/reports/new`、G15 `/general-affairs/reports/mine`、G16 `/general-affairs/requests`、G17 `/general-affairs/part-fulfillments`；新功能 G25 採購單（含待核准、到貨驗入、配發）、G26 設備型號對應料件與配發轉設備（資料庫與規則層，畫面併入 G25 與第 1 批料件頁）、G27 資產移轉單子跟著走（B6）；加上 Q16、Q17、Q18、Q26（設備添購、料件補貨劇本）、Q27（到貨建立設備）、Q28 的後續。
> **延後到第 4.5 批**（D17）：進貨單憑證、發票、請款單（D18、D19）。本批只在 §10 記錄，不做。劇本走到「貼標、複核」為止。
> 格式與第 3 批 `m7m8-batch3-design.md` 相同；重用第 1 至 3 批的外殼、選擇器、`rpc(ctx, name, args)`、`GaError`、`STALE` 慣例、`ga_ws_` 函式命名、`ga_ws_inv_post`（過帳包裝，可被同交易呼叫）。
> 實作限制：只連 DEV（`supabase/.temp/project-ref` 以 mjpd 開頭，DB 指令前先確認）；不 push；不動 `supabase/migrations`；測試資料只用 VW／ZT 測試門市，年份優先 2038；`test:page` 與 e2e 一律循序；不連正式區（odvk）。

## 1. 舊版功能清單與缺陷（以程式碼為準；實作者開工前逐項對程式碼再核一次，補不到的列入 §9）

### 1.1 舊版檔案與路徑
- 頁面：`app/general-affairs/reports/new`、`reports/mine`、`requests`、`part-fulfillments`（各頁只是殼，主體在元件）。
- API：`app/api/general-affairs/requests`（GET、POST）、`requests/[id]`（GET、PATCH，554 行）、`requests/[id]/comments`（POST）、`comments/read`、`comments/[commentId]`（PATCH、DELETE）、`requests/[id]/store-actions`（`confirm_complete`、`report_problem`、`submit_supplement`）、`requests/[id]/stock-issue`、`requests/[id]/purchase-review`（GET、POST）、`requests/[id]/purchase-receipt`、`request-targets`、`part-fulfillments`（GET、POST）、`part-fulfillments/[id]/decision`、`exception`、`store-confirmation`、`part-fulfillments/documents/[type]/[id]`、`purchase-reviews/cost-summary`。
- 資料表：`ga_service_requests`（`request_type` 為 `REPAIR`、`PURCHASE_SUPPLEMENT`、`ASSIGNED_RESPONSE`；`main_status` 為 `PENDING_INTAKE`、`WAITING_STORE_SUPPLEMENT`、`WAITING_GA_REVIEW`、`ACCEPTED`、`IN_PROGRESS`、`WAITING_STORE_CONFIRMATION`、`COMPLETED`、`REJECTED`、`CANCELED`）、`ga_service_request_comments`、`ga_service_request_events`、`ga_purchase_reviews`（`decision`：駁回、庫存出庫、調撥、採購等；一張需求單一筆）、`ga_purchase_review_quotes`、`ga_part_fulfillments`（`request_id` UNIQUE，一張需求單一張處理單）、`ga_part_fulfillment_documents`（`STOCK_ISSUE`、`TRANSFER`、`PURCHASE`）、`ga_part_fulfillment_events`、`ga_vendors`、`ga_equipment`、`ga_facilities`、`maintenance_requests`（工單）。
- 採購舊做法：需求單採購評估核准後直接進入「等待到貨」（沒有下訂動作），單號 `PO` 開頭，一張需求單只能一筆評估、一張採購單；多家報價欄位實際只寫入一家；到貨（`purchase-receipt`）只把東西記進庫存，不產生設備，也不連回需求單。

### 1.2 舊版缺陷（新版修正，多數已由 Q16 至 Q18 決定）
伺服端不檢查狀態流轉；已完成／已駁回可再受理；已取消狀態存在卻無法取消；總務代門市確認沒有標示；內部備註送到門市瀏覽器；料件處理中心任何檢視者能看採購金額與供應商；設備入帳任務唯讀者也能替任何門市上傳；門市留言總務讀過後可被改刪且原文看不到；處理單與需求單狀態不同步；異常後舊單據仍占已承諾量；改採購決策時舊採購單仍占需求量且報價被刪重建；第一次出庫可超量且料件不核對；採購到貨不會產生設備；沒有「總務主動採購」、歷史價、下訂、核准；設備移轉（含更正所屬門市）不動單子，單子留在原門市。

## 2. 已決定事項

### 2.1 先前批次已決定（引用，不再問）
| 決定 | 本批落點 |
|---|---|
| Q16 總務代門市按確認須填說明並標「總務代門市操作」；內部備註不傳給門市；沒有採購評估權限者看不到金額與供應商；設備入帳上傳限該門市管理者與設備管理權限者；門市留言可改刪但標示「已編輯／已刪除」，總務看得到原文 | G15、G16、G17 |
| Q17 強制合法流轉；已完成／已駁回可「重新開啟」（須填原因）；有進行中工單或有效單據時禁止駁回；門市受理前可撤回；總務可取消未結案單（須填原因，已出庫或已有採購單據者不可取消） | G16 |
| Q18 到貨／收貨後處理單顯示「待交付」，由總務按「送門市確認」兩邊才一起往下；異常時可逐筆作廢舊單據後重選；改採購決策時舊採購單標已取消（已到貨者不可改）、報價保留歷史；出庫不得超過需求量、料件須與需求相同（替代料須填原因）。真正的「取消並沖回庫存」等庫存頁穩定後再做（第 3 批已完成庫存頁，本批的作廢以「作廢單據連結與釋放已承諾量」為主，庫存沖回仍走調整） | G16、G17、G25 |
| Q25 工務沿用總務角色；Q26 角色接力劇本（設備添購、料件補貨、設備轉移） | 劇本 |
| Q27 到貨可直接建立設備，需求單與設備互相連結，建立後該店立刻收到貼標待辦 | D12、D15、D16 取代並擴充 |
| 第 3 批 Q13 兩個權限缺哪個講清楚、管理員後備不套用在帳務寫入；Q14 發生時間不可填未來；庫存過帳固定識別防重複；`ga_ws_inv_post` 可供本批同交易呼叫 | 到貨驗入、配發出庫 |
| 通則：分頁與精確筆數、搜尋跳脫、使用者身分、正式區 `has_permission` 語意（不檢查角色啟用、DB 無 admin bypass、應用層 `profiles.role==='admin'` 僅作導覽／唯讀保底）、錯誤白話、`409 STALE`、舊 Next 頁與舊 API 不動、無通知、正式區 SQL 附還原且備份後核可 | 全批 |

### 2.2 本批 21 題決定（2026-11-12）
| 題 | 決定（代碼） | 最終行為 |
|---|---|---|
| D1 | `po_from_review` | 新增獨立採購單（`ga_purchase_orders`）。需求單採購評估選「進入採購」時，自動產生一張**草稿**採購單並連結回需求單（`source_request_id`、`purchase_review_id`）；總務確認供應商與單價後才下訂。到貨、驗入都走採購單。舊版評估內容照留；需求單頁顯示其所有採購單的進度。 |
| D2 | `one_to_many` | 一張需求單可對應多張採購單（可分供應商、可補訂）。需求量以所有「未取消」採購單中連到該需求單的品項數量加總（換算基本單位）控管，不得超過需求量（需求單上的需求量，與 D3 同一條規則：超過須填原因）。處理單仍是一張需求單一張（`request_id` UNIQUE 不變），採購單以 `PURCHASE` 類型單據連結多筆。 |
| D3 | `strict_match` | 到貨一律從採購單操作（沒有獨立進貨頁）。收貨位置與料件預設帶採購單內容；要改位置或改收替代料須填原因並留紀錄。採購品項核准數量不得超過需求量，除非填原因（原因寫在品項）。 |
| D4 | `block_both` | 受理時伺服端擋：維修單（`REPAIR`）不能走採購評估、非料件需求不能走庫存出庫。已有有效採購單（任何非取消狀態，含草稿）或已出庫的需求單，不可再按「請門市補資料」，改用留言；草稿採購單若要補資料，須先取消該草稿。 |
| D5 | `overdue_flag` | 「待門市確認」超過 7 天（設定可調，預設 7）的單不自動結案；總務工作台標醒目「逾期未確認」，並有一鍵篩選。不通知。 |
| D6 | `threshold`（**與建議不同**） | 含稅總額**超過** 5000 元（暫定，設定頁可調；比較用 `>`，剛好 5000 免核准）的採購單必須在系統內核准才能下訂；增加「待核准」狀態與待簽核清單。核准人由新權限碼 `general_affairs.purchase_order.approve`（採購核准）決定，管理員在角色權限頁指派給任何角色。**不建「採購單位」角色**：使用者原意是可增加核決權限，以可指派的權限碼實作最彈性；DEV 種子角色 `vue_workspace_ga_po_approver` 僅供測試，正式區草稿只新增權限碼並在 README 說明如何指派。核准人不可核准自己建的單。駁回須填原因並退回草稿，可修改再送。 |
| D7 | `multi_one_vendor` | 一張採購單一個供應商、多個品項；品項可為料件或自由品名，有數量、單價；單號 `PO-YYYYMMDD-NNN`，日期台北時間，流水每日歸零（三位數，滿 999 擴為四位）。 |
| D8 | `readonly_pick_temp` + 使用者補充 | **採購單只能選已建好的供應商（`ga_vendors`，啟用、未刪除），不可臨時輸入名稱**（取代問卷原選項的「臨時輸入」）。供應商維護頁仍是第 6 批：第 6 批前請在舊版廠商管理頁新增，新版讀同一份資料；採購單上放「去舊版新增供應商」連結（開舊版 `/general-affairs/vendors`，新分頁）。下訂時複製供應商名稱、統編、付款條件成快照存進採購單，之後廠商改資料不影響舊單。帳務欄位（統編、付款條件快照與廠商銀行等資料）只給有廠商管理或檢視權限者看，伺服端遮蔽；銀行帳號等廠商帳務資料**不複製**進採購單。 |
| D9 | `recent5_new_only` | 選了料件後，該品項旁顯示同料件最近 5 筆「已下訂以上」（`ORDERED`、`PARTIALLY_RECEIVED`、`RECEIVED`、`CLOSED`）採購：日期（台北）、供應商（快照名稱）、單價、數量、單號。草稿、待核准、已核准未下訂、已取消不算；不回推舊版評估，從上線日起累積。自由品名無歷史價。 |
| D10 | `lock_after_order` | 狀態：草稿 → 已下訂 → 部分到貨 → 全部到貨 → 已結案，另有已取消，加 D6 的待核准、已核准待下訂（§3.1）。下訂後品項、數量、單價鎖定，只能改備註與預計到貨日。下訂前可取消（原因選填）；下訂後尚未到貨可取消但須填原因；已有到貨紀錄只能「短收結案」（須填原因），不能取消。 |
| D11 | `same_person_ok` | 開單、下訂、到貨驗入、配發不限制不同人；有三個權限的總務可以做全部步驟。系統記錄每一步操作人與時間（事件表），採購單上顯示。**與 D6 的取捨**：D11 只放寬「採購流程各步驟」，核准是唯一例外——核准／駁回須持採購核准權限，且核准人不可是開單人，也不可是最後一次送核准的人（`created_by`、`submitted_by`）。管理員（`profiles.role==='admin'`）不繞過核准（DB 無 admin bypass，與第 3 批帳務寫入一致）。若公司只有一位核准人又是開單人，該人要核准自己開的單時需另一位持核准權限者。核准人**不需**持有三個採購權限（只需核准權限即可看到單與金額並核准／駁回），反之持三個權限者沒有核准權限不能核准。 |
| D12 | `one_step`（**與建議不同**） | 到貨與驗入合併一步：登錄到貨（即進貨紀錄 `ga_purchase_receipts`）的同時驗入，總部倉庫存立即增加（入庫過帳）。可部分到貨；短收、破損須填原因。因此**沒有**「待驗收」狀態，也沒有獨立的驗入動作。 |
| D13 | `block_over` | 廠商多送貨一律擋：本次到貨量不得超過該品項剩餘可收量（訂購量減已驗入量）。真要多收，先修改採購單（已下訂則取消重開）。 |
| D14 | `one_part_one_model` | 料件上標記「採購入庫後可轉成哪個設備型號」：`ga_parts.equipment_template_id`（一個料件一個型號，一個型號可有多個料件）。找不到對應時，配發當下手動選型號。**不使用**舊的 `ga_part_target_compatibilities`（適用對象相容設定，另作他用不變）。 |
| D15 | `dispatch_creates_assets` | 配發 = 總部倉出庫 N ＋ 為該門市建 N 筆設備，在同一個資料庫交易內完成，失敗全部不算；可分次配發；每台設備連結回採購單與進貨紀錄，帶入型號、購價、供應商、保固起算日；序號可空白，由店長貼標時補填；建立後該店立刻收到貼標待辦。 |
| D16 | `both_paths_per_item` | 每個採購品項各自選「入總部庫存」（預設）或「到貨時直接建立設備送門市」。直接建設備發生在到貨那一步（D12 合併），不進庫存。 |
| D17 | `batch_4_5` | 進貨單憑證、發票、請款單另立第 4.5 批；本批不做。 |
| D18 | `structured_show_diff`（延後） | 屬第 4.5 批；只記錄於 §10。 |
| D19 | `record_only`（延後） | 屬第 4.5 批；只記錄於 §10。 |
| D20 | `repair_all_open` | 設備轉到新門市時，只搬「維修類」（`request_type='REPAIR'`）未結案（`main_status` 不是 `COMPLETED`、`REJECTED`、`CANCELED`）需求單及其工單，包含「待門市確認」與「待門市補資料」，由新店店長接手；添購等其他類型不搬；沒連到需求單的舊式工單不搬，在轉移單上列出清單請總務人工處理。 |
| D21 | `timeline_no_notify` | 不發通知；時間軸記一筆公開事件「因設備轉移，由 A 店轉到 B 店」；轉移單可點開看搬了哪幾張單；發起轉移前畫面明確告知「進行中的單會一起轉到新門市」；舊店只保留已結案單；「更正所屬門市」也帶走進行中的單。 |
| 補充 | `stock_and_asset` | 印表機這類設備「庫存與設備兩者都要」：驗入先加總部庫存，配發門市時轉成有資產編號的設備（D14、D15）。 |

### 2.3 核可的 assumptions（採用，並補本設計的具體落點）
- 採購單入庫收貨位置預設用既有總部倉預設位置（`ga_inventory_locations` 類型 `WAREHOUSE`、`is_default`、啟用）；上線前確認正式區確實有一個，沒有就先建（列入 `31` 預覽檢查）。
- 採購權限沿用三個：`general_affairs.purchase_review.manage`（採購評估管理）、`general_affairs.inventory_transaction.manage`（庫存過帳）、`general_affairs.part.view`（庫存料件檢視）；缺任一個不能開單、下訂、取消、短收結案、到貨驗入、配發，畫面說清楚缺哪個（比照第 3 批 Q13）。**只新增一個權限碼：`general_affairs.purchase_order.approve`**（D6）。D11 明定三個權限的人可做全部步驟，故配發建立設備**不另要求** `equipment.manage`（由 SECURITY DEFINER 函式在採購流程內建立，列入差異清單）。
- 採購單只做頁面顯示，不做訂購單 PDF；下訂、核准、到貨、配發先不發推播。
- 正式區新增資料表（採購單、品項、事件、進貨紀錄、進貨明細、配發單、設定、搬走的單子紀錄）與欄位（料件型號對應、設備來源連結、處理單與留言等），一律先出 SQL 草稿（`31` 至 `35`），附還原，備份後經使用者核可才執行；第 4.5 批的發票、請款表不在本批。
- DEV 測試要補採購總務、核准人、缺權限測試角色（`seed-workspace-role-matrix-dev.cjs`）。
- 劇本角色：總務採購（開單到配發）、另一位持總務角色的帳號（複核、工務）、核准人、需求單提出的店長、收到配發設備的店長（貼標拍照）；店長只處理自己管理的門市。
- 資產編號與 QR 沿用舊版建立設備的規則（`supabase/migrations/20260730002830_generate_equipment_asset_code_sequence.sql`、第 2 批 `assets.ts` 新增路徑、`ga_asset_code_sequences`）。**動工前先查證舊規則細節與是否有防重複檢查，有疑問先向使用者確認再實作。**

## 3. 新版做法

### 3.1 狀態機

**需求單 `main_status`（G16；Q17 已定，伺服端強制）**
| 目前狀態 | 可執行 | 結果 |
|---|---|---|
| `PENDING_INTAKE`（待受理） | 受理 | `ACCEPTED`（受理時套 D4 擋）；請門市補資料 → `WAITING_STORE_SUPPLEMENT`；駁回 → `REJECTED`（有進行中工單或有效單據禁止）；門市撤回、總務取消 → `CANCELED` |
| `WAITING_STORE_SUPPLEMENT` | 門市補充 | 回 `PENDING_INTAKE` 或 `WAITING_GA_REVIEW` 依舊版；取消 → `CANCELED` |
| `WAITING_GA_REVIEW` / `ACCEPTED` | 選處理方式（轉工單、庫存出庫、調撥、採購評估）、駁回、取消 | 選處理方式後 `IN_PROGRESS`；已出庫或有採購單據不可取消、不可請門市補資料（D4） |
| `IN_PROGRESS` | 登記異常、送門市確認（處理單「待交付」後由總務按）、取消（限無單據） | `WAITING_STORE_CONFIRMATION`、`CANCELED` |
| `WAITING_STORE_CONFIRMATION` | 門市確認完成、回報有問題、總務代按（填說明，標「總務代門市操作」） | `COMPLETED`、回 `IN_PROGRESS`；超過 7 天標逾期（D5，只標示） |
| `COMPLETED`、`REJECTED` | 重新開啟（須填原因） | 回 `IN_PROGRESS`（已完成）或 `PENDING_INTAKE`（已駁回） |
| `CANCELED` | 無 | 終態 |
所有轉換在資料庫函式內以目前狀態為條件並鎖列；不合法回 `409` 與白話原因。

**採購單 `ga_purchase_orders.status`（G25）**
| 狀態 | 中文 | 進入條件 |
|---|---|---|
| `DRAFT` | 草稿 | 新建、從評估自動產生、被駁回、撤回核准、撤回送簽 |
| `PENDING_APPROVAL` | 待核准 | 含稅總額 > 門檻，開單人按「送核准」 |
| `APPROVED` | 已核准待下訂 | 核准人核准（紀錄核准人、時間、備註） |
| `ORDERED` | 已下訂 | 按「下訂」：總額 ≤ 門檻的草稿可直接下訂；> 門檻須已核准。此時複製供應商快照、鎖定品項數量單價 |
| `PARTIALLY_RECEIVED` | 部分到貨 | 第一次到貨驗入後仍有剩餘可收量 |
| `RECEIVED` | 全部到貨 | 所有品項驗入量達訂購量（自動） |
| `CLOSED` | 已結案 | 全部到貨後按「結案」，或有到貨紀錄時「短收結案」（須填原因）；結案後完全鎖定 |
| `CANCELED` | 已取消 | 下訂前取消（原因選填）；已下訂未到貨取消（須填原因） |
動作：`submit`（DRAFT → PENDING_APPROVAL，檢查必填、供應商有效、含稅額 > 門檻）、`withdraw`（PENDING_APPROVAL → DRAFT，開單人或持三權限者）、`approve`、`reject`（PENDING_APPROVAL → DRAFT，原因必填，並記入 `last_reject_*`）、`revoke_approval`（APPROVED → DRAFT，要改品項金額時用，原因必填）、`place_order`、`cancel`、`short_close`、`close`、`receive`（登錄到貨，不改狀態機動作，只觸發 ORDERED → PARTIALLY_RECEIVED／RECEIVED）。門檻以送核准時快照存入 `approval_threshold_snapshot`；之後調整門檻只影響之後送出的單；已核准的單若在下訂前被改金額（只能先 `revoke_approval`）需重新送核准。
- 金額：品項單價為未稅；稅率預設 5%（設定可調）；`subtotal`、`tax_amount`、`total_amount`（含稅）由資料庫函式算並回存，四捨五入到整數元；「含稅總額 > 門檻」用 `total_amount`。

### 3.2 資料模型（計畫，欄位以實作時 `information_schema` 與函式定義再核）
**新表**
- `ga_purchase_orders`：`id`、`po_no`（UNIQUE，`ga_next_po_no()` 以 `pg_advisory_xact_lock` 取台北當日流水）、`status`、`vendor_id`（NOT NULL 於送核准／下訂時檢查）、`vendor_name_snapshot`、`vendor_tax_id_snapshot`、`vendor_payment_terms_snapshot`（下訂時寫入）、`source_request_id`、`purchase_review_id`、`receiving_location_id`、`expected_delivery_date`、`tax_rate`、`subtotal`、`tax_amount`、`total_amount`、`approval_required`、`approval_threshold_snapshot`、`submitted_by/at`、`approved_by/at/note`、`last_reject_by/at/reason`、`ordered_by/at`、`closed_by/at`、`cancel_reason`、`short_close_reason`、`notes`（內部備註）、`created_by/at`、`updated_by/at`（`updated_at` 即版本）。
- `ga_purchase_order_items`：`id`、`po_id`、`line_no`、`part_id`（可空）、`item_name`、`spec`、`unit`、`quantity`、`quantity_base`、`unit_price`、`line_amount`、`request_id`（連結需求單，可空）、`fulfil_mode`（`STOCK`、`DIRECT_ASSET`、`NO_STOCK`）、`target_store_id`（`DIRECT_ASSET` 必填）、`equipment_template_id`（`DIRECT_ASSET` 在料件沒有對應時必填）、`over_request_reason`、`received_qty`、`dispatched_qty`、`notes`。CHECK：`part_id` 與 `item_name` 至少一個；`STOCK` 必須有 `part_id`。**自由品名且非設備者用 `NO_STOCK`（只登錄到貨，不入庫不建設備）——這是設計補的第三種，問卷只問兩條路，列入差異清單 `approvedBy` null 待使用者確認。**
- `ga_purchase_order_events`：每個動作一筆（`event_type`、`from_status`、`to_status`、`actor_id`、`note`、`payload jsonb`、`created_at`）；D11 的「每步操作人與時間」來源；不可改刪觸發器。
- `ga_purchase_receipts`（進貨紀錄，D12 的「登錄到貨」）：`receipt_no`（`RC-YYYYMMDD-NNN`）、`po_id`、`received_date`（台北，不可未來）、`delivery_note_no`（廠商送貨單號，選填）、`notes`、`idempotency_key`（UNIQUE）、`created_by/at`。
- `ga_purchase_receipt_items`：`receipt_id`、`po_item_id`、`delivered_qty`、`accepted_qty`、`rejected_qty`、`reason`（短收或破損必填）、`received_part_id`（預設等於品項料件）、`location_id`、`change_reason`（位置或料件與採購單不同時必填）、`inventory_transaction_id`（`STOCK`）、`dispatched_qty`（FIFO 配發用）。**第 4.5 批的「進貨單憑證、發票」將重用本兩表，不得讓本批結構妨礙擴充（預留 `voucher_*` 由 4.5 再加）。**
- `ga_stock_dispatches`（配發單）：`dispatch_no`（`DSP-YYYYMMDD-NNN`）、`po_item_id`、`part_id`、`store_id`、`quantity`、`equipment_template_id`、`source_location_id`、`issue_transaction_id`、`request_id`（可空）、`idempotency_key`（UNIQUE）、`notes`、`created_by/at`。
- `ga_workflow_settings`：`key`、`value_num`、`value_text`、`updated_by/at`；鍵：`po_approval_enabled`（1）、`po_approval_threshold`（5000）、`po_tax_rate`（0.05）、`request_overdue_confirm_days`（7）、`po_price_history_limit`（5）。
- `ga_asset_transfer_moved_requests`（35）：`id`、`transfer_id`（可空）、`asset_event_id`（更正所屬門市時用）、`asset_type`、`asset_id`、`kind`（`REQUEST`、`WORK_ORDER`、`UNLINKED_WORK_ORDER`）、`request_id`、`work_order_id`、`from_store_id`、`to_store_id`、`moved`（boolean，`UNLINKED_WORK_ORDER` 為 false，只列清單）、`created_at`。
**既有表新增欄位（皆可為空，舊畫面不受影響）**
- `ga_parts.equipment_template_id`（D14）。
- `ga_equipment`：`source_purchase_order_id`、`source_po_item_id`、`source_receipt_item_id`、`source_dispatch_id`、`source_request_id`、`purchase_price`、`vendor_id`、`vendor_name_snapshot`、`warranty_start_date`（若既有欄位語意相同則重用，實作時核對）。
- `ga_part_fulfillments.ready_to_deliver_at`（Q18「待交付」）；`ga_part_fulfillment_documents.voided_at`、`void_reason`、`voided_by`（Q18 逐筆作廢）。
- `ga_service_request_comments.edited_at`、`deleted_at`、`original_body`（Q16；實作時先查表是否已有）；`ga_service_request_events` 加 `proxy_for_store boolean`、`public_to_store boolean`（時間軸公開事件，D21）。
- `ga_service_requests.cancel_reason`、`reopened_count`（Q17；實作時先查）；`ga_purchase_review_quotes.superseded_at`（Q18 報價保留歷史）。
**權限碼**：`permissions` 表新增 `general_affairs.purchase_order.approve`（名稱「採購核准」，模組總務；`INSERT ... ON CONFLICT DO NOTHING`，不指派給任何角色）。

### 3.3 設備型號對應料件與配發轉設備（G26）
- **對應**：第 1 批料件頁（`Parts.vue`）新增欄位「採購入庫後可轉成的設備型號」（可搜尋選擇器，選 `ga_equipment_templates`，可清空）。同型號可被多個料件指向；一個料件只能指一個型號。停用的型號不可新選；型號被停用後已設定的對應保留，配發時提示請改選。
- **配發（`ga_ws_po_dispatch`）**：輸入採購單品項（`STOCK` 模式且已驗入量大於已配發量）、目標門市、數量 N（正整數）、型號（料件有對應則帶入，要改須填原因；沒有對應則必選）、來源位置（預設採購單收貨位置）、序號清單（0 至 N 個，可空）、備註、固定識別。同一交易內：驗權限（三個）→ 鎖採購品項與進貨明細（FIFO，依進貨日期與時間由舊到新分配到各進貨明細，一次配發可跨多個進貨明細）→ 驗門市啟用、型號有效、N ≤ 可配發量 → 呼叫 `ga_ws_inv_post`（ISSUE，來源位置，原因「配發為設備 DSP-…」，固定識別衍生自配發識別，庫存不足依位置政策擋）→ 依舊版建立設備規則產生 N 筆 `ga_equipment`（資產編號、QR 沿用）→ 寫 `ga_stock_dispatches` 與設備來源連結 → 更新 `dispatched_qty` → 寫事件。任一步失敗整筆回復。可分次；重送同識別回原結果。
- **每台設備帶入**：型號與分類來自型號、`purchase_price` 取品項單價（含稅與否於實作前核對舊欄位語意，記入 §9）、`vendor_id` 與名稱快照、`warranty_start_date` = 該進貨明細的到貨日期（台北；到期日若舊版規則由型號保固月數算，沿用）、`source_*` 連結（含 `source_request_id` 當採購品項連了需求單且需求單門市等於配發門市）。
- **序號與貼標**：序號可空；建立後走第 2 批貼標流程（待上傳照片 → 待上傳貼標照 → 待總務複核 → 完成），該店店長手機立即有待辦；店長在貼標步驟可補填序號（新增 `ga_ws_onboarding_set_serial`，限該門市管理者與設備管理權限者，已有值要改須填原因、事件留紀錄、同型號序號不可重複）。
- **直接建設備（D16 `DIRECT_ASSET`）**：到貨驗入時，該品項驗入量 N 直接在同一交易建 N 筆設備送 `target_store_id`，不入庫存，連結同上；要求驗入量為整數。
- **不得配發**：已配發設備的庫存不可退；退貨暫時以庫存調整出＋原因處理（第 4.5 批前不做獨立退貨單）。

### 3.4 權限（以資料庫為準；DB 無 admin bypass，應用層 `profiles.role==='admin'` 僅作導覽／唯讀保底，不套用在採購寫入）
| 動作 | 需要 |
|---|---|
| 看採購單清單與詳情 | `purchase_review.view` 或 `manage`，或 `purchase_order.approve` |
| 供應商統編、付款條件快照、廠商帳務欄位 | 另需 `vendor.view` 或 `vendor.manage`；否則伺服端遮蔽（核准人沒有也只看到名稱） |
| 開單、編輯草稿、送核准、撤回、下訂、取消、短收結案、結案、撤回核准 | `purchase_review.manage` ＋ `inventory_transaction.manage` ＋ `part.view`（缺哪個說清楚） |
| 到貨驗入、配發 | 同上三個 |
| 核准、駁回 | `purchase_order.approve`；且不得為開單人與最後送核准人；管理員不繞過 |
| 看待簽核清單 | `purchase_order.approve` |
| 調整核准門檻、稅率 | `purchase_order.approve`；每次變更寫事件（誰、舊值、新值） |
| 看歷史價 | 可看採購單者 |
| 需求單與處理單頁動作 | 沿用 Q16 至 Q18：`request.manage`、`part_fulfillment.manage`、`purchase_review.manage`；沒有採購評估權限者看不到金額與供應商 |
| 逾期未確認天數設定 | `request.manage` |
| 序號補填 | 該門市 `store_managers` 任何身分（店長為主）、`equipment.manage` |
角色種子（DEV，`vue_workspace_ga_*` 與 `@example.test` 範圍）：`vue_workspace_ga_purchaser`（三個權限＋需求單管理）、`vue_workspace_ga_po_approver`（核准權限＋`purchase_review.view`）；測試帳號 `ga_po_purchaser`、`ga_po_approver`、`ga_po_review_only`（只有採購評估管理）、`ga_po_stock_only`（只有庫存過帳）、`ga_po_no_partview`（缺料件檢視）；既有 `vue_workspace_ga_staff` 若無三個權限先檢查再補。正式區 README 說明：到「角色權限」頁，選要擔任核決的角色，勾「採購核准」即可，可同時指派給多個角色。

## 4. 頁面與 API

### 4.1 頁面與導覽
- G14 `pages/ga/ReportCreate.vue`（支援 `assetToken`、QR 掃描後導入；part-requests/new 已併入，排除）。
- G15 `pages/ga/MyReports.vue`（留言、店端確認、設備入帳任務）。
- G16 `pages/ga/Requests.vue`（受理、出庫、採購評估、調撥、關聯採購單進度、逾期未確認篩選）。
- G17 `pages/ga/PartFulfillments.vue`（保留 `fulfillmentId` 參數契約；決定、待交付、送門市確認、異常逐筆作廢、單據）。
- G25 `pages/ga/PurchaseOrders.vue`（`/general-affairs/purchase-orders`：清單、統計卡、詳情抽屜含品項、時間軸、進貨紀錄、配發紀錄；登錄到貨對話框；配發對話框；設定對話框，限核准人）、`pages/ga/PurchaseOrderEdit.vue`（新增與編輯草稿，歷史價顯示、「去舊版新增供應商」連結）、`pages/ga/PurchaseApprovals.vue`（`/general-affairs/purchase-orders?view=approvals`，待簽核清單：核准、駁回需原因）。命名避開 `InventoryTransfers.vue` 與 `AssetTransfers.vue`。
- `nav.ts` 的 `GA_PAGE_BY_HREF` 新增上述 href（含 `?view=approvals` 以完整 href 對應）；同步 `access.ts` 旗標、`page-kinds.ts`、`workspace-page-meta.ts`、`workspace-pages.ts`、`tests/fixtures/role-matrix.json`、`t03-nav-baseline.json`。
- 需求單頁、處理單頁加「採購單」區塊：列出連結的所有採購單（單號、供應商、狀態、已驗入／訂購量），可點開。
- 設備移轉相關：既有 `AssetTransfers.vue`／發起對話框（第 2 批）加 D21 的告知文字與「搬走的單」明細；設備編輯的「更正所屬門市」確認視窗加同樣告知。

### 4.2 API（`/api/workspace/general-affairs/**`，由 `router.ts` 分派；共通：非 GET 要 `checkOrigin`、使用者身分、`GaError`、`page/pageSize ≤ 100` 回 `{data,total}`、寫入帶 `expected_updated_at` 回 `409 STALE`、伺服端欄位遮蔽）
**採購單（`lib/workspace/general-affairs/purchase-orders.ts`，視大小拆 `purchase-order-receipts.ts`、`purchase-order-rules.ts`）**
| 路徑 | 說明 |
|---|---|
| `GET/POST /purchase-orders` | 清單（狀態、供應商、關鍵字、我開的、逾期未到貨篩選，伺服端精確統計卡）／建單 |
| `GET/PATCH /purchase-orders/:id` | 詳情（遮蔽帳務欄位）／編輯草稿（版本檢查，整張品項替換） |
| `POST /purchase-orders/from-review` | 由評估產生草稿 `{reviewId}`（亦由評估儲存時在同交易內呼叫） |
| `POST /purchase-orders/:id/actions` | `submit`、`withdraw`、`approve`、`reject`、`revoke_approval`、`place_order`、`cancel`、`short_close`、`close`；各動作帶 `note` 與 `expected_updated_at` |
| `GET/POST /purchase-orders/:id/receipts` | 到貨驗入紀錄／登錄（固定識別、一次完成） |
| `GET/POST /purchase-orders/:id/dispatches` | 配發紀錄／配發（固定識別、一次完成） |
| `GET /purchase-orders/approvals` | 待簽核清單與數量 |
| `GET /purchase-orders/price-history?partId=` | 最近 5 筆已下訂以上（D9） |
| `GET /purchase-orders/vendor-options` | 供應商搜尋＋分頁（只回啟用、未刪除；帳務欄位依權限） |
| `GET /purchase-orders/options` | 位置、料件（含型號對應）、型號、門市（搜尋＋分頁） |
| `GET/PATCH /purchase-orders/settings` | 門檻、稅率、歷史價筆數 |
**回報與需求單、處理單**：`/reports`（POST 建立、`/reports/mine`）、`/request-targets`、`/requests`（GET、POST）、`/requests/:id`（GET、PATCH 動作：`accept`、`reject`、`request_supplement`、`route`、`assign`、`cancel`、`reopen`、`withdraw`）、`/requests/:id/comments`、`/requests/:id/store-actions`（含 `proxy` 說明）、`/requests/:id/stock-issue`、`/requests/:id/purchase-review`（儲存「進入採購」時產生草稿採購單）、`/requests/settings`（逾期天數）、`/part-fulfillments`（GET、POST）、`/part-fulfillments/:id/decision`、`/deliver`（送門市確認）、`/exception`（含逐筆作廢）、`/documents/:type/:id`。舊 `purchase-receipt` 不在新版：有採購單的需求單不提供收貨按鈕。
**型號對應**：沿用第 1 批 `parts` API，`PATCH /parts/:id` 接受 `equipment_template_id`（含驗證與事件）。
**貼標序號**：`POST /onboarding/:type/:id/serial`。
**資產移轉**：`POST /asset-transfers/:id/actions` 的收貨與更正所屬門市動作在資料庫函式內搬單；`GET /asset-transfers/:id` 回搬走的單。

### 4.3 資料庫函式（`ga_ws_*`，皆 SECURITY DEFINER、`has_permission(auth.uid(), …)` 正式區語意、必須使用者身分、回 `{ok, status, data, error, code}`）
- 需求單：`ga_ws_req_accept`、`ga_ws_req_transition`（含取消、重新開啟、撤回、駁回前置檢查、補資料檢查）、`ga_ws_req_store_action`（含代按）、`ga_ws_req_comment_edit/delete`、`ga_ws_req_overdue_count`。
- 處理單：`ga_ws_ful_deliver`（待交付 → 送門市確認）、`ga_ws_ful_void_document`、`ga_ws_ful_decision`（改決策時舊採購單標已取消、已到貨者擋、報價保留歷史）、`ga_ws_ful_stock_issue_guard`。
- 採購單：`ga_ws_po_create`、`ga_ws_po_update`、`ga_ws_po_from_review`、`ga_ws_po_action`、`ga_ws_po_receive`、`ga_ws_po_dispatch`、`ga_ws_po_price_history`、`ga_ws_po_list`、`ga_ws_po_settings_get/set`、`ga_next_po_no`、`ga_ws_po_request_remaining`（需求單剩餘量）。
- 貼標序號：`ga_ws_onboarding_set_serial`。
- 資產移轉：重新定義第 2 批的轉移確認收到與更正所屬門市函式（簽章不變），加 `ga_ws_asset_move_open_requests`。
- DEV 專用：`ga_dev_cleanup_m7m8_purchasing`（清 `[自動測試]M7M8` 標記的採購單、進貨、配發、設備、流水，暫停不可改刪觸發器，不套正式區）。

## 5. SQL 計畫（檔名與順序）

### 5.1 DEV（`supabase/workspace-dev/`，各附 `.rollback.sql`；套用腳本 `scripts/apply-workspace-m7m8-b4-dev.cjs [--rollback]`，比照第 3 批，只連 DEV，執行前確認 project-ref 以 mjpd 開頭）
- `20261112100000_m7m8_b4_request_rules.sql`（A：需求單與處理單規則、留言與事件欄位、設定表、待交付、作廢）
- `20261112110000_m7m8_b4_purchase_orders.sql`（B：採購單全套表與函式、核准權限碼、單號、歷史價）
- `20261112120000_m7m8_b4_receipt_dispatch.sql`（C：到貨驗入、料件型號對應、設備來源欄位、配發、直接建設備、貼標序號）
- `20261112130000_m7m8_b4_asset_transfer_follow.sql`（D：搬單、搬走紀錄表）
- `20261112140000_m7m8_b4_dev_test_cleanup.sql`（DEV 專用，不套正式區）
- `20261112150000_m7m8_b4_dev_roles.sql`（DEV 專用：採購與核准測試角色，不套正式區）

### 5.2 正式區草稿（`docs/vue-workspace/parity-plan/m7m8-sql/`，接續現有最大號 30，均附 rollback；`README.md` 新增「第 4 批」章節與套用順序）
| 檔案 | 內容 |
|---|---|
| `31-b4-preview-before-apply.sql` | 唯讀預覽：相關資料表筆數、進行中需求單與處理單、有採購評估且狀態停在等待到貨的需求單（新舊並存風險）、總部倉預設位置是否唯一、`ga_vendors` 啟用筆數與統編空白筆數、`ga_parts`／`ga_equipment` 目前欄位是否已有新欄位、被 D4 新規則會擋到的進行中單、`pg_get_functiondef` md5 比對（第 2 批轉移函式）、`general_affairs.purchase_order.approve` 是否已存在、持三個採購權限的角色名單 |
| `32-b4-request-rules.sql`／`-rollback.sql` | A |
| `33-b4-purchase-orders.sql`／`-rollback.sql` | B（含新增權限碼；rollback 刪權限碼前先檢查是否已有角色指派） |
| `34-b4-receipt-dispatch.sql`／`-rollback.sql` | C |
| `35-b4-asset-transfer-follow.sql`／`-rollback.sql` | D（依備份還原第 2 批兩個函式） |
套用順序：`31`（唯讀）→ 沒有 MISSING、md5 OK → `32` → `33` → `34` → `35`；撤回相反。依賴：33 需要 32 的設定表；34 需要 33 的表與第 3 批 28 的 `ga_ws_inv_post`；35 需要 21 的轉移表與 32 的事件欄位。套用前以 `pg_get_functiondef` 比對 DEV 與正式區；所有函式簽名在比對前視為草稿；備份後經使用者核可才執行。正式區 README 增補：如何在角色權限頁指派「採購核准」；上線前確認有一個預設總部倉；舊版廠商管理頁新增供應商的步驟。

### 5.3 DEV 測試資料與清除
流水不可改刪，過帳產生資料無法用 `cleanupM7M8` 清掉：一般測試以 `seedBalance` 種餘額；只有驗入與配發本身的測試才真過帳，並呼叫 `ga_dev_cleanup_m7m8_purchasing`，掛進 `cleanupM7M8` 與 `sweep-targets.cjs`。測試門市 VW001、VW002、ZT01 至 ZT05，年份優先 2038；採購單、供應商、料件、型號、設備名稱一律帶 `[自動測試]M7M8` 標記；測試供應商 `ga_vendors` 也帶標記並由清除函式移除。結束只清自己的。

## 6. 測試計畫
測試 ID：**G14**（回報建立）、**G15**（我的追蹤）、**G16**（需求單工作台）、**G17**（料件處理中心）、**G25**（採購單、核准、到貨驗入）、**G26**（型號對應與配發轉設備）、**G27**（資產移轉單子跟著走，B6）。檔名比照 `G11.*`：`tests/unit|integration|parity|e2e` 下 `G14.*` … `G27.*`。**注意**：第 3 批角色劇本檔已叫 `G14.journey-inventory.e2e.spec.ts`（沿用「劇本」編號），不改名；本批新劇本一律以功能 ID 命名，避免混淆（下列）。
- **smoke**：各頁可開（桌機 1440、手機 390 無橫向捲動、無 console 錯誤）、導覽 href 對應正確、無權限看不到入口且 API 回 403／401。
- **unit**：採購單金額與稅額計算、門檻判斷（含剛好 5000）、單號格式（台北日期）、狀態轉換表（允許與禁止全覆蓋）、`abilities()`（含兩權限缺哪個、核准人不可為開單人）、需求量加總（含單位換算）、剩餘可收量、FIFO 配發分配、歷史價篩選、欄位遮蔽（帳務欄位）、需求單合法流轉表、逾期判斷、`orIlike` 跳脫。
- **integration**（`ga_ws_*` RPC 與 API；每支寫入驗權限矩陣、Origin、400、409、冪等，並用 service role 回讀 DB；RPC 有 `BEGIN…ROLLBACK` SQL 測試）：核准門檻前後行為；核准人與開單人相同被擋、管理員不繞過；駁回要原因並退回草稿可再送；下訂後鎖定與只改備註；取消與短收結案規則；到貨超量被擋（D13）、短收與破損需原因、改位置或料件需原因（D3）、同一識別重送回原結果、併發兩人同時到貨不超收；配發一次完成與失敗整體回復、分次與跨進貨明細 FIFO、序號可空與補填、保固起算日、設備來源連結；`DIRECT_ASSET` 不入庫存；供應商必須是已建好的啟用供應商、快照在廠商改名後不變、帳務欄位遮蔽；D4 受理與補資料擋；D5 逾期篩選；D2 多張採購單需求量加總；Q16 至 Q18 全部規則；B6 搬單（只搬維修類未結案含待確認、待補資料；添購不搬；舊式工單列清單；更正所屬門市也搬；舊店只剩已結案單）。
- **parity**：同帳號呼叫舊 `/api/general-affairs/requests*`、`part-fulfillments*`、`purchase-reviews*` 與新 API，正規化比對列表、詳情與寫入結果；差異全登記 `allowlist.json`。
- **e2e 角色接力劇本**（循序）：
  1. **`G25.journey-printers.e2e.spec.ts`「總務主動購置印表機 5 台」**：總務採購（桌機）建採購單（供應商選已建好的測試供應商、品項為有型號對應的印表機料件 5 台、含稅總額 > 5000，歷史價顯示）→ 送核准 → 核准人（桌機）看到待簽核；先驗證開單人自己核准被擋 → 核准人駁回填原因 → 退回草稿修改再送 → 核准 → 總務下訂（供應商快照）→ 第一次到貨 3 台全收（總部庫存 +3）→ 第二次到貨 2 台中 1 台破損（填原因，庫存 +1）→ 嘗試超量被擋 → 配發 2 台到 ZT01、再配發 1 台到 VW001（庫存扣、建設備、連結採購單與進貨紀錄、序號空白）→ ZT01 店長（手機 390）看到貼標待辦、貼標拍照並補序號 → 另一位持總務角色的帳號複核 → 補收 1 台並配發餘額 → 全部到貨 → 結案。每步檢查對方畫面與事件時間軸；每劇本加「沒權限做不到」檢查（缺權限帳號、非核准人）。
  2. **`G16.journey-equipment-purchase.e2e.spec.ts` Q26「設備添購」**：店長（手機）提出添購需求單 → 總務受理、採購評估選「進入採購」（自動產生草稿採購單並連結需求單；D1）→ 分兩張採購單（兩家供應商，D2；一張金額 ≤ 5000 直接下訂，一張 > 5000 走核准）→ 下訂 → 到貨（`DIRECT_ASSET` 直接建設備送該店）→ 店長收到貼標待辦、貼標拍照 → 總務複核 → 送門市確認 → 店長確認完成 → 結案；加 D4 檢查（已有有效採購單不可請門市補資料、維修單不能走採購）與 D5 逾期標示。
  3. **`G17.journey-part-replenish.e2e.spec.ts` Q26「料件補貨」**：店長回報缺料件 → 總務庫存出庫（超量被擋、料件須相同）→ 庫存不足改走採購（STOCK 模式、採購單入庫）→ 到貨驗入 → 出庫 → 處理單「待交付」→ 總務按送門市確認 → 店長確認（含總務代按須說明分支）；調撥分支沿用第 3 批；異常逐筆作廢重選。
  4. **`G27.journey-transfer-follow.e2e.spec.ts` B6**：A 店有設備與一張待門市確認的維修單、一張添購單、一張舊式工單 → 總務發起轉移（畫面告知進行中的單會一起轉）→ A 店店長交出、B 店店長收到 → 維修單與其工單轉到 B 店（B 店店長接手）、添購單留在 A 店、舊式工單在轉移單清單、時間軸有公開事件、無通知；A 店只剩已結案單；另以「更正所屬門市」再驗一次。
- 版面檢查比照 `G10.layout.e2e`；`test:page` 與 e2e 一律循序，不可平行；run-all 結束碼 1 若只因 sweeper 基準 17 筆孤兒或 fetch failed 視為通過並說明。

## 7. 預計與舊版差異（登記 `tests/parity/allowlist.json`）
`approvedBy`：問卷已核可者設 `"user (2026-11-12 batch 4 spec survey)"`；新發現、問卷未涵蓋者設 `null`（`decision` 為 `fix` 的條目依驗證器規則維持 `null`）。Q16 至 Q18 對應的差異沿用既有 `approvedBy`（`user (2026-11-09 survey/m7m8 …)`）。id 命名 `m7m8-b4-*`。
1. 需求單評估「進入採購」自動產生草稿採購單、需下訂才等待到貨 [D1]。
2. 一張需求單可有多張採購單、需求量加總控管、超量須原因 [D2、D3]。
3. 到貨從採購單操作、改位置或料件須原因 [D3]。
4. 受理擋不合理組合、有採購單或已出庫不可請門市補資料 [D4]。
5. 逾期未確認標示與篩選 [D5]。
6. 採購單超過門檻須系統內核准、待核准狀態、新權限碼、核准人不可為開單人、駁回須原因 [D6、D11 取捨]。
7. 一單一供應商多品項、單號台北日期流水 [D7]。
8. 供應商只能選已建好的、下訂快照、帳務欄位遮蔽、去舊版新增連結 [D8]。
9. 同料件最近 5 筆歷史價 [D9]。
10. 下訂後鎖定、取消與短收結案規則 [D10]。
11. 每步記錄操作人與時間 [D11]。
12. 到貨驗入合併一步、可部分到貨、短收破損填原因 [D12]；超量擋 [D13]。
13. 料件對應設備型號、配發轉設備、分次、序號貼標補填 [D14、D15]；每品項選入庫存或直接建設備 [D16]；印表機庫存與設備兩者都要。
14. 資產移轉（含更正所屬門市）帶走進行中維修單、公開事件、搬走清單 [D20、D21]。
15. Q16 至 Q18 各項（代按標示、內部備註、合法流轉、取消、重新開啟、待交付、逐筆作廢、報價歷史、出庫超量擋）。
16. 新發現（`approvedBy` null）：自由品名非設備品項用 `NO_STOCK`；配發建立設備不另要求 `equipment.manage`（D11 三權限）；採購單草稿算「有效採購單」而擋補資料；門檻與核准人可由持核准權限者調整；序號補填新權限規則；舊 `purchase-receipt` 對有採購單的需求單不提供。
17. 錯誤訊息白話、清單分頁、搜尋跳脫等通則（沿用既有 id 命名慣例）。

## 8. 風險與待確認
- 新舊並存：舊 Next 版需求單頁仍有「收貨」鈕（`purchase-receipt`）與舊評估「等待到貨」；有採購單的需求單若在舊版收貨會雙記庫存。實作者先查該路徑是直接寫表或呼叫函式；若是資料表直寫，用資料庫觸發器在 `32` 擋（有採購單的評估不可寫舊收貨）；若無法擋，列入上線說明「新版上線後，採購請只用新版」並在 `31` 預覽列出停在等待到貨的舊單。
- D6 核准人可調整門檻：持有核准權限者可調高門檻繞過核准，因此每次調整寫事件並在採購單頁顯示當時門檻快照；若使用者要求獨立的「調整門檻」權限，另議。
- 只有一位核准人且常自己開單時流程會卡住（D6 與 D11 的取捨），上線說明要求至少兩位核准人或讓核准人不開單。
- 購價含稅與否、`ga_equipment` 既有金額與保固欄位語意、資產編號規則與防重複，開工前核對（§2.3）；不確定先問使用者。
- 正式區 `ga_vendors` 是否有統編與付款條件欄位、是否已有重複廠商，用 `31` 預覽。
- 搬單時採購單與處理單：維修單的料件處理單、領用單隨需求單搬；已下訂的採購單不因搬單改變；`DIRECT_ASSET` 的 `target_store_id` 不跟著變。
- 序號補填與設備型號序號唯一性檢查若舊資料已有重複，只擋新寫入。
- 所有 `ga_ws_*` 函式簽名在做 DEV 與正式區 `pg_get_functiondef` 差異比對前視為草稿。

## 9. 開工前要核對的舊版細節（實作者第一步，結果寫回本文件新增的「實作紀錄」小節）
1. 逐檔讀 §1.1 的舊頁與 API，補全 G14 至 G17 的舊版功能清單（本文件只有已知事實）。
2. 舊版新增設備流程：資產編號、QR、重複檢查、貼標待辦如何起始（`assets.ts` 與第 2 批 `onboarding.ts`）。
3. 既有 `ga_equipment` 金額、保固欄位名稱與語意；`ga_parts` 是否已有型號相關欄位。
4. `ga_service_request_comments`、`ga_service_requests`、`ga_service_request_events` 目前欄位，決定 `32` 實際要加哪幾欄。
5. 權限碼註冊方式（`permissions` 表欄位、角色權限頁是否自動列出新碼）。
6. 舊 `purchase-receipt` 寫入路徑（§8 第一項）。

## 10. 延後到第 4.5 批（只記錄，本批不做）
- 進貨單憑證（紙本進貨單照片）、發票、請款單（舊版完全沒有）。
- D18：發票記錄類型（三聯式、二聯式、收據、免開發票）、號碼、日期、未稅額、稅額、含稅額，可上傳圖片；稅額依 5% 自動算可手改尾差；請款畫面把採購單、進貨單、發票逐品項並排，有差異須填原因但可送出。
- D19：請款單只當付款申請紀錄（草稿 → 已送出 → 已付款）；付款方式轉帳、現金、支票與日期手填，不接金流、不簽核；一張請款單可帶多張進貨單與發票，累計請款金額不得超過累計進貨金額；退貨先以庫存「調整出」加原因處理，不做獨立退貨單，已轉成設備者不能退、走報廢。
- 本批結構預留：`ga_purchase_receipts`／`ga_purchase_receipt_items` 供 4.5 擴充憑證欄位；採購單「結案」之後 4.5 可加「已請款」檢查；劇本於 4.5 補上請款步驟。

## 11. 建議實作分組（供後續工作拆分）
1. 資料庫：A、B、C、D 四包與 DEV 專用兩包、套用腳本、正式區草稿 31 至 35 與 README。
2. 規則與 API：`lib/workspace/general-affairs/purchase-orders*.ts`、requests、reports、part-fulfillments、parts 對應欄位、onboarding 序號、資產移轉。
3. 前端：G25 三頁與導覽、G14 至 G17 四頁、移轉頁調整；role-matrix 與測試帳號。
4. 測試：G14 至 G17、G25 至 G27 四層加 parity 與四支角色劇本；allowlist；全批驗收。
5. 實作紀錄：每階段完成後在本文件新增「實作紀錄」小節（比照第 3 批 §10）。

## 12. 實作紀錄

### 12.1 G25-db 採購單資料庫層（2026-11-12）
完成 `20261112100000`（A）、`20261112110000`（B）、DEV 專用 `140000`、`150000`、套用腳本 `scripts/apply-workspace-m7m8-b4-dev.cjs`、正式區草稿 `31`、`32`、`33` 與 README 第 4 批章節；純函式 `lib/workspace/general-affairs/purchase-order-rules.ts`；單元 42 項、整合 21 項（`tests/integration/G25-db.purchase-orders-rpc.spec.ts`，含 3 項在資料庫交易內執行且結束一律回復的測試）。C（`120000` 到貨驗入與配發）、D（`130000` 搬單）與 `34`、`35` 留待後續階段；套用腳本與清除函式已預留它們（檔案不存在就略過；清除函式遇到進貨、配發資料表存在才處理）。

**第 9 節開工前核對結果**
1. 舊頁與 API：已逐檔確認 `purchase-receipt` 的寫入路徑（第 6 項）；G14 至 G17 其餘舊版功能清單由後續階段補全。
2. 舊版新增設備流程：資產編號由資料庫函式 `ga_next_equipment_asset_code(category_id, purchased_at)` 依分類第二層代碼與購置日期取號（序號表 `ga_asset_code_sequences`），資料庫有唯一索引 `uq_ga_equipment_asset_code_active`（啟用中資產編號不分大小寫不可重複）與 `uq_ga_equipment_barcode_active`；沒有購置日期就不自動產生編號。規則明確、沒有疑問，配發建立設備（C 階段）沿用，不需要先問使用者。
3. `ga_equipment` 沒有「保固起算日」欄位：既有 `purchased_at`、`activated_at`、`purchase_amount`（購價，含稅與否沒有註明）、`has_warranty`、`warranty_end_date`；型號 `ga_equipment_templates.default_warranty_months` 可算到期日。`warranty_start_date` 與 `source_*` 欄位仍由 C 新增；`purchase_amount` 含稅與否到 C 階段前要決定（預設建議填未稅單價，並在設備備註註明）。`ga_parts` 沒有型號相關欄位，`ga_parts.equipment_template_id` 由 C 新增。
4. 欄位現況：`ga_service_request_comments` 已有 `edited_at`、`deleted_at`，只缺 `original_body`；`ga_service_request_events` 已有 `visibility`（PUBLIC／INTERNAL）可當時間軸公開事件，所以**不另加 `public_to_store`**（與設計 §3.2 不同，避免重複語意），只加 `proxy_for_store`；`ga_service_requests` 加 `cancel_reason`、`reopened_count`；報價加 `superseded_at`。
5. 權限碼註冊：`permissions` 表以 `(module, feature, code, action, description, is_active)` 新增（`ON CONFLICT (code)`）；角色權限頁（`app/admin/roles/[id]/RoleEditClient.tsx`）依資料表列出，顯示名稱來自 `types/rbac.ts` 的 `FEATURE_NAMES`／`ACTION_NAMES`（`approve` 本來就顯示「審核」），已補 `purchase_order: '採購單'`。
6. 舊 `purchase-receipt`：是 Next API 路由，直接呼叫過帳核心 `ga_post_inventory_transaction`（參考單據 `GA_PURCHASE_REVIEW`、參考編號 = 評估 id），並直接更新需求單與處理單；不是資料表直寫，也沒有對應資料庫函式，所以無法在資料庫層擋整條路徑。採用的作法：在庫存流水表加觸發器，**只擋「評估已有未取消的新版採購單」的舊版收貨**（33）；舊版評估尚未開新版採購單的在途單由 `31` 第 5 區列出，上線說明要求採購只用新版。登記 allowlist 新發現 `m7m8-b4-po-legacy-receipt-block`（approvedBy null）。

**與設計文件不同或補充之處**
- 預設總部倉的位置類型實際是 `CENTRAL_WAREHOUSE`（設計寫 `WAREHOUSE`）；DEV 目前沒有預設的中央倉庫（`31` 第 3 區 WARN），採購單收貨位置要手動選或先建預設倉；剛好一個預設倉才會自動帶入。
- `ga_vendors` 沒有 `deleted_at` 欄位，「啟用中、未刪除」以 `status = 'active'`（合作中；另有 `paused`、`inactive`）判斷。
- 單號 `ga_next_po_no` 與舊版評估採購編號（`ga_next_purchase_order_no`，`PO-日期-四位流水`、共用序列）格式相近但不同表、不共用流水；為避免看起來相同，取號時會跳過與評估採購編號相同的號碼。
- 三張採購表登入者完全不能直接讀寫（沒有 RLS 政策、撤銷授權），所有讀取走 `ga_ws_po_get／list`，才能依廠商權限遮蔽統編與付款條件；設計文件 §3.2 沒有明講。新增 `ga_ws_po_get`、`ga_ws_po_vendor_options` 兩個函式（設計函式清單沒列）。
- 動作的版本檢查比照第 3 批：`expected_updated_at` 必填（缺少回 400 `EXPECTED_REQUIRED`）。核准、駁回與設定調整以外的動作要三個權限；`withdraw` 也要三個權限（核准人不能撤回）。
- 核准與駁回都套用「不可是開單人、不可是最後送核准人」。送核准後撤回再由別人送，`submitted_by` 以最後一次為準。
- 需求量超量：同一張需求單加總超過需求量時，本單內連到該需求單的**每個**品項都要填超量原因（設計寫「需填原因」，這裡定為每項）；從評估產生草稿時核准量大於剩餘量就只帶剩餘量，避免一建立就超量；單價由評估金額除以評估核准量推算（優先 final、negotiated、quoted、estimated），標明「請確認」。
- 送核准時含稅總額未超過門檻回 409 `NO_APPROVAL_NEEDED`（說明免核准可直接下訂）；下訂時草稿超過門檻回 409 `APPROVAL_REQUIRED`。已核准的單下訂不再重新比對門檻。
- 設定調整限持採購核准權限者，版本以 `po_*` 設定列的最新更新時間為準；每個有變動的鍵寫一筆 `ga_workflow_setting_events`（誰、舊值、新值）。逾期未確認天數的設定函式留給 G16 階段（需求單管理權限）。
- 事件表不可改刪觸發器的唯一例外：帳號被刪除時外鍵把操作人設為空白。DEV 清除函式暫停觸發器、同交易內恢復。
- 測試中發現並修正的兩個資料庫缺陷：單號滿 999 時 `lpad` 會截斷成三位（已改為四位以上不補零）、評估產生草稿時數量帶出過多小數位（已 `round` 到 4 位）。

### 12.2 G26-db 到貨驗入、配發轉設備、型號對應料件、序號補填（2026-11-12）
完成 DEV 的 `20261112120000_m7m8_b4_receipt_dispatch`（含 rollback）、正式區草稿 `34-b4-receipt-dispatch`（含 rollback，README 第 4 批章節已更新）、純函式 `lib/workspace/general-affairs/purchase-receipt-rules.ts`、料件 API 與規則的 `equipment_template_id`（可清空、型號需啟用）、Vue 料件表單的型號欄位；單元 37 項、整合 22 項（`tests/integration/G26-db.receipt-dispatch-rpc.spec.ts`，含 1 項在資料庫交易內執行且結束一律回復的測試）。DEV 專用清除函式 `ga_dev_cleanup_m7m8_purchasing` 已擴充：一併清掉由測試採購單配發或到貨建立的設備與它們用掉的資產編號流水。Vue 的採購單頁與到貨、配發畫面、workspace API 路由留給後續階段。

**實作的規則（與設計 §3.2、§3.3 對照）**
- **到貨驗入（D12、D13、D3、D16）**：`ga_ws_po_receive(po_id, header, lines, key)`。採購單要是「已下訂」或「部分到貨」；三個採購權限缺哪個講清楚；識別必填（最長 64 字），鎖住採購單後先查識別（同識別同內容回原結果 `idempotent_replay`、同識別不同內容 409）。到貨日預設今天，不可晚於今天、不可早於下訂日。每一列：到貨量 > 0；驗入量預設等於到貨量、不可大於到貨量；到貨量不得超過剩餘可收量（訂購量減**已驗入量**，破損拒收不算已收）；驗入量小於到貨量或到貨量小於剩餘量（短收）要原因；STOCK 品項可改位置、改收替代料（都須變更原因，替代料單位須與品項單位相符）；DIRECT_ASSET 與 NO_STOCK 不能指定位置或料件。STOCK 以 `ga_ws_inv_post` 入庫（參考單據 `GA_PURCHASE_ORDER`、固定識別 = 到貨識別＋品項、過去的到貨日用該日中午當發生時間）；DIRECT_ASSET 直接建設備（驗入量換算基本單位須為整數）；NO_STOCK 只登錄。任何一列失敗整筆回復（包含先前已成功的入帳）。成功後更新品項已驗入量、採購單狀態（全部達訂購量 = 全部到貨、有驗入 = 部分到貨、整批拒收維持原狀）、寫事件 `receive`，並在連結的需求單時間軸加一筆內部事件。
- **配發（D15、D14）**：`ga_ws_po_dispatch(po_item_id, store_id, quantity, template_id, template_reason, source_location_id, serials, notes, key)`。只有 STOCK 品項、且採購單已有驗入；數量 1 至 200 的整數；先依來源位置（預設採購單收貨位置）找最早的可配發進貨明細決定這次配發的料件，可配發量 = 同品項、同位置、同料件各進貨明細「驗入量 − 已配發量」的加總。型號：料件有對應就帶入，改選別的型號要原因；沒有對應必須手選；對應的型號被停用要改選。序號清單依順序給各台，可空，清單內與既有同型號設備序號不可重複。同一交易內：寫配發單 → `ga_ws_inv_post` ISSUE → 依先進先出每台建設備（保固起算日與購置日期 = 該批進貨日、連結進貨明細與配發單）→ 更新已配發量 → 事件 `dispatch`（含分配明細）。任一步失敗整筆回復（含已出庫的流水）。
- **設備欄位**：型號帶入分類、名稱、品牌、型號、規格與用途；購價 = 品項單價換算成每台的**未稅**單價（見下）；供應商與名稱快照；`has_warranty` 與到期日只在型號有預設保固月數時帶出。資產編號沿用舊版（`ga_next_equipment_asset_code`，需分類有第二層分類代碼，購置日期 = 到貨日；QR 與舊版一樣第一次列印才發放）。建立後貼標狀態是 `NEEDS_EQUIPMENT_PHOTO`，該店店長立即在待辦清單看到。
- **序號補填**：`ga_ws_onboarding_set_serial(equipment_id, serial, reason)`，限該門市店長（名單身分 `store_managers`）與設備管理權限者；已有序號要改須原因、同序號不算變更；同型號（或同品牌加型號）序號不可重複；每次變更寫 `ga_equipment_serial_events`。
- **料件對應型號（D14）**：`ga_parts.equipment_template_id`＋觸發器（新設或更換時型號須存在、啟用、未刪除，可清空，型號之後被停用已設定的對應保留；改別的欄位不受影響）；`ga_ws_update_part_guarded` 的允許欄位清單加上它；API 回 422 `TEMPLATE_INVALID`。

**第 9 節核對結果的補充（C 階段）**
- `ga_equipment.purchase_amount` 含稅與否：欄位沒有註明，採建議填未稅單價並在備註註明；**待使用者確認**（allowlist `m7m8-b4-rc-purchase-amount-excl-tax`）。
- 保固：舊版建立設備**沒有**依型號保固月數推算到期日的規則（設計寫「若舊版有就沿用」），所以這是新做法（allowlist `m7m8-b4-rc-warranty-start-and-end`）。
- 資產編號：需要分類有第二層分類代碼；取不到時整筆擋下並說明（`ASSET_CODE_UNAVAILABLE`），不外露資料庫原文。
- 庫存出庫沿用既有的拆封規則：有採購單位且不允許拆封的料件，配發量必須是整箱（`UNPACKING_NOT_ALLOWED`）；配發設備的料件通常以「個／台」為基本單位。

**與設計文件不同或補充之處**
- `dispatched_qty`（品項與進貨明細）一律是**基本單位**，`received_qty` 是**品項單位**；進貨明細另存 `accepted_base`（驗入量換算基本單位）供先進先出使用。
- 購價重用既有 `purchase_amount`，不另加 `purchase_price`；`ga_equipment` 新增 8 欄（來源五個、`vendor_id`、`vendor_name_snapshot`、`warranty_start_date`）。
- 到貨不另設 `expected_updated_at` 版本檢查（併發由「剩餘可收量」與採購單鎖保護，識別保證重送不重複）；配發同理由「可配發量」保護。
- 「短收」解讀為到貨量小於剩餘可收量：一般分批到貨也要填原因（例如「分批到貨」）——待使用者確認是否放寬（allowlist `m7m8-b4-rc-short-delivery-needs-reason`）。
- 一次配發只動同一種料件與同一個來源位置（改收替代料或改位置後，需分次配發）。
- 新增 `ga_ws_po_receipts_get`（進貨、配發、各品項可配發量），設計函式清單沒列；四張新表登入者不能直接讀寫。


### 12.3 G14 至 G17 回報、我的追蹤、需求單工作台、料件處理中心（2026-11-13）
完成 `20261112100000`（A）第二段的規則函式、正式區草稿 `32` 擴充（含 `31` 第 10 區預覽與 README 說明）、四個 Vue 頁面（`ReportCreate.vue`、`MyReports.vue`、`Requests.vue`、`PartFulfillments.vue`）與三個共用元件（`RequestDetail.vue`、`RequestStockIssue.vue`、`RequestPurchaseReview.vue`）、工作台 API（`reports`、`request-targets`、`requests/**`、`part-fulfillments/**`）、純規則 `request-rules.ts`、導覽與權限旗標（`gaReportCreate`、`gaMyReports`、`gaRequests`、`gaPartFulfillments`）。採購單的畫面與 API（G25）、搬單（G27）仍未做。

**舊版功能清單（逐檔讀過後補全；本批保留的功能都已移植，缺的列在「與設計不同或待確認」）**
- **G14 新增需求**（舊 `ServiceRequestCreateClient`）：類型分「維修／現場狀況回報」與「庶務／料件添購補充」；維修選設備、設施或「不確定」（標的由 `request-targets` 依門市列設備與設施）；添購選料件、一般耗材、其他採購（料件用搜尋）並填數量、單位、規格；標題、說明（至少 5 字）、營運影響、暫時處理方式、聯絡人與電話；QR 掃描參數 `assetToken`（`assets/scan/:token`）帶入設備或設施與門市；門市來自「我管理的門市」；送出後可補傳照片（`SERVICE_REQUEST` 附件）。伺服端驗證（`validateServiceRequestPayload`）與權限：建立需 `request.create`，替別的門市建立需需求單管理、門市管理或員工管理。
- **G15 我的追蹤**（舊 `ServiceRequestMyReportsClient`）：自己門市的需求單清單與詳情、處理紀錄時間軸、留言（公開）、補資料、確認完成、回報仍有問題、設備入帳（貼標）任務。
- **G16 需求單工作台**（舊 `ServiceRequestIntakeClient`）：清單（狀態、類型、門市、搜尋、排序、未讀的門市留言）、受理（分流：維修派工、添購／採購評估、庫存出庫、調撥處理、資產異動／門市配合；承辦角色總務或工務；建立維修工單）、駁回（六種原因類型＋說明）、請門市補資料（六種類型＋說明）、更新處理進度、送門市確認、轉派、留言（公開與內部備註、改刪、總務標記已讀）、庫存出庫、採購評估（駁回、庫存出庫、調撥、進入採購、替代品；報價）。
- **G17 料件處理中心**（舊 `part-fulfillments`）：處理單清單（狀態、單據、事件）、建立處理單、選取得方式（出庫、調撥、採購）、登記異常（少收、未收、破損、收錯、取消）、送門市確認、單據明細（出庫單、調撥單、採購評估單）。
- **舊版缺陷已確認屬實**（程式碼為證）：受理、駁回、補資料等 PATCH 完全不檢查目前狀態（已完成的單可再受理）；取消狀態存在但沒有取消動作；總務代門市按確認沒有標示；詳情把 `internal_note` 與內部事件交給門市瀏覽器（`select *`）；門市留言被總務讀過後仍可被改刪且原文看不到；料件處理中心的採購評估單明細任何檢視者都看得到金額與供應商；出庫在還沒有處理單時不檢查剩餘量也不核對料件；改採購決策時舊採購單與報價處理不一致；搜尋字串直接塞進 PostgREST `or()`；清單與詳情分別打多支 API 且沒有分頁上限保護（處理單固定取 200 筆）。

**資料庫（20261112100000 第二段；正式區草稿 32）**
- 13 個對外函式：`ga_ws_req_create`（建立，固定識別 30 分鐘內不重複）、`ga_ws_req_accept`（受理＋D4 擋＋維修派工同交易建工單）、`ga_ws_req_transition`（駁回、補資料、更新進度、送門市確認、轉派、取消、重新開啟、撤回）、`ga_ws_req_store_action`（補充、確認完成、回報問題；總務代按須說明並標 `proxy_for_store`；同步維修工單與處理單）、`ga_ws_req_comment`（新增、編輯、刪除、已讀；改刪保留 `original_body`）、`ga_ws_req_settings_set`（逾期天數）、`ga_ws_req_stock_issue`（出庫守衛）、`ga_ws_req_purchase_review`（評估＋同交易產生草稿採購單）、`ga_ws_ful_create`／`decision`／`exception`／`void_document`／`deliver`。全部 `SECURITY DEFINER`、`has_permission(auth.uid(), …)`（正式區語意）、鎖列、`expected_updated_at` 版本檢查（回 `409 STALE`）、子交易回復。
- 2 個觸發器：`ga_service_requests.waiting_confirm_since`（進入待門市確認時記錄，離開清空；D5 逾期判斷用）、`ga_part_fulfillments.ready_to_deliver_at`（已處理量達需求量時記錄「待交付」，量退回或異常時清空）。採購單連結處理單同步：`ga_ful_sync_po` 在採購單狀態或品項驗入量變動時，以 `PURCHASE` 類型單據連結（一張處理單多張採購單，D2），重算已處理量並維持處理單進度。
- 覆蓋第 3 批 `ga_inv_tr_sync_fulfillment`：調撥單全數收貨後處理單維持「調撥」並成為「待交付」，不再自動跳到等門市確認（Q18；撤回檔會還原原版，G13 e2e 期望已更新）。
- 新增欄位：`ga_service_requests.waiting_confirm_since`（共 10 個新欄位，詳見 README）。
- **修正 G26-db 的缺陷**：`ga_equipment.source_request_id` 的外鍵讓舊版需求單 API 的 `equipment:ga_equipment(...)` 嵌入查詢出現「關聯不明確」（PGRST201）整個失敗；`120000` 改為不設外鍵並在套用時移除舊外鍵，`34` 草稿同步更正，`31` 第 10 區可檢查。

**規則對照（設計 §3.1、§3.4、D4、D5）**
- 需求單流轉表在資料庫強制，純函式表 `REQUEST_TRANSITIONS` 與它逐項相同，整合測試對「12 個動作 × 9 個狀態」逐格比對。
- 受理：待受理與待總務複核才能受理；維修單不能選採購評估、非料件不能選庫存出庫、添購不能選維修派工；其餘狀態 `409`。
- 取消：限未結案且尚未等門市確認，須原因；已出庫、有採購單（含草稿）、有調撥單、有進行中工單者不能取消。駁回：待受理、待複核、已受理；有進行中工單或有效單據不能駁回。請門市補資料：有採購單（含草稿）或已出庫者擋，訊息引導改用留言。重新開啟須原因，已完成→處理中（維修工單一併重新開啟、處理單進異常）、已駁回→待受理，`reopened_count` 加一。
- 「送門市確認」若需求單有處理單，導向料件處理中心（需求單與處理單一起往下，Q18）。
- 出庫：需 `part_fulfillment.manage`、`inventory_transaction.manage`、`part.view`（缺哪個講清楚）；須先分流庫存出庫；非料件需求 `422`；不得超過剩餘需求量（換算成需求單單位，已出庫、已收貨調撥、有效單據一併計入；同固定識別重送回原結果，不重算剩餘量）；料件須與需求相同，替代料須原因並記在事件；同交易寫處理單與單據。
- 採購評估：限採購評估管理；改決策時舊採購單標已取消（已到貨者擋 `PO_ALREADY_RECEIVED`）、報價保留歷史（`superseded_at`）；選進入採購時以 `ga_ws_po_from_review` 在同交易產生草稿採購單，任何一步失敗整筆回復（整合測試以「需求量已被別張採購單占滿」驗證評估與需求單狀態都不留痕）。重存同決策不產生第二張採購單。
- 處理單：決定處理方式（改離採購時一併取消未到貨採購單）、登記異常（類型與說明必填）、逐筆作廢單據（限異常狀態、原因必填；出庫單只釋放量、不沖回庫存；採購單走採購單取消，已到貨者擋；調撥單須已取消或已收貨）、送門市確認（已處理量須達需求量，需求單須在已受理或處理中）。
- 欄位遮蔽：門市（沒有需求單管理權限）看不到內部備註、承辦帳號、取消原因、起算時間、內部事件與內部留言、留言原文；已刪除的留言只留占位；沒有採購評估權限者看不到採購單金額與供應商（單據明細與需求單的關聯採購單區塊）。

**測試（四層＋劇本）**
- 單元：`tests/unit/G14-G17/request-rules.test.ts` 18 項（流轉表全覆蓋、D4、D5 逾期邊界與天數驗證、遮蔽、可按動作、待交付、導覽旗標與側欄）。
- 整合：`tests/integration/G14-G17.requests-api.spec.ts` 15 項（權限矩陣與 Origin、400、409／STALE、遮蔽與留言改刪原文、流轉表逐格對照資料庫、D4、代按標記、逾期設定與篩選、出庫守衛與固定識別、採購評估與整體回復與報價歷史、處理單待交付與異常作廢與單據遮蔽、併發受理）。測試帳號新增 `rq_*`、`ful_*` 系列。
- 冒煙：`tests/smoke/G14-G17.pages.spec.ts`（桌機 1440 與手機 390 各 5 項：四頁可開、統計卡數、導覽 href 與 kind、權限分級、無 console 錯誤、無水平溢出）。
- 對等：`tests/parity/G14-G17.ga-requests.spec.ts` 6 項（清單、詳情、受理、門市確認、處理單清單、庫存出庫；差異登記 `m7m8-b4-rq-*` 共 55 筆，其中 14 筆為新發現待使用者確認）。
- 劇本：`G16.journey-equipment-purchase`（店長手機提出添購 → 總務請補資料 → 受理 → 採購評估產生草稿採購單 → D4 收起按鈕 → D5 逾期標示與確認）、`G17.journey-part-replenish`（店長回報缺料 → 出庫超量與替代料被擋 → 待交付 → 送門市確認 → 店長確認；分支：總務代按、異常作廢重選）。採購單核准、下訂、到貨、配發與貼標待辦由 `G25.journey-printers` 補齊。

**與設計不同或待使用者確認**
1. **留言附件**：舊版詳情會回傳留言上的附件；新版詳情的留言不帶附件，附件統一放在需求單附件面板（舊資料還在）。待確認是否要補。
2. **新增需求的料件選擇**：沿用料件搜尋＋選單，不做舊版的「適用對象相容料件」建議（`target-compatibilities`），這屬於第 1 批料件相容設定的延伸，待確認。
3. **庫存出庫的單位換算**：以需求單單位比較（採購單位與基本單位換算率換算）；替代料不換算（直接以基本單位比較）。
4. **導覽旗標**：新增需求只認 `request.create`（舊側欄還接受維修模組權限；只有維修模組權限的人舊版看得到入口卻被 API 擋）。這是把入口對齊 API 的取捨，待確認。
5. **清單排序**：同建立時間的單新版再依 id 排序（舊版沒有第二排序鍵，同時間的單次序不固定）。
6. 清單額外欄位（承辦帳號、內部備註、完成時間、聯絡人、建立者）、詳情不回 `confirmed_at`／`deleted_at`／留言 `created_by`：實作取捨，登記為待確認。
7. 劇本沒有涵蓋的後續：採購單 Vue 頁面（G25 階段）、設備搬單 G27、直接到貨建立設備與貼標。


### 12.4 G25-ui 採購單頁面與 API（2026-11-13）
完成採購單的 workspace API（`lib/workspace/general-affairs/purchase-orders.ts`，在 `router.ts` 的 `/purchase-orders/**` 分派）、三個頁面（`PurchaseOrders.vue`、`PurchaseOrderEdit.vue`、`PurchaseApprovals.vue`）與五個共用元件（`PoDetailDialog.vue`、`PoReceiptDialog.vue`、`PoDispatchDialog.vue`、`PoSettingsDialog.vue`、`PoPicker.vue`）、導覽與權限旗標（`gaPurchaseOrders`、`gaPurchaseApprovals`）、頁面登錄（`page-kinds.ts` 三個 kind：`ga-purchase-orders`、`ga-purchase-order-edit`、`ga-purchase-approvals`）、貼標序號 API（`POST /onboarding/serial`）與貼標待辦卡片的序號欄位、角色矩陣五個測試帳號。**這個階段沒有新增資料庫物件**（沿用 G25-db、G26-db 的 `ga_ws_po_*` 函式），所以沒有新的 DEV SQL 與正式區草稿。

**API（`/api/workspace/general-affairs/purchase-orders/**`）**：清單（伺服端精確統計、狀態、搜尋、我開的、逾期未到貨）、建立與編輯草稿、`actions`（送核准、撤回、核准、駁回、撤回核准、下訂、取消、短收結案、結案）、`receipts`（登錄到貨）、`dispatches`（配發）、`approvals`（待簽核清單）、`price-history`、`vendor-options`、`options`（位置、料件含型號對應、設備型號、門市選擇器）、`settings`、`from-review`。共通規則：非 GET 的 Origin 檢查（`runGa`）、輸入白名單驗證（400）、版本檢查必填（缺版本 400、版本不符 `409 STALE`）、分頁上限 100、`abilities`（兩個採購權限缺哪個講清楚、核准人限制）由伺服端算好隨詳情回傳、統編與付款條件沒有廠商權限時伺服端遮蔽。權限都以資料庫函式為準，API 只先擋「缺權限」讓訊息一致；管理員身分不繞過。配發在呼叫資料庫函式前先核對品項屬於網址上的採購單（避免用 A 單網址配發 B 單的品項，配發一旦成功就已出庫建設備）。

**頁面**
- 採購單清單：11 張統計卡（全部、各狀態、逾期未到貨、我開的，點卡片即篩選）、搜尋、卡片清單；詳情視窗含品項、金額與未稅／稅額、核准資訊與最近駁回原因、時間軸（每步操作人與時間）、進貨紀錄、配發紀錄（含建立的設備與序號），以及依 `abilities` 顯示的動作。草稿只留一條路：含稅總額超過門檻只顯示「送核准」，未超過只顯示「下訂」。核准人才看得到「核准設定」。
- 新增與編輯草稿：供應商只能選已建好且合作中的（附「去舊版新增供應商」連結，開舊版廠商管理頁）、收貨位置、預計到貨日；品項可選料件或自由品名，選了料件顯示同料件最近 5 筆已下訂以上的歷史價；每品項選「入總部庫存」「到貨直接建設備」或「只登錄到貨」；連到需求單的品項超過需求量要填原因；金額即時試算（同一份純函式）。已下訂只能改備註與預計到貨日。資料（設定與採購單）載完才顯示表單。
- 待簽核清單：只有持採購核准者；核准、駁回（原因必填）。
- 登錄到貨視窗：每個還有剩餘可收量的品項一列，預設帶剩餘量；短收、破損、改位置、改收替代料的原因規則與資料庫共用同一份純函式（送出前就提示）；固定識別防重複。配發視窗：品項、門市（選擇器）、數量、型號（料件有對應就沿用、要改須原因、沒對應必選）、序號（每行一個，可空白）。
- 貼標待辦：設備卡片加序號欄位（店長補填、已有序號要改須填原因）。

**測試**
- 單元：`tests/unit/G25-ui/purchase-ui.test.ts` 18 項（旗標與側欄、頁面登錄一致、事件文字涵蓋、`abilities` 與草稿單一路徑、API 邊界驗證）。
- 整合：`tests/integration/G25-ui.purchase-orders-api.spec.ts` 13 項（讀取與權限矩陣、清單分頁與跳脫、建立（Origin、缺權限講清楚、400、冪等與衝突、DB 回讀）、編輯與 STALE 與鎖定、核准全流程（開單人與送簽人與管理員與無權限者不能核准、駁回須原因、退回改價再送、核准後下訂寫快照、每步事件）、門檻剛好 5000 與調整門檻、帳務欄位遮蔽、選擇器與歷史價、到貨（超收、短收、破損、冪等、狀態、結案）、短收結案、配發（型號、可配發量、一次建設備、冪等、別張單的品項被擋且不出庫、序號補填限該門市店長）、直接建設備與只登錄、由評估產生草稿與需求量加總）。
- 冒煙：`tests/smoke/G25-ui.pages.spec.ts` 4 項（桌機 1440 與手機 390 各一遍）。
- 版面：`tests/e2e/G25-ui.layout.e2e.spec.ts`（比照 G10.layout：統計卡排列、無水平溢出、手機按鈕高度、視窗不超出視窗且主要按鈕在視窗內）。
- 對等：`tests/parity/G25-ui.ga-purchase-orders.spec.ts` 3 項（供應商選項、採購評估進入採購、採購到貨入庫），差異登記 `m7m8-b4-pu-*` 共 15 筆，其中 3 筆是實作取捨、`approvedBy` 為 null；T02 待核可清單已同步。
- 劇本：`G25.journey-printers`（總務主動購置印表機 5 台：建單與歷史價、送核准、開單人不能自己核准、核准人駁回再核准、下訂、分批到貨與破損與超量被擋、配發到兩店建設備、店長（手機）補序號與貼標、另一位總務複核、補收與配發餘額、結案、事件時間軸對照資料庫；另有「沒權限做不到」）；補齊 `G16.journey-equipment-purchase` 的採購、到貨、貼標段（草稿改直接建設備並下訂、D2 第二張採購單走核准、到貨建立設備連回需求單、貼標與複核、處理單待交付、送門市確認、店長確認完成）。
- 角色矩陣新增 `ga_po_purchaser`、`ga_po_approver`、`ga_po_review_only`、`ga_po_stock_only`、`ga_po_no_partview`；全部帳號補兩個新旗標的預期值。

**自行決定與待使用者確認**
1. 新增兩個側欄入口「採購單」「待簽核採購單」（舊版沒有）；核准人要從主選單進得了總務服務中心，該角色還要有「總務服務中心入口」權限（README 已補說明）。若希望只持「採購核准」的角色也能直接進入，要擴大服務中心首頁的條件，會動到導覽對等，待確認。
2. 供應商選項不回電話與聯絡人（舊版採購評估頁有）、多回廠商類型：已登記待確認。
3. 搜尋選擇器（料件、位置、型號、門市）的萬用字元（`%`、`_`）當字面字元處理。
4. 設備型號選擇器在編輯既有採購單時，已選的型號只顯示「（已選型號）」（API 沒回型號名稱），重選即可看到名稱。
5. 第 1 批料件清單頁沒有另加「可轉設備型號」欄位（料件表單已有選擇欄位，G26-db 完成）；清單是否要顯示該欄待確認。
6. 搬單（G27）已於 12.5 完成。

### 12.5 G27 資產移轉，單子跟著走（B6，2026-11-13）
完成 `20261112130000_m7m8_b4_asset_transfer_follow`（DEV SQL，附 rollback）與正式區草稿 `35-b4-asset-transfer-follow.sql`／`-rollback.sql`、純函式 `lib/workspace/general-affairs/asset-move.ts`、畫面用的 `vue-workspace/src/lib/ga-asset-move.ts`、兩個共用元件（`MoveFollowNotice.vue` 確認告知、`MovedRequestsList.vue` 搬走明細），並改了既有的轉移單頁、發起轉移視窗、設備清冊與設施清冊的「更正所屬門市」視窗。

**資料庫**
- 新表 `ga_asset_transfer_moved_requests`（搬走的單與沒搬的舊式工單清單；登入者不能直接讀寫，只走函式）。欄位比設計文件 §3.2 多了 `doc_no`、`doc_title`、`doc_status`（搬走當下的單據摘要，清單不用再查、單子後來改標題也不影響），`transfer_id` 與 `asset_event_id` 至少有一個（轉移走轉移單，更正所屬門市只有異動紀錄）。
- `ga_ws_asset_move_open_requests`（內部）：同一交易內只搬 `request_type = 'REPAIR'` 且 `main_status` 不是 `COMPLETED`、`REJECTED`、`CANCELED`、且目前在轉出門市的需求單，逐筆鎖列（`FOR UPDATE`）後把需求單與其工單的 `store_id` 改成新門市（`updated_at` 隨之更新，其他人畫面上的舊版本再按動作會得到 409 STALE）；需求單與工單時間軸各寫一筆公開事件（需求單事件類型 `ASSET_STORE_MOVED`、工單事件類型 `STORE_MOVED`），文字「因設備轉移，由 A 店轉到 B 店」，更正所屬門市則是「因設備所屬門市更正，由 A 店轉到 B 店」；不發通知；添購等其他類型與已結案的單不動。
- 重新定義第 2 批的 `ga_ws_transfer_confirm_receive`（轉移單確認收到）與 `ga_ws_correct_asset_store`（更正所屬門市），簽章不變，只在原版換店之後多呼叫搬單函式，回應多 `moved_request_count`、`unlinked_work_order_count`；做法是先用 `pg_get_functiondef` 取出 DEV 當下版本，再由 `scripts/gen-m7m8-b4-130000.cjs` 插入呼叫並同時產生 rollback（原版逐字還原）。
- `ga_ws_asset_move_preview`（確認視窗預覽：會搬哪幾張、留下哪幾張、舊式工單清單）與 `ga_ws_asset_moved_list`（依轉移單或依資產看搬走明細；雙方店長、設備或設施查看與管理權限者可看）。
- 發起轉移與交出都不搬，**收到那一刻才搬**（與換店同一時間、同一交易）；取消的轉移單不搬。

**API 與畫面**
- `GET equipment|facilities/:id/open-orders` 回應多 `moving`、`staying`、`unlinked_work_orders` 與三個張數（舊欄位不變）；`GET transfers/:id` 多 `moved`（搬走明細）；`GET equipment|facilities/:id/events` 的換店事件多 `moved_request_count`、`unlinked_work_order_count`；`POST transfers/:id/receive` 與 `POST …/correct-store` 回應多搬單張數。
- 發起轉移視窗與「更正所屬門市」視窗固定告知「進行中的單會一起轉到新門市，由新門市店長接手」並顯示張數與清單；轉移單卡片與詳情的舊警示（「換店後仍屬原門市」）改成新說法；轉移單詳情新增「搬走的單」區塊（搬走的維修單含工單，與沒搬、要人工處理的舊式工單）；確認收到與更正完成的提示訊息帶搬走張數。

**舊式工單怎麼認（設計文件沒寫、實作取捨，待使用者確認）**：維修工單表沒有連到設備或設施的欄位，沒連到需求單的舊工單無法精確屬於哪一項資產，所以以「同門市、未完成、資源類型相符（工單的資源類型為空也算）、標題或說明提到資產編號（至少 3 字）或名稱（至少 2 字）」判斷，只列清單、不搬、不改。可能漏列（標題沒提到資產）或多列（名稱太常見）。

**與第 2 批的關係**：第 2 批「解讀 h」（進行中的單換店後仍屬原門市）由本批取代，既有的 G10 整合、劇本、對等測試已同步改期望（舊白名單 `m7m8-g10-transfer-open-requests-stay` 改為 `m7m8-b4-mv-open-requests-follow-asset`，核准欄為問卷 D20、D21）。B6 歷史可見性（新店店長看得到資產所有歷史報修、舊店看得到自己門市時期的單）維持不變：進行中的單轉走後舊店看不到，只剩已結案單，符合 D21。

**測試**
- 單元：`tests/unit/G27/asset-move.test.ts` 13 項（哪些單搬、時間軸文字、舊式工單判斷、預覽正規化、搬走明細整理、確認視窗與結果文字）。
- 整合：`tests/integration/G27.asset-transfer-follow-api.spec.ts` 6 項（全流程：搬與不搬的各類型與狀態、舊式工單清單、時間軸公開事件、轉移單明細、新店接手與舊店只剩已結案、重複確認冪等；更正所屬門市與設施；沒有單與取消；權限矩陣與 Origin 與 400 與 404 與內部函式不開放；STALE 併發與雙收；舊式工單判斷與純函式一致）。
- 冒煙：`tests/smoke/G27.transfer-follow.spec.ts` 3 項（桌機 1440 與手機 390 各一遍）：發起轉移視窗、更正所屬門市視窗、已完成轉移單搬走明細。
- 對等：`tests/parity/G27.ga-asset-move.spec.ts` 2 項（page `ga-asset-move`），登記 `m7m8-b4-mv-*` 共 7 筆（6 筆問卷 D20、D21 已核可，1 筆舊式工單判斷屬實作取捨，`approvedBy` 為 null，T02 待核可清單已同步）。
- 劇本：`G27.journey-transfer-follow`（A 店有待門市確認的維修單含工單、添購單、已結案單與舊式工單 → 總務發起轉移，畫面告知 → A 店店長手機交出（單子仍在 A 店）→ B 店店長手機收到 → 維修單與工單轉到 B 店、B 店店長在「我的追蹤」看到並接手確認完成、時間軸有公開事件、沒有其他事件（不發通知）；添購與已結案留 A 店，A 店「我的追蹤」不再有進行中的維修單；轉移單詳情列出搬走的單與舊式工單；另有「更正所屬門市」一段與「沒有權限者做不到」一段）。

**自行決定與待使用者確認**
1. 舊式工單的判斷方式（見上）。
2. 沒有通知：DEV 資料庫沒有任何通知資料表，搬單也不呼叫任何通知，測試以「需求單只多一筆公開時間軸事件」驗證。
3. 搬單只搬「目前在轉出門市」的需求單；若需求單門市與資產門市本來就不一致（歷史資料）則不動。
4. 正式區 `35` 的先決條件是 `32`（需要 `ga_rq_event`）；31 第 11 區列出影響預覽。

### 12.6 第 4 批全批驗收與待使用者確認清單（B4-ACCEPT，2026-11-13）

全批驗收的做法、結果與待確認項。驗收只動測試、文件與兩處小修，沒有新增資料庫物件（沒有新的 DEV SQL 與正式區草稿，31 至 35 維持原樣）。

**驗收範圍與結果**：見下方「驗收結果」。四支角色劇本（`G25.journey-printers`、`G16.journey-equipment-purchase`、`G17.journey-part-replenish`、`G27.journey-transfer-follow`）都含「沒權限做不到」一段：缺權限帳號、非核准人、開單人自己核准被擋、店長只看自己門市。

**驗收中修的小問題**：到貨、配發、庫存出庫三個對話框遇到「識別重複但內容不同」時，原本會卡在同一個識別重送一直失敗，現在換新識別可直接再送；發起轉移視窗把兩次 `open-orders` 請求合成一次；畫面的 `groupMoved` 改成與伺服端共用同一份（避免兩份各自維護而不一致）。

**待使用者確認的新發現（`approvedBy` 為 null，共 35 筆）**：以下都是實作時補的設計或取捨，問卷沒有涵蓋。確認後請告知，我再把 `approvedBy` 改成核可；若不同意，標 `decision: fix` 並排入修正。


**採購單（G25-db／G25-ui），4 筆**

- `m7m8-b4-po-legacy-receipt-block`：設計文件第 8 節新舊並存風險：舊版收貨直接過帳，會與新版採購單到貨雙記庫存。新發現，待使用者確認。
- `m7m8-b4-po-no-stock-mode`：設計文件第 3.2 節補的設計。新發現，待使用者確認。
- `m7m8-b4-po-draft-counts-as-active`：設計文件第 7 節第 16 項。新發現，待使用者確認。
- `m7m8-b4-po-threshold-adjustable-by-approver`：設計文件第 8 節風險：持核准權限者可調高門檻繞過核准，以事件與門檻快照控管。新發現，待使用者確認。

**到貨驗入與配發（G26-db），9 筆**

- `m7m8-b4-rc-purchase-amount-excl-tax`：設計補充：設計 §3.3 要求實作前核對含稅與否，欄位語意沒有定義，先採建議（未稅）。新發現，待使用者確認含稅與否。
- `m7m8-b4-rc-warranty-start-and-end`：設計 §3.3 寫「舊版規則由型號保固月數算就沿用」，核對後舊版沒有這個規則，這是新做法。新發現，待使用者確認。
- `m7m8-b4-rc-short-delivery-needs-reason`：任務規格寫「短收或破損須原因」，對「短收」的解讀是到貨量小於剩餘量。新發現，待使用者確認是否分批到貨也要填。
- `m7m8-b4-rc-rejected-not-counted`：實作決定（問卷只說短收與破損要填原因）。新發現，待使用者確認。
- `m7m8-b4-rc-dispatch-no-equipment-manage`：設計補充（依 D11 三個權限可做全部步驟）。新發現，待使用者確認。
- `m7m8-b4-rc-dispatch-single-part-fifo`：實作決定：改收替代料或改位置後，同一品項可能有多種料件與位置的庫存，先進先出以最早一批為準。新發現，待使用者確認。
- `m7m8-b4-rc-dispatch-unpacking-rule`：沿用庫存過帳既有規則，沒有為配發另開例外。新發現，待使用者確認。
- `m7m8-b4-rc-asset-code-needs-level2`：沿用舊版規則，只是把錯誤改成白話並整筆回復。新發現，待使用者確認。
- `m7m8-b4-rc-serial-fill-rules`：D15 只決定「序號可空白由店長貼標時補」，補填的權限、原因與重複規則是設計 §3.3 補的。新發現，待使用者確認。

**回報、需求單、料件處理中心（G14 至 G17），18 筆**

- `m7m8-b4-rq-list-extra-columns-assignee-user-id`：新版清單與詳情共用同一組欄位，方便總務在清單直接看到處理需要的資料；門市（沒有管理權限）看不到內部備註與承辦帳號。實作時補的欄位，問卷未涵蓋，待使用者確認。
- `m7m8-b4-rq-list-extra-columns-internal-note`：新版清單與詳情共用同一組欄位，方便總務在清單直接看到處理需要的資料；門市（沒有管理權限）看不到內部備註與承辦帳號。實作時補的欄位，問卷未涵蓋，待使用者確認。
- `m7m8-b4-rq-list-extra-columns-completed-at`：新版清單與詳情共用同一組欄位，方便總務在清單直接看到處理需要的資料；門市（沒有管理權限）看不到內部備註與承辦帳號。實作時補的欄位，問卷未涵蓋，待使用者確認。
- `m7m8-b4-rq-list-extra-columns-contact-name`：新版清單與詳情共用同一組欄位，方便總務在清單直接看到處理需要的資料；門市（沒有管理權限）看不到內部備註與承辦帳號。實作時補的欄位，問卷未涵蓋，待使用者確認。
- `m7m8-b4-rq-list-extra-columns-contact-phone`：新版清單與詳情共用同一組欄位，方便總務在清單直接看到處理需要的資料；門市（沒有管理權限）看不到內部備註與承辦帳號。實作時補的欄位，問卷未涵蓋，待使用者確認。
- `m7m8-b4-rq-list-extra-columns-temporary-workaround`：新版清單與詳情共用同一組欄位，方便總務在清單直接看到處理需要的資料；門市（沒有管理權限）看不到內部備註與承辦帳號。實作時補的欄位，問卷未涵蓋，待使用者確認。
- `m7m8-b4-rq-list-extra-columns-created-by`：新版清單與詳情共用同一組欄位，方便總務在清單直接看到處理需要的資料；門市（沒有管理權限）看不到內部備註與承辦帳號。實作時補的欄位，問卷未涵蓋，待使用者確認。
- `m7m8-b4-rq-list-extra-columns-created-by-name`：新版清單與詳情共用同一組欄位，方便總務在清單直接看到處理需要的資料；門市（沒有管理權限）看不到內部備註與承辦帳號。實作時補的欄位，問卷未涵蓋，待使用者確認。
- `m7m8-b4-rq-list-extra-columns-base-unit`：新版清單與詳情共用同一組欄位，方便總務在清單直接看到處理需要的資料；門市（沒有管理權限）看不到內部備註與承辦帳號。實作時補的欄位，問卷未涵蓋，待使用者確認。
- `m7m8-b4-rq-detail-part-base-unit`：出庫與採購數量換算要用。實作時補的欄位，問卷未涵蓋，待使用者確認。
- `m7m8-b4-rq-detail-legacy-only-confirmed-at`：新版不把使用者 id 傳給前端，確認時間改看事件。實作時的取捨，待使用者確認。
- `m7m8-b4-rq-detail-legacy-only-created-by`：新版不把使用者 id 傳給前端，確認時間改看事件。實作時的取捨，待使用者確認。
- `m7m8-b4-rq-detail-comment-attachments`：實作時的取捨：舊資料裡若有留言附件，新版暫時看不到（資料還在）。待使用者確認是否要補留言附件顯示。
- `m7m8-b4-rq-detail-deleted-at`：新版不外露刪除標記欄位（查得到的單本來就是沒刪除的）。實作時的取捨，待使用者確認。
- `m7m8-b4-rq-nav-requests-conditions`：把入口對齊 API（舊版是壞入口）。G14 至 G17 實作時的取捨，問卷未涵蓋，待使用者確認。
- `m7m8-b4-rq-nav-fulfillments-conditions`：把入口對齊 API。G14 至 G17 實作時的取捨，待使用者確認。
- `m7m8-b4-rq-nav-report-create-conditions`：把入口對齊 API。上線前請確認店長角色有 request.create、view_own_store、comment_own_store、confirm_own_store（舊版頁面本來就需要）。待使用者確認。
- `m7m8-b4-rq-nav-my-reports-conditions`：把入口對齊 API。待使用者確認。

**採購單供應商選項（G25-ui），3 筆**

- `m7m8-b4-pu-vendor-opts-legacy-phone`：實作取捨：採購單選擇器只需要名稱、別名、統編與付款條件，電話與聯絡人請到廠商管理頁看。待使用者確認是否要補回。
- `m7m8-b4-pu-vendor-opts-legacy-contact`：實作取捨：同上，採購單選擇器不帶聯絡人。待使用者確認是否要補回。
- `m7m8-b4-pu-vendor-opts-vendor-type`：實作取捨：選擇器顯示用，沒有權限問題。待使用者確認。

**資產移轉搬單（G27），1 筆**

- `m7m8-b4-mv-legacy-workorder-heuristic`：問卷 D20 只說「沒連到需求單的舊式工單列清單請人工處理」，沒說怎麼判斷屬於哪項資產；這是實作取捨，可能漏列（標題沒提到資產）或多列（名稱太常見），待使用者確認。

**其他需要使用者決定的事項（彙整自前五個階段）**

- 購價含稅與否：設備購價重用 `purchase_amount`，目前填每台未稅單價並在備註註明（`m7m8-b4-rc-purchase-amount-excl-tax`）。
- 分批到貨是否也要填原因：目前到貨量小於剩餘量就要填原因（`m7m8-b4-rc-short-delivery-needs-reason`）。
- 核准人入口：只持「採購核准」權限的角色，若沒有「總務服務中心入口」權限，從主選單進不了服務中心；目前在 README 寫明核准角色要另外勾選，若要放寬請告知（會動到導覽對等）。
- 店長角色上線前需有 `request.create`、`view_own_store`、`comment_own_store`、`confirm_own_store`（舊版頁面本來就需要，DEV 的 `store_manager` 測試帳號沒有）。
- 留言附件：舊版詳情會回傳留言附件，新版暫時不顯示（資料還在）。
- 第 1 批料件清單頁沒有另加「可轉設備型號」欄位（料件表單已有），是否要加。
- 正式區套用 `35` 前先告知總務與店長新行為（設備換店時進行中的維修單一起轉到新門市）；撤回 35 不會把已搬走的單搬回去。
- 正式區上線前：核准人至少兩位；先在舊版廠商管理頁建好合作中供應商；確認已套過 10-g01；DEV 缺預設總部倉，採購單收貨位置要手動選。
- `I01.inspection-gps` 定位對等有 6 項失敗（畫面提示文字不同），與第 4 批無關，另案處理。
- G10 還有 2 項與第 4 批無直接關係的失敗：上線貼標劇本的完成率受 DEV 一台真實設備（門市 0002）等拍照影響；`G10.qr` 掃描頁期待「回報維修」開彈出視窗，G14 起改成新版頁籤開啟，期望需改。

### 驗收結果

- 靜態：`node --check`、`npx tsc --noEmit`、`vue-tsc --noEmit`、Vue build 都通過。
- `npm run test:unit`：114 檔、1723 項全綠。
- `npm run test:page -- B4-ACCEPT`：單元 19、整合 5、e2e 桌機 2 加手機 2、冒煙桌機 3 加手機 3，共 15 項（不含單元）全過。
- 各頁循序重跑：`G25-db` 63（單元 42、整合 21）、`G25-ui` 28、`G26-db` 59（單元 37、整合 22）、`G14-G17` 31（單元 18）、`G25` 劇本 2、`G16` 劇本 6、`G17` 劇本 7、`G27` 17（單元 13）、`G13` 62（單元 41），全過。
- `G10`：69 過、1 失敗。失敗項是上線貼標劇本，完成率受 DEV 一台真實設備（門市 0002）等拍照影響，與第 4 批無關。`G10.qr` 的期望已改成新版行為後通過。
- 全量 `test:all` 共 2497 項（單一 worker，估計 10 小時以上），跑到約第 260 項無失敗後中止並清掉殘留，改以上列頁面逐頁循序驗收。
- `run-all` 結束碼 1 皆只因 sweeper 基準 17 筆孤兒（前後一致，沒有新增）。
- 驗收時修正：`G25-db` 整合的權限碼檢查，允許角色矩陣的測試管理員角色 `vue_workspace_admin`（DEV 測試角色）持有採購核准。

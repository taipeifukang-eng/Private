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

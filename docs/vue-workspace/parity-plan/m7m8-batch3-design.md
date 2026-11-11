# M7/M8 第 3 批設計（定稿）：庫存位置與料件設定、庫存餘額與流水與過帳、庫存調撥

> 狀態：定稿（2026-11-11）。使用者已完成問卷 docId `m7m8-batch3-spec` 的 13 題，全部選建議選項（C1 至 C13），各組 assumptions 一併核可。本文件已刪除未選分支。
> 範圍：G11 `/general-affairs/inventory/locations`、G12 `/general-affairs/inventory`（含 `?view=transactions`）、G13 `/general-affairs/inventory/transfers`，加 Q12 至 Q15、Q25 與 m7m8-spec「直接照做」中的庫存事項；另含第 2 批補充 C13（分類停用後設備／設施仍可修改）。資料表為總務庫存 `ga_inventory_*`，**不是**門市盤點 `inventory.*`。
> Q27、B6（報修單跟著設備轉店）屬第 4 批，本批不碰。過帳核心 `ga_post_inventory_transaction` 不修改。
> 格式與第 2 批 `m7m8-batch2-design.md` 相同；重用第 1、2 批的外殼、選擇器、`rpc(ctx, name, args)`、`GaError`、`STALE` 慣例、`ga_ws_` 函式命名。
> 實作限制：只連 DEV（`supabase/.temp/project-ref` 以 mjpd 開頭，DB 指令前先確認）；不 push；不動 `supabase/migrations`；測試資料只用 VW／ZT 測試門市；`test:page` 與 e2e 一律循序。

## 1. 舊版功能清單（以程式碼為準）

### 1.1 G11 位置與料件設定
- 入口：頁面本身不守門，靠 API。選單要 `inventory_location.view` 或 `manage`；API 另放行 `store_managers` 有任何一筆的人（唯讀、自己名下門市的 STORE 位置）。無權限顯示「沒有庫存位置權限」。
- 清單：四張統計卡（只算載入的 50 筆）；篩選 關鍵字、類型、門市、狀態；固定依更新時間排序；欄位 名稱＋代碼、類型、門市、政策（預設／允許負庫存）、狀態、操作。
- 新增／編輯對話框：類型（總倉／門市／辦公室／暫存／其他）、名稱、代碼（存檔轉大寫，全公司唯一不分大小寫，停用者仍佔用）、門市（僅門市類型且必填）、啟用、預設（僅門市或總倉且啟用；每門市一個、全公司一個啟用總倉預設）、允許負庫存、描述。新增後不關閉，切到編輯讓你加料件。未存變更有確認與離開警告。
- 刪除：`ga_soft_delete_inventory_location`（軟刪除，連帶軟刪除全部位置料件設定，不檢查庫存與調撥，不提示筆數）。
- 位置料件：最多顯示 100 筆；欄位 安全／補貨／最高、偏好領用單位（基本或採購）、啟用、備註；新增時料件下拉前 200 筆無搜尋；新增後不能修改（API 有 PATCH 畫面沒用），只能刪除重建；刪除不檢查庫存。規則：同位置同料件一筆、三量 ≥ 0 且 安全 ≤ 補貨 ≤ 最高、採購單位需有換算率、位置與料件須啟用。
- 影響他處：沒有啟用的位置料件設定就不能過帳（`LOCATION_PART_NOT_CONFIGURED`）；首頁低庫存卡；需求單出庫預設單位；調撥頁依預設位置選目的位置。
- DEV：八張庫存表與調撥、處理單表都在、RLS 全開、全部 0 筆。

### 1.2 G12 餘額、流水、過帳
- 四張統計卡、餘額表（50 筆、無換頁、負數紅字）、流水表（50 筆、類型／位置／料件篩選、無日期、無換頁、重送識別碼遮罩）、過帳表單（入庫 RECEIPT／出庫 ISSUE／調增 ADJUST_IN／調減 ADJUST_OUT；位置、料件、數量、單位、原因必填、備註、發生時間）。
- 持有狀態（使用中／閒置可調撥／待確認）：彙總方塊、優先可調撥前 3 名、逐列調整（`ga_set_inventory_holding_allocation`，需 `inventory_transaction.manage`，合計不可超過持有量，餘額減少時觸發器自動校正）；有事件表但畫面看不到歷史。
- 過帳：`ga_post_inventory_transaction`（SECURITY DEFINER、使用者身分）；檢查順序 登入、交易管理權限、料件查看或管理、參數、位置啟用、料件啟用、位置料件已設定、單位換算（≤ 4 位小數）、整數、出庫最小領用與拆包、負庫存。冪等：同人同 key 內容相同回原交易（`idempotent_replay`）、不同則 `IDEMPOTENCY_CONFLICT`。同位置同料件有 advisory lock 與餘額列 `FOR UPDATE`。流水有不可改刪觸發器。
- 選項 API 無分頁，超過 1000 筆被靜默截斷。無匯出。

### 1.3 G13 調撥
- 建單：來源、目的、料件（來源位置有設定者）、數量、單位、原因、運送方式（未定／總務配送／門市人員帶回／物流寄送／廠商直送）、備註；單號 `GAT-YYYYMMDD-5 位流水`（UTC 日期）。API 允許 20 筆，介面一次一個，新版維持一張一個料件。
- 狀態：`REQUESTED` → `SOURCE_CONFIRMED`（交出，ISSUE 扣來源）→ `IN_TRANSIT`（可略過）→ `RECEIVED`（RECEIPT 入目的）；未收貨前可 `CANCELED`（需原因）。異常 = CANCEL + `cancel_reason` 前綴「調撥異常：類型｜說明」。
- 列表：狀態卡（用載入的 50 筆算）、狀態下拉、搜尋（字串直接拼 `.or`）、下一步提示、明細的已扣／已入庫狀態。
- 連動：帶 `fromRequestId` 時用管理員身分檢查剩餘需求量、upsert `ga_part_fulfillments`（TRANSFER）與 `ga_part_fulfillment_documents`；每個動作同步處理單；失敗只 `console.warn`。
- query 契約：`fromRequestId、requestNo、partId、quantity、sourceLocationId、destinationStoreId、reason、notes`；三處入口（需求單、料件處理中心、總務首頁）。
- 權限：畫面與 API 為 `transfer.manage` 或 `transaction.manage` 擇一，另 API 要 `part.view`；資料庫實際要 `transfer.manage`（寫單據）＋`transaction.manage`（過帳）＋`part.view`。
- 無通知。

### 1.4 舊版缺陷（新版修正）
各頁只載入 50／100／200 筆與統計只算載入筆數；選項 API 1000 筆截斷；搜尋逗號括號會壞；刪除與停用不檢查庫存／調撥；位置料件不能修改；位置已有交易仍可改門市；每次動作清空調撥備註；調撥動作無鎖列、每次點擊新的隨機冪等鍵（可重複扣帳）；多步驟中途失敗停在「已扣庫存、單子未更新」；單號用 UTC 日期；需求單連結失敗只記 warn、不驗證需求單、upsert 覆蓋處理單狀態；預填 quantity 不換算單位、靜默丟棄參數；錯誤訊息混英文代碼或資料庫原文；取消不退庫存；舊 DEV 腳本的角色是臨時 dev_* 角色，role-matrix 沒有庫存模組；分類停用後設備／設施改任何欄位都被擋（C13）。

## 2. 已決定事項

### 2.1 先前批次已決定（引用，不再問）
| 決定 | 本批落點 |
|---|---|
| Q1 分六批、本批 = G11 到 G13、驗收後才做第 4 批 | 範圍 |
| Q12 交出後取消／異常可勾「退回來源庫存」，補入庫流水與調撥單關聯；沒勾紅字提醒；走既有入庫流程 | 調撥動作函式；流水頁要能顯示此類流水 |
| Q13 記帳與調撥兩個權限都要、管理員後備不套用在帳務寫入、缺哪個講清楚；上線前列出只有其中一個權限的角色 | 畫面預檢、`00-readiness-check.sql` P3 加兩碼人數與角色 |
| Q14 位置有庫存或進行中調撥不可刪只能停用並顯示連帶筆數；發生時間不可填未來；建單庫存不足顯示警告仍可建；切換負庫存要確認 | 位置函式、過帳包裝、建單、位置表單 |
| Q15 建單（表頭＋明細＋連結需求單）、出庫過帳、到貨入庫一次完成；數量換基本單位比較 | `ga_ws_inv_*` 函式 |
| Q18 全數收貨後處理單顯示「待交付」（處理單畫面屬第 4 批，本批只寫入同一批資料） | 調撥動作同步處理單 |
| Q25 工務沿用總務角色 | 劇本的「工務」是另一個持有總務角色的帳號 |
| 流水不可改刪、記錯用調整、不做沖正；調撥一張一個料件、整張全收或整張異常；收貨只有總務；店長唯讀自己門市；固定識別防重複；狀態流轉維持舊版（C9 的「未收」以註記處理、不改流轉）；網址參數完整保留；舊 Next 路徑不轉址；無通知 | 全批 |
| Q5／Q6／第 1 批已實作的料件刪除與單位鎖定（`ga_ws_part_usage`、父料件刪除連帶位置料件） | 重用；C2 的檢查與其一致 |
| 通則：分頁與精確筆數、搜尋跳脫、使用者身分、正式區 `has_permission` 語意（不檢查角色啟用、DB 無 admin bypass、應用層 `profiles.role==='admin'` 保底）、正式區 SQL 附還原且備份後核可 | 全批 |

### 2.2 本批 13 題決定（2026-11-11，全選建議）
| 題 | 決定（代碼） | 最終行為 |
|---|---|---|
| C1 | `edit_and_batch` | 位置料件可修改、可單獨停用／啟用；新增時可多選料件、共用同一組預設數字，加入後可逐筆調整；不做「從其他位置複製」。 |
| C2 | `block_inflight_confirm_stock` | 有進行中調撥（REQUESTED、SOURCE_CONFIRMED、IN_TRANSIT，來源或目的為該位置）一律擋，不留例外。停用位置僅有庫存時，先顯示「還有 N 項庫存、M 張進行中調撥」再確認（位置本身保留停用，因 Q14「只能停用」）。移除或停用位置料件設定、停用料件，若該位置／料件仍有庫存（非 0 餘額）就擋，須先出庫或調整。 |
| C3 | `lock` | 位置已有庫存或交易紀錄後，鎖定「位置類型」「所屬門市」（assumption：位置代碼也鎖）；要換店請新增位置並調撥。沒有交易的位置建錯仍可直接改。 |
| C4 | `keep_improve` | 保留持有狀態；統計改全量；新增修改紀錄查看；調整時可填原因（寫入既有事件表 `notes` 欄，不新增欄位）。 |
| C5 | `page_date_csv` | 餘額與流水都換頁；流水加日期區間、記錄人、原因關鍵字篩選；兩者可匯出 CSV（目前篩選條件下的全部資料）。 |
| C6 | `risky_only` | 只有出庫、調減、或會變成負庫存時，顯示摘要與「過帳後餘額」並要再按一次確認；入庫、調增直接送出。 |
| C7 | `mark_and_filter` | 餘額表紅標（低於安全庫存）、黃標（低於補貨點）；「只看需補貨」篩選。純顯示、不動帳、不發通知、無需正式區 SQL。 |
| C8 | `block_with_shortcut` | 建單時目的位置未設定（或未啟用）該料件，直接擋，提供「前往位置設定」捷徑；無位置管理權限者只看到說明請總務設定。不自動開啟設定。 |
| C9 | `unreceived_note_only` | 「未收」只是註記，單子仍停在待收貨（SOURCE_CONFIRMED／IN_TRANSIT），貨到了照常確認收貨。少收、破損、收錯、取消才終結（不可恢復）。因此**不做 reopen 動作**。 |
| C10 | `store_report_flag` | 目的門市的店長（名單內 `store_manager` 身分）可在自己門市為目的地的單上按「回報問題」（沒收到、少收、破損，可加說明）；只做標記，不改庫存也不改單子狀態；不發通知。總務列表顯示紅色「門市回報有問題」，由總務決定是否標異常或取消。 |
| C11 | `mark_red_filter` | 已交出（SOURCE_CONFIRMED／IN_TRANSIT）超過 N 天（預設 3，總務可設定）未收貨的單在調撥頁標紅，並有一鍵篩選「逾期未收」；不發通知、不碰首頁待辦（第 6 批決定）。 |
| C12 | `all_identities_hide_internal` | 名單內店長、督導、區經理三種身分都可唯讀看自己門市（來源與目的雙方皆看得到自己相關的單）；位置描述、位置料件備註、調撥原因、總務備註、異常內部說明由伺服端挑欄位遮蔽，只顯示白話標籤（如「異常：少收」）。選單對有權看的人顯示庫存入口（唯讀）。 |
| C13 | `allow_keep` | 設備分類被停用後，設備與設施只要「不換分類」就允許儲存其他欄位；新增或換分類仍只能選啟用中、未刪除且祖先路徑有效的分類。舊版網站同一條資料庫規則一併放寬，需 DEV SQL＋正式區草稿。 |

### 2.3 核可的 assumptions（採用）
- 位置：換預設位置跳確認後自動換；錯誤一律白話中文；清單、位置料件、選擇器皆搜尋加分頁、統計卡伺服端精確筆數；刪除與停用用正式確認視窗並要求原因、顯示連帶筆數；多人同時編輯回 `409 STALE`；新增位置料件需 `inventory_location.manage`＋`part.view`；不新增資料表，只新增函式；有交易後代碼鎖定。
- 庫存：補登舊日期不設下限、不可填未來（Q14）、「最後異動時間」不倒退；入庫／調增、出庫／調減在畫面加白話說明、流水加記錄人；過帳固定識別防重複並新包一層函式供第 4 批共用；錯誤碼白話化；選項 API 搜尋加分頁；不做期初匯入（上線前唯讀查正式區現況再問）；記帳需 `inventory_transaction.manage`＋（`part.view`／`part.manage`），缺哪個講清楚。
- 調撥：單號改台北日期；備註不再清空、每步驟備註另存、時間軸顯示誰何時做什麼；異常類型獨立欄位（舊單仍照前綴顯示）；確認交出、收貨、取消、退回來源庫存為一次完成的函式，鎖列加以目前狀態為條件；建單與交出時檢查位置啟用與設定；需求單轉調撥驗證需求單存在、未結案、門市相符、基本單位比較剩餘量、不覆蓋進行中處理單、連結失敗整張不成立；預填 quantity 換算、無法帶入顯示「未能帶入：…」；工單來源只預填文字；網址參數完整保留；狀態卡與列表伺服端精確筆數與分頁；舊 Next 頁與舊 API 不動。
- 可見性：資料庫可見性規則不改，欄位遮蔽在伺服端；新增三個測試帳號（只有交易管理、只有調撥管理、只有位置管理）；DEV 專用清除函式不套正式區。

## 3. 新版做法

### 3.1 頁面與導覽
- 三頁：`pages/ga/InventoryLocations.vue`（G11）、`pages/ga/GaInventory.vue`（G12，餘額、流水、持有狀態三個子區）、`pages/ga/InventoryTransfers.vue`（G13）。命名一律 `inventory`，避開第 2 批的 `AssetTransfers.vue`、`TransferCreateDialog.vue`、`lib/ga-transfers.ts` 與人員調店的 `lib/workspace/transfers.ts`。UI 文案區分「轉移單（設備搬店）」與「調撥單（料件庫存）」。
- `nav.ts` 的 `GA_PAGE_BY_HREF` 加 `/general-affairs/inventory`、`/inventory?view=transactions`（同一頁帶 payload，以完整 href 對應，需特別處理）、`/inventory/locations`、`/inventory/transfers`；「盤點作業」「使用紀錄」維持規劃中。同步 `access.ts` 旗標、`page-kinds.ts`、`workspace-page-meta.ts`、`workspace-pages.ts`、`tests/fixtures/role-matrix.json`、`t03-nav-baseline.json`。
- query 契約以頁籤 payload（`openGaPage(kind, recordId, payload)`）承接，頁面 kind 用 `ga-inventory-*`。預填規則照舊（來源不存在改用持有量最大且非目的的位置、`destinationStoreId` 取預設位置否則第一個），新增「未能帶入：…」提示，`quantity` 依單位換算。
- 進頁前先擋並顯示白話無權限說明；有權看的人（含門市名單內三種身分）選單就顯示（唯讀）。

### 3.2 每頁要做的功能

**G11 位置與料件設定（`InventoryLocations.vue`）**
1. 清單：搜尋＋分頁、伺服端精確統計卡、篩選（關鍵字、類型、門市、狀態）。
2. 對話框：新增後切編輯、未存離開確認、預設位置衝突確認、負庫存切換確認。有交易後類型、門市、代碼唯讀並說明原因 [C3]。
3. 刪除／停用：正式確認視窗，先呼叫 `impact` 顯示庫存項數、進行中調撥張數、位置料件數，必填原因；進行中調撥直接擋 [C2]。
4. 位置料件：可搜尋選擇器（重用 `PartMultiPicker`）多選加入並共用預設數字、逐筆修改、停用／啟用、移除（有庫存擋）[C1][C2]。
5. 店長唯讀：390 寬卡片、無操作按鈕、遮蔽描述與備註 [C12]。

**G12 餘額、流水、過帳、持有狀態（`GaInventory.vue`）**
1. 餘額：分頁、含 0 選項、低庫存紅黃標與「只看需補貨」[C7]、CSV 匯出 [C5]、統計卡精確。
2. 流水：分頁、類型／位置／料件／日期／記錄人／原因關鍵字篩選、顯示記錄人、可辨識「調撥退回來源庫存」流水（Q12）、CSV 匯出 [C5]。
3. 過帳：類型白話說明、固定識別、發生時間不可未來；出庫／調減／會變負數時先顯示摘要與過帳後餘額再確認 [C6]；成功回「庫存 A → B」與是否重送；兩權限缺哪個講清楚。
4. 持有狀態：全量彙總、優先可調撥前 3 名、逐列調整帶原因、修改紀錄查看 [C4]。

**G13 調撥（`InventoryTransfers.vue`）**
1. 清單：伺服端狀態卡計數、狀態與搜尋篩選（跳脫）、分頁、「逾期未收」篩選與紅標 [C11]、「門市回報有問題」紅標 [C10]。
2. 建單：庫存不足警告仍可建（Q14）；目的位置缺設定直接擋＋「前往位置設定」捷徑 [C8]；網址參數預填與「未能帶入」。
3. 動作：確認交出、運送中、收貨、取消（含「退回來源庫存」勾選與紅字提醒，Q12）、異常（類型結構化欄位）；「未收」僅註記 [C9]；時間軸（誰、何時、備註）；每個動作按鈕依 `abilities()`。
4. 店長：目的門市店長可「回報問題」（類型、說明）[C10]；其餘唯讀、遮蔽內部備註 [C12]。
5. 逾期天數設定（總務可改，預設 3）[C11]。

### 3.3 API（`/api/workspace/general-affairs/inventory/**`，由 `router.ts` 分派；`lib/workspace/general-affairs/inventory.ts`，視大小拆 `inventory-locations.ts`、`inventory-transfers.ts`）
共通：非 GET 要 `checkOrigin`；使用者身分；`GaError`；`page/pageSize ≤ 100` 回 `{data, total}`；寫入帶 `expected_updated_at`，`409 STALE`；伺服端依 C12 遮蔽欄位。
| 路徑 | 說明 |
|---|---|
| `GET/POST /locations`、`GET/PATCH/DELETE /locations/:id` | 位置；DELETE 呼叫 `ga_ws_inv_delete_location` |
| `GET /locations/:id/impact` | 庫存項數、進行中調撥張數、位置料件數（刪除、停用確認）[C2] |
| `GET/POST /locations/:id/parts`、`PATCH/DELETE /locations/:id/parts/:lpId` | 位置料件；POST 支援多筆 [C1]；移除與停用前檢查 [C2] |
| `GET /options` | 搜尋＋分頁（位置、料件、位置料件設定含餘額） |
| `GET /balances`、`GET /balances/export` | 餘額；含 0、低庫存標示與篩選 [C7]、CSV [C5] |
| `GET /transactions`、`GET /transactions/export` | 流水；日期、記錄人、原因篩選 [C5] |
| `POST /transactions/post` | `ga_ws_inv_post` |
| `GET /holding`、`PATCH /holding/:balanceId`、`GET /holding/:balanceId/events` | 持有狀態全量彙總、調整帶原因、歷史 [C4] |
| `GET/POST /transfers`、`GET /transfers/:id` | 調撥單；列表伺服端狀態計數 |
| `POST /transfers/:id/actions` | 動作：`confirm_source`、`ship`、`receive`、`cancel`（含 `return_stock`、`exception_type`）、`store_report`（C10）。**無 `reopen`**（C9 已定案）。 |
| `GET/PATCH /transfers/settings` | 逾期天數設定 [C11] |

伺服端以 `abilities()`（比照第 2 批 `transfers.ts`）算每張單「我能做什麼」，按鈕與 API 預檢共用；兩權限缺哪個講清楚（Q13）。

## 4. 資料與 SQL 計畫

### 4.1 檔案與編號
DEV（`supabase/workspace-dev/`，各附 `.rollback.sql`）：
- `20261111100000_m7m8_b3_inventory_rules.sql`（A）
- `20261111110000_m7m8_b3_inventory_post.sql`（B）
- `20261111120000_m7m8_b3_inventory_transfers.sql`（C）
- `20261111130000_m7m8_b3_category_keep_inactive.sql`（D，C13）
- 套用腳本 `scripts/apply-workspace-m7m8-b3-inventory-dev.cjs [--rollback]`（比照 b2 腳本，只連 DEV，執行前確認 project-ref 以 mjpd 開頭）。

正式區草稿（`docs/vue-workspace/parity-plan/m7m8-sql/`，接續現有最大號 25，均附 rollback，`README.md` 更新套用順序與上線前檢查）：
| 檔案 | 內容 |
|---|---|
| `26-b3-preview-before-apply.sql` | 唯讀預覽：八張庫存表筆數、進行中調撥、卡單風險（目的位置停用／無設定的已交出單）、C2／C3 新規則會擋到的既有資料、`pg_get_functiondef` md5 比對、兩權限缺一的角色名單、有店長角色卻沒指派門市的帳號、持有狀態兩張表是否存在、被停用分類下的設備與設施筆數（C13） |
| `27-b3-inventory-rules.sql`／`-rollback.sql` | A：`ga_ws_inv_delete_location`（有庫存或進行中調撥禁止，回連帶筆數）、位置停用檢查、位置料件移除／停用檢查、料件停用檢查 [C2]；位置有交易後鎖定類型、門市、代碼（驗證觸發器）[C3]；位置料件 PATCH 版本檢查 [C1] |
| `28-b3-inventory-post.sql`／`-rollback.sql` | B：`ga_ws_inv_post`（包 `ga_post_inventory_transaction`：不可填未來、固定識別、最後異動時間不倒退、可被第 4 批同交易呼叫；舊函式簽名不變）；若「最後異動時間不倒退」需改核心則改以另寫欄位處理，不動舊函式 |
| `29-b3-inventory-transfers.sql`／`-rollback.sql` | C：調撥表新增 `exception_type`、`return_stock_transaction_id`、`store_report_*`（C10）、逾期天數設定（C11）；`ga_ws_inv_transfer_create`（鎖定、驗需求單、基本單位比較、不覆蓋進行中處理單、目的位置檢查 C8、台北日期單號）、`ga_ws_inv_transfer_action`（鎖列＋以目前狀態為條件、固定識別、交出與收貨過帳、取消退回來源庫存、同交易同步處理單與單據）、`ga_ws_inv_transfer_store_report`；既有欄位語意不變，舊畫面仍可讀；新欄位預設值讓舊單免回填 |
| `30-b3-category-keep-inactive.sql`／`-rollback.sql` | D（C13）：設備與設施驗證觸發器函式（錯誤訊息「設備分類必須啟用、未刪除且祖先路徑有效」處，原定義見 `supabase/migrations/20260730002830_generate_equipment_asset_code_sequence.sql` 與 baseline）改為：INSERT 或 `category_id` 有變動時才檢查分類啟用；UPDATE 且分類未變則略過分類啟用檢查（設施對應函式實作時以 `pg_get_functiondef` 確認）。Next 舊版與 Vue 新版共用此規則。 |

持有狀態不需新 SQL（事件表已有 `notes`）。所有函式 `SECURITY DEFINER`、`has_permission(auth.uid(), …)`（正式區語意）、必須使用者身分呼叫、回 `{ok, status, data, error, code}`。套用前以 `pg_get_functiondef` 比對 DEV 與正式區；所有正式區 SQL 先在 DEV 測過、附還原、備份後經使用者核可才執行。

### 4.2 DEV 現況（唯讀，2026-11-11）
資料表全在、RLS 全開、皆 0 筆；`ga_ws_` 目前沒有任何庫存函式；7 個庫存權限碼都在；`vue_workspace_ga_staff`、`vue_workspace_ga_works`、`vue_workspace_admin` 七碼全有；店長角色只有 `service_center.access`（靠 `store_managers` 指派）；`manager` 與 `dev_inventory_*` 有 `transaction.manage` 無 `transfer.manage`。

### 4.3 DEV 測試資料與清除
流水表禁止更新刪除且有外鍵，過帳產生資料無法用 `cleanupM7M8` 清掉。整合與 e2e 的餘額一律 `seedBalance` 直接種；只有過帳函式本身的測試才真過帳；新增 **DEV 專用**清除函式（SECURITY DEFINER、僅處理標記 `[自動測試]M7M8` 的列、暫停不可改刪觸發器，不套正式區），掛進 `cleanupM7M8` 與 `sweep-targets.cjs`。測試門市 VW001、VW002、ZT01 至 ZT05，年份優先 2038；ZT01、VW001 指派為各自門市 `store_manager` 並建 STORE 位置。結束只清自己的。

## 5. 權限（以資料庫為準；DB 無 admin bypass，應用層 `profiles.role==='admin'` 僅作導覽／唯讀保底，不套用在帳務寫入）
| 動作 | 需要 |
|---|---|
| 看位置、位置料件 | `inventory_location.view` 或 `manage`，或 `store_managers` 任一身分（店長、督導、區經理；只看自己名下門市 STORE 位置）[C12] |
| 寫位置與位置料件 | `inventory_location.manage`；新增或更換位置料件另需 `part.view` |
| 看餘額 | `inventory_balance.view` 或 `inventory_transaction.manage`，或門市名單 |
| 看流水 | `inventory_transaction.view` 或 `manage`，或門市名單 |
| 過帳、調整持有狀態 | `inventory_transaction.manage` ＋（`part.view` 或 `part.manage`） |
| 看調撥單 | `inventory_transfer.view`／`manage`、`inventory_transaction.view`／`manage`，或來源／目的位置可見 |
| 建單、交出、運送中、收貨、取消、退回庫存 | `inventory_transfer.manage` ＋ `inventory_transaction.manage` ＋ `part.view`（Q13，缺哪個畫面說清楚） |
| 店長回報問題 [C10] | 目的門市名單內 `store_managers.role_type = 'store_manager'` 的店長；只寫標記 |
| 逾期天數設定 [C11] | `inventory_transfer.manage` |

導覽沿用舊版 legacyNavFlags（管理員、店長角色或任一庫存權限）；舊式管理員沒掛管理員角色者維持「看得到被擋」並顯示白話說明。角色矩陣新增 `ga_inventory` 模組與帳號 `ga_inv_txn_only`、`ga_inv_transfer_only`、`ga_inv_location_edit`（`seed-workspace-role-matrix-dev.cjs`，只動 `vue_workspace_*` 與 `@example.test`）。

## 6. 測試計畫
測試 ID：**G11**（位置與料件設定）、**G12**（餘額、流水、過帳、持有狀態）、**G13**（調撥）；C13 掛在第 2 批頁面，命名 **G06C／G08C**（設備、設施分類停用）。檔名比照 G06–G10：`tests/unit|integration|parity|e2e` 下 `G11.*`、`G12.*`、`G13.*`。
- **smoke**：三頁可開、導覽四個 href 對應正確、無 console 錯誤、390 與 1440 無橫向捲動。
- **unit**：位置與位置料件驗證、單位換算（含預填 quantity）、預填參數解析與「未能帶入」、`abilities()`、錯誤碼對白話、CSV 匯出欄位、`orIlike` 跳脫、低庫存紅黃標判斷 [C7]、逾期天數判斷 [C11]、欄位遮蔽 [C12]。
- **integration**（`tests/integration/G11~G13.*.spec.ts`，移植舊 `scripts/test-general-affairs-inventory-*-dev.js` 斷言，改用 `tests/support/auth` 與環境守衛）：RLS 每角色看得到的列；過帳全部錯誤碼、冪等重送與衝突、負庫存、單位換算、拆包、最小領用量、不可填未來、最後異動時間不倒退；併發同位置出庫不超扣；位置刪除與停用檢查、有交易後鎖定類型／門市／代碼 [C2][C3]；位置料件修改、停用、批次 [C1]；調撥動作一次完成與失敗整體回復、連點與兩人同時按只成功一次、位置停用卡單被擋、目的位置缺設定建單被擋 [C8]、取消退回來源庫存（流水與調撥單關聯）、備註不被清空、「未收」註記後仍可收貨 [C9]、店長回報只寫標記且非目的門市店長做不到 [C10]；「兩權限缺一」矩陣（無權限、只有查看、只有交易管理、只有調撥管理、全有）；Q13 管理員後備不套用；`PERM.context-semantics` 正式區 `has_permission` 語意；C13：分類停用後設備與設施不換分類可存、換到停用分類或新增於停用分類被擋。
- **parity**（`tests/parity/`）：同帳號呼叫舊 `/api/general-affairs/inventory/*` 與新 API，正規化比對位置、餘額、流水、調撥列表；寫入比對讀回資料庫；差異登記 `allowlist.json`（`m7m8-` 命名，approvedBy 規則見第 7 節）。
- **e2e 角色接力劇本**（Q26，庫存段，循序執行）：總務桌機 1440 建位置、多選批次加入料件設定並修改 [C1]、入庫 → 從需求單網址帶入建調撥單（目的位置缺設定時被擋並走捷徑 [C8]）→ 交出 → 運送中 → **工務（另一個持有總務角色的帳號）桌機收貨**；**店長手機 390** 每一步查看自己門市餘額、流水、調撥單，確認沒有操作按鈕、看不到內部備註 [C12]；督導與區經理身分同樣唯讀可看 [C12]；異常路線（取消勾退回／不勾、少收終結、「未收」註記後仍可收貨 [C9]、店長回報問題後總務看到紅標 [C10]、逾期標紅與篩選 [C11]）；並發連點；位置停用卡單被擋 [C2]；舊 query 參數完整預填與「未能帶入」；最後加「沒權限做不到」檢查。「料件補貨」整條劇本要等第 4 批需求單。C13 e2e：停用分類後修改設備放置位置可存。
- 版面檢查比照 `G10.layout.e2e`；e2e 盡量用 seed 而非過帳。

## 7. 預計與舊版差異（登記 `tests/parity/allowlist.json`）
approvedBy 規則：問卷已核可的決定（下列對應 C1 至 C13 與核可 assumptions 者）設為 `"user (2026-11-11 batch 3 spec survey)"`；實作中新發現、問卷未涵蓋者設 `null`，待使用者確認。
1. 位置料件可修改、停用、批次新增 [C1]。
2. 移除設定、停用位置／料件、有進行中調撥時被擋或要確認 [C2]。
3. 有交易的位置鎖定類型、門市與代碼 [C3]。
4. 持有狀態統計改全量、可看歷史、調整填原因 [C4]。
5. 餘額與流水有換頁、日期、匯出 [C5]；過帳風險確認 [C6]；低庫存標示與篩選 [C7]。
6. 建調撥單目的位置缺設定被擋 [C8]；「未收」只註記、其餘異常終結 [C9]；店長回報問題 [C10]；逾期標紅 [C11]。
7. 店長、督導、區經理唯讀範圍與內部備註遮蔽 [C12]。
8. 分類停用後設備／設施不換分類仍可修改（舊 Next 版同步放寬）[C13]。
9. 發生時間不可填未來（Q14）、最後異動時間不倒退。
10. 調撥單號改台北日期；備註不再被清空；異常類型結構化欄位；固定識別取代隨機識別。
11. 預填 quantity 換算單位；無法預填顯示「未能帶入」；建單驗證需求單。
12. 錯誤訊息白話化；清單與下拉分頁；搜尋不壞；舊版 `soft delete` 英文與 prompt 取代。

## 8. 風險與待確認
- 正式區是否已有庫存、流水、調撥資料未查（上線前唯讀查，`26-b3-preview-before-apply.sql`）；若有，新欄位與函式必須相容舊單，且 C2、C3 新規則要先列出會被擋的既有資料。
- 持有狀態兩張表在 `supabase/migrations`（非 `migration_` 前綴），正式區可能漏套，上線前確認。
- 過帳核心若需改動才能做到「最後異動時間不倒退」，改用包裝函式處理；舊 Next 畫面仍直接呼叫舊函式，兩邊行為會有差異。
- 新舊並存期間兩邊同時操作同一調撥單：新函式以狀態條件更新，舊畫面無鎖列，仍有極小機率重複；驗收後再退場舊頁。
- Q13 的 role-matrix 細分帳號需先補，否則「缺一個權限」測不到。
- 所有 `ga_ws_inv_*` 函式簽名在做 DEV 與正式區 `pg_get_functiondef` 差異比對前視為草稿。
- C13 改的是既有設備與設施驗證觸發器，影響第 2 批頁面與舊 Next 版，須同批回歸測試 G06、G08。
- C10 回報權限限 `role_type = 'store_manager'`（督導與區經理僅唯讀）是依問卷文字「店長」的解讀，若使用者另有意見再調整。

## 9. 建議實作分組（供後續工作拆分）
1. SQL：A、B、C、D 四包（DEV 套用、整合測試、正式區草稿 26 至 30 與 README）。
2. API：locations、balances／transactions／post／holding、transfers 三組（含 `abilities()`、欄位遮蔽、CSV）。
3. 前端：G11、G12、G13 三頁與導覽接線、role-matrix 與測試帳號。
4. 測試：G11 至 G13 四層加 parity 與角色接力 e2e；C13 回歸；allowlist 登記。

## 10. 實作紀錄

### 10.1 G11 位置與料件設定＋C13（2026-11-11 完成，DEV 驗證）
- 資料庫（DEV 已套用，各附 rollback，並已在 DEV 以「撤回 → 套用」跑過一輪）：`20261111100000_m7m8_b3_inventory_rules.sql`（7 個 `ga_ws_inv_*` 位置函式、4 個內部輔助函式、位置守衛觸發器、料件停用保護觸發器）、`20261111130000_m7m8_b3_category_keep_inactive.sql`（C13，重新定義 `ga_validate_equipment`、`ga_validate_facility`，原函式備份在 `ga_m7m8_function_backups`）；套用腳本 `scripts/apply-workspace-m7m8-b3-inventory-dev.cjs`（檔案不存在的階段會略過）。正式區草稿 `26`（唯讀預覽）、`27`、`30` 與各自 rollback、README 套用順序已寫好；`28`、`29` 編號保留給 G12、G13。
- API：`lib/workspace/general-affairs/inventory-locations.ts`（位置、影響範圍、位置料件；`router.ts` 的 `inventory` 分派，G12、G13 之後在同一分派下加）、`inventory-rules.ts`（純函式）。頁面：`pages/ga/InventoryLocations.vue`、`components/ga/InventoryLocationParts.vue`、`lib/ga-inventory.ts`；`access.ts` 新增 `gaInventoryLocations` 旗標，`nav.ts` 對照 `/general-affairs/inventory/locations`。
- 測試：unit 30、smoke 10（桌機＋手機）、integration 14、e2e 14（桌機＋手機）、parity 7；C13 回歸 `G06C`（整合 6、e2e 4）；G06、G08 重跑。
- 設計上的自行決定與修正（與上文第 2、3 節的差異）：
  1. 停用位置不另填原因（資料表沒有可存停用原因的欄位）；刪除位置、移除位置料件設定要填原因。
  2. 移除或停用位置料件設定，除了「該位置有該料件庫存」，也擋「有進行中調撥使用該料件與位置（來源或目的）」，避免收貨時卡單。
  3. 刪除位置只擋「有庫存」與「進行中調撥」（照 Q14），不因「曾有交易紀錄但庫存為 0」而擋。
  4. 「已有交易」＝該位置有任何交易或任何餘額列（即使餘額 0）；C3 鎖定類型、門市、代碼用這個判斷，資料庫觸發器同時保護舊版畫面。
  5. 位置守衛觸發器（進行中調撥不能停用或刪除、有交易後不能改類型／門市／代碼）與料件停用保護（任何位置仍有庫存就不能停用料件）是資料庫層規則，舊版畫面也受影響。
  6. 位置料件設定清單用服務身分讀取（位置本身先以使用者身分確認看得到），讓只有位置權限（沒有料件查看）的人也看得到是哪個料件；只取料件公開欄位，不含內部備註。
  7. 名稱 100 字、代碼 40 字、描述與備註 500 字的長度限制（舊版沒有）。
  8. 門市名單身分的入口：`gaInventoryLocations` 在名單內任何身分為真，側欄入口補在「資產與庫存」。**限制**：「總務服務中心」選單入口（`gaCenter`）仍要總務相關權限或店長角色，沒有任何總務入口權限的督導與區經理看不到入口；若要讓他們也能進，需另外決定是否把名單身分納入 `gaCenter`（會動全站導覽基準）。
  9. 分類停用提示：設備與設施編輯畫面的分類選擇器顯示「這個分類已停用：不換分類仍可儲存其他欄位；要換分類只能選啟用中的分類。」
- 新發現、問卷未涵蓋的差異共 9 項，`allowlist.json` 的 `approvedBy` 為 null，待使用者確認：位置設定清單料件關聯多回 `is_active`、詳情不回傳 5 個系統欄位（`created_by`、`updated_by`、`deleted_at`、`deleted_by`、`deletion_reason`）、只有位置權限者的偏好領用單位名稱由伺服端補上、名稱代碼長度限制、位置刪除連帶移除設定的原因加前綴。


### 10.2 G12 庫存餘額、流水、過帳、持有狀態（2026-11-11 完成，DEV 驗證）
- 資料庫（DEV 已套用，各附 rollback，已在 DEV 以「撤回 → 套用」跑過一輪）：`20261111110000_m7m8_b3_inventory_post.sql`（4 個函式：`ga_inv_map_error` 核心錯誤換白話、`ga_ws_inv_post` 過帳包裝、`ga_ws_inv_set_holding` 持有狀態調整、`ga_ws_inv_balance_page` 餘額清單＋精確統計）；**不改**過帳核心 `ga_post_inventory_transaction` 與 `ga_set_inventory_holding_allocation`。另有 **DEV 專用** `20261111111000_m7m8_b3_dev_test_cleanup.sql`（`ga_dev_cleanup_m7m8_inventory`，只清名稱帶 `[自動測試]M7M8 T` 的位置與料件的流水，只給 service_role，不套正式區）。正式區草稿 `28-b3-inventory-post.sql`（附 rollback，README 套用順序已更新為 26 → 27 → 28 → 30）。
- API（`lib/workspace/general-affairs/inventory-stock.ts`、`inventory-stock-rules.ts`；`inventory.ts` 分派 locations 與 stock 兩組）：`GET /access`、`GET /options?type=locations|parts|location-parts`、`GET /balances`、`GET /balances/export`、`GET /transactions`、`GET /transactions/export`、`POST /transactions/post`、`GET /holding`、`PATCH /holding/:balanceId`、`GET /holding/:balanceId/events`。非 GET 驗 Origin、用使用者身分、分頁上限 100；持有狀態調整帶 `expected_updated_at`（`409 STALE`）；過帳帶固定識別（同內容重送回 200 並標示 replay，內容不同 409）。
- 頁面：`pages/ga/GaInventory.vue`（餘額、流水、持有狀態三個分頁，用 `payload.view` 區分）、`components/ga/InventoryBalances.vue`、`InventoryTransactions.vue`、`InventoryHolding.vue`、`InventoryPostDialog.vue`、`InventoryPicker.vue`（位置／料件／位置料件搜尋加分頁選擇器）、`lib/ga-inventory-stock.ts`。導覽：`gaInventory` 旗標；`nav.ts` 以完整 href 對應 `/general-affairs/inventory`（payload `{view:'balances'}`）與 `/general-affairs/inventory?view=transactions`（payload `{view:'transactions'}`），`GaNavItem` 新增 `payload`，側欄高亮同時比對 `payload.view`。
- 行為：C4 持有狀態統計全量（資料庫端加總）、前 3 名、逐列調整帶原因（寫入事件表 `notes`）、可看修改紀錄；C5 餘額與流水分頁、流水加日期（台北）、記錄人、原因關鍵字、來源篩選、匯出 CSV（目前篩選條件下的全部資料，上限 50,000 筆，公式開頭補單引號、UTF-8 BOM）；C6 只有出庫、調減、或會變負才顯示摘要與過帳後餘額並要再按一次確認（會變負而位置不允許負庫存直接擋）；C7 紅黃標與「只看需補貨」；C12 名單身分唯讀，流水原因與備註、持有狀態調整原因由伺服端遮蔽，原因搜尋對唯讀身分無效；Q12 流水可辨識「調撥退回來源庫存」；Q13 兩權限缺哪個講清楚；Q14 發生時間不可晚於現在。
- 設計上的自行決定與修正（與上文第 2、3 節的差異）：
  1. 餘額清單函式用 `SECURITY DEFINER`，但每一列都用餘額表 RLS 同一個可見性函式 `ga_inventory_balance_is_visible` 過濾（看得到哪些位置與原本相同），位置與料件名稱用資料庫身分讀公開欄位；原因是只有「交易管理」的帳號沒有位置查看權限，若用 RLS 直接 join 位置會整列消失（舊版同樣讀不到位置名稱）。
  2. 過帳選項的位置與料件設定改由伺服端用服務身分、依權限範圍讀取（有交易管理的人看全部啟用中的位置；名單身分只看自己門市）；過帳用的料件選項只給有「庫存交易管理」的人，缺「料件查看」時回說明。
  3. 流水不回傳識別碼、參考單據 id、使用者 id 與記錄人 email，只回記錄人姓名與來源說明；`metadata` 只在伺服端用來判斷來源。
  4. 發生時間容許比現在晚 1 分鐘（時鐘誤差）；前端與資料庫函式用同一個規則。
  5. 持有狀態調整原因為選填；「待確認」＝持有量減使用中與閒置（自動計算，不能手動填）。
  6. 持有狀態只列庫存大於 0 的項目；負庫存或 0 沒有可分配的持有量。
  7. 「庫存流水」側欄入口與「庫存總覽」共用同一個頁籤（`ga-inventory`），再點另一個入口只切換分頁，不另開頁籤。
- 新發現、問卷未涵蓋的差異共 7 項，`allowlist.json`（page `ga-inventory`）的 `approvedBy` 為 null，待使用者確認：餘額列不回傳 `last_transaction_id`、`created_at`；流水不回傳參考單據 id、識別碼、`created_by`、記錄人 email；日期篩選改用台北時間整天。
- 測試：unit 33（過帳驗證、單位換算、C6 風險、C7 紅黃標、CSV、遮蔽、持有狀態、導覽）、smoke 10（桌機＋手機）、integration 17（權限矩陣與 Origin、400／409／422、冪等、併發、最後異動時間、餘額清單與統計核對、持有狀態 STALE、流水篩選與匯出、選項、C12 遮蔽，全部 DB 回讀）、e2e 10（主流程、缺權限、名單身分唯讀、角色接力、版面；桌機＋手機）、parity 6；回歸 G11 45、G01、T03、role-matrix 80、G06／G08／G09／G10 smoke 全過。
- 測試輔助：`ga_dev_cleanup_m7m8_inventory`（DEV 專用）掛在 `cleanupM7M8`，測試真的過帳留下的流水才清得掉；餘額一律用 `seedBalance` 直接種。

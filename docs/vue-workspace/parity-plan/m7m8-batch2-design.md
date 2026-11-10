# M7/M8 第 2 批設計：設備、設施、保固、維修紀錄、QR 標籤與掃描、轉移單、上線貼標

> 範圍：G06 設備、G07 新增設備與 Excel 匯入、G08 設施、G09 保固與維修紀錄、G10 QR 標籤列印與掃描，加 Q5、Q8、Q9、Q10、Q11、Q28、Q29，以及 m7m8-spec「不用問、直接照做」中與設備、設施、QR 相關的事項。
> Q27（到貨建立設備）屬第 4 批，**第 3 到第 6 批都不要做**。規格以 `m7m8-spec.md` 為準；舊版行為以程式碼為準（`domains/ga-assets.md` 僅供參考）。
> 後面五個實作組都照這份做；有不一致先停下回報，不要自行改設計。第 1 批已驗收的外殼、共用上傳工具與附件面板、分類與門市選擇器、料件、型號、適用料件、`ga_ws_` 函式、測試結構都要重用，不要重寫。

## 1. 主迴圈解讀（待使用者確認，驗收時請一併確認）

| 編號 | 解讀 | 影響 |
|---|---|---|
| (a) | Q10 與 Q28：平常換店一律走 Q28 轉移單。設備／設施編輯畫面不再能直接改所屬門市（新版 API 拒收 `store_id`）。另給總務「更正所屬門市（建檔錯誤用）」：跳確認（舊→新門市、未結案單數）、必填原因、寫入同一張異動紀錄表。Q10 的「有未結案單禁止刪除並顯示張數（可改報廢）」照做。 | 與舊版不同（舊版編輯畫面可直接改店）；列入白名單，`approvedBy: null`。舊版畫面直接改 `store_id` 仍照舊，資料庫層不擋（不能改舊版行為）。 |
| (b) | Q29 的決定覆蓋「設施標籤列印這次不做」：設施也要標籤列印與貼標待辦，流程比照設備（待上傳照片 → 待上傳貼標照 → 待總務複核 → 完成），退回須填原因且兩項都要求。 | 新功能；`approvedBy: null`。 |
| (c) | Q9（使用者 2026-11-09 已確認）：QR 網址網域由伺服端環境變數 `NEXT_PUBLIC_SITE_URL`（專案既有慣例）決定，不取瀏覽器網址；缺值或格式不符就報錯；非正式環境印「測試」浮水印；排除已報廢／已作廢並提示；無編號可印但警告；單次上限 300 張。 | 上線部署清單已加一項（`m7m8-sql/README.md`「上線部署清單」）。 |
| (d) | 店長手機 390 寬的料件列表改成一筆一張卡片（第 1 批驗收時使用者同意）；設備、設施清單在手機也用卡片。 | 料件列表的修改併入第 4 組；`approvedBy: null`。 |
| (e) | Q8「恢復使用並重新啟用 QR」只對「設備已報廢、設施已退役」這類被自動作廢的資產；**已刪除的資產不提供恢復**（設施的資料庫驗證觸發器本來就禁止還原已刪除列，設備雖然可以但清單看不到）。設備「退役」維持舊版：QR 不作廢，不需恢復。 | 若使用者想要「誤刪也能救」，需要另做「已刪除」檢視與設施觸發器調整，這批不做。 |
| (f) | 退回貼標複核：一律「設備／設施照片與貼標位置照片兩項都要求重拍」，介面不再提供個別勾選（對應「直接照做」：退回同時勾兩種照片的小問題改為兩項都要求）。 | 與舊版不同（舊版可只退一項）；`approvedBy` 用 `user (2026-11-09 survey/m7m8 assumptions)`。 |
| (g) | 轉移單「確認交出／確認收到」認 `store_managers.role_type = 'store_manager'` 的人（不含督導 `supervisor`、區經理 `area_manager`）。貼標待辦與上傳照片沿用舊版：`store_managers` 內任何身分都可處理自己門市。 | 轉移單比貼標待辦嚴格；上線前要確認每間有資產的門市都有「店長」名單身分（`20-b2-preview` 第 6 區可查）。 |
| (h) | 轉移完成換店時，進行中的報修單與工單**留在原門市**（與 Q10 現行「進行中報修仍掛舊門市」一致，不自動搬）。發起與完成時的未結案單張數會記在轉移單與異動紀錄，介面要顯示警示「還有 N 張未結案單，仍屬原門市」。 | 若希望單子跟著設備走，需另行決定（會動到需求單門市欄位，屬第 4 批）。 |
| (i) | 設施貼標進度沿用設備同一組狀態值（`NEEDS_EQUIPMENT_PHOTO` 等，在設施上意思是「待上傳設施照片」），方便合併統計與共用元件。正式區既有設施套用 `22` 後依現有照片回填：沒有照片的設施會變成「待上傳設施照片」，店長手機上線後就會出現待辦，這正是 Q29 要的。 | 已寫進 `m7m8-sql/README.md`。 |
| (j) | 維修紀錄只含「報修（`request_type = REPAIR`）且指向設備或設施」的需求單與其工單；添購、指定回覆不算。每台設備修過幾次另有彙總。 | Q11 的實作定義。 |
| (k) | 永久網址 `/general-affairs/assets/scan/{token}` 的 Next 頁面預設**完全不動**（舊頁面行為不變）；新增環境旗標 `WORKSPACE_SCAN_REDIRECT=true` 時才轉到 `/workspace/#/open/ga-asset-scan/{token}`。旗標預設關閉；使用者驗收後在上線當天打開（列入上線部署清單的下一個版本）。測試以旗標開啟驗證轉址與登入後回到原網址。 | 避免違反「舊版 Next 頁面行為不可更動」；`approvedBy: null`。 |
| (l) | 掃 QR 無權限者（Q5）看到白話說明，並列出該設備所屬門市的店長姓名當「聯絡方式」（只列姓名，不列電話與帳號）。 | 實作定義，若使用者要固定客服電話請告知。 |
| (m) | Excel 匯入：單次最多 500 列；設備沒填購置日期就不自動產生資產編號（編號欄留空，標籤列印時警告）；有填資產編號則直接使用（須唯一）。分類用「分類代碼」對應（啟用中、設備資產編號需第二層分類代碼為 4 碼如 IC01）。 | 實作定義。 |

## 2. DEV 唯讀確認結果（2026-11-10，ref 以 mjpd 開頭）

| 項目 | 結果 |
|---|---|
| `ga_equipment`、`ga_facilities` | 都在、RLS 啟用。設備有 QR 三欄位與貼標六欄位（`onboarding_status`、複核備註／時間／人、兩個「需重拍」旗標）；**設施沒有貼標欄位，也沒有保固欄位（保固在 `specs.facility_has_warranty`／`facility_warranty_end_date`）**。目前設備、設施、需求單、工單都是 0 筆。 |
| QR | `qr_token` 預設由 `gen_random_uuid` 產生、格式檢查 `^[a-z0-9]{24,64}$`、唯一索引；DEV 原本缺的報廢自動作廢觸發器已在第 1 批補上，確認設備與設施各一個都在。作廢規則：設備 `SCRAPPED`、設施 `RETIRED`、任何軟刪除。 |
| 設備編號 | `ga_next_equipment_asset_code(category, purchased_at)`：需要第二層（或其下層）分類且代碼 4 碼（`[A-Z]{2}[0-9]{2}`），格式 `分類代碼 + 購置日期 YYYYMMDD + 三位流水`，序號表 `ga_asset_code_sequences`（不開 RLS，靠撤銷權限保護）。新增設備時在 `ga_validate_equipment` 觸發器內自動產生（有購置日期、沒填編號時）。 |
| 貼標流程（舊版） | 設備狀態四階段由函式與觸發器維護；舊版 `store-onboarding-tasks`（只載入 100 筆）、`onboarding-review-tasks`（100 筆）、`[id]/onboarding-review` 三支 API。附件 `ga_resource_attachments` 目的碼 `PRIMARY_IMAGE`／`LABEL_POSITION_IMAGE`，**同一資源同目的只能有一張 `is_primary`**（舊版重傳主圖會撞唯一索引，新版在函式內先把舊主圖降級）。 |
| 附件權限 | 舊版 `ga_resource_attachment_can_manage` 對設施只認設施管理權限，店長不能替設施上傳貼標照；新版 `22` 擴充（見 §3）。儲存空間 `general-affairs-attachments` 私有、20MB、僅圖片與 PDF。 |
| 需求單與工單 | `ga_service_requests`（`equipment_id`／`facility_id`、`main_status`：`PENDING_INTAKE`／`WAITING_STORE_SUPPLEMENT`／`WAITING_GA_REVIEW`／`ACCEPTED`／`IN_PROGRESS`／`WAITING_STORE_CONFIRMATION`／`COMPLETED`／`REJECTED`／`CANCELED`）與 `maintenance_requests`（工單，`status`：`UNACCEPTED`／`ACCEPTED`／`PROCESSING`／`COMPLETED`，以 `ga_service_requests.maintenance_request_id` 連結）。**工單本身沒有設備欄位**，所以維修紀錄一律從需求單取。 |
| 店長身分 | `store_managers(store_id, user_id, role_type ∈ store_manager／supervisor／area_manager)`。DEV 店長角色（`store_manager`）沒有 `request.view_own_store` 權限，所以店長讀需求單不能靠 RLS，維修紀錄函式自己判斷範圍。 |
| 測試資料 | 測試門市 VW001、VW002、ZT01 到 ZT05 都在；帳號 `ga_works`（總務／工務，58 權限）、`store_manager`（ZT01 店長）、`ga_store_manager_b`（VW001 店長）、`ga_facility_view`／`ga_facility_edit`、`denied` 都在。 |
| 缺的（已補） | 設備細分帳號 `ga_equipment_view`／`ga_equipment_edit`（見 §6）。 |
| 儲存空間 | 沒有 `maintenance-photos`（第 5 批才需要，本批不用）。轉移單照片放在既有附件儲存空間 `general-affairs-attachments` 的 `asset-transfers/{transferId}/{step}/` 底下。 |

## 3. 資料庫物件（已在 DEV 套用並通過 13 項資料庫函式整合測試）

檔案：`supabase/workspace-dev/20261110100000_m7m8_b2_asset_events_transfers.sql`（A）、`20261110110000_m7m8_b2_onboarding.sql`（B）、`20261110120000_m7m8_b2_import_history.sql`（C），各有 `.rollback.sql`；套用與撤回：`node scripts/apply-workspace-m7m8-b2-assets-dev.cjs [--rollback]`。正式區草稿與唯讀預覽在 `docs/vue-workspace/parity-plan/m7m8-sql/20` 到 `23`（README 有白話說明與套用順序）。

函式都是 `SECURITY DEFINER`、用 `has_permission(auth.uid(), …)` 自己判斷、**必須以使用者登入身分呼叫**，回傳 `{ok, status, data, error, code?, …}`（用第 1 批的 `rpc(ctx, name, args)` 呼叫；`code = 'STALE'` 代表資料已被改，要重新載入）。

### 3.1 A：異動紀錄、轉移單、更正、恢復、刪除

| 物件 | 說明 |
|---|---|
| `ga_asset_events` | 資產異動紀錄（不可改；一般身分不可刪）。`event_type`：`TRANSFER_REQUESTED`／`TRANSFER_HANDED_OVER`／`STORE_TRANSFER`／`TRANSFER_CANCELLED`／`STORE_CORRECTION`／`QR_RESTORED`。欄位：資產類型與 id、名稱與編號快照、原／新門市、轉移單 id、原因、備註、當時未結案單數、操作人 id 與姓名。 |
| `ga_asset_transfers` | 轉移單。`transfer_no`（`AT` + 台北日期 + 四位流水）；狀態 `PENDING_HANDOVER` → `PENDING_RECEIVE` → `COMPLETED`，或 `CANCELLED`；每步的操作人、時間、備註；`open_request_count` 為發起時的未結案單數；**同一資產同時只能有一張進行中**（部分唯一索引）。 |
| `ga_asset_transfer_photos` | 轉移單照片（`step` = `HANDOVER`／`RECEIVE`，每步最多 3 張，只收圖片）。 |
| 讀取權限（RLS） | 三張表只有讀取政策：持有該類設備／設施查看或管理權限者，或轉出／轉入門市的店長（`role_type = store_manager`）。**沒有任何寫入政策，寫入一律走函式。** |
| `ga_ws_asset_open_orders(type, id)` | 預覽：`{open_count, open_requests, open_work_orders, open_transfer_id}`。未結案單 = 需求單主狀態不是完成／退回／取消，**或**其工單狀態不是已完成，任一還開著算一張。 |
| `ga_ws_correct_asset_store(type, id, to_store, reason, expected_updated_at)` | 更正所屬門市：總務管理權限、原因必填（≤200）、不能同店、有進行中轉移單不可、寫 `STORE_CORRECTION`。回傳 `open_count`。 |
| `ga_ws_delete_asset(type, id, reason, expected_updated_at)` | 刪除：有未結案單回 409 `code=OPEN_ORDERS` 與 `open_count`（錯誤訊息已含「N 張」與「可改為報廢」）；有進行中轉移單回 `OPEN_TRANSFER`；其餘呼叫舊版 `ga_soft_delete_*`（QR 由既有觸發器作廢）。 |
| `ga_ws_restore_asset(type, id, reason, expected_updated_at)` | 恢復使用並重新啟用 QR：設備 `SCRAPPED`／設施 `RETIRED`（或 QR 已作廢）→ `ACTIVE`，`qr_token` 不變；已刪除回 404；不需恢復回 409；寫 `QR_RESTORED`。 |
| `ga_ws_transfer_create(type, asset_id, to_store, reason, note)` | 總務發起；已報廢／QR 作廢者不可轉；回 `{id, transfer_no, open_count}`。**不換店。** |
| `ga_ws_transfer_confirm_handover(transfer_id, note, photos)` | A 店店長確認交出；`photos` 為 `[{path, file_name, content_type, size_bytes}]`，`path` 必須以 `asset-transfers/{id}/handover/` 開頭。 |
| `ga_ws_transfer_confirm_receive(transfer_id, note, photos)` | B 店店長確認收到：**同一個交易內更新資產所屬門市**、寫 `STORE_TRANSFER`；資產已被刪除或所屬門市已被更正回 409（整步不生效）。QR token 完全不動。 |
| `ga_ws_transfer_cancel(transfer_id, reason)` | 總務取消（只能取消未完成的）；資產不動。 |

### 3.2 B：貼標流程（Q29）

| 物件 | 說明 |
|---|---|
| `ga_facilities` 新增 6 欄 | `onboarding_status`（預設 `NEEDS_EQUIPMENT_PHOTO`）、`onboarding_review_note`／`_reviewed_at`／`_reviewed_by`、`onboarding_requires_primary_photo`／`_label_photo`。 |
| 設施版計算／同步函式與附件觸發器 | 邏輯與設備版相同；設備版函式與觸發器不動。 |
| `ga_resource_attachment_can_manage` 擴充 | 設施分支多了「店長可替自己門市、狀態為待上傳階段的設施上傳」；其他分支逐字不變（`22` 先檢查 md5、備份原始碼，撤回依備份還原）。 |
| `ga_ws_onboarding_list(statuses[], asset_type, store_id, search, limit, offset)` | 設備與設施合併的待辦／複核清單，分頁（上限 200，取代舊版 100 筆）。範圍：持有設備／設施查看或管理、需求單管理或全部、`store.manage` 者看全部門市（舊版規則），其餘只看自己有名單身分的門市。排除已刪除、設備已報廢、設施已退役。回 `{rows, total}`；照片簽名網址由伺服端另查附件產生。 |
| `ga_ws_submit_onboarding_photo(type, id, purpose, path, file_name, content_type, size)` | 上傳一張貼標流程照片：驗證身分（管理權限，或該門市名單內）、狀態與目的相符（主照片要在 `NEEDS_EQUIPMENT_PHOTO`、貼標照要在 `NEEDS_LABEL_PHOTO`，否則 `STALE`）、登錄附件、清「需重拍」旗標、同步狀態，**同一個交易**。實體檔由伺服端先傳到 `{type小寫}/{id}/{purpose小寫}/{uuid}.{ext}`，函式失敗時伺服端要移除剛傳的檔案。 |
| `ga_ws_review_onboarding(type, id, action, note)` | 總務複核（管理權限）：只有 `PENDING_GA_REVIEW` 可複核（否則 `STALE`）；`approve` → `COMPLETED`；`reject` → 原因必填、兩項旗標都設為需重拍、回 `NEEDS_EQUIPMENT_PHOTO`。 |
| `ga_ws_onboarding_progress(store_id, include_empty)` | 上線貼標進度：每店設備與設施各階段筆數、完成率（完成／總數，總數 0 回 `null`，不算 100%）、最舊未完成時間。排除已刪除、設備已報廢、設施已退役。範圍：設備或設施查看／管理者看全部啟用門市，店長只看自己門市，其他 403。 |

### 3.3 C：匯入與維修紀錄

| 物件 | 說明 |
|---|---|
| `ga_asset_import_batches` | 匯入批次（防重複識別碼唯一）。 |
| `ga_ws_import_assets(rows, file_name, idempotency_key, dry_run)` | 整批預檢與寫入：預檢與正式寫入同一段程式（預檢也真的嘗試寫入再撤回），所以所有資料庫規則都會在預檢回報；**任何一列有錯整批不寫入**；同一識別碼重送回 `already_imported`。權限分設備與設施。每列：`row_no, kind(EQUIPMENT/FACILITY), store_code, category_code, name, brand, model, serial_number, asset_code, facility_code, status, criticality, area, location_detail, installed_at, purchased_at, purchase_amount, has_warranty, warranty_end_date, quantity, unit, notes`（值要已是資料庫值，中文標籤由伺服端 `import-columns.ts` 轉換）。回 `{committed, errors[{row_no,error}], rows[{row_no,asset_type,code,…}], batch_id, equipment_count, facility_count, store_count}`；預檢回的是預計編號，正式寫入的編號可能不同。 |
| `ga_ws_asset_maintenance_history(type, asset_id, store_id, status, search, from, to, limit, offset)` | 維修紀錄逐筆（需求單 + 工單）；`status`：`OPEN`／`CLOSED`／需求單主狀態原值；搜尋用字串比對（逗號、括號、百分號不會壞）；分頁（上限 200）；範圍：持有設備／設施查看或管理、需求單查看全部或管理、維修單／工單查看全部者看全部，其餘看自己名單身分的門市；**非全部範圍者看不到處理人姓名**。 |
| `ga_ws_asset_repair_summary(type, store_id, search, limit, offset)` | 每台設備／設施修過幾次、未結案幾張、最近報修時間。 |

## 4. 規格對照（誰負責什麼）

| 決議 | 實作 | 組 |
|---|---|---|
| Q5 店長看料件不含內部備註（第 1 批已做）；**門市負責人只看設備基本欄位（名稱、位置、狀態、保固、所屬門市），金額、供應商、備註、序號、採購與保固申請方式只給有設備／設施查看權限者**；由伺服端挑欄位，不改資料庫 | `asset-fields.ts` 的 `pickAssetFields(row, level)`，清單、詳情、掃描頁、貼標任務都經過它 | 1 |
| Q5 掃 QR 無權限者看到白話說明與聯絡方式 | 掃描 API 回 `403 { code: 'NO_ACCESS', message, contacts }` | 3 |
| Q8 報廢／刪除仍作廢，掃到時友善說明；總務可恢復並沿用原標籤；設備退役維持舊版 | `ga_ws_restore_asset`；掃描 API 區分「不存在」與「已作廢」 | 1、3 |
| Q9 QR 網域、測試浮水印、排除作廢、無編號警告、300 張上限 | `qr-url.ts`、標籤 API、標籤頁 | 3 |
| Q10 有未結案單禁止刪除；更正門市；編輯不可改門市 | `ga_ws_delete_asset`、`ga_ws_correct_asset_store`；編輯 API 拒收 `store_id` | 1 |
| Q11 維修紀錄改讀需求單與工單、完整分頁 | `ga_ws_asset_maintenance_history`、`ga_ws_asset_repair_summary` | 1（API）、4（頁） |
| Q28 轉移單 | `ga_ws_transfer_*`、轉移 API 與頁面 | 2（API）、5（頁） |
| Q29 Excel 匯入、設施貼標、進度頁 | `ga_ws_import_assets`、`ga_ws_*onboarding*` | 2（API）、5（頁） |
| 直接照做：編輯保留「購買來源供應商」「保固申請方式」 | 更新只送有改的欄位（`PATCH` 語意），讀回比對 | 1 |
| 直接照做：保固到期用台北時間，到期日當天結束才算過期 | `warrantyState()` 用台北日期 | 1 |
| 直接照做：新增設備一次 1 到 100 台、任一編號重複整批失敗、欄位驗證、編號自動產生 | 沿用 `lib/general-affairs/equipment/validation.ts` 與單一 `insert` 陣列（單一語句全成或全不變）；設備編號可改，改時提醒「標籤需重印」 | 1、4 |
| 直接照做：只載入前 100／200／500 筆的地方改搜尋、分頁、精確筆數（店內設備、保固頁、維修紀錄、貼標待辦） | 所有清單伺服端分頁 + `total` | 1、2 |
| 直接照做：附件規則、HEIC 顯示檔名與下載連結、簽名連結每次重簽 | 重用第 1 批 `attachments.ts` 與共用元件 | 4、5 |
| 直接照做：QR 永久網址 token 沿用不重發；未登入先登入再回原網址；作廢或不存在回 404；無報修權限者按鈕停用並說明 | 掃描 API 與頁 | 3 |

## 5. API（全部在 `/api/workspace/general-affairs/**`，由 `router.ts` 分派）

共通：非 GET 要 `checkOrigin`；以使用者身分查詢（RLS 與函式判斷權限）；錯誤格式沿用第 1 批 `GaError`（`{error, code?, …}`）；清單 `?page=&pageSize=`（≤100）回 `{data, total}`；寫入一律 `expected_updated_at` 版本檢查（`409 STALE`）。

### 5.1 設備與設施（第 1 組）

`kind` ∈ `equipment`／`facilities`（兩者同結構，欄位差異依舊版 `lib/general-affairs/{equipment,facilities}/validation.ts`）。

| 方法與路徑 | 說明 | 權限（資料庫語意，`permissions` 集合） |
|---|---|---|
| `GET /{kind}` | 清單。篩選：關鍵字（逗號、括號不壞）、分類（含子孫）、狀態、保固狀態（全部／保固中／即將到期／已過保／無保固／保固日未填）、貼標進度、門市；排序 `name/asset_code/status/updated_at/created_at/warranty_end_date`；回統計卡（總數、需留意狀態、保固需確認）。回應欄位經 `pickAssetFields`。 | 該類查看／管理，或名單內店長（基本欄位） |
| `GET /{kind}/:id` | 詳情（含附件摘要、貼標進度、進行中轉移單） | 同上 |
| `POST /{kind}` | 新增（設備 1 到 100 台；設施一筆） | 管理 |
| `PATCH /{kind}/:id` | 部分更新（**拒收 `store_id`，回 400 並說明改走轉移單或更正**）。設備編號可改，回應帶 `warnings: ['LABEL_REPRINT']`。 | 管理 |
| `DELETE /{kind}/:id` | body `{reason, expected_updated_at}`，`ga_ws_delete_asset`；409 `OPEN_ORDERS` 帶 `open_count` | 管理 |
| `GET /{kind}/:id/open-orders` | `ga_ws_asset_open_orders`（刪除與更正確認畫面用） | 該類查看／管理 |
| `POST /{kind}/:id/correct-store` | `{to_store_id, reason, expected_updated_at}` | 管理 |
| `POST /{kind}/:id/restore` | `{reason, expected_updated_at}` | 管理 |
| `GET /{kind}/:id/events` | 異動紀錄時間軸（含轉移） | 該類查看／管理，或轉出／轉入門市店長 |
| `GET /asset-maintenance/history?type=&assetId=&storeId=&status=&q=&from=&to=` | 維修紀錄逐筆 | 函式判斷（§3.3） |
| `GET /asset-maintenance/summary?type=&storeId=&q=` | 每台修過幾次 | 同上 |

保固頁（G09）用 `GET /{kind}?warranty=…` 加統計；不另開路徑。

### 5.2 轉移、貼標、匯入（第 2 組）

| 方法與路徑 | 說明 | 權限 |
|---|---|---|
| `GET /transfers?status=&assetType=&storeId=&mine=1&q=&page=` | 轉移單清單（RLS 決定看得到哪些）。`mine=1` 只列「待我處理」：我是 A 店店長且 `PENDING_HANDOVER`，或我是 B 店店長且 `PENDING_RECEIVE`。 | RLS |
| `GET /transfers/:id` | 詳情 + 時間軸 + 照片簽名網址（每次重簽） | RLS |
| `POST /transfers` | `{assetType, assetId, toStoreId, reason, note}` | 管理（資料庫判斷） |
| `POST /transfers/:id/handover`、`/receive` | `multipart`：`note`、`files[]`（≤3 張圖片）。伺服端先上傳到 `asset-transfers/{id}/{step}/`，再呼叫函式；函式失敗就移除剛傳的檔案。 | 店長（資料庫判斷） |
| `POST /transfers/:id/cancel` | `{reason}` | 管理 |
| `GET /onboarding/tasks?statuses=&assetType=&storeId=&q=&page=` | `ga_ws_onboarding_list`，預設只列待上傳兩個狀態；附上設備／設施照片簽名網址（每次重簽） | 函式判斷範圍 |
| `POST /onboarding/photo` | `multipart`：`assetType`、`assetId`、`purpose`、`file`。流程：驗證圖片（4MB、縮圖由前端）→ 上傳 → `ga_ws_submit_onboarding_photo` → 失敗移除檔案；回新狀態與更新後的待辦 | 函式判斷 |
| `GET /onboarding/review` | `statuses=PENDING_GA_REVIEW`，帶兩張照片簽名網址 | 設備／設施查看或管理（資料庫語意） |
| `POST /onboarding/review` | `{assetType, assetId, action, note}` | 管理 |
| `GET /onboarding/progress?storeId=` | `ga_ws_onboarding_progress`；每店 `completion_rate`、各階段筆數 | 函式判斷 |
| `GET /asset-import/reference` | 門市代碼、啟用中設備／設施分類代碼與名稱、狀態與重要程度對照、欄位說明（供下載範本與前端提示） | 設備或設施管理 |
| `POST /asset-import/check`、`/commit` | `{rows, fileName, idempotencyKey}`；Excel 由前端用 `xlsx` 解析成列物件（欄位名用中文表頭，值保持原字串），伺服端 `import-columns.ts` 對應成資料庫值並呼叫 `ga_ws_import_assets(dry_run)`；`check` 與 `commit` 都回逐列結果；`commit` 有錯時 `committed=false`、HTTP 200 | 設備或設施管理（資料庫判斷） |

### 5.3 QR（第 3 組）

| 方法與路徑 | 說明 |
|---|---|
| `GET /qr/labels?type=&ids=&storeId=&q=&status=&categoryId=` | 標籤資料：`{items:[{id,name,code,storeName,qrUrl,svg,warnings[]}], excluded:[{id,name,reason}], watermark:boolean, limit:300, truncated:boolean, matched:number}`。`ids` 給了就只印那幾台，否則依篩選；**單次最多 300 張**，超過回 `truncated` 並提示分批；排除已報廢／已作廢（`excluded` + 提示）；無編號者仍列入但 `warnings:['NO_CODE']`；`svg` 由伺服端用既有 `qrcode` 套件產生（`type: 'svg'`）。權限：該類查看／管理。 |
| `GET /assets/scan/:token` | 掃描資料。token 必須 24 到 64 位小寫英數否則 400；未登入 401；找不到 404 `{code:'NOT_FOUND'}`；已作廢 404 `{code:'REVOKED', message}`（友善說明：已報廢或已刪除，請洽總務）；無權限 403 `{code:'NO_ACCESS', message, contacts}`（Q5）；成功回資產基本資料（欄位經 `pickAssetFields`，名單外且無查看權限者看不到金額、供應商、備註）、保固狀態、近期維修紀錄、照片簽名網址（最多 8 張，主圖優先）、`canReport`（有建單權限且該門市範圍內才為 true）與 `reportPath`、`managementPath`（依權限）。 |

**QR 網址 `lib/workspace/general-affairs/qr-url.ts`（第 3 組）**：
- `getQrBaseUrl(env = process.env)`：讀 `NEXT_PUBLIC_SITE_URL`（`trim`、去結尾斜線），必須符合 `^https?://[^/\s]+$`，否則丟 `GaError(500, 'QR 網址網域尚未設定…')`；**任何環境、任何情況都不得退回瀏覽器網址**。
- `isProductionRuntime(env)`：`VERCEL_ENV === 'production'`，或 Supabase 專案 ref 不是 DEV ref；非正式環境標籤加「測試」浮水印（`watermark: true`），並在標籤頁頂顯示環境說明。
- `qrUrlFor(token)` = `{base}/general-affairs/assets/scan/{token}`。純函式 + 單元測試（缺值、尾斜線、含路徑、非 http、正式環境缺值報錯、浮水印判斷）。

## 6. 角色矩陣（已補，並通過 role-matrix 整合測試 76 項）

`tests/fixtures/role-matrix.json` 新增模組 `ga_equipment` 與兩個細分帳號：`ga_equipment_view`（只有 `general_affairs.equipment.view`）、`ga_equipment_edit`（`equipment.manage` + `equipment.view`）；DEV 帳號已用 `scripts/seed-workspace-role-matrix-dev.cjs` 建立（只動 `vue_workspace_*` 與 `@example.test`）。設施細分帳號 `ga_facility_view`／`ga_facility_edit` 第 1 批已有。其餘本批需要的帳號都已存在：總務與工務 `ga_works`（及 `ga_staff`）、A 店店長 `store_manager`（ZT01）、B 店店長 `ga_store_manager_b`（VW001）、無權限 `denied`。

**第 1 組加上新導覽旗標時，要同步更新這個檔案的 `expected.capabilities` 與 `navigationHrefs`，並重跑 role-matrix 整合測試。** 預期變動：店長帳號（`store_manager`、`acting_manager`、`ga_store_manager_b`）會多出設備、設施、貼標待辦、進度與轉移相關旗標；設備／設施查看與管理帳號會多出對應旗標。

## 7. 頁面清單與導覽（第 1 組接線、第 4 與第 5 組實作）

新增 `GaFlags`（`access.ts`，仿第 1 批寫法，`has()` 含管理員後備、API 用資料庫語意）：

| 旗標 | 條件 | 頁面 kind | 舊網址（`GA_PAGE_BY_HREF`） |
|---|---|---|---|
| `gaEquipment` | 店長身分，或設備查看／管理 | `ga-equipment` | `/general-affairs/equipment` |
| `gaEquipmentCreate` | 設備管理 | `ga-equipment-create` | `/general-affairs/equipment/new` |
| `gaEquipmentWarranties` | 設備查看／管理 | `ga-equipment-warranties` | `/general-affairs/equipment/warranties` |
| `gaEquipmentHistory` | 店長身分，或設備查看／管理 | `ga-equipment-history` | `/general-affairs/equipment/maintenance-history` |
| `gaEquipmentLabels` | 設備查看／管理 | `ga-equipment-labels` | `/general-affairs/equipment/labels` |
| `gaFacilities`、`gaFacilityCreate`、`gaFacilityWarranties`、`gaFacilityHistory` | 同上（設施版） | `ga-facilities`、`ga-facility-create`、`ga-facility-warranties`、`ga-facility-history` | `/general-affairs/facilities`、`/new`、`/warranties`、`/maintenance-history` |
| `gaFacilityLabels` | 設施查看／管理 | `ga-facility-labels` | 無舊網址（新頁，掛在側欄「設施」群組） |
| `gaTransfers` | 設備或設施管理，或店長身分 | `ga-transfers` | 無舊網址（新頁） |
| `gaOnboardingTasks` | 店長身分（待上傳）；總務也能進（看全部門市） | `ga-onboarding-tasks` | 無（新頁；舊版這個待辦在首頁） |
| `gaOnboardingReview` | 設備或設施管理 | `ga-onboarding-review` | 無（新頁） |
| `gaOnboardingProgress` | 設備／設施查看或管理，或店長身分 | `ga-onboarding-progress` | 無（新頁） |
| `gaAssetImport` | 設備或設施管理 | `ga-asset-import` | 無（新頁） |
| （不用旗標） | 登入者皆可 | `ga-asset-scan`（走 `/open/ga-asset-scan/{token}` 深連結白名單，登入後開頁籤） | `/general-affairs/assets/scan/{token}` |

- 新頁沒有舊網址，**不改舊版 `components/general-affairs/navigation.tsx`**；由 `lib/workspace/general-affairs/nav.ts` 在 `gaNavigation` 輸出後追加（貼標待辦、轉移單等放在側欄「設備與設施」相關群組最後）。第 1 組負責。
- `WorkTabKind`（`lib/workspace/page-kinds.ts`）與 `vue-workspace/src/App.vue` 的 kind → 元件對照、`workspace-page-meta.ts`、`/open/:kind/:id?` 白名單都要加上述 kind。
- 頁面檔（`vue-workspace/src/pages/ga/`）：`Equipment.vue`、`EquipmentCreate.vue`、`Facilities.vue`、`FacilityCreate.vue`（共用元件 `AssetList.vue`、`AssetDrawer.vue`、`AssetFormFields.vue`、`AssetStatusTag.vue`、`AssetCard.vue`）、`AssetWarranties.vue`（設備與設施共用，prop `type`）、`AssetMaintenanceHistory.vue`（逐筆與彙總兩個分頁，prop `type`）、`AssetLabels.vue`、`AssetScan.vue`、`AssetTransfers.vue`、`OnboardingTasks.vue`、`OnboardingReview.vue`、`OnboardingProgress.vue`、`AssetImport.vue`。
- **手機（390 寬）**：店長會用的頁（設備清單、設施清單、轉移單、貼標待辦、掃描頁、維修紀錄）一律卡片式，一筆一張卡、主要按鈕在卡片底部且高度 ≥ 44px、不得水平捲動；桌機維持表格。料件列表手機卡片化（解讀 (d)）併入第 4 組。
- 重用第 1 批共用元件：`UploadPicker`／附件面板（照片縮小、4MB 檢查）、分類與門市選擇器、`GaShell`、未儲存離開確認。

## 8. 權限對照（資料庫為準，☑ 可、☐ 不可）

| 操作 | 總務／工務（`ga_works`） | 設備管理（`ga_equipment_edit`） | 設備查看（`ga_equipment_view`） | 設施管理／查看 | 店長 A（ZT01） | 店長 B（VW001） | 無權限（`denied`） |
|---|---|---|---|---|---|---|---|
| 設備清單全欄位（含金額、供應商、備註） | ☑ | ☑ | ☑ | ☐ | ☐ | ☐ | ☐ |
| 設備清單基本欄位（自己門市） | ☑ | ☑ | ☑ | ☐ | ☑ | ☑（自己門市） | ☐ |
| 新增／編輯／刪除／更正門市／恢復 QR | ☑ | ☑ | ☐ | 僅設施 | ☐ | ☐ | ☐ |
| 發起轉移單、取消轉移單 | ☑ | ☑ | ☐ | 僅設施 | ☐ | ☐ | ☐ |
| 確認交出（轉出門市） | ☐（不是名單店長） | ☐ | ☐ | ☐ | ☑（A 是轉出門市時） | ☑（B 是轉出門市時） | ☐ |
| 確認收到（轉入門市） | ☐ | ☐ | ☐ | ☐ | ☑（A 是轉入門市時） | ☑（B 是轉入門市時） | ☐ |
| 上傳貼標流程照片 | ☑（管理權限） | ☑ | ☐ | 僅設施 | ☑（自己門市、待上傳階段） | ☑（同左） | ☐ |
| 貼標複核（通過／退回） | ☑ | ☑ | ☐ | 僅設施 | ☐ | ☐ | ☐ |
| 上線貼標進度 | ☑（全部門市） | ☑ | ☑ | ☑ | ☑（自己門市） | ☑（自己門市） | ☐ |
| Excel 匯入 | ☑ | 僅設備 | ☐ | 僅設施 | ☐ | ☐ | ☐ |
| 標籤列印 | ☑ | ☑ | ☑ | 僅設施 | ☐ | ☐ | ☐ |
| 維修紀錄 | 全部 | 全部 | 全部 | 全部 | 自己門市（不含處理人） | 自己門市 | ☐ |
| 掃 QR 看資產 | ☑ | ☑ | ☑ | ☑ | 自己門市資產（基本欄位）；他店顯示白話說明 | 同左 | 白話說明 |

所有 ☐ 都要有「無權限者做不到」的測試（API 回 403／404、介面沒有按鈕，兩者都驗）。

## 9. 五個實作組的分工與相依

統一規則：Sonnet 實作；每組做完先自跑 `vue-tsc --noEmit`、`npx tsc --noEmit`、`node --check`、`npm --prefix vue-workspace run build` 並同步到 `public/workspace`，再逐一**循序**跑 `npm run test:page -- <workId>`（不可平行）；commit 小而清楚，結尾 `Co-Authored-By`。只碰 DEV 與 VW／ZT 測試門市，測試資料帶 `[自動測試]M7M8` 標記（用 `tests/support/m7m8-fixtures.ts`，已含 `seedFacility`、`seedRepairRequest`、`rpcClientFor`、`callFn`，清理已涵蓋新表），只刪自己建立的資料，sweeper 孤兒維持 17（不要刪既有孤兒）。與舊版不同的行為列入 `tests/parity/allowlist.json`（§11）。

```
第 1 組（資產主檔 API 與接線）──┬─> 第 4 組（資產頁面）──┐
第 2 組（轉移、貼標、匯入 API）──┤                        ├─> 第 5 組（流程頁面、劇本、收尾）
第 3 組（QR：網址、標籤、掃描）──┘                        │
```
第 1 組先做「接線提交」（§9.1），之後第 2、3 組可平行；第 4 組在第 1 組完成後開始；第 5 組最後。

### 第 1 組：資產主檔 API、欄位可見範圍、導覽接線（G06、G08、G09 的後端；工作項 G06）

- 檔案：`lib/workspace/general-affairs/assets.ts`（`equipmentApi`、`facilitiesApi`）、`asset-fields.ts`（`pickAssetFields`、`warrantyState`，純函式）、`history.ts`（`maintenanceApi`）、`access.ts`（新旗標）、`nav.ts`、`router.ts`、`lib/workspace/page-kinds.ts`、`lib/workspace/session` 的 capabilities 輸出、`tests/fixtures/role-matrix.json`。
- **先做接線提交**：`router.ts` 一次加好所有 case（`equipment`、`facilities`、`asset-maintenance`、`transfers`、`onboarding`、`asset-import`、`qr`、`assets`），第 2、3 組的模組先放空殼匯出（處理函式一律 `throw new GaError(501, '尚未完成')`，檔名與匯出名照 §5：`transfers.ts` 匯出 `transfersApi`、`onboarding.ts` 匯出 `onboardingApi`、`asset-import.ts` 匯出 `assetImportApi`、`qr.ts` 匯出 `qrApi`、`scan.ts` 匯出 `scanApi`），並加上全部新旗標、kind、導覽追加項。第 2、3 組只替換自己的模組內容，**不得再改 `router.ts`、`access.ts`、`nav.ts`**（需要調整請回報第 1 組負責人）。
- 內容：設備／設施清單、詳情、新增、部分更新、刪除、更正門市、恢復、未結案單預覽、異動紀錄、維修紀錄與彙總、統計卡；Q5 欄位挑選；Q10 編輯拒收 `store_id`；保固狀態台北時間；舊版驗證沿用 `lib/general-affairs/{equipment,facilities}/validation.ts`（不要複製一份）。
- 測試：`tests/unit/G06/`（`pickAssetFields`、`warrantyState`、導覽旗標、`GA_PAGE_BY_HREF`）、`tests/integration/G06.assets-api.spec.ts`（各角色 200／403、讀回資料庫、Q5 欄位、Q10 編輯拒收 `store_id`、刪除 409、更正、恢復、分頁與搜尋逗號括號、設施同規則）、`G09.history-api.spec.ts`、role-matrix 更新與重跑。
- 相依：無（SQL 已備）。

### 第 2 組：轉移單、貼標流程、Excel 匯入的 API（工作項 G07、G10 的後端）

- 檔案：`transfers.ts`、`onboarding.ts`、`asset-import.ts`、`import-columns.ts`（中文表頭與值對照：門市代碼、分類代碼、類型「設備／設施」、狀態與重要程度中文標籤、是否保固「是／否」、日期 `YYYY-MM-DD`、數字；錯誤訊息用列號 + 欄位名）。
- 照片上傳與簽名網址重用 `upload-rules.ts` 與 `attachments.ts` 的函式（圖片限定、≤4MB、單次 ≤3 張；簽名網址每次重簽）；失敗清理已上傳的檔案。
- 測試：`tests/integration/G07.import-api.spec.ts`（xlsx 列物件 → 預檢 → 提交、錯誤列整批不寫入、重送不重複、500 列上限、權限）、`G10.transfers-api.spec.ts`、`G10.onboarding-api.spec.ts`（含「退回後兩項都要重傳」、店長 B 看不到 A 店待辦、複核權限、進度完成率）。資料庫函式本身已有 `G06.asset-db.spec.ts` 13 項，這裡測 API 層（身分、格式、檔案、錯誤對應）。
- 相依：第 1 組接線提交。

### 第 3 組：QR 網址、標籤、掃描（工作項 G10 的 QR 部分）

- 檔案：`qr-url.ts`、`qr.ts`（標籤資料，伺服端 SVG）、`scan.ts`；Next 端 `app/general-affairs/assets/scan/[token]/page.tsx` 只在 `WORKSPACE_SCAN_REDIRECT === 'true'` 時 `redirect`（其餘程式一行不動）；Vue 頁 `AssetLabels.vue`（沿用舊版 60×25 mm、一張一頁、`@media print`）、`AssetScan.vue`（照舊版資訊卡、友善說明、按鈕規則；手機優先）；`/open/ga-asset-scan/{token}` 深連結與未登入先登入再回原網址。
- 測試：`tests/unit/G10/qr-url.test.ts`；`tests/integration/G10.qr-api.spec.ts`（標籤 300 上限、排除報廢並提示、無編號警告、浮水印旗標、缺環境變數報錯、掃描 400／401／403／404／REVOKED／成功、Q5 欄位、token 沿用）；e2e：開啟旗標的測試伺服器驗證 `/general-affairs/assets/scan/{token}` 轉址與登入後回原網址、恢復 QR 後舊 token 又可掃、轉移後 token 不變、掃描頁 390 寬無水平捲動。
- 相依：第 1 組接線提交與 `asset-fields.ts`。

### 第 4 組：設備、設施、保固、維修紀錄頁面（工作項 G06、G07、G08、G09 的前端）

- 內容：§7 的 `Equipment.vue`、`EquipmentCreate.vue`、`Facilities.vue`、`FacilityCreate.vue`、`AssetWarranties.vue`、`AssetMaintenanceHistory.vue` 與共用元件；刪除（顯示未結案單張數、可改報廢）、更正所屬門市（確認視窗：舊→新門市、未結案單數、必填原因）、恢復使用並重新啟用 QR（確認視窗）、設備編號可改並提醒標籤需重印、離開未儲存確認、附件面板（重用）、轉移單入口按鈕（開啟 `AssetTransfers` 的發起視窗，元件由第 5 組提供；第 4 組先放入口並在元件未到時隱藏）；店長看到基本欄位版本；**手機卡片**；料件列表手機卡片化（解讀 (d)，改 `Parts.vue`，並更新第 1 批對應的 e2e 與 390 寬檢查）。
- 測試：`tests/e2e/G06.equipment.e2e.spec.ts`、`G08`、`G09`（桌機 1440 與手機 390 兩個 project；建立、編輯、讀回、刪除被擋、更正、恢復、保固篩選、維修紀錄分頁）、`tests/smoke/G06…`、`tests/parity/G06…`（讀取欄位比對舊 API；寫入讀回）。
- 相依：第 1 組。

### 第 5 組：轉移、貼標、進度、匯入頁面；Q26 劇本；收尾（工作項 G10 前端、G07 匯入頁）

- 內容：`AssetTransfers.vue`（桌機表格 + 發起視窗；手機卡片「待我處理」分頁，確認交出／收到可拍照）、`OnboardingTasks.vue`（手機優先：一台一張卡，逐台上傳設備照與貼標照，進度條與退回原因顯示）、`OnboardingReview.vue`（桌機：兩張照片並排，通過／退回〈原因必填〉）、`OnboardingProgress.vue`（每店完成率條、各階段筆數、卡在哪一步、可點進該店待辦）、`AssetImport.vue`（下載範本、選 Excel、預檢結果逐列顯示、有錯整批不能提交、提交成功顯示批次摘要）。
- **Q26 劇本（本批加入，七個劇本中的兩個）**：
  - `tests/e2e/G10.journey-transfer.spec.ts`「設備轉移」：總務（桌機 1440，`ga_works`）發起 → A 店店長（`store_manager`，ZT01，手機 390）看到待我處理並確認交出（附照片）→ B 店店長（`ga_store_manager_b`，VW001，手機 390）看到並確認收到 → 檢查：B 店看得到設備且能報修入口可見、A 店看不到（清單與掃描頁都是）、QR token 沿用（舊 token 掃描頁顯示 B 店）、轉移單時間軸與異動紀錄完整（發起、交出、收到、操作人、照片）。
  - `tests/e2e/G10.journey-onboarding.spec.ts`「上線貼標」：總務用 Excel 匯入設備與設施（ZT01 與 VW001 兩店）→ 依門市印標籤（確認 300 上限與測試浮水印）→ 店長手機逐台上傳設備照與貼標照（設備與設施各至少兩台）→ 總務複核，**含退回一次**（填原因，店長收到退回、兩項都要重傳）→ 該店完成率 100%，進度頁顯示一致。
  - 每個劇本另加「無權限者做不到」檢查（§8 所有 ☐：用 API 與介面兩種方式驗證，至少包含：`denied`、`ga_equipment_view`、設施帳號、非轉出／轉入門市的店長、總務不能代替店長確認、店長不能複核、店長不能發起轉移、店長不能匯入）。
  - 店長一律手機 390，總務、工務桌機 1440；每一步檢查對方畫面有沒有收到、狀態對不對；最後走到「完成」。
- 收尾：`tests/parity/allowlist.json` 條目（§11）與 `STILL_PENDING`；T03 導覽基準（`tests/fixtures/t03-nav-baseline.json`，若頁面數改變）；`m7m8-sql/README.md` 核對 DEV 實測結果；全批 `npm run test:page` 逐一循序（G06、G07、G08、G09、G10，再 role-matrix、T03）；整批回報（含待使用者確認的解讀清單與截圖路徑；依使用者全域規定，Remote Control 開啟時用 1920×1080 截圖上傳）。
- 相依：第 1、2、3、4 組。

### 9.1 路徑與檔名約定（避免衝突）

| 項目 | 擁有者 | 其他組 |
|---|---|---|
| `router.ts`、`access.ts`、`nav.ts`、`page-kinds.ts`、`App.vue` 的 kind 對照、`workspace-page-meta.ts`、session capabilities | 第 1 組 | 需要改請回報，不自行修改 |
| `transfers.ts`、`onboarding.ts`、`asset-import.ts`、`import-columns.ts` | 第 2 組 | — |
| `qr-url.ts`、`qr.ts`、`scan.ts`、Next 掃描頁、`AssetLabels.vue`、`AssetScan.vue` | 第 3 組 | — |
| `Equipment*.vue`、`Facilit*.vue`、`AssetWarranties.vue`、`AssetMaintenanceHistory.vue`、`Parts.vue`、共用資產元件 | 第 4 組 | — |
| `AssetTransfers.vue`、`Onboarding*.vue`、`AssetImport.vue`、劇本、allowlist、README | 第 5 組 | — |
| `tests/support/m7m8-fixtures.ts`、`sweep-targets.cjs` | 共用：只新增不改既有；每組自己的 seed 函式加在檔尾並註明組別 | — |

## 10. 測試與驗證總表

| 層 | 內容 |
|---|---|
| 資料庫函式（已完成） | `tests/integration/G06.asset-db.spec.ts` 13 項：刪除與未結案單、更正門市、恢復 QR、轉移單全流程與越權亂序、取消、設施轉移、設備與設施貼標流程（含退回兩項都要求與主照片唯一）、進度完成率、設施店長 RLS、匯入（預檢、整批失敗、重送、權限）、維修紀錄範圍與彙總。正式區草稿 `21`、`22`、`23` 也在 DEV 完整跑過一輪（套用、測試、撤回、確認回到原狀）。 |
| 單元 | `pickAssetFields`、`warrantyState`（台北日期、當日結束才過期）、`qr-url`、`import-columns`、導覽旗標、標籤排除與上限規則 |
| 冒煙 | 每頁導覽進入、標題、主要 API 200、無 pageerror、390 寬無水平溢出（手機卡片頁）、舊網址回應 |
| 整合 | 各 API 的 200／400／401／403／404／409、版本衝突、重送冪等、寫入後用 service role 讀回、檔案上傳失敗清理 |
| e2e | 桌機 1440 與手機 390；每頁一條完整路徑；兩個 Q26 劇本 |
| parity | 讀取欄位與舊 API 比對、寫入讀回；差異都在白名單（§11） |

## 11. 差異白名單（`tests/parity/allowlist.json`，每條都要有 `key`，不可整個 entry 放行）

`approvedBy` 規則：使用者在問卷已決定者填 `"user (2026-11-09 survey/m7m8 Qn)"`；「不用問、直接照做」的填 `"user (2026-11-09 survey/m7m8 assumptions)"`；**主迴圈解讀 (a)(b)(d) 與其他自行延伸者填 `null`，並把 id 加入 `tests/unit/T02/parity-framework.test.ts` 的 `STILL_PENDING`**。

| 差異 | `approvedBy` |
|---|---|
| 門市負責人只看設備與設施基本欄位（Q5） | `… survey/m7m8 Q5` |
| 掃 QR 無權限者看到白話說明與聯絡方式（Q5；聯絡方式內容為解讀 (l)） | Q5 部分填 Q5，聯絡方式填 `null` |
| 報廢／刪除後掃描顯示友善說明而非「找不到」（Q8） | `… Q8` |
| 新增恢復使用並重新啟用 QR（Q8；範圍為解讀 (e)） | `… Q8`；(e) 的限制填 `null` |
| QR 網域取環境設定、測試浮水印、排除作廢、300 張上限（Q9） | `… Q9` |
| 有未結案單禁止刪除並顯示張數（Q10） | `… Q10` |
| 編輯畫面不能再直接改所屬門市；更正所屬門市（解讀 (a)） | `null`（STILL_PENDING） |
| 轉移單（Q28） | `… Q28`；(g) 身分限制與 (h) 未結單不搬填 `null` |
| 維修紀錄改讀需求單與工單、完整分頁（Q11） | `… Q11` |
| Excel 匯入與上線貼標進度頁（Q29） | `… Q29` |
| 設施貼標待辦與標籤列印（解讀 (b)） | `null`（STILL_PENDING） |
| 編輯設備保留「購買來源供應商」「保固申請方式」 | `… assumptions` |
| 保固到期改用台北時間 | `… assumptions` |
| 退回貼標複核兩項照片都要求（解讀 (f)） | `… assumptions` |
| 清單改為伺服端分頁與精確筆數（取代前 100／200 筆） | `… assumptions` |
| 設備、設施清單手機卡片（解讀 (d)） | `null`（STILL_PENDING） |
| 掃描頁轉址旗標（解讀 (k)） | `null`（STILL_PENDING） |

## 12. 風險與待確認

1. **正式區 `ga_resource_attachment_can_manage` 內容**：`22` 會先比對 md5，不同就中止；若正式區與 DEV 不同，要先確認差異再決定。
2. **設施貼標回填**：正式區既有設施套用 `22` 後會一次出現大量「待上傳設施照片」待辦，上線前先用 `20` 第 5 區看筆數，並決定是否分批開放（例如先對少數門市）。
3. **沒有店長名單身分的門市**無法確認轉移單；上線前用 `20` 第 6 區補齊。
4. **掃描頁轉址旗標**要等使用者驗收後才在 Vercel 正式環境打開；打開前掃描仍進舊版頁面。
5. **正式建置的 `NEXT_PUBLIC_SITE_URL`**：Vercel 正式環境需設定為正式網址並用舊標籤實掃驗證（已列入部署清單）。
6. 異動紀錄不可被一般身分修改或刪除；測試資料清理由 service role fixture 處理（資料庫觸發器只放行 `service_role`／資料庫管理者的刪除）。
7. 本批不做 Q27、庫存、需求單頁、工單頁；轉移、貼標與維修紀錄頁需要的需求單資料只讀取，不寫入。

## 13. G08／G09 實作紀錄（設施、保固、維修紀錄）

- 頁面：`Facilities.vue`、`FacilityCreate.vue`、`FacilityFormFields.vue`、`AssetWarranties.vue`（設備與設施共用，依頁籤 kind 區分）、`AssetMaintenanceHistory.vue`（逐筆與每台修過幾次兩個分頁）。設備清冊的刪除、更正所屬門市、恢復使用、異動紀錄等流程在設施清冊用同樣的畫面。
- 新增旗標：`gaFacilities`、`gaFacilityCreate`、`gaEquipmentWarranties`、`gaFacilityWarranties`、`gaEquipmentHistory`、`gaFacilityHistory`（規則見 `access.ts`，單元測試 `tests/unit/G08`、`G09`）。
- API 補充（`assets.ts`）：清單可加 `withWarrantyDocs=1`（回這一頁每台的保固文件與簽名網址，只限完整層級）、`warrantyStats=1`（回各保固狀態的精確筆數，不受保固篩選影響）；設施可依 `warranty_end_date`（specs 內日期）排序。維修紀錄 API（`history.ts`）回 `permissions.seeAssignee`，另外在 API 層擋掉「只有另一類資產權限的人用 type 參數讀這一類」。
- 側欄：設施保固管理補在「設施管理」群組最後；沒有舊版「設施管理」群組的名單內身分（只有店長名單身分、沒有 `store_manager` 角色代碼者）在「資產與庫存」補「設施清冊」「設施維修紀錄」。這些新增或收斂的入口都列在 `tests/parity/allowlist.json`（`m7m8-g08-nav-*`、`m7m8-g09-nav-*`，approvedBy 為 null，待使用者確認）。
- 舊版事實：舊維修紀錄頁讀 `maintenance_requests` 並過濾 `equipment_id`／`facility_id`，但工單資料表沒有這兩欄，實際永遠沒有資料；Q11 改讀需求單與其工單。

## 14. G10 實作紀錄（QR 標籤列印與資產掃描）

- 伺服端：`qr-url.ts`（網域取 `NEXT_PUBLIC_SITE_URL`、非正式環境浮水印、排除與上限規則、轉址旗標，純函式）、`qr.ts`（`GET /qr/labels`）、`scan.ts`（`GET /assets/scan/:token`）。`router.ts` 加 `qr`、`assets` 兩個 case；`access.ts` 加 `gaEquipmentLabels`、`gaFacilityLabels`（設備／設施查看或管理，店長不行）。
- 標籤 API：`ids` 最多 150 筆（網址長度限制，更多請用篩選）；篩選模式用資料庫計數，只取前 300 張；`excluded` 最多回 20 筆說明，`excludedTotal` 為精確筆數；標籤上的網址缺 `NEXT_PUBLIC_SITE_URL` 或格式不符回 500 `code=QR_CONFIG`，不退回瀏覽器網址。
- 掃描 API：不存在 404 `NOT_FOUND`、作廢 404 `REVOKED`（只有看得到該類資產者帶資產名稱，有管理權限且未刪除者帶 `canRestore`）、無權限 403 `NO_ACCESS`（`contacts` 只有該門市 `role_type=store_manager` 的姓名）。範圍沿用舊版「看全部」權限清單；欄位層級（完整／基本）依設備／設施查看或管理權限（Q5）。照片只給現場辨識用，排除發票、收據、保固、合約類用途。維修紀錄取最近 5 筆，範圍由資料庫函式判斷。
- `canReport`：建單權限沿用舊版掃描頁與舊版「新增需求」選單的清單（`request.create`、`maintenance_request.create`、`cross_dept.maintenance.submit`），再加門市範圍（可替任何門市建單的 `request.manage`／`store.manage`／`employee.manage`，或本人是該門市名單內人員）。DEV 的店長角色只有 `maintenance_request.create`；正式區店長角色另有 `request.create`。
- Vue：`AssetLabels.vue`（設備與設施共用，列印走獨立視窗，版型 60 x 25 mm 一張一頁）、`AssetScan.vue`（手機優先）。掃描頁走 `/open/ga-asset-scan/{token}` 深連結（`App.vue` 白名單），未登入先登入再開同一頁；清冊（`Equipment.vue`、`Facilities.vue`）可由頁籤 payload 帶入搜尋字串。
- Next 端：`app/general-affairs/assets/scan/[token]/page.tsx` 只加一行旗標轉址（`WORKSPACE_SCAN_REDIRECT=true`），其餘程式不動。測試站啟動器（`tests/support/start-test-server.cjs`）固定設定 `NEXT_PUBLIC_SITE_URL=http://localhost:3002` 與轉址旗標。
- 測試：單元 `tests/unit/G10`；整合 `G10.qr-api.spec.ts`；冒煙 `G10.qr.spec.ts`；e2e `G10.qr.e2e.spec.ts`；對等 `G10.ga-qr.spec.ts`（map：`tests/parity/map/ga-qr.json`）；驗收截圖 `tests/smoke/G10.screens.spec.ts`（設定 `M7M8_SHOT_DIR` 才執行）。「缺網域設定報錯」只有單元測試涵蓋（測試站固定有設定，無法在同一站切換）。

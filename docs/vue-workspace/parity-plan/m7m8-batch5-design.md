# M7/M8 第 5 批設計（定稿，2026-11-16 問卷 W1–W9 全採建議）：G18 工單中心、G19 跨部門維修

> 狀態：**定稿（2026-11-16）**，使用者對 §9 的 W1–W9 全部採用建議，各組 assumptions 視為核可；規格決定表同步寫入 `m7m8-spec.md`「第 5 批規格決定」。依據 m7m8-spec Q1、Q19–Q21、spec 第 53 行「不用問、直接照做」事項、B6／D20／D21，以及 m7m8-batch4-design（第 4 批已完成需求單端工單同步）。
> 範圍：G18 `/general-affairs/work-orders`（工單中心，新版）、G19 `/cross-dept/maintenance`（跨部門維修，最小移植）、工單端寫入與需求單同步、Q20／Q21 權限與刪除規則、A4 工單列印。
> 不做：廠商下拉與廠商統計（第 6 批）、階段管理畫面、工單通知、進貨憑證／發票／請款（第 4.5 批）。
> 實作限制同第 4 批：只連 DEV（`supabase/.temp/project-ref` 以 `mjpd` 開頭，現為 `mjpdfpxqttbhzeimmtqr`）；不 push；不動 `supabase/migrations`；不連正式區；`test:page` 與 e2e 循序。
> 定稿前已做 §8 的 DEV 唯讀實測，結果在 §11（RLS 政策原文、16 階段、儲存空間、`ga_ws_inv_post` 參考單據限制、W9 名單）；實測推翻或補充的地方已回寫到各節。

## 1. 舊版功能清單與缺陷

### 1.1 舊版檔案與路徑
- 頁面：`app/general-affairs/work-orders/page.tsx`（23 行的殼，把 `section='work-orders'` 丟給 6030 行的 `components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx`，工單區 `renderWorkOrderCenter` 約 3914–4975 行）；`app/cross-dept/maintenance/page.tsx`（1696 行，導覽名稱「總務組」）。
- API（7 組路由檔共 1,379 行，不含需求單端與 lib）：`/api/maintenance-requests`（GET 列表、POST、PATCH 改分類、DELETE，含 `summary`）、`maintenance-updates`、`maintenance-photos`、`maintenance-update-photos`、`maintenance-progress-stages`、`maintenance-categories`、`maintenance-ticket-events`；需求單端 `requests/[id]`（受理建工單、送門市確認）與 `store-actions`；`lib/maintenance/status-service.ts`、`status.ts`、`lib/general-affairs/maintenance-permissions.ts`。
- 資料表：`maintenance_requests`、`maintenance_updates`、`maintenance_photos`、`maintenance_update_photos`、`maintenance_ticket_events`、`maintenance_categories`、`maintenance_progress_stages`（DEV 16 列，其餘為空）、共用附件 `ga_resource_attachments`（`MAINTENANCE_REQUEST`、`MAINTENANCE_UPDATE`）。沒有 `location`、資產欄位。
- 儲存空間：私有 bucket `maintenance-photos`（沒有任何 migration 建立；**DEV 目前不存在**）、`general-affairs-attachments`。

### 1.2 舊版功能（新版要對等或改良）
1. **列表與焦點卡**：只顯示需求單轉出的工單（`source=general_affairs`）；有 view_all 才能選全部門市，否則限自己管理的門市；狀態下拉、搜尋、資源類型篩選；六張焦點卡（已完成、門市退回、待門市確認、等料件、廠商處理、待安排）。「只顯示需求單轉出的工單」的實際做法是 `source=general_affairs` 條件（`app/api/maintenance-requests/route.ts` 約 108 行：`ga_service_request_id` 不為空），所以沒有需求單的舊式單在工單中心與總務服務中心「我的回報」都看不到，只在跨部門頁。工單編號是 `WO-` 加 id 前 8 碼大寫（無獨立欄位）。網址 `?workOrderId=` 直接選中。
2. **詳情**：下一步引導卡、門市、問題類型、聯絡窗口、門市描述、現場照片（四個來源合併）、共用附件、處理狀態（含 unresolved_reason 紅框）、時間軸（INTERNAL 進度灰點）。
3. **16 個進度階段**（固定）與 4 個主狀態（UNACCEPTED、ACCEPTED、PROCESSING、COMPLETED）；13 個「執行類」階段一存就推成處理中。
4. **更新進度**：必填內容與日期；六個快捷動作（出庫、調撥、採購、派工、補資料、駁回）；進階設定承辦人與處理方式（文字）。
5. **送門市確認**（階段固定 WAITING_STORE_CONFIRMATION、公開）、**強制結案**（需 `service_center.force_close`、須原因）。
6. **門市確認完成／仍有問題**：路徑 A（我的追蹤，需求單端，新版第 4 批已做 SQL 版）、路徑 B（工單端：總務服務中心「我的回報」詳情的兩顆按鈕，`GeneralAffairsServiceCenterClient.tsx` 約 1887、3881–3895 行，經 `/api/maintenance-updates`；因列表有 `source` 條件，實際只對有需求單的工單出現）。跨部門頁（`app/cross-dept/maintenance/page.tsx`）完全沒有確認／仍有問題按鈕，這才是 Q21（三）「沒有回報人確認鈕」的所在；舊式單送確認時，`status-service.ts` 約 70–76 行在工單已寫入後才丟錯（非交易）。
7. **與需求單雙向同步**（受理建工單、送確認、確認／回報問題、重新開啟；工單端寫入最後同步需求單）。
8. **照片與附件**：回報照片（`maintenance_photos`，工單中心與跨部門頁都讀寫）、進度照片（`maintenance_update_photos`，**只有跨部門頁能上傳**，最多 5 張）、共用附件（工單中心只用 `MAINTENANCE_REQUEST`；API 雖允許 `MAINTENANCE_UPDATE` 但沒有任何畫面使用）；簽名網址 7 天。
9. **列印**（整頁 `window.print()`）、**刪除**（只有跨部門頁）、**維修分類管理**與工單分類（只有跨部門頁）、**門市總覽**（summary）、**事件歷程 API**（沒有任何畫面讀）。
10. **「出庫」快捷鈕**實際只預填階段並導去庫存頁，庫存流水與工單沒有關聯。

### 1.3 舊版缺陷（新版修正）
| # | 缺陷 | 新版處理 | 已決定？ |
|---|---|---|---|
| 1 | 伺服端不檢查工單目前狀態就流轉（任何狀態可被按確認完成、已完成可被存進度改回處理中）；兩條門市確認路徑不一致 | 單一 SQL 函式加合法流轉表（§3.1） | Q21（二）部分；其餘屬缺陷修正 |
| 2 | 每次存進度都把承辦人改成操作者、處理方式與廠商清成空值 | 「有填才更新」 | 缺陷修正，登記白名單 |
| 3 | 多步驟寫入非原子 | 全部同一 SQL 交易，失敗全回復 | spec 第 31 行、Q21（三） |
| 4 | 工單同步會翻轉已結案需求單；不同步處理單 | 護欄表（§3.4） | spec 第 53 行 |
| 5 | 只有「查看自己門市」的店長打開工單中心被擋 | 唯讀看自己門市 | Q20（二） |
| 6 | 「查看全部」被當成可改可刪；前端只認 maintenance_request.*，不認 work_order.* | 收緊並前後端對齊 | Q20（一） |
| 7 | 管理員應用層放行、資料庫不放行（列表空白、儲存沒寫入） | 伺服端一致處理；函式 SECURITY DEFINER | Q20（三） |
| 8 | 店長走舊式確認被 RLS 靜默擋掉（工單沒改、需求單改完成）；靜態推論 | 單一寫入路徑消失；開工前 DEV 角色實測 | Q20（三）、Q21（二） |
| 9 | 刪除：本人可隨時刪、歷程永久消失、需求單被孤立、儲存檔清不乾淨 | §3.5 | Q21（一）、W4 |
| 10 | 只載 50 筆、N+1 請求、搜尋字串拼進 `or()` | 伺服端分頁、精確筆數、焦點卡計數由資料庫算、搜尋跳脫 | spec 第 31 行 |
| 11 | summary 無分頁（超過 1000 列失真） | 資料庫端 group by | 通則 |
| 12 | 強制結案原因混在進度文字；「駁回」鈕其實把需求單標成已完成 | 原因寫內部更新與內部事件、僅內部可見；按鈕改名「不處理，強制結案」 | spec 第 53 行、W3 |
| 13 | 「補資料」只把工單標成等門市補資料並同步需求單進度文字；門市只在總務服務中心首頁「門市待辦」（最多 5 筆，只列不能回覆，約 2811 行）看得到，沒有回覆入口 | 兩邊同步，店長在我的追蹤回覆（§3.1、W1） | W1 |
| 14 | 受理表單選的承辦人沒帶到工單 | 第 4 批 `ga_ws_req_accept` 已修；工單端顯示對齊 | 已修 |
| 15 | 「發生位置」永遠空白（工單表沒有 location） | 新版改讀需求單的位置與資產；不改工單表 | Q19（不拆表） |
| 16 | 階段表可改名但自訂代碼被前端丟掉；兩份 seed 的 OTHER 排序不同（999 與 990） | 固定 16 碼，排序以程式常數為準 | spec 第 53 行 |
| 17 | 事件歷程只寫不讀；B6 的 STORE_MOVED 在工單中心看不到 | 時間軸合併進度紀錄與公開事件 | 第 4 批 D21 |
| 18 | 照片：副檔名由 MIME 推斷、不驗內容、失敗留孤兒檔、簽名 7 天 | 非圖片擋下、整體回復、短效期重簽 | spec 第 29 行 |
| 19 | 更新沒有並發控制 | `expected_updated_at`，409 STALE | 第 4 批通則 |
| 20 | 列印整頁，連導覽與內部備註 | A4 專用表單 | Q21（四） |

## 2. 已決定事項（引用，不再問）

| 來源 | 決定 | 本批落點 |
|---|---|---|
| Q19 | 兩頁都保留，跨部門頁也認新總務權限；不拆表、不搬既有工單資料；不為跨部門頁新增功能；總務服務中心上線後關閉跨部門頁 | 共用工單元件；跨部門頁最小移植（§4） |
| Q20 | 修改與刪除要更新或管理權限；只有查看自己門市可唯讀看自己門市；管理員由伺服端一致處理；上線前列出「只有查看全部、沒有更新權限」的角色與人，經確認補授權後才改資料庫規則 | §3.3、§5 的 40 號檔（正式區）／120000（DEV） |
| Q21 | 回報人只能刪未受理且未連結需求單的自己的單；門市確認只在「待門市確認」可按；舊式回報補「回報人確認／仍有問題」；A4 專用工單表單，預設不印內部備註、可勾選包含 | §3.1、§3.5、§4 |
| spec 第 53 行 | 16 階段固定、不做階段管理畫面；維修分類管理維持舊權限；不做廠商下拉（承辦人與處理方式沿用文字）；需求單已完成／退回／取消時工單存進度只記在工單、不翻回；強制結案原因固定僅內部可見，門市只看到「總務已結案」；工單狀態變動沒有通知 | §3 |
| spec 第 29、31 行 | 照片沿用原儲存空間與路徑、舊照片不搬、簽名每次短效重簽、非圖片擋下；列表一律伺服端搜尋、分頁、精確筆數；寫入全成功或全不變 | §3、§4 |
| 第 4 批 | `ga_ws_req_*` 同步工單（受理、送確認、重新開啟、確認、回報問題）；B6 搬單改工單 store_id 並寫 STORE_MOVED；總務代門市按確認標 proxy_for_store；`409 STALE`；SECURITY DEFINER 加正式區 `has_permission` 語意；維修單不能走採購評估與庫存出庫（D4） | §3 |
| Q25／Q26 | 工務沿用總務角色；劇本含「需要料件時從庫存出庫」 | §6、W2 |
| 通則 | 錯誤白話、搜尋跳脫、無通知、正式區 SQL 先出草稿附還原、備份後核可才執行、舊 Next 頁與舊 API 不動 | 全批 |

## 3. 新版做法

### 3.1 狀態機
**主狀態**：`UNACCEPTED`（舊式未受理）、`ACCEPTED`、`PROCESSING`、`COMPLETED`。**階段**：固定 16 碼（INITIAL_REVIEW、WAITING_STORE_INFO、INTERNAL_HANDLING、SEARCHING_VENDOR、WAITING_VENDOR_REPLY、WAITING_VENDOR_QUOTE、QUOTE_REVIEW、VENDOR_ASSIGNED、WAITING_VENDOR_VISIT、VENDOR_WORKING、WAITING_PARTS、PARTS_IN_TRANSIT、WAITING_INTERNAL_APPROVAL、WAITING_STORE_CONFIRMATION、REOPENED、OTHER），常數放程式，與資料表 16 列對齊。

**合法流轉表（伺服端，非法回 409 並用白話說明）**
| 動作 | 允許的目前狀態 | 結果 |
|---|---|---|
| ACCEPT（舊式未受理工單由總務受理） | UNACCEPTED | ACCEPTED |
| SAVE_PROGRESS | UNACCEPTED（自動受理）、ACCEPTED、PROCESSING | 執行類階段推成 PROCESSING；已完成不可存進度（要先在需求單端重新開啟） |
| REQUEST_COMPLETION（送門市確認） | ACCEPTED、PROCESSING，且階段不是已在待確認 | PROCESSING＋WAITING_STORE_CONFIRMATION，固定公開 |
| STORE_CONFIRM_COMPLETE | 僅 WAITING_STORE_CONFIRMATION | COMPLETED（STORE_CONFIRMED） |
| REPORT_UNRESOLVED | 僅 WAITING_STORE_CONFIRMATION | PROCESSING＋REOPENED，寫 unresolved_reason |
| FORCE_CLOSE | ACCEPTED、PROCESSING（須原因、須 force_close 權限） | COMPLETED（ADMIN_FORCE_CLOSED），原因僅內部可見 |
| REQUEST_SUPPLEMENT（補資料，W1） | ACCEPTED、PROCESSING，且需求單無有效採購單（含草稿）、未出庫（D4）；須填補資料類型與說明 | 工單 PROCESSING＋WAITING_STORE_INFO（公開）；有需求單者**同交易**把需求單設為 WAITING_STORE_SUPPLEMENT（`supplement_type`、`supplement_note`、公開進度，與第 4 批 `request_supplement` 結果相同）。已出庫或已有採購單者擋下 409，提示改用留言。舊式單（無需求單）只改工單。 |
| SUBMIT_SUPPLEMENT（店長回覆） | 工單 WAITING_STORE_INFO 且需求單 WAITING_STORE_SUPPLEMENT | 店長在「我的追蹤」回覆（第 4 批 `submit_supplement` 入口不變）→ 需求單 WAITING_GA_REVIEW（待總務複核）、工單回 PROCESSING＋INITIAL_REVIEW；總務複核後照第 4 批流程回處理中。需修改第 4 批 `ga_ws_req_transition`（request_supplement 分支）與 `ga_ws_req_store_action`（submit_supplement 分支）兩段，**由新檔 `…105000_request_supplement_sync` 以 CREATE OR REPLACE 覆蓋，套用前備份現有函式定義**。 |
| ISSUE_PART（領用料件，W2） | ACCEPTED、PROCESSING（待門市確認與已完成不可） | 同交易呼叫 `ga_ws_inv_post` 扣庫存，寫工單用料紀錄與內部時間軸事件（§3.2） |
| DELETE（W4） | UNACCEPTED 且 `ga_service_request_id` 為空 | 總務（`work_order.manage`）與回報人（限自己）可刪；其餘 409，提示改用強制結案 |

重新開啟已完成工單：不在工單端做，維持第 4 批做法，由需求單端「重新開啟」（須原因）同步工單為 PROCESSING／REOPENED。沒有需求單的舊式單完成後**不提供重新開啟**，需要時另開新單（W8，介面文案要寫明）。

**強制結案（W3）**：按鈕名稱「不處理，強制結案」；工單 COMPLETED＋`completion_method=ADMIN_FORCE_CLOSED`；有需求單者需求單設 COMPLETED（`completed_at` 同時間），公開進度「總務已結案」。需求單與工單列表、報表以「結案方式」欄標示（門市確認完成／強制結案），由工單 `completion_method` 帶出，**不在 `ga_service_requests` 加欄位**。原因寫 `maintenance_updates`（INTERNAL）與 `maintenance_ticket_events`（FORCE_CLOSE、INTERNAL、metadata 帶原因），店長與非總務端一律只看到「總務已結案」。

### 3.2 資料模型
- **不改既有資料表結構**（Q19）。DEV 的 `maintenance_*` 表已存在且為空。
- **強制結案原因**：不加欄位，寫 `maintenance_updates`（INTERNAL，notes=原因）與 `maintenance_ticket_events`（FORCE_CLOSE，INTERNAL，metadata 帶原因）；門市只看公開事件「總務已結案」（W3）。`completion_method` 既有 CHECK 已含 `ADMIN_FORCE_CLOSED`，不需改。
- **照片（W5）**：新照片一律走共用附件 `ga_resource_attachments`（第 1 批上傳工具）：回報照片 `MAINTENANCE_REQUEST`、進度照片 `MAINTENANCE_UPDATE`（兩個 resource_type 都已在 CHECK 內，bucket 固定 `general-affairs-attachments`，路徑須以 `maintenance_request/` 或 `maintenance_update/` 開頭，格式限 jpeg／png／webp／heic／heif／pdf，單檔 ≤20MB）。舊 `maintenance_photos`、`maintenance_update_photos` **唯讀**合併顯示，不搬、不寫新資料；新版不再寫入這兩張表。
- **領用料件（W2）**：同交易呼叫第 3 批 `ga_ws_inv_post`（有固定識別防重複）。**DEV 實測**：`ga_inventory_transactions.reference_type` 沒有值域 CHECK（只要求 reference_id 有值時 reference_type 不可空白），所以不需放寬；但 `ga_ws_inv_post` 規定帶 `reference_type`／`reference_id`／`metadata` 時必須先在同交易設 `app.ga_inv_internal_post='true'`（第 4 批 `ga_ws_req_stock_issue`、驗入配發同做法，用完設回 `false`），因此 `ga_ws_wo_issue_part` 必須是 SECURITY DEFINER 內部流程並照做。流水 `reference_type='MAINTENANCE_REQUEST'`、`reference_id=工單 id`，metadata 帶工單編號；工單編號為 `WO-` 加 id 前 8 碼大寫，另寫入 reason 供庫存流水頁顯示。
- **工單用料清單（不新增資料表）**：以 `maintenance_ticket_events`（event_type=`PART_ISSUED`，INTERNAL，metadata 帶 transaction_id、transaction_no、part_id、料號、名稱、數量、單位、位置）記錄，工單詳情的「用料清單」由這些事件組成；庫存流水是唯一的數量真相，事件只是顯示索引（`ga_ws_wo_get` 以 transaction_id 回查流水核對）。**`event_type` 無 CHECK**（實測 `maintenance_ticket_events` 只有 visibility CHECK），新事件類型 `PART_ISSUED`、`SUPPLEMENT_REQUESTED`、`SUPPLEMENT_REPLIED`、`DELETED` 不需改表。
- 不動第 4 批需求單規則：維修單仍不能走需求單的採購評估與需求單出庫（D4）；領用只發生在工單端，且需有庫存交易權限。
- 事件類型沿用既有（CREATED、ACCEPT、SAVE_PROGRESS、REQUEST_COMPLETION、STORE_CONFIRM_COMPLETE、REPORT_UNRESOLVED、FORCE_CLOSE、MIGRATED、STORE_MOVED）。
- 讀取用函式整形，不新增資料表。「前往工單」所需的工單摘要由需求單查詢帶出（`maintenance_request_id` 已在 `ga_service_requests`）。

### 3.3 權限（以正式區語意；DB 無 admin bypass，應用層 `profiles.role==='admin'` 僅作導覽／唯讀保底，寫入一律由函式內 `has_permission` 判斷。**W9 已決定：以角色權限為準**——`profiles.role=admin` 若沒有任何有效角色帶更新或管理權限，只能唯讀、不能寫入，畫面白話說明「您的帳號沒有可修改工單的角色，請洽管理員授權」，並列入上線前名單（§11）；Q20「管理員可看可改」落實為「管理員擁有總務／管理角色時可改」；表中權限碼省略前綴，實際為 `general_affairs.work_order.*`、`general_affairs.maintenance_request.*`、`cross_dept.maintenance.*`、`general_affairs.service_center.force_close`）
| 能力 | 需要的權限碼（任一） |
|---|---|
| 進入頁面、看自己門市 | `work_order.view_own_store`、`maintenance_request.view_own_store`（且為該門市店長）、或下列更大的碼 |
| 看全部門市 | `work_order.view_all`、`maintenance_request.view_all`、`cross_dept.maintenance.view_all` |
| 存進度、送門市確認、分類、補資料 | `work_order.update`、`work_order.manage`、`maintenance_request.update`、`cross_dept.maintenance.update`（**不含只有 view_all**，Q20） |
| 強制結案、補資料、領用料件 | 強制結案：`general_affairs.service_center.force_close`（另需上一列任一）；補資料同上一列；領用料件：上一列任一，另加 `general_affairs.inventory_transaction.manage` 與（`part.view` 或 `part.manage`），缺哪個講清楚 |
| 刪除（總務） | `work_order.manage`，且工單 UNACCEPTED、未連需求單（W4）；已受理或已連需求單只能強制結案 |
| 刪除（回報人） | 本人、狀態 UNACCEPTED、`ga_service_request_id` 為空 |
| 門市確認、回報問題（舊式回報） | 回報人，或該門市店長且持 `maintenance_request.create` 等回報權限；僅「待門市確認」 |
| 維修分類管理 | `cross_dept.maintenance.category.edit`（維持舊權限） |
| 看處理人姓名 | 總務端可；店長端不可 |
- 前端 `canViewAll`、`canUpdate` 對齊上表（舊版只讀 `maintenance_request.*`，漏掉 `work_order.*`）。
- **上線前名單**：列出「只有查看全部、沒有更新權限」的角色與人，以及 `profiles.role=admin` 但沒有有效更新角色的人（W9）。DEV 已出（§11）；正式區用 36 號唯讀預覽出名單，由使用者確認補授權後才套 40 號 RLS 收緊。
- **RLS 實測更正**：DEV 現行政策是 `view_all` 同時放行 UPDATE 與 DELETE（另加 `reported_by=auth.uid()` 本人隨時可刪），Q20 要收緊的正是這兩條；店長在 `maintenance_requests`、`maintenance_updates` 沒有任何 UPDATE 路徑，「店長走舊式確認被 RLS 靜默擋掉」屬實（§11）。新版函式為 SECURITY DEFINER，不受 RLS 影響，收緊只影響舊 Next 頁與直連。

### 3.4 與需求單同步（同交易，工單端 → 需求單端）
- 所有工單端寫入由 `ga_ws_wo_*` 函式完成：鎖列 → 檢查權限與流轉 → 寫 `maintenance_updates` → 更新 `maintenance_requests` → 寫 `maintenance_ticket_events` → 同步需求單（`main_status`、`public_progress`、`ga_service_request_events` 的 `WORK_ORDER_PROGRESS_SYNCED`），任一步失敗全回復。
- **需求單護欄**：需求單為 COMPLETED、REJECTED、CANCELED 時只記工單，不改需求單（spec 第 53 行）；需求單為 WAITING_STORE_SUPPLEMENT 時，除補資料往返（W1）外不翻轉狀態。
- **公開文字**：INTERNAL 進度只寫「維修工單已更新，目前狀態：階段名」，不洩漏內容；強制結案公開文字「總務已結案」。
- 送門市確認與第 4 批 `ga_ws_req_transition` 的 `request_store_confirmation` 共用同一內部函式，兩個入口行為一致。
- 門市確認與回報問題：舊式回報（無需求單）走 `ga_ws_wo_store_confirm`／`ga_ws_wo_report_unresolved`；有需求單的工單維持第 4 批 `ga_ws_req_store_action`（單一邏輯，避免雙路徑）。
- 舊式工單送門市確認不再丟錯（舊版缺陷）：只改工單，回報人確認。

### 3.5 刪除
- 回報人：僅未受理（UNACCEPTED）且未連結需求單的自己的單可刪；其他一律擋並說明原因（Q21、W4）。
- 總務（`work_order.manage`）：同樣只能刪未受理且沒連需求單的單；**已受理或已連需求單的工單不可刪，只能「不處理，強制結案」**（W4），需求單端不會出現被孤立的進行中工單。
- 刪除時：先把該工單的共用附件標記 `deleted_at`／`deleted_by`／`deletion_reason`（只標記，不實際刪儲存檔，spec 第 29 行、Q3），再於同交易刪工單列；子表（更新、事件、舊照片列）若無 `ON DELETE CASCADE` 由函式依序先刪。

### 3.6 照片與附件
- 舊照片沿用原 bucket 與路徑唯讀顯示（`maintenance_photos`、`maintenance_update_photos`），不搬、不改；新照片寫共用附件（W5）；詳情把四個來源合併成同一照片區並標「舊版照片」；簽名連結每次開啟短效重簽。
- 非圖片擋下、上傳整體回復（失敗不留孤兒）、縮圖沿用共用元件 `ResourceAttachmentPanel`（照片縮小、PDF 4MB）。
- DEV 實測沒有 `maintenance-photos` bucket（也沒有對應 storage.objects 政策）：新照片走共用附件，DEV 不需建；讀舊照片的測試由 DEV 專用檔建私有 bucket 並放 1 張測試圖，不套正式區。正式區 bucket 是否存在、是否私有由 36 號預覽確認。

### 3.7 列印
A4 專用工單表單（仿檢查報告 `.inspection-print-output` 的 `@media print`、A4、15mm、隱藏其他內容）：工單基本資料、門市與聯絡窗口、問題描述、處理進度時間軸（只公開）、照片；「包含內部備註」預設不勾、勾了才印 INTERNAL 更新與強制結案原因（此勾選只有總務端看得到，W7）。入口在工單詳情的「列印工單表單」按鈕，用列印專用樣式（隱藏導覽與其他區塊）。內容固定為：基本資料（工單編號、門市、聯絡窗口與電話、問題類型、回報日期、問題描述）＋公開進度時間軸＋照片（舊版照片與新附件都含）。

## 4. 頁面與 API

### 4.1 頁面
- `/general-affairs/work-orders`（新版 `WorkOrderCenter`，kind `ga-work-orders`）：左側列表（篩選、搜尋、分頁、精確筆數）、焦點卡六張（由資料庫算全部筆數，不只已載入的）、右側詳情與動作；手機 390 為單欄、點列表進詳情。
- 詳情動作：更新進度（含快捷動作）、送門市確認、「不處理，強制結案」（須原因，Modal，W3）、補資料（W1，送出後工單與需求單同進待門市補資料）、領用料件（W2，選位置與料件、數量不超過庫存、顯示用料清單）、列印工單表單（W7）、複製工單編號、附件（新照片共用附件，舊照片唯讀，W5）。沒有需求單的已完成單不顯示重新開啟（W8）。
- `/cross-dept/maintenance`（新版 `CrossDeptMaintenance`，最小移植，Q19、W6）：用同一套工單元件；列表（全部來源）、新增舊式回報（標題、說明、最多 5 張照片，走共用附件）、展開看進度、更新進度、刪除（Q21、W4 規則）、改分類、維修分類管理（`cross_dept.maintenance.category.edit`）、回報人「確認完成／仍有問題」按鈕（只在待門市確認時可按，仍有問題須原因）。**不增欄位、不加新功能**；跨部門頁也認新總務權限；總務服務中心上線後關閉。
- 舊式回報人的按鈕只補在**跨部門頁**（Q21；舊版該頁完全沒有，總務服務中心「我的回報」有按鈕但看不到舊式單）。新版 `MyReports.vue` 以需求單為主，不含舊式單，本批不改。
- 需求單詳情與「我的追蹤」顯示工單摘要（階段名、公開進度、結案方式、前往工單連結；店長看不到處理人與內部內容）；「我的追蹤」補資料回覆沿用第 4 批入口，回覆後兩邊同步（W1）；`GaCenter.vue` 移除「工單仍在舊版」提示；`nav.ts` `GA_PAGE_BY_HREF` 加入工單中心與跨部門頁。
- B6：若日後新增工單資產連結，需同步改 `ga_ws_asset_unlinked_work_orders` 的啟發式；本批**不新增**。

### 4.2 API（`/api/workspace/general-affairs/**`，`router.ts` 加 `work-orders`、`cross-dept-maintenance`；共通：非 GET 檢查 Origin、使用者身分、`GaError`、`page/pageSize ≤ 100` 回 `{data,total}`、寫入帶 `expected_updated_at` 回 `409 STALE`、伺服端欄位遮蔽）
| 方法與路徑 | 用途 |
|---|---|
| GET `work-orders` | 列表：`page`、`pageSize`、`store_id`、`status`、`focus`、`q`（跳脫）、`source`（需求單轉出／全部）；回精確筆數與焦點卡計數 |
| GET `work-orders/:id` | 詳情：基本資料、時間軸（進度＋公開事件合併，非總務遮蔽 INTERNAL 與處理人）、照片清單與簽名連結、abilities（可做哪些動作與缺哪個權限） |
| POST `work-orders/:id/progress` | 存進度 |
| POST `work-orders/:id/request-completion` | 送門市確認 |
| POST `work-orders/:id/force-close` | 強制結案 |
| POST `work-orders/:id/store-confirm`、`report-unresolved` | 舊式回報的確認／仍有問題 |
| POST `work-orders/:id/request-supplement`、`reply-supplement` | 補資料（總務）；舊式單回覆（有需求單者店長走我的追蹤既有入口） |
| POST `work-orders/:id/issue-part` | 領用料件（W2；body 帶位置、料件、數量、單位、原因、`idempotency_key`） |
| POST `work-orders/:id/attachments` | 新照片上傳（共用附件工具；非圖片擋下） |
| DELETE `work-orders/:id` | 刪除（§3.5，W4） |
| PATCH `work-orders/:id/category` | 改分類 |
| GET `work-orders/summary` | 各門市筆數（資料庫端 group by） |
| GET／POST／PATCH／DELETE `maintenance-categories` | 分類管理（維持舊權限） |
| POST `cross-dept-maintenance` | 新增舊式回報（含照片） |
| GET `work-orders/:id/print` | 列印資料（含 `include_internal` 參數，非總務不可帶） |

### 4.3 資料庫函式（皆 SECURITY DEFINER、`has_permission(auth.uid(), …)`、回 `{ok,status,data,error,code}`）
`ga_ws_wo_list`、`ga_ws_wo_get`、`ga_ws_wo_summary`、`ga_ws_wo_transition`（SAVE_PROGRESS／REQUEST_COMPLETION／FORCE_CLOSE／REQUEST_SUPPLEMENT 的單一寫入入口，含鎖列、流轉表、護欄、有填才更新、同步需求單）、`ga_ws_wo_store_confirm`、`ga_ws_wo_report_unresolved`、`ga_ws_wo_delete`、`ga_ws_wo_create_legacy`（跨部門新增，含附件登記）、`ga_ws_wo_category`、`ga_ws_wo_print`（非總務強制不含內部）、`ga_ws_wo_issue_part`（W2，內部設 `app.ga_inv_internal_post`）。內部共用 `ga_wo_sync_request(...)`，並讓第 4 批 `ga_ws_req_transition` 的送確認改呼叫同一內部函式（單一邏輯）。

## 5. SQL 計畫

### 5.1 DEV（`supabase/workspace-dev/`，各附 `.rollback.sql`；套用腳本 `scripts/apply-workspace-m7m8-b5-dev.cjs [--rollback]`，比照第 4 批 `apply-workspace-m7m8-b4-dev.cjs`，用 `tests/support/env-guard.cjs` 只連 DEV，執行前確認 project-ref 以 mjpd 開頭）
| 檔名 | 內容 |
|---|---|
| `20261117100000_m7m8_b5_work_order_rules.sql` | `ga_ws_wo_*`（list、get、summary、transition、store_confirm、report_unresolved、delete、create_legacy、category、print）、內部同步函式 `ga_wo_sync_request`、階段與事件常數檢查、工單編號函式 |
| `20261117105000_m7m8_b5_request_supplement_sync.sql` | CREATE OR REPLACE 第 4 批 `ga_ws_req_transition`（request_supplement 與 request_store_confirmation 分支改呼叫內部同步）與 `ga_ws_req_store_action`（submit_supplement 分支回寫工單）；**套用前先把現有定義存成備份檔，rollback 還原備份** |
| `20261117110000_m7m8_b5_work_order_parts.sql` | `ga_ws_wo_issue_part`（W2）；不改表（reference_type 無 CHECK） |
| `20261117120000_m7m8_b5_work_order_rls.sql` | Q20／Q21 的 RLS 收緊（更新、刪除政策）。DEV 先套；正式區要等名單確認 |
| `20261117130000_m7m8_b5_dev_storage_and_seed.sql` | DEV 專用，不套正式區：舊照片測試用 `maintenance-photos` 私有 bucket（若 SQL 無法放檔，改由測試 helper 用 service role 上傳）、DEV 維修分類、測試角色（工務、只有 view_all）、擴充 `cleanupM7M8` |
套用順序：100000 → 105000 → 110000 → 120000 → 130000；rollback 反向。第 4 批現有函式定義用 `pg_get_functiondef` 擷取備份，放 `supabase/workspace-dev/_backup/`（不入 migration）。

### 5.2 正式區草稿（`docs/vue-workspace/parity-plan/m7m8-sql/`，接續現有最大號 **35**，均附 rollback；README 新增「第 5 批」章節與套用順序）
| 檔案 | 內容 |
|---|---|
| `36-b5-preview-before-apply.sql` | 唯讀預覽：工單相關表筆數；`maintenance-photos` bucket 是否存在與政策；RLS 實際政策與 migration 是否一致；「只有 view_all、沒有更新碼」的角色與人名單（Q20）；`profiles.role=admin` 但沒有有效更新角色的名單（W9）；有 `ga_service_request_id` 但需求單已刪除或已結案的工單數；`assignee_name`／`handling_method` 疑似被覆蓋的歷史筆數；`status` 與 `progress_stage` 不一致筆數；OTHER 階段排序差異；現有 `ga_ws_req_*` 函式 md5（確認第 4 批已套用且與 DEV 一致） |
| `37-b5-work-order-rules.sql`／`-rollback.sql` | 工單函式（對應 DEV 100000） |
| `38-b5-request-supplement-sync.sql`／`-rollback.sql` | 覆蓋第 4 批兩個函式（對應 DEV 105000）；rollback 內含第 4 批原定義；套用前確認 md5 與 DEV 備份一致 |
| `39-b5-work-order-parts.sql`／`-rollback.sql` | 領用料件函式（對應 DEV 110000） |
| `40-b5-work-order-rls.sql`／`-rollback.sql` | RLS 收緊（對應 DEV 120000）；**未經使用者確認 36 號名單與補授權前不得套用** |
套用順序：36（唯讀，無 MISSING）→ 37 → 38 → 39 → 40（名單確認後）；撤回相反。依賴：37 需要第 4 批 32 與第 3 批庫存；38 需要 37；39 需要 37 與第 3 批 `ga_ws_inv_post`。**一律先備份，經使用者核可才執行；不在本批連正式區。**

### 5.3 DEV 測試資料
DEV 工單相關表全空（實測；分類 0 列、階段 16 列）：測試以 `seedWorkOrder`（每個狀態與階段、含舊式未受理、含已連需求單、部分附照片）與 `cleanupM7M8` 擴充，使用 VW／ZT 測試門市與保留年份 2038；庫存流水不可改刪，領用料件測試比照第 4 批用 cleanup 函式，結束只清自己建立的資料。

## 6. 測試計畫
測試 ID：**G18**（工單中心）、**G19**（跨部門維修），檔名比照 `G18.*`。
- **smoke**：兩頁可開（桌機 1440、手機 390 無橫向捲動、無 console 錯誤）；導覽 href；無權限看不到入口，API 回 403／401；只有查看自己門市者可唯讀開頁。
- **unit**：流轉表（允許與禁止全覆蓋）、焦點卡分類（16 階段）、有填才更新、工單編號、`abilities()`（缺哪個權限講清楚、管理員後備只作唯讀）、搜尋跳脫、階段常數與 DB 16 列一致。
- **integration**（RPC 與 API；每支寫入驗權限矩陣、Origin、400、409 STALE、冪等，用 service role 回讀 DB；RPC 有 `BEGIN…ROLLBACK` SQL 測試）：存進度不覆蓋承辦人與處理方式；非待確認時按確認被擋；已完成不能存進度；需求單已完成／退回／取消時工單存進度不翻回；INTERNAL 進度不洩漏到需求單公開文字；強制結案需權限與原因、原因對店長不可見；送確認與第 4 批 `ga_ws_req_transition` 結果一致；失敗回復（同交易）；只有 view_all 不能改、不能刪；回報人刪已受理或已連結的單被擋；舊式回報確認與仍有問題；分頁精確筆數、第 51 筆之後可搜到；summary 超過 1000 列正確。
- **RLS 實測**：以真實角色（店長、總務、工務、只有 view_all、管理員）查詢，確認列表不空白、寫入不靜默失敗。
- **parity**：同帳號呼叫舊 `/api/maintenance-requests*`、`maintenance-updates`、`summary` 與新 API，正規化後比對列表、詳情、寫入結果；差異登記 `tests/parity/allowlist.json`。
- **測試 ID**：G18 工單中心（`G18.smoke`、`G18.unit`、`G18.integration.*`、`G18.rls`、`G18.parity`、`G18.layout.e2e`、`G18.print.e2e`、三支劇本）、G19 跨部門維修（`G19.smoke`、`G19.integration.*`、`G19.journey-legacy`）。補資料往返與第 4 批回歸另編 **G28**（`G28.supplement-roundtrip`）；轉店帶單回歸沿用 **G27** 並加工單斷言。
- **e2e 角色接力劇本（循序）**：
  1. **`G18.journey-repair.e2e.spec.ts`**：店長（手機 390）報修 → 總務（桌機）受理並轉工單 → 工務更新進度、上傳進度照片、在工單內領用料件（庫存扣減、流水參照工單編號、超過庫存被擋、缺庫存交易權限被擋）→ 工務送「待門市確認」→ 店長在我的追蹤確認完成 → 工單與需求單同為結案；另一輪「仍有問題」→ 重新處理 → 再送確認 → 結案。每步回讀 DB 驗工單、需求單與庫存一致。
  2. **`G19.journey-legacy.e2e.spec.ts`**：回報人在跨部門頁（總務組）新增舊式回報（含照片，最多 5 張）→ 總務受理、存進度 → 送門市確認（不再報錯）→ 回報人按「確認完成」（另一輪按「仍有問題」須原因）→ 結案後沒有重新開啟按鈕（W8）；另測回報人刪自己未受理的單、已受理的單刪不掉、維修分類管理、無更新權限的管理員唯讀（W9）。
  3. **`G18.journey-exceptions.e2e.spec.ts`**：強制結案（按鈕「不處理，強制結案」、需求單已完成、結案方式標示強制結案、店長只看到「總務已結案」、原因不外洩）；補資料往返（工單按補資料→需求單同進待門市補資料→店長在我的追蹤回覆→工單回初步評估、需求單待總務複核；已出庫或已有採購單者被擋並提示改用留言）；需求單已退回／取消時工單存進度不翻回；刪除規則（已受理、已連需求單不可刪；未受理且沒連需求單可刪、附件只標記）。
  4. **轉店帶單回歸（沿用第 4 批 G27，加工單斷言）**：設備轉店後未結案維修單與工單一起搬、時間軸顯示 STORE_MOVED。
  5. **列印（`G18.print.e2e`）**：開 A4 預覽，預設無內部備註、勾選後出現；匯出 PDF 版面檢查。
- **第 4 批回歸**：因改了 `ga_ws_req_transition`／`ga_ws_req_store_action`，必須重跑第 4 批 G16、G17、G27 與補資料往返（G28）。
- 版面檢查比照 `G10.layout.e2e`；`test:page` 與 e2e 一律循序；run-all 結束碼 1 若只因 sweeper 基準孤兒或 fetch failed 視為通過並說明。

## 7. 預計與舊版差異（登記 `tests/parity/allowlist.json`）
`approvedBy`：Q19–Q21、spec 第 53 行與本批問卷 W1–W9 對應者設 `user (2026-11-16 batch 5 spec survey)`；本批新發現、待使用者確認者設 `null`（decision 為 fix 的條目依驗證器規則維持 `null`）。id 命名 `m7m8-b5-…`。
1. 伺服端檢查工單狀態與合法流轉；門市確認只在待確認可按 [Q21]。
2. 存進度不再覆蓋承辦人、處理方式、廠商（有填才更新）[缺陷修正，`approvedBy` null]。
3. 寫入同交易、失敗全回復 [spec 第 31 行、Q21]。
4. 需求單已結案時工單存進度不翻回 [spec 第 53 行]。
5. 管理員由伺服端一致處理 [Q20]；只有查看自己門市可唯讀 [Q20]；更新與刪除收緊 [Q20]。
6. 回報人刪除限未受理且未連結 [Q21]；總務同規則，已受理或已連需求單只能強制結案 [W4]。
7. 舊式回報補確認與仍有問題；送確認不再報錯 [Q21]。
8. 強制結案原因僅內部可見、門市看到「總務已結案」；按鈕改名「不處理，強制結案」、需求單標已完成並以「結案方式」標示 [spec 第 53 行、W3]。
9. 工單列表伺服端搜尋分頁、精確筆數、焦點卡全量計數；搜尋跳脫；summary 全量 [spec 第 31 行]。
10. 時間軸合併進度與公開事件（含 STORE_MOVED）[D21]。
11. A4 專用列印 [Q21]。
12. 照片：非圖片擋下、短效簽名、失敗回復 [spec 第 29 行]；新照片走共用附件、舊照片唯讀合併 [W5]。
13. 「發生位置」「設備資訊」改讀需求單 [Q19，`approvedBy` null]。
14. 補資料兩邊同步、店長在我的追蹤回覆 [W1]；工單內領用料件、庫存流水記工單編號 [W2]；舊式單完成後不可重新開啟 [W8]；無有效更新角色的管理員唯讀 [W9]；跨部門頁最小移植並補確認鈕 [W6]；A4 表單 [W7]。
15. 工單詳情新增 `expected_updated_at` 衝突提示 [第 4 批通則]。
16. 錯誤訊息白話、舊版英文資料庫錯誤（分類重名）改白話 [通則]。

## 8. 風險與待確認（開工前實測已完成，結果見 §11.1）
- **RLS 與 bucket**：DEV 政策原文已查（§11.1），店長被擋屬實；仍須在實作階段以真實角色（店長、總務、工務、只有 view_all、管理員）做 RLS 行為測試（G18.rls），政策文字不等於行為。
- **DEV 沒有 `maintenance-photos` bucket（已實測）**：影響舊照片測試，用 DEV 專用檔補；正式區是否存在、政策是否為私有，由 36 號預覽確認。
- **Q20 收緊會讓部分人失去更新能力**：先出名單，使用者補授權後才套 40 號；未確認前 DEV 可先套，正式區不套。
- **新舊並存**：舊 Next 工單中心與跨部門頁仍可寫同一批表（舊版沒有流轉檢查）。上線後新舊同時操作同一張工單可能互相覆蓋；上線說明要求總務改用新版，跨部門頁依 Q19 於總務服務中心上線後關閉。若舊頁寫入造成與新規則不一致的資料（例如已完成被改回處理中），36 號預覽列出筆數。
- **改第 4 批函式的回歸風險**：讓 `ga_ws_req_transition` 共用內部函式會動到已驗收的第 4 批程式，必須重跑第 4 批 G16、G17、G27 測試。
- **舊式工單沒有需求單也沒有資產欄位**：B6 的啟發式仍不準，`m7m8-b4-mv-legacy-workorder-heuristic` 的 `approvedBy` 仍為 null，與本批一併請使用者確認。
- **總務服務中心「維修回報」可直接建立沒有需求單的工單**：W6 assumptions 已核可，新版只在跨部門頁保留新增舊式回報，總務服務中心不再提供此入口。
- **舊版 6030 行元件共用 state**：移植時易漏掉焦點篩選、強制結案、`workOrderId` 網址參數、調撥連結（`transferUrl`）；實作者逐項核對。
- 廠商統計頁用 `totalWorkOrders*0.86` 估算完成數屬第 6 批，本批不動。
- 所有 `ga_ws_wo_*` 函式簽名在 DEV 與正式區 `pg_get_functiondef` 差異比對前視為草稿。

- W1 動到第 4 批 `request_supplement`／`submit_supplement`，回歸範圍含補資料往返（G28）與 G16、G17、G27。
- Q26 劇本「需要料件時從庫存出庫」與第 4 批 D4（維修單不走需求單出庫）已由 W2 調和：領用只發生在工單內，不動需求單規則。
- 實測新增風險：`ga_ws_inv_post` 的參考單據保護要求 `app.ga_inv_internal_post`；舊 Next 頁與直連 API 仍用舊 RLS 與舊流程，未收緊前可繞過新規則。

## 9. 已決定（2026-11-16，使用者 W1–W9 全採建議）
各題 assumptions 視為核可；最終行為已寫入 §3、§4、§5、§7。

| 題 | 決定 | 最終行為（摘要） |
|---|---|---|
| W1 | B 兩邊同步 | 工單補資料時需求單同進「待門市補資料」；店長在我的追蹤回覆；回覆後工單回初步評估（INITIAL_REVIEW）、需求單進待總務複核；已出庫或已有採購單者不可補資料，改用留言（§3.1）。修改第 4 批 `ga_ws_req_transition`／`ga_ws_req_store_action`，重跑第 4 批相關測試 |
| W2 | B 工單內領用料件 | 工單詳情新增領用，同交易呼叫 `ga_ws_inv_post`，流水記工單編號，工單顯示用料清單；不超過庫存；需庫存交易權限；不新增資料表；不動第 4 批需求單規則（§3.2） |
| W3 | A 強制結案 | 需求單標已完成；按鈕「不處理，強制結案」；列表與報表以「結案方式」標示；原因僅內部可見，門市只看到「總務已結案」（§3.1） |
| W4 | A 已受理或已連需求單不可刪 | 只能強制結案；未受理且沒連需求單者，總務與回報人（限自己）可刪；刪除時附件只標記不實刪（§3.5） |
| W5 | A 共用附件 | 新照片用共用附件（第 1 批上傳工具），舊 `maintenance_photos` 唯讀合併顯示，舊照片不搬（§3.6） |
| W6 | A 最小移植 | 跨部門「總務組」頁用同一套工單元件，保留新增舊式回報（標題、說明、最多 5 張照片）、維修分類管理，補回報人「確認完成／仍有問題」（只在待門市確認時），不增欄位、不加新功能（§4.1） |
| W7 | A A4 工單表單 | 基本資料＋公開進度＋照片；內部備註與強制結案原因預設不印、可勾選；入口在工單詳情；列印專用樣式（§3.7） |
| W8 | A 不提供重新開啟 | 沒有需求單的舊式單完成後不可重新開啟，需要時另開新單（§3.1） |
| W9 | A 以角色權限為準 | 管理員有總務／管理角色才可改；沒有有效角色的 `profiles.role=admin` 只能看，列入上線前名單（§3.3、§11） |

沿用 m7m8-spec 既定：Q19（兩頁都保留、跨部門頁也認新總務權限）、Q20、Q21、第 4 批 B6／D20（轉店帶走未結案維修單與工單）。

## 10. 建議實作分組（四個開發階段，詳見回報 stages）
1. **資料庫**（G18 資料庫函式）：`ga_ws_wo_*`、補資料同步改第 4 批兩函式、領料函式、RLS、DEV 專用檔、套用腳本；正式區草稿 36–40 與 README；先重跑第 4 批 G16／G17／G27 回歸。
2. **規則與 API**：`lib/workspace/general-affairs/work-orders*.ts`、`router.ts`、abilities、附件、列印資料。
3. **畫面**：共用工單元件、工單中心、跨部門頁、需求單與我的追蹤工單摘要、列印版面。
4. **測試與驗收**：unit／integration／RLS／parity／三支劇本（G18、G19、G28）、版面與列印、allowlist、驗收清單（含 Q20 名單、W9 名單、bucket、36 號預覽）。

## 11. 實作紀錄

### 11.1 開工前 DEV 唯讀實測（2026-11-16，專案 mjpd…，僅 SELECT／系統目錄，未寫入）
| 項目 | 結果 | 對設計的影響 |
|---|---|---|
| 工單相關表筆數 | `maintenance_requests`、`_updates`、`_photos`、`_update_photos`、`_ticket_events`、`_categories`、共用附件中維修類，**全部 0 列** | 全部測試資料自建；沒有歷史資料可做 parity，改用 seed |
| 16 階段資料 | `maintenance_progress_stages` 16 列、皆啟用；排序 10…150，**OTHER=990**（另一份 seed 為 999，已確認以 990 為準）；欄位只有 code、name、sort_order、is_active | 程式常數與資料表 16 列對齊的單元測試可直接比對 |
| RLS（maintenance_requests） | SELECT：view_all／update／work_order.*／cross_dept 的 view_all、update、或本人、或該店店長且有 create／view_own_store／work_order.view_own_store／cross_dept.submit；**UPDATE：view_all 也放行**（`maintenance_request.view_all`、`work_order.view_all`、`cross_dept.maintenance.view_all`）；**DELETE：`view_all`、`update`、`work_order.manage`、`cross_dept` 的 view_all／update，或 `reported_by=auth.uid()`（本人無條件）**；INSERT：本人且（有 view_all／update 類，或為該店店長且有 create／submit） | 與 §1 缺陷 6、9 的靜態推論相符；40 號要收緊 UPDATE（移除 view_all）與 DELETE（移除 view_all 與本人無條件，改走函式規則） |
| RLS（updates／events／photos） | 子表寫入政策的 `updated_by=auth.uid()`／`created_by=auth.uid()`／`uploaded_by=auth.uid()` 讓本人可寫；INTERNAL 的 updates／events 只有 view_all／update／manage 類看得到 | 店長端不會看到 INTERNAL，與設計一致；子表的 view_all 也能寫，同樣在 40 號收緊 |
| 店長走舊式路徑 | 店長在 `maintenance_requests` 沒有 UPDATE 政策可通過（只有 view_all／update／manage 類），確認屬實：舊式確認被 RLS 擋下，需求單端卻改完成 | 新版單一 SECURITY DEFINER 路徑解決；回歸測試用真實店長角色驗 |
| 儲存空間 | DEV 只有 `general-affairs-attachments`、`campaign-department-assets`、`pharmacist-fee-proofs`，**沒有 `maintenance-photos`**，也沒有對應 storage.objects 政策；`general-affairs-attachments` 只有 service_role 政策（簽名連結由伺服端產生）；皆為私有 | 新照片走共用附件不受影響；舊照片測試用 DEV 專用檔建 bucket |
| 共用附件 CHECK | resource_type 含 `MAINTENANCE_REQUEST`、`MAINTENANCE_UPDATE`；格式限 jpeg／png／webp／heic／heif／pdf；≤20MB；storage_path 需以 `lower(resource_type)/` 開頭；有 deleted_at／deleted_by／deletion_reason 成對 CHECK | 刪除工單時標記附件需同時填三欄；非圖片、非 PDF 由資料庫也擋 |
| `ga_inventory_transactions` | 無 `reference_type` 值域 CHECK（僅 reference_pair：有 reference_id 就要有 reference_type）；`ga_ws_inv_post` 帶 reference 或 metadata 時**必須先設 `app.ga_inv_internal_post='true'`**，否則 403 `REFERENCE_NOT_ALLOWED` | W2 不需改表；`ga_ws_wo_issue_part` 要照第 4 批做法設旗標並用畢設回 false；流水另有 reason 非空、數量符號、固定識別成對等 CHECK |
| `maintenance_requests` CHECK | status 四值、priority、`completion_method` 已含 `ADMIN_FORCE_CLOSED`；`maintenance_ticket_events` 只有 visibility CHECK，`event_type` 無值域限制 | 新事件類型不需改表 |
| `ga_service_requests` 欄位 | 有 `maintenance_request_id`、`completed_at`、`waiting_confirm_since`，**沒有結案方式欄位** | 結案方式由工單 `completion_method` 帶出，不加欄位 |
| W9 名單（DEV） | `profiles.role=admin` 共 2 人，**兩人都有帶更新或管理權限的有效角色，沒有「只能唯讀」的管理員**；只有查看全部、沒有更新碼的角色 1 個：`vue_workspace_navigation`（有效成員 1 人，DEV 導覽測試角色） | DEV 無需補授權；正式區名單由 36 號預覽產出，上線前經使用者確認 |

### 11.2 實作進度

#### 第 1 階段（資料庫層，G18-db，2026-11-16）：已完成
**範圍**：只做資料庫（DEV SQL＋rollback、套用腳本、正式區草稿 36–40、README、DB 層測試）；API、lib 純函式、畫面、導覽、角色劇本與 parity 在後面三個階段。**沒有 push，沒有動 `supabase/migrations`，沒有連正式區，沒有動 `_preview.html`。**

**交付檔案**
| 類別 | 檔案 |
|---|---|
| DEV SQL（各附 `.rollback.sql`） | `supabase/workspace-dev/20261117100000_m7m8_b5_work_order_rules`（12 個對外函式中的 11 個＋25 個內部輔助函式）、`…105000_m7m8_b5_request_supplement_sync`（覆蓋第 4 批 `ga_ws_req_transition`、`ga_ws_req_store_action`）、`…110000_m7m8_b5_work_order_parts`（`ga_ws_wo_issue_part`）、`…120000_m7m8_b5_work_order_rls`（三條政策收緊）、`…130000_m7m8_b5_dev_storage_and_seed`（DEV 專用） |
| 備份 | `supabase/workspace-dev/_backup/20261117_b4_req_functions_before_b5.sql`（套用前 `pg_get_functiondef`，md5：`ga_ws_req_store_action=20a40759bb4488685c08cd885f785158`、`ga_ws_req_transition=a962e584ccd1679a2c246fddde688d3c`） |
| 腳本 | `scripts/apply-workspace-m7m8-b5-dev.cjs [--rollback]`、`scripts/gen-m7m8-b5-105000.cjs`（由備份產生 105000，每個取代斷言只命中一次）、`scripts/build-m7m8-b5-prod-drafts.cjs`（由 DEV 檔產生 37–40） |
| 正式區草稿 | `docs/vue-workspace/parity-plan/m7m8-sql/36-b5-preview-before-apply.sql`（唯讀）、`37-b5-work-order-rules`、`38-b5-request-supplement-sync`、`39-b5-work-order-parts`、`40-b5-work-order-rls`（37–40 各附 `-rollback`），README「第 5 批」章節與套用順序 36→37→38→39→40（40 要等名單確認） |
| 測試 | `tests/integration/G18-db.work-orders-rpc.spec.ts`、`tests/unit/G18-db/work-order-sql.test.ts`、`tests/support/m7m8-po-fixtures.ts`（工單測試帳號 16 組）、`tests/support/m7m8-fixtures.ts`（`seedWorkOrder`、`seedMaintenanceCategory`、`cleanupM7M8` 擴充）、`tests/parity/allowlist.json`（22 筆 `m7m8-b5-*`） |

**實作與設計的對應（§3、§5）**
- 對外函式 12 個：`ga_ws_wo_list／get／summary／print／transition／store_confirm／report_unresolved／reply_supplement／delete／create_legacy／category／issue_part`。`transition` 是 SAVE_PROGRESS、REQUEST_COMPLETION、FORCE_CLOSE、REQUEST_SUPPLEMENT 的單一寫入入口。全部 SECURITY DEFINER、固定 `search_path`、回 `{ok,status,data,error,code}`、錯誤白話中文；只用 `has_permission(auth.uid(), …)`，沒有任何 `profiles.role` 後備（`ADMIN_WITHOUT_ROLE` 只是把「沒有可修改工單的角色」講清楚）。
- 同步：內部函式 `ga_wo_sync_request`（護欄：需求單已完成／退回／取消不翻回；待總務複核與待補資料期間一般進度不翻轉）、`ga_wo_apply_completion_request`（送確認，**第 4 批 `request_store_confirmation` 改呼叫同一個函式**）、`ga_wo_apply_supplement_request`／`ga_wo_apply_supplement_reply`（W1 補資料往返，第 4 批 `request_supplement`／`submit_supplement` 呼叫）。
- 鎖定順序與第 4 批一致（先需求單、後工單），避免死鎖；所有錯誤在寫入前回傳，寫入後的失敗用 RAISE 讓整段子交易回復。
- 105000 只多三處呼叫，其餘與備份逐行相同（單元測試逐行比對）；rollback 是備份原文，DEV 實測「套用 → 撤回 → 再套用」後撤回狀態 md5 與備份完全相同。
- 領用料件：先設 `app.ga_inv_internal_post='true'`，過帳後立即設回 `'false'`；流水 `reference_type=MAINTENANCE_REQUEST`、`reference_id=工單 id`、`reason=維修工單領用 WO-xxxxxxxx｜原因`；冪等重送回原結果（不重寫事件）；超庫存回 409 `INSUFFICIENT_STOCK`。

**自行決定之處（設計沒寫死，列給使用者看；allowlist 中 `approvedBy` 為 null 的 7 筆就是這些）**
1. **新增 `ga_ws_wo_reply_supplement`**：設計 §4.2 有「舊式單回覆」API 但函式清單沒有，補一個（回報人或該門市店長，需求單端的回覆仍走第 4 批 `submit_supplement`）。
2. **存進度的額外阻擋**（`wo-state-blocks`）：待門市確認期間不能存進度、領料、補資料；需求單在待門市補資料期間工單不能存進度或送確認；不能直接把階段選成「待門市確認」（要按送確認）、連結單不能直接選「等待門市補充資料」（要按補資料）。目的：避免工單與需求單狀態分岔。
3. **強制結案寫兩筆進度、兩筆事件**：內部（原因，`FORCE_CLOSE`）與公開（「總務已結案」，`FORCE_CLOSE_NOTICE`），店長的時間軸只看到後者。強制結案只限已受理或處理中（未受理的單請直接刪除或先受理）。
4. **刪除不留 DELETED 事件**（`wo-delete-no-audit-event`）：事件表 FK 是 `ON DELETE CASCADE`（DEV 實測所有子表都是），事件會跟工單一起消失；可追溯的只有共用附件上的刪除標記（刪除人、原因含工單編號）。要不要另建稽核紀錄請使用者決定。刪除同意權限＝`work_order.manage`、`maintenance_request.update`、`cross_dept.maintenance.update` 或回報人本人（單純 `work_order.update` 不能刪，與舊版刪除政策相同、去掉 view_all）。
5. **送門市確認說明可留白**（`wo-completion-note-optional`），預設「總務已標記處理完成，等待門市確認結果。」（舊版必填）。
6. **新增舊式回報的權限**（`wo-create-legacy-perm`）：該門市店長且有 `maintenance_request.create` 或 `cross_dept.maintenance.submit`，或有工單更新權限；只有查看全部的人不能新增。需要防重複識別碼（同人同識別碼重送回原工單，先於內容驗證）；附件只收圖片、最多 5 張、路徑必須是 `maintenance_request/<工單id>/…` 且檔案已在儲存空間。
7. **舊式單總務不能代按確認／仍有問題／回覆補資料**（`wo-legacy-no-proxy`）：設計只列回報人與店長；有需求單者的代按走第 4 批。
8. **列表**：回報人永遠看得到自己的單（即使不是該門市店長）；`pageSize` 小於 1 用 20、大於 100 用 100；焦點卡計數不受焦點篩選影響、受其他篩選影響。
9. **`ga_wo_apply_completion_request` 要求工單已受理或處理中**：第 4 批原本無條件把工單改成待確認（連已完成的也會），改為只套用於已受理／處理中的工單。
10. **需求單端要求補資料**時，需求單處於「待總務複核」也允許（沿用第 4 批規則），工單端同樣允許。
11. **120000 RLS**：刪除政策對所有人（含更新者）都加上「未受理且沒連需求單」，與 W4 一致；`maintenance_updates` 寫入政策只拿掉 view_all，**「本人署名」條款維持**（見下方發現）。
12. **DEV 專用角色改名為 `vue_workspace_ga_wo_works`／`_viewer`／`_manager`**（見下方事故）。

**實作中的發現**
- **DEV 事故與修復（已處理）**：原本把 DEV 測試角色命名為 `vue_workspace_ga_works`，與角色矩陣既有的「測試工務」角色撞名；`ON CONFLICT (code) DO UPDATE` 把它的權限覆蓋成 8 個，之後我測 rollback 時又把整個角色連同成員指派刪掉，導致 `ga_works` 測試帳號全部 403（G14-G17 parity 與 smoke 失敗）。已用 `scripts/seed-workspace-role-matrix-dev.cjs --skip-legacy` 還原（`vue_workspace_ga_works` 回到 58 權限、1 位成員），DEV 專用角色改名為 `ga_wo_*` 前綴並確認不碰既有角色。教訓：DEV 專用角色代碼不可與 `tests/fixtures/role-matrix.json` 的 `vue_workspace_*` 撞名。
- **子表「本人署名」條款是既有缺口**：`maintenance_updates` 寫入政策的 `updated_by = auth.uid()` 讓任何已登入者都能用自己的名義對任何工單新增進度（RLS 不檢查工單可見性）。新版函式不依賴它；120000 只拿掉 view_all，沒有再收緊（不在 Q20 範圍）。建議之後加上「工單看得到才能寫」的條件，需使用者決定。
- **DEV 與正式區 `has_permission` 不同**：DEV 版檢查 `roles.is_active` 並有 RBAC `admin` 角色後備，正式區不檢查 `is_active`（記憶筆記）；本批函式一律呼叫 `has_permission`，語意跟著環境走，測試用的角色都是啟用狀態，沒有依賴差異。
- **共用附件不能由 service role 直接寫入**：觸發器 `ga_validate_resource_attachment` 以 `auth.uid()` 當上傳人並驗證管理權限，service role 沒有 `auth.uid()` 會失敗；測試只能經 `ga_ws_wo_create_legacy`（以使用者身分）建立附件。刪除工單用 `app.ga_resource_attachment_soft_delete='on'` 標記刪除（本批函式內設定並設回）。
- **Supabase 儲存空間保護**：不能用 SQL 刪 bucket，130000 的 rollback 會留下空的 `maintenance-photos` bucket（無害，已寫在 README）。
- **第 4 批函式本體是 CRLF 換行**（migration 以 CRLF 貼入），105000 由產生器統一成 LF，所以套用後 md5 與備份不同是預期的（內容比對以單元測試為準）；rollback 直接用備份原文。
- **36 預覽在 DEV 的結果**：第 6 區（只能查看全部）現在會列出測試帳號與 `vue_workspace_navigation`；第 7 區（沒有更新角色的管理員）會列出測試用的 `m7m8-test-po-admin`，都屬 DEV 測試資料，正式區的名單要使用者上線前確認。

**驗證結果（2026-11-16，只連 DEV，循序執行）**
- `npm run test:page -- G18-db`：單元 24（SQL 靜態檢查：授權、search_path、階段與焦點常數對齊 `lib/maintenance/status.ts`、105000 逐行比對、rollback 完整、草稿與 DEV 檔一致、36 唯讀）＋整合 20（權限矩陣讀寫、流轉表、有填才更新、需求單護欄、INTERNAL 不外洩、送確認與第 4 批結果一致、門市確認與仍有問題、強制結案、補資料往返含代按與需求單端入口、領用料件、刪除、新增舊式回報、改分類、列表分頁與焦點卡、時間軸與列印、RLS 直連、`BEGIN…ROLLBACK` 連帶刪除與函式目錄）全過。run-all 結束碼 1 只因 sweeper 基準 17 筆孤兒。
- 第 4 批回歸（改了 `ga_ws_req_transition`、`ga_ws_req_store_action`）：`G14-G17` 33（單元 18、smoke 10、整合 17、parity 6）、`G16` 6、`G17` 7、`G27` 單元 13＋17、`G26-db` 單元 37＋22、`G25-db` 單元 43＋21、`G25` 劇本 2，全部通過；結束碼 1 皆只因 sweeper 基準 17 筆孤兒。補資料往返的專門劇本（G28）在後面階段。
- `npm run test:unit`：117 檔 1790 項全綠；`npx tsc --noEmit`、`vue-tsc --noEmit` 無錯誤。本階段沒有動 Vue、API 或 `public/workspace`，所以沒有跑 Vue build 與同步。
- 正式區：全部只出草稿；`36` 已在 DEV 以唯讀方式跑過（語法與欄位正確）。

**未完成／留給後面階段**：規則與 API（`lib/workspace/general-affairs/work-orders*.ts`、`router.ts`、abilities、附件簽名、列印資料）、畫面（工單中心、跨部門頁、需求單與我的追蹤的工單摘要、列印）、角色劇本（G18、G19、G28）、G18 parity 對舊 `/api/maintenance-requests*`、版面與列印 e2e、Q20 名單與 W9 名單的正式區確認、上線前使用者核可。


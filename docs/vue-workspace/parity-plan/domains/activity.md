# 活動檔期

> M5 更新（2026-11-08）：W19、P05 已完成並以程式碼為準，下列盤點中的缺口多數已補上，保留原文供對照。已補上：活動列表狀態依日期、停用與未發布標籤、類型文字、排程入口依權限（Q2）；停用的活動對督導／店長／活動檢視／門市端隱藏（Q2）；刪除前輸入名稱並列出筆數（Q3）；改期列出期間外門市並移回尚未安排（Q4）；三種誤操作提醒（Q5）；盤點類只有三個分頁；月曆週一為首；督導區顏色；特殊日期依月份分組與星期；允許與禁止星期重疊擋下；行銷圖片拖曳排序（最多 8 張、5MB）；自動排程與舊版 200 組隨機資料對照。W20 活動檢視填報、受眾可見性文件說法「新版不一致」已過時（新舊相同，依 2026-11-03 規格），由 W20 另案處理。實測新發現：舊版寫入要同時過 profiles.role 與資料庫 RLS 兩關，所以「舊式身分經理但沒有編輯權」的人舊版也寫不進去。

## 領域共用缺口

- 缺少獨立路由：Vue 無 /activity-management、/activity-view/[id] 對應的獨立 URL/導覽，已發布活動的檢視只藏在 MonthlyTools「活動檢視」，且進入權限用 activity.management.access，與舊版 activity.campaign.view/view_all + getCampaignAudienceAccess 受眾判斷不一致，需統一(lib/campaign-access.ts、monthly/tools/route.ts)
- 權限基準差異：舊版 store-activity-settings API 以 profiles.role in (admin, manager) 判斷寫入；Vue campaign-tools 以 RBAC activity.campaign.edit/activity.manage，需測試二者對相同帳號是否一致
- campaign-tools 直接包裝舊 route handler(app/api/campaign-*)，因此舊 API 的 RBAC 不可刪改；兩版共用同一批資料表，需確認 DEV 的 workspace_version、workspace_request_id、RPC workspace_campaign_replace/workspace_campaign_state/workspace_campaign_checklist_order 已套用(supabase/workspace-dev/20261030000000_vue_campaign_operations.sql)
- 行銷部圖片拖曳排序、inventory 類型隱藏促銷專屬分頁、督導區顏色、已發布活動列表狀態徽章等小功能缺口
- 文件過時：docs/vue-workspace/feature-parity-review.md 第9行稱活動管理僅簡化店別日期，與程式現況(七分區皆已原生實作)不符，需更新
- 測試缺口：現有 scripts/test-workspace-campaign-{ui,api,scheduling,assets-clean} 與 test-workspace-monthly-activity 需補：新舊版同一資料集的對照測試(自動排程結果一致、PDF/列印輸出、發布受眾可見性、權限矩陣 activity.* 各碼、inventory vs promotion 類型差異)，並以 DEV 資料庫(supabase/workspace-dev)建立測試資料

## /admin/activity-management

- 狀態：**done**（S）— 檔期列表、新增、編輯、刪除、進入排程、門市設定與特殊日期入口皆有原生 Vue 對應，且多出搜尋、分頁、停用旗標與版本衝突保護。僅有小差異(見 missingOrDifferent)，核心功能已復刻。
- 舊版：`app/admin/activity-management/page.tsx`
- Vue：`vue-workspace/src/pages/Campaigns.vue`、`vue-workspace/src/pages/CampaignEdit.vue`
- 權限：activity.manage、activity.campaign.edit、activity.store_detail.edit、activity.equipment_trip.edit、activity.checklist.edit、CAMPAIGN_READ_CODES(activity.campaign.view_all / activity.campaign.view / ...，見 lib/workspace/server.ts)
- 相依：Modal 共用元件、lib/workspace/server.ts 權限碼、supabase/workspace-dev/20261030000000_vue_campaign_operations.sql

**舊版功能**

- 列出所有活動檔期(GET /api/campaigns)，顯示名稱、類型徽章(盤點活動 / 母親節/周年慶)、進行中徽章、開始與結束日期
- 新增活動檔期 Modal：活動類型(promotion/inventory)、名稱、開始日、結束日(必填，缺欄位 alert)
- 編輯活動檔期(PUT)
- 刪除活動檔期(confirm：相關排程一併刪除)
- 「排程管理」按鈕：僅有 activity.campaign.edit 或 activity.store_detail.edit 才顯示，連到 schedule/[id]
- 「門市設定」連結到 settings 子頁
- 「特殊日期」連結到 events 子頁
- 空狀態：尚無活動檔期
- 載入中 spinner

**缺少或不同**

- Vue 列表不顯示「進行中」徽章，改顯示啟用/停用欄；多了 is_active 欄位可編輯(CampaignEdit.vue)，舊版無此欄位，屬行為差異(vue-workspace/src/pages/Campaigns.vue)
- 舊版只有 campaign.edit 或 store_detail.edit 者看到「排程管理」；Vue 對所有進入頁面者都顯示「活動規劃／排程」按鈕(Campaigns.vue)，權限在進入後各區塊再控制
- 舊版編輯/刪除按鈕對所有可進入者顯示(API 端才擋)；Vue 編輯按鈕依 editCampaigns 切換為「查看」，刪除隱藏，較嚴格
- 舊版類型徽章文字為「母親節/周年慶」，Vue 為「促銷」(Campaigns.vue)
- Vue 新增搜尋、分頁、重新整理，需 e2e 驗證 20 筆分頁

**業務規則**

- end_date 不得早於 start_date
- campaign_type 僅 promotion / inventory
- 刪除活動連帶刪除排程等相關資料
- Vue 版名稱最長 120 字、日期須為有效 20xx-MM-DD、PUT/DELETE 需 version 否則 409

**API**：舊 GET/POST/PUT/DELETE /api/campaigns；新 app/api/workspace/campaigns/route.ts (GET/POST/PUT/DELETE，含 requestId 冪等與 workspace_version 樂觀鎖)

**資料表**：campaigns

**既有測試**：scripts/test-workspace-campaign-ui.py、scripts/test-workspace-campaign-api.py、scripts/sql/test-workspace-campaign-operations.sql、scripts/test-production-legacy-campaign-pharmacist-remaining-compatibility.js

**待確認**

- 舊版 /api/campaigns 本身的權限檢查細節未逐行比對，以 fetchSchedulePermissions 前端行為為準
- scripts/test-workspace-campaign-ui.py 實際涵蓋哪些斷言未逐行檢視

### 測試案例

**冒煙**

- 以 A 登入開 Vue 工作台 Campaigns 頁：HTTP 200、表格出現 ZZTEST-CAMP 檔期、無 console error / pageerror、無 4xx/5xx 網路回應
- 以 A 開舊版 /admin/activity-management：spinner 消失後列表出現同一批檔期
- 導覽可見性矩陣（lib/workspace/navigation.ts）：A/B/C/I/J/K/L/M/N 看得到活動管理入口；G 看不到且直接打 URL 顯示無權限（API 403）；D/E 依 CAMPAIGN_READ_CODES 判斷（D/E 有 activity.campaign.view 所以可見，需記錄）
- GET /api/workspace/campaigns 回 records/total/canEdit；A canEdit=true，C canEdit=false
- 空資料：以搜尋不存在字串 q=ZZNONE 顯示空狀態文字

**單元**

- app/api/workspace/campaigns/route.ts validate()（未 export，建議抽出至 lib/workspace/campaign-validate.ts 或在測試中以 transpile+重新匯出測）：案例 name 空白/僅空白→400；name 120 字 OK、121 字→400；start_date '2026-02-30'、'1999-01-01'、'2026-1-1'→400；end<start→400；end=start OK；campaign_type 'mothers_day'→400；is_active 非 boolean（'true'）→400；回傳 name 已 trim
- Campaigns.vue 類型/狀態顯示轉換（若為 inline 函式則抽成 campaignTypeLabel(type)：promotion→促銷、inventory→盤點活動），並與舊版 label 對照表斷言（舊版 promotion→母親節/周年慶，KNOWN-DIFF）
- 舊版「進行中」判斷 start<=today<=end 抽純函式 isCampaignOngoing(c, today) 作為 parity 基準（含 start=today、end=today 邊界）

**整合**

- 角色矩陣 GET /api/workspace/campaigns：A/B/C/D/E/I…N=200；G=403；匿名=401
- POST 角色矩陣：A、B、X2=200；C、D、E、K、X1=403（X1 舊版 POST /api/campaigns 會 200 → 輸出權限差異表）
- 舊版對照 POST /api/campaigns：A、X1=200；B、X2=403（role 非 admin/manager）→ 列入權限差異報告
- PUT 樂觀鎖：同一檔期取得 version=v，兩個請求同時用 v PUT（Promise.all）→ 一個 200 另一個 409；之後 GET version=v+1
- PUT/DELETE 缺 version → 409；version 過期 → 409
- requestId 冪等：POST 同一 requestId 送兩次（含並行）→ DB 只有一筆 campaigns，第二次回相同 id
- DELETE 連帶刪除：先建立檔期並寫入 campaign_schedules、campaign_store_details、campaign_equipment_trips、campaign_checklist_items、campaign_department_publish 各一筆，DELETE 後以 service role 查各表 campaign_id 皆 0 筆
- checkOrigin：POST/PUT/DELETE 帶 Origin https://invalid.example → 403
- 分頁：建 25 筆 ZZTEST 檔期，GET page=1 回 20 筆、page=2 回 5 筆、total=25；q 搜尋大小寫/部分字串
- 錯誤路徑：DELETE 不存在 uuid → 404 或明確錯誤（記錄實際行為）；非 uuid id → 400

**E2E**

- A：新增 promotion 檔期（名稱、日期、啟用）→ 列表出現 → 編輯改名與結束日 → 列表更新 → 刪除（確認對話框）→ 列表消失、DB 無殘留
- A：新增時不填結束日 / 結束日早於開始日 → 顯示錯誤、不送出（或 400 訊息顯示），DB 無新增
- C 唯讀：按鈕顯示「查看」、無刪除鈕、開啟編輯頁欄位 disabled
- 兩個分頁同時編輯同一檔期：tab1 儲存成功，tab2 儲存出現版本衝突訊息且不覆蓋 tab1 結果
- 搜尋 + 分頁：25 筆中切到第 2 頁、搜尋 'ZZTEST-CAMP-<runId>-2' 只剩符合項、重新整理按鈕重抓
- 入口按鈕：「活動規劃／排程」導到 CampaignSchedule、「門市設定」「特殊日期」開 CampaignConfiguration Modal

**對等驗證**

- 同一 DEV 資料集、同一帳號 A：舊版 GET /api/campaigns 與 Vue GET /api/workspace/campaigns?pageSize=大 取 ZZTEST 前綴集合，比對 id/name/start_date/end_date/campaign_type 完全一致
- 畫面比對：Playwright 擷取兩版列表每列 (名稱, 類型, 開始, 結束) 正規化後比對；類型文字用對照表轉換（母親節/周年慶↔促銷）
- 寫入對等：用舊版 POST 建一筆、Vue POST 建一筆相同內容，service role 查 campaigns 兩列除 id/時間/workspace_version/is_active/request_id 外欄位相同
- 刪除對等：兩版各刪一筆含子資料的檔期，比對各子表殘留皆為 0
- 權限對等報告：對 X1、X2、A、B、C、G 列出舊版/Vue 各操作 HTTP 狀態矩陣，差異輸出 .tmp-check/campaign/permission-diff.json

**測試資料**

- campaigns：ZZTEST-CAMP-<runId>-P1 promotion（含今天，用於進行中）、-I1 inventory、-F1 未來、-E1 已結束、批次 25 筆供分頁
- 每個檔期至少 1 筆 campaign_schedules / campaign_store_details / campaign_equipment_trips / campaign_checklist_items / campaign_department_publish（供刪除連帶驗證）
- 帳號 A、B、C、D、E、G、X1、X2（見 domainNotes 第 7 點）

**風險**

- 舊版以 profiles.role、Vue 以 RBAC 判斷寫入，同一帳號可能一邊可寫一邊不可
- Vue 多了 is_active，舊版建立的檔期 is_active 預設值需確認不會被 Vue 隱藏
- DELETE 連帶刪除若依賴 FK cascade，DEV 與正式 schema 不一致時會殘留

## /admin/activity-management/schedule/[id]

- 狀態：**partial**（L）— 七個分區(排程、門市細節/人力、預覽、設備車次、工作清單、行銷部、商品部)、自動排程、發布給督導/店長/盤點組、儲存/取消皆已原生復刻；但行銷圖片拖曳排序、非促銷活動的分區隱藏、門市已填狀態等有差異，需實測確認。文件 feature-parity-review.md 稱「尚未對等」已過時。
- 舊版：`app/admin/activity-management/schedule/[id]/page.tsx`
- Vue：`vue-workspace/src/pages/CampaignSchedule.vue`、`vue-workspace/src/components/CampaignStoreEditor.vue`、`vue-workspace/src/components/CampaignRecords.vue`、`vue-workspace/src/components/CampaignDepartment.vue`、`vue-workspace/src/components/CampaignPreviewTable.vue`、`vue-workspace/src/components/ActivityPlan.vue`、`vue-workspace/src/campaign-scheduling.ts`
- 權限：activity.campaign.edit、activity.manage、activity.store_detail.edit、activity.equipment_trip.edit、activity.checklist.edit、activity.support_request.edit、activity.support_assign.edit、activity.marketing.publish、activity.merchandise.publish、activity.staff_overview.view
- 相依：Campaigns.vue 列表頁(入口)、CampaignConfiguration.vue(特殊日期與門市設定供自動排程使用)、ActivityPlan / ActivityCalendar(預覽)、舊版 route handler 被 campaign-tools 直接 import，需保留 app/api/campaign-* 的 RBAC

**舊版功能**

- 活動標題與期間；返回列表
- 權限旗標：campaign.edit / store_detail.edit / equipment_trip.edit / checklist.edit / support_request.edit / marketing.publish / merchandise.publish
- 自動排程按鈕：週三/六/日、避開被封鎖特殊日期、依門市 allowed/forbidden_days、同督導區同日不重複且前後一天避開，失敗門市放寬連續限制再試，confirm 並顯示無法排程清單，套用後覆蓋現有排程為草稿
- 發布/取消發布給 督導 / 店長 / 盤點組人員(PATCH /api/campaigns/publish，confirm)
- 儲存所有變更(confirm)、取消變更(confirm)、未儲存離開頁面 beforeunload 警告
- 分頁籤：活動排程、門市細節、預覽表；促銷類型才有 設備車次、Check List、行銷部、商品部
- 月曆(依月份切塊、週一為首)，門市卡片拖放至日期、日期內已排門市可拖曳換日或移除；暫存區(未安排門市)；督導區顏色
- 門市細節 Modal(CampaignStoreDetailModal)：外場廠商、紅豆餅、循環、量子、骨密、督導、經理、試飲、活動組、業務1-6、內場工讀1-2、備註；盤點類型欄位：外盤公司、預計盤點時間、盤點組人員
- 門市本店人員、支援需求(StoreSupportEditModal)、支援人員指派、預估人數(headcount)
- 預覽表 CampaignDetailPreviewTable：列印/匯出
- 設備車次編輯(EquipmentTripEditor)：套次、日期、起訖、備註、日曆
- Check List 範本編輯(ChecklistTemplateEditor)：新增/編輯/刪除/拖曳排序
- 行銷部發布：活動內容、規則、最多 N 張圖片上傳、圖片拖曳排序、移除；發布(saveDepartmentPublish)
- 商品部發布：滿額贈規則圖、商品供應說明、活動百貨配量 Excel；發布
- 載入時讀取 /api/campaigns、stores-with-supervisors、store-activity-settings、event-dates、campaign-schedules

**缺少或不同**

- 行銷部圖片拖曳重排序：舊版 draggable + dragOverMarketingIndex(page.tsx 約1683-1701行)；Vue CampaignDepartment.vue 無拖曳排序，只能移除/上傳
- 舊版 inventory 類型活動隱藏 設備車次/Check List/行銷/商品分頁；Vue CampaignSchedule.vue 的 sections 為固定七項不判斷 campaign_type(門市細節欄位則由 campaign_type 切換)
- 舊版月曆為週一起始、暫存區卡片依督導區上色；Vue 為週日起始、無督導區顏色，另以選單安排門市(新增功能)
- 舊版 beforeunload 離開警告；Vue 以 tab.dirty 工作台分頁層級關閉確認取代，行為不同需實測
- 舊版預覽表為頁內顯示；Vue 的 CampaignPreviewTable 提供列印(A3 橫向)，需驗證列印輸出
- 舊版門市細節列顯示已填/未填 badge 於 Tab2；Vue 有「已設定/待填寫」欄，等價
- Vue 發布後權限用 permissions.publish(= activity.campaign.edit)；舊版 handlePublish 權限於 API 判斷，需對照 app/api/campaigns/publish/route.ts
- Vue 行銷圖片上傳走 assets 資源(最多 8 張、5MB、png/jpeg/webp)，舊版常數 MAX_MARKETING_IMAGE_COUNT 值未確認是否為 8

**業務規則**

- 自動排程只用週三(3)、週六(6)、週日(7)；被 is_blocked 的特殊日期排除
- 同一天同督導區只能一間；第一階段另避免前後一天同督導區，第二階段放寬
- 排程儲存為整批取代(Vue 用 RPC workspace_campaign_replace + version 防衝突 + requestId 冪等)
- 行銷發布權限包含 checklist.edit；商品發布同
- 發布對象 supervisors/store_managers/inventory_team 可個別切換
- 圖片限 png/jpeg/webp、每張 5MB(Vue 驗證)
- 上傳 Excel 限 xlsx/xls

**API**：舊 /api/campaigns、/api/campaigns/publish、/api/stores-with-supervisors、/api/store-activity-settings、/api/event-dates、/api/campaign-schedules、/api/campaign-store-details、/api/campaign-store-own-staff、/api/campaign-support-requests、/api/campaign-support-staff、/api/campaign-store-headcount、/api/campaign-checklist-items、/api/campaign-checklist-completions、/api/campaign-equipment-trips、/api/campaign-department-publish、/api/campaign-department-assets；新 app/api/workspace/campaign-tools/route.ts (resource 分派: schedules/settings/events/stores/details/ownStaff/requests/supportStaff/headcount/checklist/checklist-order/completions/trips/departments/assets/publish/employees/search/permissions，內部包裝舊 route handler)、app/api/workspace/campaign-schedules/route.ts、app/api/workspace/campaigns/route.ts

**資料表**：campaigns、campaign_schedules、campaign_store_details、campaign_store_own_staff、campaign_support_requests、campaign_support_staff、campaign_store_headcount、campaign_checklist_items、campaign_checklist_completions、campaign_equipment_trips、campaign_department_publish、store_activity_settings、event_dates、stores

**既有測試**：scripts/test-workspace-campaign-ui.py、scripts/test-workspace-campaign-api.py、scripts/test-workspace-campaign-scheduling.cjs、scripts/test-workspace-campaign-assets-clean.cjs、scripts/sql/test-workspace-campaign-operations.sql

**待確認**

- 舊版 CampaignStoreDetailModal / EquipmentTripEditor / ChecklistTemplateEditor / StoreSupportEditModal 內部細節功能(如車次顏色 EQUIPMENT_SET_COLORS、檢核項目細節欄位)未逐檔讀完，與 Vue CampaignStoreEditor(17KB)/CampaignRecords 的逐項對照為推定
- MAX_MARKETING_IMAGE_COUNT 實際值未讀取
- scripts/test-workspace-campaign-ui.py 是否已涵蓋行銷/商品/發布/自動排程流程未逐行確認

### 測試案例

**冒煙**

- A 開 Vue CampaignSchedule（ZZTEST promotion 檔期）：七個分區標籤皆出現、標題顯示名稱/期間/「促銷活動」、無 console error
- A 開 inventory 檔期：標題顯示「盤點活動」，記錄七分區是否仍顯示（KNOWN-DIFF：舊版只顯示 排程/門市細節/預覽表）
- GET /api/workspace/campaign-tools?resource=permissions 各角色回傳旗標：A 全 true；K 只有 details 系列；L trips；M checklist + marketing + merchandise（因 checklist.edit 也授權）；I marketing；J merchandise；C 全 false
- 舊版 schedule/[id] 以 A 開啟：月曆、暫存區、分頁籤載入完成
- G 開啟 → 403；匿名 resource=permissions → 401（已有，沿用）

**單元**

- vue-workspace/src/campaign-scheduling.ts campaignDates()：跨月(11-29~12-02)、單日、start>end 回空陣列、閏年 2028-02-28~03-01、上限 3660 截斷
- autoCampaignSchedule()：(a) 只排週三/六/日；(b) is_blocked 日期排除、is_blocked=false 的 event 不排除、event_date 帶時間 'YYYY-MM-DDT00:00:00' 也能比對；(c) allowed_days=[] 視同無限制；(d) forbidden 與 allowed 同時存在；(e) 同督導區同日不重複；(f) strict 階段避開前後一天、放寬階段允許相鄰；(g) supervisor_id null 歸 'unassigned' 群組；(h) 全部失敗回 failed 原順序
- 黃金對照（關鍵）：把舊版 page.tsx autoSchedule 演算法（541-700 行）以相同邏輯移植成測試用 legacyAutoSchedule(stores,dates,settings,events)（純函式，只放在測試檔），用 seed 隨機產生 200 組（門市 1-30、督導 1-6、期間 7-60 天、隨機 settings/blocked events）比對 Vue 與舊版 schedules 集合與 failed 集合完全相同；任何差異輸出案例 JSON
- CampaignDepartment.vue 上傳前驗證（如抽成 validateDepartmentFiles(files)）：9 張→錯、5MB+1 byte→錯、image/gif→錯、png/jpeg/webp OK；Excel 驗證 xlsx/xls OK、csv 錯
- ActivityPlan / CampaignStoreEditor 的已設定/待填寫判斷（若為 inline，抽成 isStoreDetailFilled(detail, campaignType)）與舊版 badge 判斷對照

**整合**

- schedules 整批取代：GET resource=schedules&campaign_id 取得 version → PUT {rows, version, requestId} → 200 且 DB 只剩新 rows、version+1
- 並行：兩個 PUT 用同 version 同時送 → 一個 200 一個 409；DB 內容等於成功那個
- 冪等：同 requestId PUT 兩次 → 第二次回相同結果、version 只 +1
- ownStaff（scope=store_id）、supportStaff（scope=support_request_id）同樣做 version/requestId/409 測試；scope 缺漏 → 400
- checklist-order：ids 含非 uuid → 400；正確順序 → RPC 後 campaign_checklist_items 排序欄位符合
- 角色寫入矩陣（每個 resource 的 POST/PUT/DELETE 對 A,B,C,K,L,M,N,I,J,G）：依 edits map（campaign-tools/route.ts 22 行）期望；例：K 寫 trips → 403、L 寫 trips → 200、M 寫 departments → 200、I 寫 assets → 200、J 寫 assets → 403（assets 只開 marketing/checklist）
- 跨門市：K 為 S1 店長時寫入 S3 的 details → 記錄實際結果（舊 handler 是否有門市範圍檢查需讀 app/api/campaign-store-details/route.ts；若無則列風險）
- publish：PATCH/POST resource=publish 切換 published_to_supervisors / store_managers / inventory_team，只有 activity.campaign.edit 可（A,B 200；activity.manage-only 帳號記錄結果；M 403）
- assets：9 檔→400、6MB→400、gif→400、合法 png→200 且回 url；刪除後 storage 無殘留（沿用 test-workspace-campaign-assets-clean.cjs）
- departments：marketing 發布內容/規則/圖片順序陣列存入 campaign_department_publish；merchandise 上傳 xlsx 後讀回 data URI 可解碼
- 錯誤路徑：未知 resource → 404；campaign_id 非 uuid → 400；Origin 不符 → 403

**E2E**

- A 自動排程：建 12 門市/3 督導/1 blocked 日 → 按自動排程 → 確認對話框顯示無法排程清單 → 套用 → 月曆出現草稿 → 儲存 → 重新整理後仍在；DB campaign_schedules 筆數 = 成功數
- 手動調整：以選單把暫存區門市排到某日、把已排門市換日、移除 → 儲存 → DB 對應；取消變更 → 回到儲存前狀態
- dirty 保護：修改後嘗試關閉工作台分頁 → 出現確認；修改後按發布 → 按鈕 disabled 並提示先儲存
- 門市細節：K 開門市細節編輯外場廠商/紅豆餅/循環/量子/骨密/試飲/業務1-6/工讀/備註 → 儲存 → 預覽表該列顯示；inventory 檔期改顯示外盤公司/預計盤點時間/盤點組人員
- 支援：N 建立支援需求、指派支援人員、填預估人數 → 重新載入保留
- 設備車次：L 新增兩套車次、日期與起訖、備註 → 日曆顯示
- Check List：M 新增 3 項、拖曳排序、刪除 1 項 → 重新整理順序保留
- 行銷部：I 上傳 3 張 png、移除 1 張、填內容規則、發布 → ActivityPlan 檢視可見；嘗試第 9 張被擋
- 商品部：J 上傳滿額贈圖與 xlsx、發布 → 檢視頁可下載
- 發布：A 依序發布給督導/店長/盤點組，再取消督導 → 以 E 登入 MonthlyTools 活動檢視不可見、D 可見
- 預覽表列印：觸發 print，攔截 window.print 或 page.pdf(A3 landscape) 產檔，斷言含所有已排門市名稱
- C 唯讀：所有編輯控制 disabled、無自動排程/發布按鈕

**對等驗證**

- 自動排程對等：同一 DEV 資料（stores-with-supervisors、settings、event_dates）在舊版頁面按自動排程（Asia/Taipei，攔截 confirm 回 true，不儲存）擷取 React state 或儲存後 DB 結果；Vue 同樣操作後 DB 結果；比對 (store_id, activity_date) 集合完全相同。注意門市排序必須相同（兩版門市來源皆 stores-with-supervisors，需確認排序一致，否則先 assert 輸入順序）
- 資料讀取對等：同一檔期，舊版 /api/campaign-* 各 GET 與 Vue campaign-tools?resource=* GET 回應 JSON 深比較（campaign-tools 包裝舊 handler，應逐位元相同，除 version 欄位）
- 寫入對等：同一操作序列（建 2 筆 details、1 支援需求、2 車次、3 checklist、行銷發布）分別經舊版 UI 與 Vue UI 執行於兩個複製檔期，service role dump 各子表（去 id/時間/campaign_id）後比對
- 預覽表對等：兩版預覽表擷取每列（門市、日期、各欄）正規化後比對
- 權限對等：以 permissions 旗標矩陣比對舊版 page.tsx 的 fetchSchedulePermissions 結果與 Vue resource=permissions

**測試資料**

- 門市 ZT901-ZT912：督導 SV1(ZT901-904)、SV2(ZT905-908)、SV3(ZT909-912)、1 間 supervisor_id null
- store_activity_settings：ZT901 allowed=[6]、ZT902 forbidden=[3]、ZT903 allowed=[1]（必失敗）
- event_dates：檔期內 1 天 is_blocked=true（週六）、1 天 is_blocked=false
- 檔期：P1 promotion 2099-11-01~2099-11-30、I1 inventory 同期
- 測試圖片 png/jpeg/webp 各 1、6MB png、gif、xlsx、csv fixture
- 帳號 A,B,C,G,I,J,K,L,M,N,D,E

**風險**

- 舊版日期計算用本地時區，非 Asia/Taipei 會整體偏移一天
- campaign-tools 直接 import 舊 route handler，舊 handler 被修改會同時影響兩版
- Vue 無行銷圖片拖曳排序、inventory 不隱藏分頁（KNOWN-DIFF）
- workspace_campaign_replace 整批取代與舊版逐筆寫入並存時，舊版寫入不會更新 workspace_version，可能導致 Vue 覆蓋舊版寫入

## /admin/activity-management/events

- 狀態：**done**（S）— 新增、刪除、列表、類型與禁止排程旗標皆有；僅呈現方式不同(Modal+表格取代獨立頁+月份分組)。
- 舊版：`app/admin/activity-management/events/page.tsx`
- Vue：`vue-workspace/src/components/CampaignConfiguration.vue(mode='events'，由 Campaigns.vue 以 Modal 開啟)`
- 權限：activity.campaign.edit、activity.manage
- 相依：CampaignConfiguration.vue、Campaigns.vue

**舊版功能**

- 列出特殊日期並依月份分組
- 每筆顯示 emoji 類型圖示、日期含星期、說明、類型文字(國定假日/公司活動/其他)、「禁止排程」徽章
- 新增特殊日期 Modal：日期(必填)、說明、類型、禁止在此日排程旗標
- 刪除(confirm)
- 空狀態「尚無特殊日期」
- 返回活動管理

**缺少或不同**

- Vue 不依月份分組、不顯示星期、無 emoji 圖示(CampaignConfiguration.vue 為單一表格)
- Vue 事件以 event_date upsert(onConflict event_date)，同日重複新增會覆蓋；舊版 /api/event-dates POST 行為未確認
- Vue 為 Modal 內嵌而非獨立路由，無法直接以 URL 開啟
- Vue 唯讀使用者可看列表但不可新增刪除；舊版 API 權限未逐行比對

**業務規則**

- is_blocked=true 的日期不可自動排程
- event_type 僅 holiday / company_event / other
- 日期須為有效 YYYY-MM-DD，說明最長 1000 字(Vue)

**API**：舊 GET/POST/DELETE /api/event-dates；新 app/api/workspace/campaign-tools/route.ts (resource=events)

**資料表**：event_dates

**既有測試**：scripts/test-workspace-campaign-api.py(包含 events 建立與刪除)、scripts/test-workspace-campaign-ui.py

**待確認**

- 舊版 /api/event-dates 的 POST 權限與重複日期行為未讀取

### 測試案例

**冒煙**

- A 在 Campaigns 開「特殊日期」Modal：表格載入、無 console error
- GET campaign-tools?resource=events：A/C 200；G 403
- 舊版 /admin/activity-management/events 以 A 開啟：依月份分組列表出現

**單元**

- campaign-tools events POST 驗證（campaign-tools/route.ts 45-47 行，建議抽 validateEventDate(body)）：'2099-02-30'→錯、'2099-2-1'→錯、event_type 'birthday'→錯、is_blocked 'true' 字串→錯、description 1000 字 OK/1001 錯、description 非字串（null）→錯
- 舊版事件顯示 formatter（月份分組 key、星期文字、類型文字 holiday→國定假日 等）抽成 groupEventsByMonth / eventTypeLabel 作為 parity 基準

**整合**

- POST 角色矩陣：A、B、X2=200；C、K、G、X1=403（舊版 /api/event-dates：A、X1=200、B/X2=403 → 列入權限差異）
- 重複日期：同 event_date POST 兩次不同說明 → 只有一筆且為第二次內容（兩版皆 upsert onConflict event_date，兩版各驗一次）
- DELETE ?id=非uuid → 400；不存在 uuid → 200/無影響（記錄）；C 刪除 → 403
- Origin 不符 → 403
- is_blocked 後自動排程：建立 blocked 日後呼叫 autoCampaignSchedule 輸入該 events → 不排該日（串接 unit）

**E2E**

- A 新增 2099-12-25 國定假日 禁止排程 → 列表出現 → 刪除（確認）→ 消失
- A 不填日期送出 → 錯誤訊息、無 API 呼叫或 400
- C 唯讀：看得到列表，無新增/刪除按鈕
- 新增 blocked 日後進入 schedule 頁自動排程，該日無門市

**對等驗證**

- 同一帳號 A：舊版 GET /api/event-dates 與 Vue resource=events 回應以 event_date 為鍵比對 description/event_type/is_blocked
- 寫入對等：舊版 UI 新增 2099-12-24、Vue UI 新增 2099-12-26 相同欄位，DB 兩列除日期/id/時間外一致
- 顯示對等：舊版畫面擷取 (日期, 說明, 類型文字, 禁止排程徽章) 與 Vue 表格擷取比對；月份分組/星期/emoji 為 KNOWN-DIFF 不比

**測試資料**

- event_dates 2099-12-01 holiday blocked、2099-12-10 company_event 非 blocked、2099-12-20 other
- 帳號 A,B,C,G,X1,X2

**風險**

- event_date 為全域 unique，測試若用真實日期會覆蓋正式假日設定（DEV 也可能被其他測試使用），一律用 2099 年
- 舊版 role vs Vue RBAC 權限差異

## /admin/activity-management/settings

- 狀態：**done**（S）— 門市選擇、允許/禁止星期、備註、衝突檢查與儲存皆有；差異為呈現方式(下拉選單取代左側門市列表)與缺少「已設定」標記。
- 舊版：`app/admin/activity-management/settings/page.tsx`
- Vue：`vue-workspace/src/components/CampaignConfiguration.vue(mode='settings'，由 Campaigns.vue 以 Modal 開啟)`
- 權限：activity.campaign.edit、activity.manage、舊版:profiles.role in admin/manager
- 相依：CampaignConfiguration.vue、自動排程(campaign-scheduling.ts)讀取此設定

**舊版功能**

- 左側門市清單(來自 /api/supervisors/stores)，已設定門市顯示 ✓ 已設定
- 選門市後設定「限定只能辦活動的星期」、「禁止辦活動的星期」(週一至週日切換鈕)及備註
- 顯示文字摘要「此門市只能在…辦活動」
- 允許與禁止同日衝突時顯示紅色警告
- 儲存設定(POST upsert onConflict store_id)，空陣列存為 null
- 未選門市時顯示提示

**缺少或不同**

- Vue 以下拉選單選門市(CampaignConfiguration.vue)，不顯示「✓ 已設定」標記與門市清單捲動
- Vue 衝突時於儲存時丟錯誤而非即時警告，並直接禁止儲存(workspace campaign-tools 也驗證)
- Vue 切換門市有未儲存放棄確認(新增)
- 舊版 API 寫入權限為 profiles.role in (admin, manager)，Vue 為 activity.campaign.edit / activity.manage RBAC，權限基準不同
- Vue 門市清單來源為 campaign-tools resource=stores(stores-with-supervisors)，非 /api/supervisors/stores，門市範圍可能不同(未驗證)
- 舊版 DELETE /api/store-activity-settings 無 UI 使用，Vue 亦未提供

**業務規則**

- allowed_days / forbidden_days 值 1-7(週一=1，週日=7)
- 允許與禁止不可重疊
- 全空代表使用預設規則(週三/六/日)
- 每門市僅一筆設定(upsert onConflict store_id)

**API**：舊 GET/POST/DELETE /api/store-activity-settings、GET /api/supervisors/stores；新 app/api/workspace/campaign-tools/route.ts (resource=settings, stores)

**資料表**：store_activity_settings、stores

**既有測試**：scripts/test-workspace-campaign-ui.py、scripts/test-workspace-campaign-api.py(未確認是否含 settings)

**待確認**

- 兩個門市來源 API 回傳範圍是否一致未驗證
- test-workspace-campaign-ui.py 是否涵蓋 settings 未確認

### 測試案例

**冒煙**

- A 在 Campaigns 開「門市設定」Modal：門市下拉有選項、無 console error
- GET campaign-tools?resource=settings、resource=stores：A 200、G 403
- 舊版 /admin/activity-management/settings 以 A 開啟：左側門市清單、已設定門市顯示 ✓

**單元**

- campaign-tools settings POST 驗證（route.ts 40-43，抽 validateStoreActivitySetting）：days 含 0/8/1.5/'1'→錯；allowed 與 forbidden 重疊→錯；notes 5000 OK/5001 錯；store_id 非 uuid→錯；空陣列 OK
- CampaignConfiguration.vue 衝突檢查與摘要文字（如 inline 則抽 daysConflict(allowed,forbidden)、settingSummary(allowed)）對照舊版「此門市只能在…辦活動」文字
- 正規化函式 normalizeSetting(s)：null→[]、null notes→''，供 parity 比對使用

**整合**

- POST 角色矩陣：A、B、X2=200；C、K、G、X1=403；舊版 POST /api/store-activity-settings：A、X1=200、B、X2=403 → 權限差異表
- upsert：同 store_id 連續 POST 兩次 → 只有一筆且為最新
- 重疊 [3] / [3] → 400（Vue）；舊版同 payload → 記錄是否接受（預期接受，屬行為差異）
- 門市範圍：Vue resource=stores 與舊版 /api/supervisors/stores 對 A、E 帳號回傳門市 id 集合比較，差異輸出
- Origin 不符 → 403

**E2E**

- A 選 ZT901 → 允許週六日、禁止週三、備註 → 儲存 → 重新開啟 Modal 再選 ZT901 資料保留
- A 設允許週三又禁止週三 → 顯示錯誤、不儲存
- A 修改後切換門市 → 出現放棄確認；取消則留在原門市
- 設定 ZT901 只允許週一 → schedule 頁自動排程 ZT901 出現在無法排程清單

**對等驗證**

- 同帳號 A 讀取：舊版 GET /api/store-activity-settings 與 Vue resource=settings 以 store_id 比對（經 normalizeSetting）
- 寫入對等：舊版 UI 設 ZT902、Vue UI 設 ZT903 相同規則，DB 正規化後一致
- 門市清單對等：兩版下拉/清單中門市集合一致（不一致時列出差異門市並標 uncertain 交人工判斷）
- 下游對等：兩版設定相同後，自動排程結果相同（重用 schedule 頁 parity）

**測試資料**

- 門市 ZT901-ZT904 與既有 store_activity_settings 一筆（測已設定標記）
- 帳號 A,B,C,E,G,X1,X2

**風險**

- Vue 存 [] / ''，舊版可能存 null，下游讀取若用 allowed_days?.length 結果一致，但 SQL 查詢 IS NULL 會不同
- 兩版門市來源 API 不同，範圍可能不一致

## /activity-management

- 狀態：**partial**（M）— 沒有獨立路由頁；僅在月度工具的「活動檢視」中提供活動列表與年度過濾，且進入權限基準不同(activity.management.access vs activity.campaign.view)。缺少狀態徽章、發布對象標籤。
- 舊版：`app/activity-management/page.tsx`
- Vue：`vue-workspace/src/components/MonthlyTools.vue(mode='activity'，月報工具內「活動檢視」)`
- 權限：activity.campaign.view、activity.campaign.view_all、activity.management.access(Vue/部門受眾)
- 相依：月度狀態頁 MonthlyTools.vue、lib/campaign-access.ts 受眾判斷、/activity-view/[id] 對應的 ActivityPlan

**舊版功能**

- 載入已發布活動(GET /api/campaigns/published)，依 RBAC 與發布對象(督導/店長/盤點組·行銷部·營業部助理)過濾
- 標題顯示角色：督導 / 店長 / 督導與店長
- 年度篩選按鈕：全部 + 從 start/end 擷取的各年度，預設當年
- 活動卡片：名稱、狀態徽章(即將開始/進行中/已結束)、活動期間、發布給標籤(督導/店長/盤點組)、發布時間
- 「查看排程」連結到 /activity-view/[id]
- 空狀態(依年度顯示不同文案)
- 返回門市管理(/monthly-status)

**缺少或不同**

- Vue 無狀態徽章(即將開始/進行中/已結束)、無發布對象標籤、無發布時間、無角色標題(MonthlyTools.vue 第204行僅有活動名稱/期間/查看按鈕)
- Vue 年度篩選為數字輸入框，預設當年，不含「全部」選項；舊版為按鈕群含「全部」
- Vue 入口為月度工具 Modal，需 activity.management.access；舊版頁面 API 以 activity.campaign.view / view_all 判斷，且依 getCampaignAudienceAccess 過濾督導/店長/部門(lib/campaign-access.ts)。兩者進入權限碼不同，可能造成可見對象不一致
- Vue 無獨立 URL/導覽項目，導覽只有 /admin/activity-management(navigation.ts)；一般督導/店長走 /monthly-status 路徑
- Vue 資料來源為 monthly tools op=activity 的 published()，是否沿用 campaign-access 受眾判斷需讀 monthly/tools/route.ts 的 published 實作確認

**業務規則**

- view_all 看全部；否則依 getCampaignAudienceAccess 的督導/店長/部門受眾過濾
- 活動期間涵蓋該年度即顯示
- 狀態依現在時間對 start/end 判斷

**API**：舊 GET /api/campaigns/published；新 app/api/workspace/monthly/tools/route.ts (op=activity，內含 published())

**資料表**：campaigns、profiles / user_roles / roles / permissions、stores / store_managers / supervisor 對應

**既有測試**：scripts/test-workspace-monthly-activity.py

**待確認**

- published() 實作內容未逐行讀取，無法確認受眾過濾是否等同舊版
- test-workspace-monthly-activity.py 具體斷言未讀

### 測試案例

**冒煙**

- D 開 Vue 月度工具（MonthlyTools mode=activity）：活動列表出現已發布給店長的 ZZTEST 檔期、無 console error
- GET /api/workspace/monthly/tools?op=activity：D/E 200；P（有 campaign.view 無 management.access）403；G 403
- 舊版 /activity-management 以 D 開啟：標題「店長」、卡片出現、預設當年篩選
- 月度工具中「活動檢視」入口僅對 management.access 帳號顯示（capabilities.activity）

**單元**

- 舊版狀態徽章判斷抽成 campaignStatus(start,end,now)：即將開始/進行中/已結束，邊界 now=start 00:00、now=end 23:59
- 年度篩選：yearsFromCampaigns(campaigns) 與 campaignInYear(c, year)（期間跨年 2099-12-20~2100-01-05 應同時屬兩年），對照 MonthlyTools.vue 的年度過濾實作
- lib/campaign-access.ts hasCampaignPublishedAccess(access) 與 getCampaignAccessDeniedMessage(access) 的組合表（督導/店長/盤點組/部門各 true/false）

**整合**

- 受眾矩陣（同一批檔期：P_sup 只發督導、P_mgr 只發店長、P_inv 只發盤點組、P_all 全發、P_none 未發）：E 看到 P_sup,P_all；D 看到 P_mgr,P_all；H 看到 P_inv,P_all；C(view_all) 看全部含 P_none？（記錄舊版實際行為）；F 跨區督導看 P_sup 但需確認是否依門市範圍過濾
- 同一矩陣分別打舊版 GET /api/campaigns/published 與 Vue op=activity，回傳 id 集合應完全相同（Vue 包裝 published()），差異僅可能來自 management.access 前置檢查
- P 帳號：舊版 200、Vue 403 → 列入權限差異
- 取消發布後立即查詢 → 兩版皆不再出現

**E2E**

- D 登入 → 月度狀態 → 月度工具 → 活動檢視 → 年度輸入改 2099 → 出現 ZZTEST 檔期 → 點查看 → 開啟 ActivityPlan
- E 登入同流程看到督導受眾檔期，看不到僅店長檔期
- A 取消發布給店長 → D 重新整理後消失
- 年度改為無資料年份 → 空狀態

**對等驗證**

- 受眾對等：對 D,E,F,H,C,I 六個帳號，舊版 /api/campaigns/published 與 Vue op=activity 回應 id 集合逐一比對，輸出矩陣
- 畫面對等：擷取兩版 (名稱, 期間) 列表比對；狀態徽章、發布標籤、發布時間、角色標題為 KNOWN-DIFF（Vue 缺），在報告列出
- 年度篩選對等：舊版點某年度按鈕與 Vue 輸入同年度，列表集合相同；舊版「全部」Vue 無對應（KNOWN-DIFF）

**測試資料**

- 已發布檔期 P_sup/P_mgr/P_inv/P_all/P_none（2099）、一筆跨年檔期、一筆過去年度檔期
- store_managers：D→ZT901；督導 E(SV1)→ZT901-904、F(SV2)→ZT905-908，各檔期排程含對應門市
- 帳號 C,D,E,F,G,H,I,P

**風險**

- Vue 需 activity.management.access 才能進入，舊版只需 activity.campaign.view，現有店長/督導角色若未配 management.access 將在 Vue 看不到活動
- 無獨立路由，舊書籤/通知連結 /activity-management 失效

## /activity-view/[id]

- 狀態：**partial**（M）— 主要檢視功能(排程日曆、僅看本店、門市細節、人力總覽、支援請求、Check List 總覽、行銷/商品部內容、車次、PDF 匯出)皆有 Vue 原生對應，但沒有獨立路由，需從 MonthlyTools 進入，且實際細節行為(下載 Excel、車次配色等)需實測比對。
- 舊版：`app/activity-view/[id]/page.tsx`
- Vue：`vue-workspace/src/components/ActivityPlan.vue`、`vue-workspace/src/components/ActivityCalendar.vue`、`vue-workspace/src/components/ActivityOverview.vue`、`vue-workspace/src/components/ActivityImagePreview.vue`、`vue-workspace/src/activity-calendar-pdf.ts`、`vue-workspace/src/components/MonthlyTools.vue`
- 權限：activity.campaign.view、activity.campaign.view_all、activity.management.access、activity.staff_overview.view、activity.store_detail.edit(支援回報編輯)
- 相依：/activity-management 對應的活動列表(MonthlyTools)、CampaignStoreEditor 的資料(唯讀顯示)、jspdf / html2canvas 類相依(activity-calendar-pdf.ts)

**舊版功能**

- 載入 /api/campaigns/[id]/view(含受眾權限)、stores-with-supervisors、event-dates、設備車次、行銷/商品部發布內容
- 活動排程月曆顯示各日門市、特殊日期、設備車次(套次配色)
- 點擊門市開啟門市細節 Modal(CampaignStoreDetailModal)
- 支援請求 Modal(SupportRequestModal)、人員總覽(StaffOverviewModal)、Check List 總覽(ChecklistOverviewModal)
- 人力預估人數(campaign-store-headcount)與檢核完成度讀取
- 匯出 PDF(jsPDF，A4 橫向、每月一頁，檔名「活動名稱_活動排程.pdf」)
- 行銷部內容與圖片預覽、商品部滿額贈圖、商品供應說明、百貨配量 Excel 下載(a.download)
- 僅看自己門市切換(query/searchParams)

**缺少或不同**

- Vue 無 /activity-view/[id] 獨立路由，只能經 MonthlyTools(App.vue / MonthlyTools.vue 第205行 ActivityPlan)進入
- 匯出 PDF 實作不同：Vue 用 activity-calendar-pdf.ts 並依 plan.errors 禁用；舊版檔名與頁面配置需比對
- 資料來源由 monthly/tools op=activityDetail 彙整(lib/workspace/activity-plan.ts)，各讀取器個別失敗以 errors 呈現，舊版是單頁依序 fetch；錯誤處理行為不同
- 舊版 searchParams 可帶入參數(useSearchParams)，Vue 以 props.store 取代，URL 不可分享

**業務規則**

- 僅受眾(督導/店長/盤點組·行銷部)可查看已發布活動，由 getCampaignAudienceAccess 判斷
- plan 資料再依活動門市過濾 (activity-plan.ts allowed set)
- 百貨配量檔與規則圖以 data URI 下載

**API**：舊 GET /api/campaigns/[id]/view、/api/stores-with-supervisors、/api/event-dates、/api/campaign-equipment-trips、/api/campaign-department-publish、/api/campaign-store-headcount、/api/campaign-checklist-items、/api/campaign-checklist-completions；新 app/api/workspace/monthly/tools/route.ts (op=activityDetail)、lib/workspace/activity-plan.ts

**資料表**：campaigns、campaign_schedules、campaign_store_details、campaign_store_own_staff、campaign_support_requests、campaign_support_staff、campaign_store_headcount、campaign_checklist_items、campaign_checklist_completions、campaign_equipment_trips、campaign_department_publish、event_dates、stores

**既有測試**：scripts/test-workspace-monthly-activity.py、scripts/test-workspace-campaign-ui.py(預覽/PDF 是否涵蓋未確認)

**待確認**

- 舊版 activity-view 內各 Modal 子元件(SupportRequestModal/StaffOverviewModal/ChecklistOverviewModal)內部功能未逐檔讀取
- Vue ActivityPlan 對各面板(行銷、商品、車次顏色)的完整度僅看到片段，未全檔檢視
- 新版 PDF 與舊版 PDF 輸出版面是否一致未驗證

### 測試案例

**冒煙**

- D 從 MonthlyTools 查看 P_all：ActivityPlan 載入月曆、無 plan.errors 錯誤區塊、無 console error
- GET monthly/tools?op=activityDetail&id=<P_all>：D 200；G 403；未發布給店長的 P_sup 以 D 查 → 403/拒絕訊息
- 舊版 /activity-view/<P_all> 以 D 開啟：月曆、車次、行銷/商品區載入

**單元**

- lib/workspace/activity-plan.ts activityPlan() 的門市過濾（allowed set）：以 mock fetch 測各讀取器只回傳 storeIds 內門市；某讀取器 throw 時只填 errors[key] 其他資料仍在
- vue-workspace/src/activity-calendar-pdf.ts exportActivityCalendar：mock jsPDF 驗證檔名「活動名稱_活動排程.pdf」、A4 橫向、頁數=月份數（若函式依 DOM，於 Playwright 內測）
- 「僅看本店」過濾抽成 filterSchedulesByStore(schedules, storeId) 並對照舊版 searchParams 行為
- 設備車次套次配色：舊版 EQUIPMENT_SET_COLORS 與 Vue 配色映射函式比對（uncertain，需先讀兩邊實作）

**整合**

- 受眾矩陣同 /activity-management，改打舊版 GET /api/campaigns/[id]/view 與 Vue op=activityDetail，status 與 schedules 門市集合一致
- activityDetail 僅回傳活動排程內門市的 details/headcount/completions（以含非活動門市的子資料驗證不洩漏）
- 跨門市：D 以「僅看本店」查看時不可見其他門市細節的敏感欄位（記錄兩版實際行為）
- K 於檢視頁編輯支援回報（store_detail.edit）→ 200；D 無此權限 → 403
- 任一資料表缺資料（無車次、無行銷發布）→ 對應區塊空狀態，不整頁失敗

**E2E**

- D：開 P_all → 月曆顯示本店日期與特殊日期 → 切僅看本店 → 點門市開細節 → 開人力總覽(需 staff_overview.view，以有/無兩帳號驗證) → Check List 總覽 → 支援請求
- D：行銷部區看到內容與 2 張圖片預覽；商品部下載百貨配量 Excel（攔截 download，檔案可用 openpyxl 開啟且內容=上傳 fixture）
- D：匯出 PDF → 攔截 download，檔名正確、PDF 頁數=月份數、可解析出門市名稱文字（或至少非空）
- plan.errors 存在時（以權限缺某讀取器的帳號造成）PDF 按鈕 disabled

**對等驗證**

- 資料對等：同帳號 D，舊版頁面各 fetch 回應（view、event-dates、equipment-trips、department-publish、headcount、checklist）與 Vue activityDetail 對應欄位深比較（依門市過濾後）
- 月曆對等：擷取兩版月曆每日 (日期 → 門市名稱集合, 特殊日期說明, 車次)，正規化後比對
- PDF 對等：兩版 PDF 用 pdfplumber/pdf-parse 抽文字，比對每頁出現的門市名稱與日期集合；版面差異以截圖並排人工審視（不自動判定）
- 下載檔對等：兩版下載的百貨配量 Excel 與規則圖 SHA-256 相同

**測試資料**

- P_all 檔期跨兩個月（2099-11-20~2099-12-10），含 4 門市排程、2 套設備車次、3 checklist 項與部分完成紀錄、headcount、支援需求與支援人員、行銷部 2 圖、商品部滿額贈圖與 xlsx
- 1 筆 blocked 與 1 筆非 blocked 特殊日期落在期間內
- 帳號 D(店長 ZT901)、E(督導)、H(盤點組)、K、具 staff_overview.view 與不具的帳號、G

**風險**

- Vue 無獨立 URL，無法分享連結
- PDF 實作不同，版面一致性只能人工確認
- activityPlan 各讀取器部分失敗時只顯示 errors，可能掩蓋權限問題

## 領域測試備註

【測試架構總則（Opus 規劃，交 Sonnet 實作）】
1) 環境：DEV 連線在 .env.development.local（NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / EXPECTED_SUPABASE_PROJECT_REF / ALLOW_DEV_DATABASE_OPERATIONS）。所有寫 DB 的測試腳本開頭必須 assert：URL 內含 EXPECTED_SUPABASE_PROJECT_REF 且 ALLOW_DEV_DATABASE_OPERATIONS 為真，否則立即中止；絕不讀 .env.production.local。測試前先確認 supabase/workspace-dev/20261030000000_vue_campaign_operations.sql 已套用（查 campaigns.workspace_version 欄位、rpc workspace_campaign_replace / workspace_campaign_state / workspace_campaign_checklist_order 存在），未套用則測試標 BLOCKED 而非 FAIL。
2) 資料隔離：所有假資料名稱前綴 `ZZTEST-CAMP-<runId>`，門市代碼 `ZT9xx`，結束時依前綴清除（campaigns 刪除連帶 schedules 等；event_dates 用 2099 年日期避免撞到真資料，因 event_date 為 unique upsert 會覆蓋）。
3) 時區：舊版自動排程用 `new Date('YYYY-MM-DD')` + 本地 getDay()/setDate()（app/admin/activity-management/schedule/[id]/page.tsx 528-537、541-700 行），Vue 用 UTC（vue-workspace/src/campaign-scheduling.ts）。所有 Playwright 測試 context 必須 timezone_id='Asia/Taipei'；另加一個 negative 測試在 'America/Los_Angeles' 記錄舊版日期偏移（只記錄，不當成 Vue 缺陷）。
4) 權限基準差異是本領域最大對等風險，已用程式碼確認：
   - 舊版 /api/campaigns POST/PUT/DELETE、/api/event-dates POST/DELETE、/api/store-activity-settings POST/DELETE 皆用 profiles.role in ('admin','manager')（app/api/campaigns/route.ts 47/99/154 行、event-dates 47/101、store-activity-settings 50/107）。
   - Vue：/api/workspace/campaigns 用 CAMPAIGN_READ_CODES / CAMPAIGN_EDIT_CODES(activity.campaign.edit, activity.manage)（lib/workspace/server.ts 96-106）；campaign-tools 的 events/settings POST 不走舊 handler，自行 upsert 並以 edits map 的 RBAC 控制（app/api/workspace/campaign-tools/route.ts 22、40-49 行）。
   - 已發布活動：Vue 的 monthly/tools op=activity / activityDetail 先 permit('activity.management.access') 再呼叫舊版 published()/campaignView（後者再查 activity.campaign.view/view_all + 受眾）→ Vue 實際需要兩組權限，比舊版嚴格（app/api/workspace/monthly/tools/route.ts 83、90-91 行）。
   因此權限矩陣必須包含「role=manager 但無 activity.* RBAC」與「role=member 但有 activity.campaign.edit」兩種交叉帳號，並把差異以表格輸出，由人決定是否需要修正（不可在測試中自動當作 PASS）。
5) 資料寫入對等的正規化規則：store_activity_settings 舊版 notes 空字串存 null、allowed/forbidden 可能為 null；Vue 存 [] 與 ''。比對時 null≡[]、null≡''。event_dates 兩版皆 upsert onConflict event_date（已確認），同日重新新增為覆蓋。
6) 既有測試：scripts/test-workspace-campaign-scheduling.cjs（以 typescript transpile 方式 require Vue ts，可沿用此 pattern 做所有 unit）、test-workspace-campaign-api.py（含 origin 403、匿名 401、assets 上傳）、test-workspace-campaign-ui.py、test-workspace-campaign-assets-clean.cjs、test-workspace-monthly-activity.py。新增測試命名 scripts/test-workspace-campaign-parity-*.{cjs,py}，結果寫 .tmp-check/campaign/。
7) 共用角色帳號（DEV，前綴 zztest-camp-）：A admin(role=admin, 全 activity.*)；B 活動編輯(role=member, activity.campaign.edit)；C 唯讀(activity.campaign.view_all only)；D 店長(activity.campaign.view + activity.management.access，store_managers 對應門市 S1)；E 督導(activity.campaign.view + activity.management.access，督導 SV1 管 S1/S2)；F 跨區督導(SV2 管 S3/S4)；G 無權(無任何 activity.*)；H 盤點組(inventory_team 受眾)；I 行銷部(activity.marketing.publish)；J 商品部(activity.merchandise.publish)；K 門市細節編輯(activity.store_detail.edit)；L 設備車次(activity.equipment_trip.edit)；M Checklist(activity.checklist.edit)；N 支援(activity.support_request.edit + support_assign.edit)；X1 legacy-manager(role=manager，無 activity.* RBAC)；X2 rbac-only(role=member，有 activity.campaign.edit)；P 有 view 但無 management.access。
8) 已確認的已知差異（須在 parity 報告列為 KNOWN-DIFF，不視為測試失敗，但須交使用者裁決）：Vue 無「進行中」徽章/有 is_active；類型文字「促銷」vs「母親節/周年慶」；Vue 無行銷圖片拖曳排序；Vue CampaignSchedule 不依 inventory 隱藏促銷分頁；月曆週日起始且無督導區色；/activity-management 與 /activity-view/[id] 無獨立路由、無狀態徽章與發布標籤；年度篩選無「全部」。MAX_MARKETING_IMAGE_COUNT 舊版=8（page.tsx 194 行）與 Vue 8 張一致。
9) uncertain：舊版 CampaignStoreDetailModal / EquipmentTripEditor / ChecklistTemplateEditor / StoreSupportEditModal / SupportRequestModal / StaffOverviewModal / ChecklistOverviewModal 內部欄位未逐檔讀；Sonnet 實作 parity 前須先讀這些元件產出欄位清單再比對。test-workspace-campaign-ui.py 與 test-workspace-monthly-activity.py 斷言範圍未逐行確認，實作前先 grep 避免重複。

## 活動查看權限（view_own／view_all）移植到 Vue（CV01，2026-11-04）

- 規則來源只有 `lib/campaign-access.ts`（舊版 dc87ea4）；workspace 不複製規則：
  - `GET /api/workspace/campaigns` 的可見活動委派舊 `GET /api/campaigns`（權限閘門、發布閘門、view_all／編輯權看全部），本 API 只負責分頁、搜尋與欄位。
  - `/api/workspace/campaign-tools` 各分頁的讀取、店長可寫的五項資源（headcount、ownStaff POST／DELETE、completions、requests、supportStaff POST／DELETE）都直接呼叫舊 handler，由 `authorizeCampaignStoreWrite` 判斷；前置閘門不再要求持 edit 權（否則只有 view_own 的店長被擋，與舊版不同）。整批 PUT（RPC）與其他維護作業仍只開放 edit 權。
  - 支援需求 DELETE 不再走 admin client 的特例，改走舊 handler（會檢查任命門市）。
- 入口：`canEnterCampaignView(ctx.auth, userId)`。session `capabilities.campaignView`、導覽「活動檢視」（/activity-management，連到舊頁）、monthly tools `capabilities.activity`／`op=activity`／`op=activityDetail` 都用它，不再看 `activity.management.access`（該碼保留給其他功能，例如行銷部判斷）。
- 權限碼常數：`CAMPAIGN_READ_CODES`（API 閘門，含 view_own）與 `CAMPAIGN_PAGE_CODES`（活動管理頁入口，不含 view_own，避免全員預設角色持 view_own 時看到管理頁）。
- 權限頁（Roles.vue）：規則抽到 `vue-workspace/src/role-scope.ts`。`activity.campaign.view_own` 顯示「查看自己管理門市」，`view_all`「查看全部」，舊 `view`「（舊）查看，將停用」且不計入互斥查看範圍；快速預設反映實際勾選範圍。
- 測試：`tests/*/CV01.*`（unit／smoke／integration／e2e／parity）；parity 對舊版 matrix 角色逐項比對可見活動、各分頁可見門市、入口與寫入允許與否。403 與 404 同視為「拒絕」。

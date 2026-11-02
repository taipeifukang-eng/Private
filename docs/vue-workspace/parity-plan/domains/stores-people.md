# 門市、店長、督導、員工、人事異動、升遷、調店

## 領域共用缺口

- 歷史異動編輯與刪除缺口（影響 /admin/promotion-management）：需新增 workspace API（PATCH、DELETE 或 RPC 版本）、Vue UI 與權限對應（employee.movement.manage／employee.manage／employee.promotion.batch 編輯；employee.promotion.delete 刪除），並移植舊 app/api/employee-movements/[id]/route.ts 的回復邏輯與日期驗證（lib/employee-movement-date.ts 已存在可共用）。
- 員編格式規則需決策：舊版 FK+4碼／FKF+5碼／FKPT+3碼／FKI+3碼（FKI 需確認），Vue 版 ^[A-Z0-9_-]{1,20}$（EmployeeCreate.vue 與 supabase/workspace-dev/20261029100000_vue_employee_create.sql）。建議抽成共用驗證放進 lib/workspace，同時用於新增員工、批次異動入職、員工匯入。
- 權限模型差異：舊版多數員工與升遷頁面用 profile.role、department、job_title（admin、營業部 member／manager、非指派職稱），Vue 版用 RBAC 代碼（employee.manage、employee.promotion.batch 等）加 canReadStorePersonnel。需要建立角色對照表並用多種身份（admin、營業助理、營業主管、督導、店長、一般員工）在 DEV 資料上跑權限矩陣；既有 scripts/seed-workspace-promotion-permissions-dev.cjs、seed-workspace-store-permissions-dev.cjs 可延用。
- 批次語意差異：Vue 版匯入員工、批次異動、批次升遷都改成整批原子與預先驗證；舊版為逐列容錯。需使用者確認接受，並在測試計畫明確寫出預期行為。
- 共用元件：Modal.vue、StoreGps.vue、TopScrollTable.vue；共用邏輯 lib/workspace/server.ts（context、requireCapability、checkOrigin）、lib/workspace/store-personnel.ts、employee-movements.ts、movement-*.ts、transfers.ts。
- 測試缺口：現有測試多為 Python Playwright 與 Node 腳本且針對 DEV 資料；缺少『新舊版同輸入同輸出』的對照測試（parity test），例如同一批 Excel 丟給 /api/import-employees 與 /api/workspace/employee-import、同一組異動分別送 /api/employee-movements/batch 與 /api/workspace/movement-submit 後比對資料表結果；也缺少真正串起門市建立、員工匯入、異動、調店的端對端流程測試，以及不依賴 DEV 資料的 smoke 測試（只有 scripts/test-rbac-admin-routes-smoke.js 可參考）。
- route-inventory.json 狀態欄已過時：本次以程式碼為準，全部 12 個舊版路由（含 8 個 /admin/stores 子頁）除 /admin/employee-management 與 /admin/promotion-management 外，功能均已有 Vue 版；文件不可直接採信。
- 舊版死碼：app/store/actions.ts 的 cloneStore 沒有任何呼叫者，/api/employees/list 頁面未使用，不需復刻；/admin/stores/[id]/clone 實際為搬遷與沿革頁。
- 尚待決策的顯示差異（低風險）：已停止門市數量顯示、店長指派時的『已有店長』提示、督導頁統計卡（經理人數、督導人數、門市總數）、門市地圖預設是否包含已停止門市。

## /admin/stores

- 狀態：**done**（S）— Stores.vue 呼叫 api('stores')，列表欄位、已停止門市切換、新增、編輯、員工、搬遷、地圖入口都有對應。只有一處顯示差異：舊版在『顯示已停止』按鈕上帶有數量。另有新增的搜尋框與批次升遷、員工主檔入口。
- 舊版：`app/admin/stores/page.tsx`
- Vue：`vue-workspace/src/pages/Stores.vue`
- 權限：store.store.view、store.store.view_inactive、store.store.create、store.store.edit、store.store.clone、store.manage
- 相依：共用元件 Modal.vue、StoreGps.vue、session capabilities（vue-workspace/src/stores.ts）

**舊版功能**

- 門市列表（代碼、名稱、簡稱、負責人、地址、電話、員工數、狀態），依 store_code 排序
- 加盟店標籤；顯示 store_managers 指派的店長姓名
- 員工數取各店最新月份 monthly_staff_status 中非 resigned 的人數
- 『顯示/隱藏已停止 (N)』切換，需 store.store.view_inactive
- Google 地圖按鈕（連到 /admin/stores/map）
- 新增門市按鈕（需 store.store.create）
- 列上操作：編輯（store.store.edit）、員工、搬遷（僅營運中且有 store.store.clone）
- 表尾統計（共 N 間，含已停止數量）
- 沒有門市時的空狀態；沒有任何門市相關權限就導回 /dashboard

**缺少或不同**

- 舊版『顯示已停止』按鈕與表尾顯示已停止門市數量，Vue 版只有勾選框，沒有數量（Stores.vue）
- 舊版對已停止門市不提供搬遷按鈕；Vue 版改成『查看沿革』，是功能增加，不是缺漏
- Vue 版新增搜尋框、批次升遷、員工主檔／歷程入口；屬於增強，不需移除

**業務規則**

- （無）

**API**：舊 Server Component 直接查 Supabase（無 REST API）；新 GET/POST /api/workspace/stores（RPC workspace_store_catalog、workspace_store_history、workspace_store_mutate）、app/api/workspace/stores/route.ts

**資料表**：stores、store_managers、profiles、monthly_staff_status

**既有測試**：scripts/test-workspace-stores.py、scripts/test-workspace-stores-create.py、scripts/test-workspace-stores-permissions.py、scripts/apply-workspace-stores-dev.cjs、scripts/cleanup-workspace-stores-dev.cjs、scripts/seed-workspace-store-permissions-dev.cjs、scripts/test-store-scope-management-rbac.js

**待確認**

- 舊版以 RLS 的 supabase client 查詢，Vue 版以 service-role 的 workspace_store_catalog RPC 查詢，兩邊對同一使用者可見的門市範圍是否完全相同，沒有逐一核對 RPC 內的過濾條件

### 測試案例

**冒煙**

- R-admin 開啟工作台門市頁（Stores.vue）：表格有資料列，且 ZT901、ZT902、ZT904 依 store_code 排序；console error 為 0，/api/workspace/stores 回 200
- R-viewer 開啟：看得到列表，但看不到新增、編輯、搬遷按鈕；看不到『顯示已停止』勾選（沒有 view_inactive）
- R-staff：導覽中沒有門市管理；直接打 GET /api/workspace/stores 應回 403（對應舊版導回 /dashboard）
- 導覽可見性：R-admin、R-sales-member、R-viewer 可見，R-staff 不可見，與舊版 Navbar 比對

**單元**

- vue-workspace/src/pages/Stores.vue 的搜尋過濾與已停止過濾若是 inline computed，建議抽成 filterStores(rows, {query, showInactive}) 再測：代碼、名稱、簡稱、負責人可搜尋，大小寫不敏感，已停止門市只在 showInactive 時出現
- 員工數計算：抽出『各店最新月份 monthly_staff_status 中非 resigned 的人數』邏輯（若在 RPC workspace_store_catalog 內，改用 integration 驗證），測試案例：同店有 2026-09、2026-10 兩個月時只算 10 月；resigned 不計入；沒有月份資料時為 0

**整合**

- GET /api/workspace/stores 角色矩陣：R-admin 回全部（含 ZT903 需帶 inactive 參數）；R-viewer 回營運中，帶 inactive 參數時不得回 ZT903（因為沒有 view_inactive）；R-staff 回 403；未登入回 401
- 回傳欄位驗證：ZT904 is_franchise=true；ZT901 的店長姓名等於 store_managers 指派的 R-store-manager-A 姓名；員工數等於 seed 的非 resigned 人數
- 可見範圍比對（uncertain 項）：以 R-store-manager-A 與 R-supervisor 分別用舊版 RLS client 查 stores（supabase-js 以該使用者 session 登入）以及 workspace_store_catalog，比對兩邊 store_code 集合是否相同
- POST 時 checkOrigin：帶錯誤的 Origin header 應回 403

**E2E**

- R-admin：開門市頁 → 搜尋 'ZT90' → 勾選顯示已停止 → ZT903 出現且狀態為已停止 → ZT903 列上沒有搬遷按鈕，但有查看沿革 → 點 ZT901 的『員工』開啟 StoreEmployees 分頁 → 點地圖入口開啟 StoreMap

**對等驗證**

- 同一 DEV 資料、R-admin：用 Playwright 抓舊版 /admin/stores 表格（代碼、名稱、簡稱、負責人、地址、電話、員工數、狀態），再抓 Vue 版相同欄位，依 store_code 排序後 deepEqual（篩選 ZT 前綴）
- 表尾統計：舊版『共 N 間、已停止 M 間』與 Vue 版筆數比對；已停止數量的顯示差異列入 allowlist，待使用者決定

**測試資料**

- stores：ZT901（營運中）、ZT902（營運中）、ZT903（is_active=false）、ZT904（加盟店）
- store_managers：ZT901→R-store-manager-A、ZT902→R-store-manager-B
- monthly_staff_status：ZT901 在 2026-09 有 3 人、2026-10 有 4 人（其中 1 人 resigned）
- 角色：R-admin、R-viewer、R-staff、R-store-manager-A、R-supervisor

**風險**

- RLS 與 service-role RPC 的可見範圍可能不同，店長或督導可能看到比舊版更多的門市

## /admin/stores/create

- 狀態：**done**（S）— StoreEditor.vue 在沒有 recordId 時進入新增模式。欄位、必填檢查、GPS 成對驗證與範圍檢查都一致，伺服器端也有同樣的驗證與唯一代碼衝突處理（23505）。
- 舊版：`app/admin/stores/create/page.tsx、app/store/actions.ts#createStore`
- Vue：`vue-workspace/src/pages/StoreEditor.vue（recordId 為空時為新增）`、`vue-workspace/src/components/StoreGps.vue`
- 權限：store.store.create、store.manage
- 相依：Stores.vue（入口）、StoreGps.vue

**舊版功能**

- 欄位：門市代碼*、門市名稱*、加盟店、簡稱、人資門市代碼、負責人、地址、電話
- GPS 緯度／經度（-90~90、-180~180，需成對或同時留空），含定位輔助（StoreGpsFields）
- 送出後顯示成功並回列表，代碼重複時顯示錯誤
- 權限：store.store.create 或 store.manage

**缺少或不同**

- 舊版建立後回到列表；Vue 版建立後留在頁籤並轉成編輯狀態（互動不同，非缺漏）
- 舊版 GPS 輔助元件的各項行為（瀏覽器定位、訊息）需與 StoreGps.vue 逐項比對；已有 test-workspace-store-map-coordinates.cjs 可覆蓋座標驗證

**業務規則**

- （無）

**API**：舊 server action createStore（app/store/actions.ts）；新 POST /api/workspace/stores operation=create（RPC workspace_store_mutate）

**資料表**：stores

**既有測試**：scripts/test-workspace-stores-create.py、scripts/test-workspace-store-map-coordinates.cjs

**待確認**

- 未逐行比對 StoreGpsFields.tsx（191 行）與 StoreGps.vue 的瀏覽器定位錯誤訊息

### 測試案例

**冒煙**

- R-sales-member 從門市頁點新增，StoreEditor.vue 以新增模式開啟，所有欄位為空，console error 為 0
- R-viewer 看不到新增按鈕；直接 POST operation=create 回 403

**單元**

- StoreGps.vue 或 StoreEditor.vue 的座標驗證抽成 validateGps(lat, lng)：兩欄皆空回 ok；只填一欄回錯誤；lat=90.0001 回錯誤；lng=-180 回 ok；非數字字串回錯誤（已有 scripts/test-workspace-store-map-coordinates.cjs，擴充邊界值）
- 必填驗證：store_code、store_name 去空白後為空回錯誤

**整合**

- POST /api/workspace/stores operation=create：R-sales-member 建立 ZT910 成功，DB 的 stores 各欄位與送出值一致（含 hr_store_code、is_franchise、GPS）
- 重複代碼：再次建立 ZT901，應得到 23505 對應的友善錯誤（4xx，非 500），DB 筆數不變
- 伺服器端 GPS 驗證：繞過 UI 直接送 lat=95 回 400；只送 lat 回 400
- 權限：R-viewer、R-staff 回 403；沒有 store.store.create 但有 store.manage 的角色可以建立
- 並行：兩個請求同時建立 ZT911，只能有一筆成功，另一筆回衝突錯誤

**E2E**

- R-sales-member：新增 → 填 ZT912、名稱、簡稱、地址、電話、GPS（25.04, 121.56）→ 儲存 → 看到成功訊息，分頁轉為編輯模式 → 回門市列表能搜尋到 ZT912
- 錯誤路徑：只填緯度就儲存，畫面顯示成對錯誤且沒有送出 API 請求

**對等驗證**

- 同一組輸入（ZT913），分別用舊版 server action createStore（透過舊版 /admin/stores/create 頁面送出）與 Vue POST 建立，cleanup 之間重新 seed，比對 stores 列（排除 id、created_at）完全相同
- 錯誤訊息比對：重複代碼、GPS 錯誤時兩版都拒絕寫入（文字可不同，但 DB 結果必須一致）

**測試資料**

- 既有 ZT901 用於測重複代碼；新代碼 ZT910～ZT913 用後清除
- 角色：R-sales-member、R-viewer、R-staff，以及一個只有 store.manage 的帳號

**風險**

- StoreGpsFields.tsx 與 StoreGps.vue 的瀏覽器定位錯誤訊息未逐行比對；e2e 用 context.grant_permissions(['geolocation']) 與 set_geolocation 模擬定位，另用拒絕權限情境驗證錯誤訊息

## /admin/stores/map

- 狀態：**done**（S）— StoreMap.vue 有左側門市清單、搜尋、標記與資訊視窗、顯示全部、載入失敗重試，計數文字也對應。只有『顯示已停止』的預設行為不同。
- 舊版：`app/admin/stores/map/page.tsx、components/admin/StoreGoogleMapClient.tsx`
- Vue：`vue-workspace/src/pages/StoreMap.vue`、`vue-workspace/src/google-maps.ts`
- 權限：store.store.view、store.store.view_inactive、store.manage
- 相依：環境變數 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY、Stores.vue

**舊版功能**

- 左側門市清單（代碼、簡稱／名稱、地址、電話）加搜尋（代碼、名稱、地址、電話）
- Google Maps 標記，點選後平移並顯示資訊
- 統計：已設定 GPS、尚未設定、目前顯示
- 沒有 GPS 的門市不顯示於地圖
- 返回門市管理；無 store.store.view 權限導回 /dashboard

**缺少或不同**

- 舊版查詢包含已停止門市，沒有過濾；Vue 版預設只顯示營運中，需有 view_inactive 且勾選才顯示已停止（app/api/workspace/store-map/route.ts，同時有 20261028170000_vue_store_map_inactive.sql），屬刻意的行為差異，需和使用者確認是否要與舊版一致
- Vue 版另有 Google 授權錯誤與載入逾時處理與 mapId，是增強

**業務規則**

- （無）

**API**：舊 Server Component 直接查 stores；新 GET /api/workspace/store-map

**資料表**：stores

**既有測試**：scripts/test-workspace-store-map.py、scripts/test-workspace-store-map-api.py、scripts/test-workspace-store-map-real.py、scripts/test-workspace-store-map-coordinates.cjs、scripts/store-map-sdk-test-double.js、scripts/seed-workspace-store-map-dev.cjs、scripts/cleanup-workspace-store-map-dev.cjs

**待確認**

- 真實 Google 地圖需要有效金鑰，已有 SDK 測試替身（store-map-sdk-test-double.js）可供自動化測試

### 測試案例

**冒煙**

- 使用 scripts/store-map-sdk-test-double.js 替身時，R-viewer 開 StoreMap.vue：左側清單有 ZT901、ZT902，統計顯示已設定 GPS、尚未設定、目前顯示，console error 為 0
- R-staff：GET /api/workspace/store-map 回 403

**單元**

- 搜尋過濾（代碼、名稱、地址、電話）若在 StoreMap.vue 內，抽成純函式測試；統計函式：GPS 為 null 的門市計入未設定，且不產生 marker

**整合**

- GET /api/workspace/store-map：R-viewer 不含 ZT903；具 view_inactive 的帳號帶 inactive=1 才包含 ZT903；未帶參數時不含
- 沒有 GPS 的 ZT902（seed 時把 GPS 設為 null）出現在清單計數中，但 marker 資料中沒有它

**E2E**

- R-admin（使用 SDK 替身）：搜尋 'ZT901' → 清單剩 1 筆 → 點擊後 InfoWindow 顯示代碼與地址 → 按顯示全部恢復 → 勾選顯示已停止後，ZT903 出現
- 載入失敗：讓替身模擬 SDK 載入失敗，畫面出現錯誤與重試按鈕，按下後恢復

**對等驗證**

- 舊版 /admin/stores/map 與 Vue 版在同一資料下，比對左側清單的 store_code 集合與三個統計數字；預設是否含已停止門市列為已知差異（待決策）：若使用者要求一致，則改成比對舊版與 Vue『勾選已停止後』的結果

**測試資料**

- ZT901（有 GPS）、ZT902（無 GPS）、ZT903（已停止且有 GPS）
- NEXT_PUBLIC_GOOGLE_MAPS_API_KEY 用替身時可用假值

**風險**

- 真實 Google Maps 需要有效金鑰，CI 一律用替身；scripts/test-workspace-store-map-real.py 只在手動驗證時執行

## /admin/stores/[id]/edit

- 狀態：**done**（S）— StoreEditor.vue 載入既有資料後欄位完整，代碼唯讀，有 is_active 切換，停止營運時要確認，並多了版本衝突偵測（expected 版本、409）。
- 舊版：`app/admin/stores/[id]/edit/page.tsx、app/store/actions.ts#getStoreForAdminEdit/updateStore`
- Vue：`vue-workspace/src/pages/StoreEditor.vue`、`vue-workspace/src/components/StoreGps.vue`
- 權限：store.store.edit、store.store.view、store.manage
- 相依：Stores.vue、StoreGps.vue、Modal.vue

**舊版功能**

- 載入門市資料；找不到門市時提示並導回列表
- 門市代碼唯讀；可改名稱、加盟店、簡稱、人資門市代碼、負責人、地址、電話、GPS、營運中狀態
- 名稱必填、GPS 成對與範圍驗證
- 儲存成功後回列表
- 權限 store.store.edit（讀取用 view 或 edit）

**缺少或不同**

- Vue 版停用門市時多一個確認對話框與樂觀鎖，屬增強
- 舊版 updateStore 是否同步其他表（如 monthly 或報表的門市名稱）需確認 app/store/actions.ts 第 196~265 行之後的副作用，Vue 版由 RPC workspace_store_mutate 處理，未逐行比對

**業務規則**

- （無）

**API**：舊 server action getStoreForAdminEdit、updateStore；新 GET /api/workspace/stores?id=、POST /api/workspace/stores operation=edit

**資料表**：stores

**既有測試**：scripts/test-workspace-stores.py、scripts/test-workspace-stores-permissions.py

**待確認**

- updateStore 在 actions.ts 內是否有其他表同步，需讀取 lines 233-262 才能確認；本次只核對到欄位層級

### 測試案例

**冒煙**

- R-sales-member 從列表點 ZT901 編輯，StoreEditor 欄位帶入既有值，門市代碼唯讀，console error 為 0
- 不存在的 id：GET /api/workspace/stores?id=<random uuid> 回 404，UI 顯示找不到門市

**單元**

- 與新增相同的 GPS 與必填驗證；停用確認的判斷（is_active 由 true 改為 false 時要求確認）抽成 needsDeactivateConfirm(before, after)

**整合**

- POST operation=edit 帶正確 expected 版本：成功並更新 stores；帶舊 expected：回 409，DB 不變
- 並行：兩個 session 以同一 expected 同時編輯，只能有一個成功，另一個回 409
- 嘗試修改 store_code（繞過 UI 送不同代碼）：伺服器忽略或拒絕，DB 的代碼不變
- 權限：R-viewer 可 GET 但 POST 回 403；R-staff 的 GET 也回 403
- 副作用核對（uncertain）：先讀 app/store/actions.ts updateStore 第 196-265 行，若舊版會同步其他表（例如 monthly 門市名稱），在 Vue 編輯後查同一張表，確認有同步

**E2E**

- R-sales-member：編輯 ZT902 → 改名稱與電話 → 儲存 → 列表顯示新名稱
- 停用流程：取消營運中 → 出現確認對話框 → 取消時狀態不變 → 再次確認並儲存 → 列表預設不再顯示 ZT902，勾選已停止後出現

**對等驗證**

- 同一組修改（名稱、簡稱、人資代碼、負責人、地址、電話、GPS、is_active），分別用舊版 updateStore 與 Vue 版 edit 寫入，比對 stores 列以及 updateStore 可能觸及的其他表快照

**測試資料**

- ZT902 每次測試前重設為營運中
- 角色：R-sales-member、R-viewer、R-staff

**風險**

- updateStore 的跨表副作用尚未確認

## /admin/stores/[id]/clone

- 狀態：**done**（S）— 頁面實際功能是門市搬遷與搬遷沿革，不是複製門市。StoreRelocation.vue 具備搬遷（新代碼、名稱、簡稱、人資代碼、負責人、日期、備註）、補建沿革、刪除沿革、刪除後帶入重填，並有伺服器端的未變更與已停止門市檢查。
- 舊版：`app/admin/stores/[id]/clone/page.tsx、app/store/actions.ts#relocateStore/getStoreRelocationHistory/createStoreRelocationHistory/deleteStoreRelocationHistory`
- Vue：`vue-workspace/src/pages/StoreRelocation.vue（含 store-history-editor 模式）`
- 權限：store.store.clone、store.manage
- 相依：Stores.vue、Modal.vue

**舊版功能**

- 顯示目前門市資訊（代碼、名稱、簡稱、人資代碼、負責人、地址、狀態）
- 搬遷表單：新代碼*、名稱*、簡稱、人資代碼、負責人、搬遷日期*、備註；無變更時拒絕；新代碼重複時拒絕
- 搬遷會更新 stores 並寫入 store_relocation_history（保留門市 ID）
- 搬遷歷史列表
- 補建歷史（手動輸入搬遷前後完整資料與日期、備註）
- 刪除歷史（會導向重填）
- 權限 store.store.clone

**缺少或不同**

- 舊版的 server action cloneStore（複製門市與店長、員工）沒有任何頁面呼叫（已 grep app 與 components 確認），屬死碼，不需復刻
- Vue 版把已停止門市的搬遷限制為不可搬遷、只可看沿革，舊版頁面入口只對營運中門市顯示，行為一致

**業務規則**

- （無）

**API**：舊 server action relocateStore、createStoreRelocationHistory、deleteStoreRelocationHistory、getStoreRelocationHistory；新 GET /api/workspace/stores?id=（含 history）、POST /api/workspace/stores operation=relocate | history-add | history-delete

**資料表**：stores、store_relocation_history

**既有測試**：scripts/test-workspace-stores.py、scripts/test-workspace-stores-permissions.py、scripts/apply-workspace-stores-dev.cjs

**待確認**

- relocation 後下游資料（月報、督導日誌等以 store_code 顯示的地方）是否需要同步，兩版都只改 stores，未見差異，但沒有逐表驗證

### 測試案例

**冒煙**

- R-sales-member 開啟 ZT901 搬遷頁（StoreRelocation.vue）：顯示目前資訊與沿革清單，console error 為 0
- ZT903（已停止）只能看沿革，不出現搬遷表單

**單元**

- 搬遷『無變更』判斷：新代碼、名稱、簡稱、人資代碼、負責人都與目前相同時拒絕；若邏輯在 SQL，則改在 integration 測
- 必填（新代碼、名稱、日期）與日期格式驗證；可共用 lib/employee-movement-date.ts 的 getMovementDateError 確認四位數年份

**整合**

- POST operation=relocate：ZT901 → ZT921，stores.id 不變、store_code 更新，store_relocation_history 新增一筆，前後值正確
- 新代碼與 ZT902 重複時回錯誤，兩張表都不變；所有欄位都未變更時回錯誤
- 對 ZT903 relocate 回錯誤
- history-add 補建一筆，再 history-delete，DB 都正確；刪除不存在的 id 回 404
- 權限：沒有 store.store.clone 的 R-viewer 回 403
- 並行：同時對 ZT901 發兩次 relocate，只能有一筆成功，不會出現兩筆歷史

**E2E**

- R-sales-member：搬遷 ZT901 到 ZT921（填日期與備註）→ 確認 → 沿革出現一筆 → 刪除該筆沿革 → 確認後表單帶入原值供重填 → 補建一筆歷史 → 沿革列表更新

**對等驗證**

- 同一搬遷輸入分別用舊版 relocateStore 與 Vue relocate 執行，比對 stores 與 store_relocation_history 快照（排除 id、時間戳）
- 補建與刪除沿革也各比對一次
- 確認舊版 cloneStore 是死碼：用 grep 確認沒有呼叫者，不列入 parity 測試

**測試資料**

- ZT901 每次測試前還原代碼；ZT903 已停止；預先在 ZT902 seed 一筆 store_relocation_history

**風險**

- 月報、督導日誌等用 store_code 顯示的下游資料，兩版都沒有同步；可用一個查詢確認搬遷後舊代碼的紀錄仍能透過 store_id 關聯

## /admin/stores/[id]/employees

- 狀態：**done**（S）— 月份選擇、在職與離職統計、顯示離職勾選、員編、姓名、藥師標記、職位、全職或兼職、本月狀態都已對應；職位排序與狀態標籤也有實作，另外多了搜尋與月份人員狀態入口。
- 舊版：`app/admin/stores/[id]/employees/page.tsx`
- Vue：`vue-workspace/src/pages/StoreEmployees.vue`
- 權限：store.store.view、store.store.view_inactive、store.store.create、store.store.edit、store.store.clone、store.manage、monthly.status.view_all、monthly.status.view_own
- 相依：Stores.vue、Monthly.vue（開啟每月人員狀態）

**舊版功能**

- 門市名稱與代碼標題
- 月份下拉（來自 monthly_staff_status 的 year_month 倒序）
- 說明橫幅並連到每月人員狀態
- 統計：在職 N 人、含離職 N 人；『顯示離職員工』勾選
- 表格：員編、姓名（藥師標籤）、職位、類型（全職／兼職）、本月狀態（有狀態標籤）
- 沒有月份資料時的空狀態與前往每月人員狀態按鈕

**缺少或不同**

- 舊版在客戶端以排序清單呈現，Vue 版在客戶端用自訂職位順序排序，需確認與舊版排序一致（舊版排序函式在 page.tsx 約 130-150 行，Vue 版 positions 陣列）
- Vue 版新增搜尋，並且只在使用者有 monthly.status.view_all 或自己是該店店長時才顯示開啟月份人員狀態

**業務規則**

- （無）

**API**：舊 瀏覽器端直接查 Supabase；新 GET /api/workspace/store-employees

**資料表**：stores、monthly_staff_status、store_managers

**既有測試**：scripts/test-workspace-store-employees.py、scripts/seed-workspace-store-employees-dev.cjs、scripts/cleanup-workspace-store-employees-dev.cjs、scripts/test-dev-store-employee-compatibility.js

**待確認**

- 舊版頁面沒有顯式權限檢查，只靠 RLS 與登入；Vue 版要求店務相關權限，兩版可存取對象可能不同

### 測試案例

**冒煙**

- R-sales-member 開 ZT901 員工分頁：月份下拉預設最新月份，在職與離職統計正確，console error 為 0
- R-store-manager-A 開 ZT901 看得到『開啟月份人員狀態』；R-store-manager-B 開 ZT901 看不到這個入口

**單元**

- vue-workspace/src/pages/StoreEmployees.vue 的 rank()、rows 排序與過濾抽成 sortStoreEmployees(records, {showResigned, query})。測試：positions 陣列要與舊版 POSITION_ORDER（app/admin/stores/[id]/employees/page.tsx 第 33 行起）逐項一致，包含不在清單中的職位排到 999；同職位依姓名 zh-TW 排序；同職位同姓名時，Vue 多用 employee_code 排序（舊版不保證順序，標為允許差異）
- activeCount 與 resignedCount 計算

**整合**

- GET /api/workspace/store-employees?id=ZT901&month=2026-10：回傳筆數與 monthly_staff_status 相同；月份清單倒序
- 角色矩陣：R-admin 可以；R-viewer 可以；R-store-manager-A 對 ZT901 可以；R-store-manager-B 對 ZT901 依設計（記錄實際結果並與舊版 RLS 比對）；R-staff 回 403
- 沒有月份資料的店（ZT904）回空陣列，不得回 500

**E2E**

- R-sales-member：開 ZT901 → 切換到 2026-09 → 人數改變 → 勾選顯示離職後出現 resigned 員工 → 搜尋員編 → 點開啟月份人員狀態後跳到 Monthly.vue，並帶入正確門市與月份
- ZT904 顯示空狀態與前往每月人員狀態按鈕

**對等驗證**

- 同一資料用 R-admin 抓舊版與 Vue 版表格（員編、姓名、藥師、職位、類型、本月狀態），在 showResigned 的兩種狀態下各比對一次，順序也要一致（同職位同姓名的情境除外）
- 權限比對：舊版頁面只靠 RLS；用 R-store-manager-B、R-staff 分別開兩版，記錄能否看到資料，任何不一致都要回報給使用者決策

**測試資料**

- ZT901 的 monthly_staff_status：2026-09、2026-10 兩個月，包含店長、副店長、新人、兼職藥師（is_pharmacist=true）、不在職位清單內的『外包』職位、resigned 員工各一筆，另有兩位同為專員且同姓名的員工
- ZT904 沒有任何月份資料

**風險**

- 舊版沒有顯式權限檢查，兩版可存取對象可能不同

## /admin/stores/[id]/employee-management

- 狀態：**done**（S）— 員工主檔列表（員編、姓名、目前職位、到職日、最後升遷日）與每位員工的升遷／異動歷程（日期、舊值→新值、備註）都有；權限判斷用 canReadStorePersonnel，與舊版 admin 或營業部 member／manager 且職稱非督導店長一致。
- 舊版：`app/admin/stores/[id]/employee-management/page.tsx`
- Vue：`vue-workspace/src/pages/StorePersonnel.vue（含 store-personnel-history 模式）`
- 權限：store.store.view（及相關）、角色條件：profiles.role=admin 或 department 以『營業』開頭且 role 為 member／manager 且 job_title 非指派職位
- 相依：Stores.vue

**舊版功能**

- 權限：admin、營業部 member 或 manager（且職稱不是督導／店長／代理店長／督導(代理店長)），否則提示權限不足並返回
- 門市員工主檔列表（含離職），欄位：員編、姓名、職位、到職日期、最後升遷日期
- 每位員工『升遷歷程』：目前職位、歷史記錄（舊值 → 新值、日期、備註）
- 返回按鈕

**缺少或不同**

- 舊版歷程只讀 employee_movement_history 且依 employee_code 查詢；Vue 版加上 store_id 條件，只顯示該門市的異動，與舊版（所有門市）範圍不同，需確認是否要保持一致（app/api/workspace/store-personnel/route.ts 的 .eq('store_id', id)）
- Vue 版歷程標籤用 formatPromotionPosition，舊版也是，一致

**業務規則**

- （無）

**API**：舊 瀏覽器端直接查 Supabase；新 GET /api/workspace/store-personnel、lib/workspace/store-personnel.ts

**資料表**：stores、store_employees、employee_movement_history、profiles

**既有測試**：scripts/test-workspace-store-personnel.py、scripts/cleanup-workspace-store-personnel-dev.cjs、scripts/seed-workspace-store-personnel-dev.cjs

**待確認**

- 歷程只列同店異動是否為刻意設計，文件中未找到明確依據

### 測試案例

**冒煙**

- R-sales-member 開 ZT901 人員主檔（StorePersonnel.vue）：列表包含離職員工，console error 為 0
- R-sales-trap（營業部 member 但職稱為店長）被拒絕，顯示權限不足；R-staff 被拒絕

**單元**

- lib/workspace/store-personnel.ts canReadStorePersonnel：admin → true；營業部 member 或 manager 且職稱為一般職稱 → true；職稱為督導、店長、代理店長、督導(代理店長) → false；部門為『營業二部』這類以營業開頭的值 → true；部門為『財務部』 → false；role 為 supervisor → false。用這張表與舊版 page.tsx 的判斷式並列，跑同一組輸入，結果必須一致

**整合**

- GET /api/workspace/store-personnel?id=ZT901：欄位包含員編、姓名、職位、到職日、最後升遷日；超過 500 人時分頁正確（seed 0 筆或用現有分段邏輯測 range）
- 帶 employeeId 查歷程：回傳 employee_movement_history 依日期倒序
- 跨店歷程：FK9001 在 ZT901 與 ZT902 都有異動，Vue 只回 ZT901 的紀錄（第 19 行 .eq('store_id', id)），舊版會回全部；依使用者決策設定預期值
- 角色矩陣：R-admin、R-sales-member、R-sales-manager 200；R-sales-trap、R-supervisor、R-store-manager-A、R-staff 403

**E2E**

- R-sales-member：開 ZT901 人員主檔 → 點 FK9001 的歷程 → 顯示目前職位與舊值 → 新值、日期、備註 → 關閉 → 返回門市列表

**對等驗證**

- 同一資料抓舊版與 Vue 版主檔表格比對；歷程比對時，若決策為『沿用舊版』，則兩版筆數應相同；若決策為『只看同店』，則 Vue 等於舊版結果過濾 store_id 後的子集，列入 allowlist
- 權限：用 9 種角色帳號分別開兩版，結果表格（可進入或被拒）必須完全相同

**測試資料**

- ZT901 store_employees 5 人（含 1 名離職）；FK9001 在 ZT901 有 promotion，在 ZT902 有 transfer 的歷程
- 角色：全部 9 個，特別是 R-sales-trap

**風險**

- 歷程只看同店是否為刻意設計，尚未確認

## /admin/stores/[id]/promotion-management

- 狀態：**done**（M）— 批次升遷列、新人階段（另有行政階級）、Excel 匯入與範本、驗證、確認儲存、同步月份職位都有，且多了伺服器端驗證預覽與未來日期排程。權限來源不同（見差異）。
- 舊版：`app/admin/stores/[id]/promotion-management/page.tsx、app/api/promotions/batch/route.ts`
- Vue：`vue-workspace/src/pages/StorePromotions.vue`
- 權限：employee.promotion.batch、角色條件（舊版）：admin、營業部 member／manager
- 相依：Stores.vue 入口、員工主檔 store_employees

**舊版功能**

- 權限：admin、營業部助理或主管（同 employee-management 條件）
- 可新增／刪除列（至少保留一列），欄位：員編、姓名、職位、新人階段（職位為新人時必填）、生效日、備註
- 前端驗證（缺員編、姓名、職位、新人階段、生效日）
- 確認後 POST /api/promotions/batch，成功顯示筆數並自動更新對應月份職位
- 匯入 Excel（員編、姓名、職位、新人階段／新人等級、生效日、備註）
- 下載『升遷匯入範本』
- 說明文字：生效日格式 YYYY/MM/DD 或 YYYY-MM-DD

**缺少或不同**

- 權限來源不同：舊頁面看 profile role／department／job_title；舊 API 另外只允許 role 為 admin、manager、supervisor、area_manager（app/api/promotions/batch/route.ts 第 27 行）；Vue 版是 employee.promotion.batch 加 canReadStorePersonnel，授權對象需在 DEV 角色資料上驗證等價
- Vue 版匯入時由伺服器解析 Excel，範本是 /api/workspace/store-promotions?template=true，不是前端 xlsx 產生
- Vue 版多了 500 列上限、版本 expected 與 requestId 冪等、行政階級選項

**業務規則**

- （無）

**API**：舊 POST /api/promotions/batch；新 GET/POST /api/workspace/store-promotions（RPC workspace_promotion_save、workspace_promotion_snapshot）、lib/workspace/promotion-import.ts

**資料表**：stores、store_employees、employee_movement_history、monthly_staff_status

**既有測試**：scripts/test-workspace-promotions.py、scripts/test-workspace-promotions-close.py、scripts/test-workspace-promotions-concurrency.cjs、scripts/test-workspace-promotions-load.py、scripts/test-workspace-promotions-transaction.cjs、scripts/test-workspace-promotion-import.cjs、scripts/test-workspace-promotion-activation.cjs、scripts/test-workspace-promotion-permissions.py、scripts/test-workspace-promotion-preview.py、scripts/test-workspace-promotion-scheduled-dev.cjs、scripts/test-promotion-monthly-position-sync.js、scripts/test-acting-manager-promotion-movement.js

**待確認**

- RPC 內是否完全複製舊 API 對 monthly_staff_status 位置與 current_position 的更新順序與 notes 格式，需以 test-promotion-monthly-position-sync.js 對照

### 測試案例

**冒煙**

- R-sales-member 開 ZT901 批次升遷（StorePromotions.vue）：預設有 1 列，新人階段只在職位為新人時出現，console error 為 0
- 下載範本：GET /api/workspace/store-promotions?template=true 回 xlsx（content-type 與檔名正確）

**單元**

- lib/workspace/promotion-import.ts normalizePromotionDate：'2026/10/01'、'2026-10-01'、Excel 序號 46296、'2026/1/5' 補零、'26/10/01' 拒絕、'2026-02-30' 拒絕
- validatePromotionRows：缺員編、缺姓名、缺職位、職位為新人但缺新人階段、缺生效日都要回對應錯誤；超過 MAX_PROMOTION_ROWS（500）時拒絕；員編自動轉大寫
- parsePromotionWorkbook：欄位標題『新人階段』與『新人等級』都能辨識；超過 MAX_PROMOTION_FILE_BYTES 拒絕；空白列略過
- promotionTemplate：表頭與舊版前端產生的範本欄位順序一致（員編、姓名、職位、新人階段、生效日、備註）

**整合**

- POST 預覽：伺服器驗證結果與 validatePromotionRows 一致；確認儲存呼叫 RPC workspace_promotion_save 後，store_employees.current_position 與 last_promotion_date 更新、employee_movement_history 新增 promotion 紀錄、對應月份的 monthly_staff_status.position 更新
- 未來日期：生效日 2026-12-01 時，只排程，不立即改 current_position（對照 scripts/test-workspace-promotion-scheduled-dev.cjs）
- 冪等：同一 requestId 送兩次，只產生一筆歷史
- 並行：兩個 session 以同一 expected 送出，一個成功一個回 409（沿用 scripts/test-workspace-promotions-concurrency.cjs）
- 原子性：3 列中第 2 列員編不存在，整批不寫入（Vue 語意）
- 權限矩陣：R-admin、R-sales-member 200；R-sales-trap（有 employee.promotion.batch，但 canReadStorePersonnel 為 false）403；R-supervisor、R-store-manager-A、R-staff 403。並與舊 API 第 27 行 role ∈ {admin, manager, supervisor, area_manager} 的結果並列成表，回報差異
- 代理店長：升為代理店長時的 movement_type 與月份職位同步（對照 scripts/test-acting-manager-promotion-movement.js）

**E2E**

- R-sales-member：新增 2 列（FK9002 升副店長、FK9003 新人加新人階段）→ 刪除一列再加回 → 驗證錯誤顯示 → 修正 → 確認儲存 → 顯示成功筆數 → 開人員主檔確認職位已更新
- 匯入：上傳含 3 列的 xlsx → 預覽 → 確認 → 結果與手動輸入一致；上傳含錯誤列的檔案，顯示列號錯誤且不寫入

**對等驗證**

- 同一組升遷（含新人、行政階級、代理店長、過去日期、當月日期），分別送舊版 POST /api/promotions/batch 與 Vue workspace_promotion_save，比對 store_employees、employee_movement_history（old_value、new_value、notes 格式）、monthly_staff_status 快照，重點核對 notes 字串與 monthly position 更新順序（以 scripts/test-promotion-monthly-position-sync.js 為基準）
- 部分失敗的情境：舊版逐列寫入、Vue 整批拒絕，列入已知差異 allowlist（待確認）

**測試資料**

- ZT901 store_employees：FK9002（專員）、FK9003（新人候選）、FK9004（副店長，可升代理店長）
- monthly_staff_status：2026-10 有以上 3 人
- xlsx fixture：正確 3 列、含錯誤 1 列、標題用『新人等級』的版本、501 列的超量檔

**風險**

- 權限來源不同（role 對 RBAC），授權對象可能不一致
- RPC 是否完全複製舊 API 的 notes 格式與更新順序

## /admin/store-managers

- 狀態：**done**（S）— 搜尋人員、勾選管理門市、儲存、解除單店或全部指派、現有指派總覽都有實作；人員來源條件（職稱含店長或督導）一致，且有權限（store.manager.assign 或 store.manage）與併發保護（expected）。
- 舊版：`app/admin/store-managers/page.tsx、app/api/store-managers/*`
- Vue：`vue-workspace/src/pages/StoreManagers.vue`、`vue-workspace/src/pages/StoreManagerEdit.vue`
- 權限：store.manager.assign、store.manage
- 相依：Modal.vue、lib/admin/store-management-access.ts

**舊版功能**

- 左側：搜尋店長（姓名、Email、員編），顯示員編與職稱
- 選擇人員後顯示目前管理門市，勾選多間門市指派
- 在門市選項上顯示『已有店長: XXX』提示
- 儲存指派（先刪該使用者 role_type=store_manager 且 is_primary 的舊指派再新增）
- 右側：現有店長指派，依店長分組並顯示管理門市數
- 移除全部指派、移除單店（有確認）
- 權限 store.manager.assign 或 store.manage

**缺少或不同**

- 舊版在選門市時提示該店目前已有其他店長，Vue 版 StoreManagerEdit.vue 的門市清單沒有這個提示（app/admin/store-managers/page.tsx 第 359-382 行對應處）
- 舊版人員查詢包含職稱『代理店長』（ilike 三個條件），Vue 版以 ilike %店長% 涵蓋，結果等價
- Vue 版右側改為『依門市』的指派總覽，非舊版『依店長分組』，資訊相同，呈現不同
- Vue 版新增解除已停用門市的處理與解除確認

**業務規則**

- （無）

**API**：舊 GET /api/store-managers/users、GET /api/store-managers/stores、GET /api/store-managers/assignments、POST /api/store-managers/assign（含 DELETE）；新 GET/PUT /api/workspace/store-managers（RPC workspace_set_store_manager）

**資料表**：store_managers、profiles、stores

**既有測試**：scripts/test-workspace-store-managers.py、scripts/test-workspace-store-managers-transaction.cjs、scripts/seed-workspace-store-managers-dev.cjs、scripts/cleanup-workspace-store-managers-dev.cjs、scripts/apply-workspace-store-managers-dev.cjs、scripts/test-store-scope-management-rbac.js

**待確認**

- 是否要補上『已有店長』提示需使用者決定；它是舊版的資訊提示，不影響資料正確性

### 測試案例

**冒煙**

- R-sales-manager 開 StoreManagers.vue：右側總覽有 ZT901→R-store-manager-A，console error 為 0
- R-viewer 與 R-staff：PUT /api/workspace/store-managers 回 403，導覽中看不到店長管理

**單元**

- 人員候選過濾：職稱包含『店長』（涵蓋店長、代理店長、督導(代理店長)）或包含『督導』；搜尋姓名、Email、員編。若在 route 或頁面內，抽出 matchManagerCandidate(profile, q) 測試
- 依門市與依人員的分組轉換函式（若存在）

**整合**

- PUT 指派 R-store-manager-B 管理 ZT902 與 ZT904：store_managers 只留下該使用者 role_type=store_manager 且 is_primary 的兩筆，舊指派被刪除
- 解除單店與全部解除：DB 對應刪除；解除已停用門市 ZT903 的指派也要成功
- 並行：expected 過期回 409；兩個 PUT 同時針對同一人，最後結果與其中一個請求完全一致（沒有交錯的混合狀態），對照 scripts/test-workspace-store-managers-transaction.cjs
- 權限：store.manager.assign 或 store.manage 可以；R-supervisor 403
- 候選人：GET 回傳的人員中，包含 job_title='代理店長' 的帳號

**E2E**

- R-sales-manager：搜尋 R-store-manager-B → 勾選 ZT902、ZT904 → 儲存 → 總覽更新 → 解除 ZT904 並確認 → 只剩 ZT902 → 全部解除

**對等驗證**

- 同一指派序列（指派兩店 → 改為一店 → 全部解除），分別用舊版 POST /api/store-managers/assign 與 Vue PUT 執行，每一步都比對 store_managers 快照
- 候選人比對：舊版 GET /api/store-managers/users 與 Vue 候選清單的 user_id 集合相同
- 『已有店長』提示：舊版 page.tsx 第 359-382 行有，Vue 沒有，列為待決策的 UI 差異

**測試資料**

- profiles：店長、代理店長、督導(代理店長) 各一人，加一位職稱不含店長的員工（不應出現在候選）
- store_managers：ZT901→R-store-manager-A

**風險**

- Vue 缺少『已有店長』的指派提示，可能造成重複指派

## /admin/supervisors

- 狀態：**done**（S）— 搜尋、督導與經理、兼任店長三種角色、主責與代理督導、已有督導時的衝突處理、解除與權限都有實作。UX 改成明確選主責督導，行為更嚴謹。差異只有統計卡片。
- 舊版：`app/admin/supervisors/page.tsx、app/api/supervisors/*`
- Vue：`vue-workspace/src/pages/Supervisors.vue`、`vue-workspace/src/pages/SupervisorEdit.vue`
- 權限：store.supervisor.assign、store.manager.assign、store.manage
- 相依：Modal.vue、lib/admin/store-management-access.ts

**舊版功能**

- 統計卡：經理人數、督導人數、門市總數
- 督導管理列表（依人員顯示管轄門市，含兼任店長門市）
- 搜尋經理／督導（姓名、Email、員編）
- 勾選管轄門市；新增勾選時若該店已有督導，confirm 詢問是否改為『代理管理』
- 儲存時送 userId、storeIds、roleType（supervisor 或 store_manager）、proxyStoreIds
- 代理督導推算（role_type=supervisor 且 is_primary=false）
- 權限：store.supervisor.assign、store.manager.assign（兼任店長）、store.manage

**缺少或不同**

- 舊版頁首的經理人數、督導人數、門市總數統計卡，Vue 的 Supervisors.vue 沒有
- 舊版以 confirm 決定是否成為代理；Vue 版要求每個衝突門市明確指定主責督導，語意不同但更嚴謹，需確認使用者接受（SupervisorEdit.vue）
- 舊版指派列表以人為主；Vue 版以門市為主並分經理、主責、代理三欄

**業務規則**

- （無）

**API**：舊 GET /api/supervisors/users、GET /api/supervisors/stores、GET /api/supervisors/assignments、POST /api/supervisors/assign；新 GET/PUT /api/workspace/supervisors（見 supabase/workspace-dev/20261028130000_vue_supervisors.sql、20261029160000_vue_supervisor_primary_choice.sql）

**資料表**：store_managers（role_type supervisor、store_manager、area_manager；is_primary）、profiles、stores

**既有測試**：scripts/test-workspace-supervisors.py、scripts/seed-workspace-supervisors-dev.cjs、scripts/cleanup-workspace-supervisors-dev.cjs、scripts/apply-workspace-supervisor-primary-dev.cjs、scripts/test-store-scope-management-rbac.js

**待確認**

- 舊版 area_manager 角色在 Vue 總覽中被列為經理／管理職欄位，是否與舊版 supervisorEntries 篩選（只列 role_type=supervisor）完全一致未逐筆驗證

### 測試案例

**冒煙**

- R-sales-manager 開 Supervisors.vue：總覽分經理、主責、代理三欄，ZT901 主責為 R-supervisor，console error 為 0
- R-staff 被拒；導覽可見性與舊版一致

**單元**

- 代理督導推算：role_type=supervisor 且 is_primary=false 時為代理；抽出 classifyAssignments(rows) 測試 supervisor、store_manager、area_manager 與 is_primary 的組合
- 衝突判斷：勾選的門市已有其他主責督導時，列入 conflicts，要求指定主責

**整合**

- PUT 指派督導 S2 管理 ZT901（已有主責 R-supervisor），指定 S2 為主責：store_managers 中 R-supervisor 對 ZT901 改為 is_primary=false，S2 為 true；指定保留原主責時，S2 為代理
- roleType=store_manager（兼任店長）需要 store.manager.assign，沒有時回 403
- area_manager 在總覽的分類：比對 RPC 回傳與舊版 supervisorEntries（只列 role_type=supervisor）的差異
- 並行與 expected：過期版本回 409

**E2E**

- R-sales-manager：搜尋督導 S2 → 勾選 ZT901、ZT902 → ZT901 有衝突時跳出主責選擇 → 選擇 S2 為主責 → 儲存 → 總覽 ZT901 主責為 S2，代理欄出現 R-supervisor → 解除

**對等驗證**

- 同一序列分別送舊版 POST /api/supervisors/assign（proxyStoreIds 帶 ZT901，對應舊版 confirm 選擇『是』）與 Vue（選擇保留原主責、S2 為代理），比對 store_managers 快照，兩者應相同
- 另一序列：舊版選擇『否』時的結果，與 Vue 選擇 S2 為主責的結果比對，記錄語意差異
- 統計卡（經理、督導、門市數）：Vue 沒有，列為待決策；若補上，測試數字與舊版相同

**測試資料**

- profiles：R-supervisor、S2（督導）、經理 M1（area_manager）
- store_managers：ZT901 主責 R-supervisor；M1 為 area_manager 管 ZT901 與 ZT902

**風險**

- 主責或代理的語意與舊版 confirm 不同
- area_manager 的總覽分類可能不一致

## /admin/employee-management

- 狀態：**partial**（S）— 統計、搜尋與狀態職位篩選、Excel 匯出、新增、編輯、異動歷程、生日 CSV 匯入都有 Vue 版，但新增員工時舊版強制的員編格式（FK+4碼、FKF+5碼、FKPT+3碼、FKI+3碼）在 Vue 版放寬成 1-20 字英數字、底線或連字號（EmployeeCreate.vue 與 SQL 第 12 行），屬業務規則差異。
- 舊版：`app/admin/employee-management/page.tsx、EmployeeManagementClient.tsx、app/api/employees/add、update、bulk-update-birthday`
- Vue：`vue-workspace/src/pages/Employees.vue`、`vue-workspace/src/pages/EmployeeCreate.vue`、`vue-workspace/src/pages/EmployeeBirthdays.vue`、`vue-workspace/src/components/EmployeeEdit.vue`、`vue-workspace/src/employee-export.ts`
- 權限：employee.manage（進入）、employee.employee.create、employee.employee.edit、舊版角色條件：admin 或營業部 member／manager 且非指派職稱
- 相依：Modal.vue、EmployeeEdit.vue、lib/workspace/employee-directory.ts、employee-birthdays.ts、SQL 20261029100000_vue_employee_create.sql、20261029210000_vue_employee_edit.sql、20261029090000_vue_employee_birthdays.sql

**舊版功能**

- 權限：admin、營業部 member／manager 且非指派職稱，否則導回 /dashboard
- 員工資料庫（store_employees 去重，合併 monthly_staff_status 最新狀態與 employee_movement_history 最新異動），欄位：員編、姓名、當前職位、狀態、到職日、生日
- 統計卡：總員工數、在職、離職
- 搜尋（員編、姓名）、狀態篩選、職位篩選
- 匯出篩選結果 Excel、匯出 CSV 範本（員編、姓名、生日）
- 批量匯入生日（上傳 CSV、預覽、確認匯入、顯示成功與失敗明細）
- 新增員工：員編格式驗證與 FKI 實習生確認，欄位員編、姓名、當前職位、到職日、生日
- 編輯員工：員編不可改，可改姓名、職位、到職日、生日（同時回寫 monthly_staff_status）
- 升遷歷程彈窗
- 使用說明區塊

**缺少或不同**

- 新增員工的員編格式驗證缺漏：舊版 handleAddEmployee 限制 FK/FKF/FKPT/FKI 四種格式，Vue 的 EmployeeCreate.vue review() 與 SQL workspace_employee_create 只檢查 ^[A-Z0-9_-]{1,20}$
- 舊版彈窗中的『升遷歷程』只看升遷；Vue 版改為『異動歷程』並可依類型篩選，範圍較廣（增強）
- 舊版『匯出 CSV 範本』在 Vue 版移到 EmployeeBirthdays.vue，需確認該頁含員編、姓名、生日三欄範本（已看到 csv、範本關鍵字，未逐行比對欄位）
- 編輯時是否同步更新 monthly_staff_status 姓名與職位（舊版 app/api/employees/update 第 82-110 行會更新）：Vue 版由 RPC workspace_employee_edit 負責，未讀 SQL 本體確認
- Vue 版寫入使用 requestId 冪等與 expected 版本控制，是增強

**業務規則**

- （無）

**API**：舊 POST /api/employees/add、POST /api/employees/update、POST /api/employees/bulk-update-birthday、GET /api/employees/list（頁面未使用）；新 GET/POST /api/workspace/employees、GET/PUT /api/workspace/employees/edit、GET/PUT /api/workspace/employee-birthdays

**資料表**：store_employees、monthly_staff_status、employee_movement_history、profiles

**既有測試**：scripts/test-workspace-employee-directory.cjs、scripts/test-workspace-employee-directory-ui.py、scripts/test-workspace-employee-export.py、scripts/test-workspace-employee-create-ui.py、scripts/test-workspace-employee-create-api.py、scripts/test-workspace-employee-create-dev.cjs、scripts/test-workspace-employee-dialogs.py、scripts/test-workspace-employee-birthdays.cjs、scripts/test-workspace-employee-birthdays-ui.py、scripts/test-workspace-employee-birthday-save.py、scripts/test-employee-management-status-sync.js

**待確認**

- 員編格式放寬可能是刻意（SQL 註解與驗證文件未見理由），需使用者確認要沿用舊規則還是新規則
- 需實測 Vue 編輯員工後 monthly_staff_status 是否與舊版同步

### 測試案例

**冒煙**

- R-sales-member 開 Employees.vue：統計卡（總數、在職、離職）、表格載入，console error 為 0
- R-staff、R-sales-trap、R-store-manager-A 被拒（舊版導回 /dashboard）
- EmployeeCreate.vue、EmployeeBirthdays.vue、EmployeeEdit.vue 彈窗都能開啟

**單元**

- lib/workspace/employee-directory.ts employeeDirectory：store_employees 依員編去重；合併最新月份 monthly_staff_status 狀態；最新 employee_movement_history 異動；統計在職與離職數
- 員編驗證：新建一個共用函式（例如 lib/workspace/employee-code.ts validateEmployeeCode）並以參數化測試兩套規則。舊規則：FK1234 ok、FKF12345 ok、FKPT123 ok、FKI123 ok 但需確認、FK123 拒絕、fk1234 轉大寫後 ok、FK12345 拒絕。現行 Vue 規則：/^[A-Za-z0-9_-]{1,20}$/（EmployeeCreate.vue review()），FKI 開頭需勾選確認
- lib/workspace/employee-birthdays.ts：normalizeBirthday（1990/1/5、1990-01-05、民國格式若不支援要拒絕、空值）；parseBirthdayCsv（BOM、CRLF、標題列、超過 MAX_BIRTHDAY_ROWS 或 MAX_BIRTHDAY_BYTES 時拒絕）；matchBirthdayEmployees（找不到員編、姓名不符）；restoreBirthdayNames
- vue-workspace/src/employee-export.ts employeeWorkbook：欄位與舊版匯出一致（員編、姓名、當前職位、狀態、到職日、生日），只匯出篩選後的資料

**整合**

- POST /api/workspace/employees（新增）：成功寫入 store_employees；重複員編回錯誤；員編格式依決策的規則驗證（SQL workspace_employee_create 也要擋，繞過 UI 直接送 'FK12' 測伺服器端）；requestId 冪等
- PUT /api/workspace/employees/edit：修改姓名與職位後，查 monthly_staff_status 該員工的姓名與職位是否同步（對照舊版 app/api/employees/update 第 82-110 行）；員編不可改；expected 過期回 409
- PUT /api/workspace/employee-birthdays：10 筆中 2 筆員編不存在，回傳成功與失敗明細，DB 只更新 8 筆（與舊版 bulk-update-birthday 語意比對）
- 權限：employee.employee.create 與 employee.employee.edit 分開測；只有 employee.manage 但沒有 create 時，新增回 403

**E2E**

- R-sales-member：搜尋 FK900 → 狀態篩選『離職』→ 職位篩選 → 匯出 Excel，用 openpyxl 讀檔驗證列數 → 新增 FK9050（含生日）→ 列表出現 → 編輯姓名 → 開異動歷程
- 生日匯入：在 EmployeeBirthdays 下載範本，確認欄位為員編、姓名、生日 → 上傳含錯誤列的 CSV → 預覽 → 確認 → 顯示成功與失敗明細
- FKI 員編：沒有勾選確認時不能送出

**對等驗證**

- 列表比對：同資料下舊版與 Vue 版的員編、姓名、當前職位、狀態、到職日、生日，依員編排序後 deepEqual；三個統計數字相同
- 新增：同一筆輸入分別送 /api/employees/add 與 Vue POST，比對 store_employees 快照
- 編輯：同一修改分別送 /api/employees/update 與 Vue edit，比對 store_employees 與 monthly_staff_status 快照（這是確認 Vue 有無同步月份資料的關鍵測試）
- 生日：同一份 CSV 分別送 /api/employees/bulk-update-birthday 與 Vue，比對 birthday 欄與回傳的成功或失敗筆數

**測試資料**

- store_employees 20 筆，包含：同員編在兩店（去重測試）、離職、各種職位、無生日
- monthly_staff_status 2026-10 對應資料；FK9001 有 3 筆異動歷程
- CSV fixture：正確 5 列、含 BOM、員編不存在 2 列、日期格式錯誤 1 列

**風險**

- 員編規則放寬（業務規則差異，需決策）
- Vue 編輯是否同步 monthly_staff_status 尚未讀 SQL 確認

## /admin/import-employees

- 狀態：**done**（S）— 下載範本、上傳 Excel、預覽、錯誤列表與匯入都有。Vue 版比舊版嚴格：整批通過才會寫入，舊版是逐列處理、失敗列只顯示錯誤，其他列仍寫入。
- 舊版：`app/admin/import-employees/page.tsx、app/api/import-employees/route.ts`
- Vue：`vue-workspace/src/pages/EmployeeImport.vue`
- 權限：employee.import
- 相依：Modal.vue、SQL 20261030010000_vue_employee_import.sql

**舊版功能**

- 說明卡片、下載 Excel 範本（門市代號、員編、姓名、職位、到職日期）
- 上傳 .xlsx／.xls，非 Excel 提示
- 逐列處理：門市代號須存在、日期支援 YYYY-MM-DD、YYYY/M/D 與 Excel 序號、員編不可重複；員工預設 full_time
- 右側匯入結果：成功筆數、失敗筆數、錯誤明細（列號與原因）

**缺少或不同**

- 舊版逐列容錯（部分成功），Vue 版整批原子匯入，任何一列錯誤都不寫入，行為不同，需使用者確認是否接受（lib/workspace/employee-import.ts、SQL workspace_employee_import_save）
- 舊版 API 沒有顯式權限檢查（app/api/import-employees/route.ts 僅建立 supabase client，是否被 middleware 保護未確認）；Vue 版要求 employee.import 並有 5MB 與 10000 列上限
- Vue 版新增預覽與核對步驟、二次確認、requestId 冪等

**業務規則**

- （無）

**API**：舊 POST /api/import-employees；新 POST（預覽）與 PUT（確認）/api/workspace/employee-import（RPC workspace_employee_import_check、workspace_employee_import_save）

**資料表**：stores、store_employees

**既有測試**：scripts/test-workspace-employee-import.py、scripts/apply-workspace-employee-import-dev.cjs

**待確認**

- 舊版頁面副標說明支援 CSV，但程式碼只接受 .xlsx／.xls，兩版皆不支援 CSV

### 測試案例

**冒煙**

- R-sales-member 開 EmployeeImport.vue：下載範本可用，上傳區可見，console error 為 0
- R-staff 或沒有 employee.import 的角色：POST /api/workspace/employee-import 回 403

**單元**

- lib/workspace/employee-import.ts importDate：'2026-10-01'、'2026/1/5'、Excel 序號、空值、'2026-13-01' 拒絕
- parseEmployeeImport：HEADERS 對應（門市代號、員編、姓名、職位、到職日期）；同檔內重複員編；超過 MAX_IMPORT_ROWS（10000）拒絕；非 xlsx 或 xls 拒絕；employment_type 預設 full_time；檔案超過 5MB 拒絕

**整合**

- POST 預覽（RPC workspace_employee_import_check）：門市代號 ZT999 不存在、員編與 DB 已存在的重複時，回列號與原因
- PUT 確認（workspace_employee_import_save）：全部正確時 5 筆寫入 store_employees，store_id 對應正確；任何一列錯誤時 0 筆寫入；同 requestId 重送不重複寫入
- 並行：兩個 PUT 匯入同一批員編，只能有一批成功

**E2E**

- R-sales-member：下載範本 → 用 openpyxl 產生 5 列有效資料的 xlsx → 上傳 → 預覽 → 二次確認 → 成功 → 到 Employees.vue 搜尋得到這 5 人
- 上傳含 1 列錯誤的檔案：預覽顯示錯誤列號，確認按鈕停用或送出被拒，DB 沒有變化

**對等驗證**

- 同一份全部正確的 xlsx 分別送舊版 POST /api/import-employees 與 Vue 流程，比對 store_employees 快照（store_id、position、start_date、employment_type）
- 同一份含錯誤列的 xlsx：舊版會寫入正確列、Vue 全部不寫，列入已知差異（待決策）；但兩版回報的錯誤列號與原因必須對應
- 權限比對：確認舊 API 是否受 middleware 保護（以 R-staff 直接 POST 舊 API），記錄結果

**測試資料**

- xlsx fixture：有效 5 列、含不存在門市代號、含 DB 已存在員編、含 Excel 序號日期、含 YYYY/M/D 日期、10001 列超量檔、改副檔名的 csv
- 門市 ZT901、ZT902

**風險**

- 整批原子與逐列容錯的語意差異
- 舊 API 沒有權限檢查

## /admin/promotion-management

- 狀態：**partial**（L）— 三個分頁的批次輸入、歷史檢視、調店登記確認都已有 Vue 版，且批次驗證與匯入匯出更完整；但舊版歷史紀錄可編輯與刪除，Vue 版（MovementHistory.vue 與 app/api/workspace/employee-movements/route.ts 只有 GET）完全沒有編輯與刪除，也沒有對應的 workspace API，因此為 partial。
- 舊版：`app/admin/promotion-management/page.tsx（2457 行）、app/api/employee-movements/batch/route.ts、app/api/employee-movements/[id]/route.ts、app/api/store-transfer-requests/**`
- Vue：`vue-workspace/src/pages/MovementManagement.vue`、`vue-workspace/src/pages/MovementDraft.vue`、`vue-workspace/src/pages/MovementHistory.vue`、`vue-workspace/src/pages/Transfers.vue`、`vue-workspace/src/components/TransferCreate.vue、TransferConfirm.vue、TransferCorrect.vue、TransferHistory.vue`、`vue-workspace/src/movement-draft-file.ts`
- 權限：employee.promotion.batch、employee.store_transfer.create、employee.store_transfer.confirm、employee.promotion.delete（刪除歷史）、employee.movement.manage（編輯歷史）、employee.manage（編輯歷史）、舊版另有 profile.role=admin 旁路
- 相依：Pharmacists.vue 的調店月份同步（lib/workspace/transfer-months.ts）、組織單位（Organization.vue 的 organization_units）、員工主檔（Employees.vue）、SQL 20261029110000 至 20261029230000 的調店與異動批次 RPC

**舊版功能**

- 權限分流：admin 全部；employee.promotion.batch 可用批次與歷史；employee.store_transfer.create 可登記調店；employee.store_transfer.confirm 可確認、拒絕、更正；只有確認權的督導只看調店分頁；URL ?tab= 參數
- 分頁一：批次輸入異動（8 種：入職、升職、代理、留職停薪、復職、過試用期、離職、調店），欄位依類型變動：入職需生日與是否藥師，且可選總部最下層組織單位，升職需職位與新人／行政階級，代理只記代理店長，調店需原／新門市；員編自動大寫；員工搜尋帶入；新增／刪除列；Excel 匯入（含日期與門市名稱容錯解析、有歧義的提示）、匯出、下載範本；必填與範例員編檢查；儲存呼叫 /api/employee-movements/batch
- 分頁二：歷史紀錄：年月與類型篩選、清除篩選、每頁 50／100、分頁、表格欄位（員編、姓名、任職門市、類型、是否藥師、舊值、新值、生效日期、備註）
- 歷史紀錄的『編輯』（姓名、生效日期、職位與新人／行政階級、備註；有必填與升職驗證，PATCH /api/employee-movements/[id]）與『刪除』（DELETE，需 employee.promotion.delete，有確認，會回復相關資料）
- 分頁三：調店登記確認：新增調店申請（員編搜尋、原與新門市、備註）、狀態篩選、列表、確認（填生效日）、拒絕、更正生效日（需原因）、更正紀錄
- 生效日輸入限制（四位數西元年，MOVEMENT_DATE_MIN）
- 使用說明區塊

**缺少或不同**

- 缺：歷史紀錄編輯功能。舊版 PATCH /api/employee-movements/[id]（權限 employee.movement.manage 或 employee.manage 或 employee.promotion.batch）沒有 Vue 對應；app/api/workspace/employee-movements/route.ts 只有 GET，MovementHistory.vue 無編輯按鈕
- 缺：歷史紀錄刪除功能。舊版 DELETE /api/employee-movements/[id]（權限 employee.promotion.delete，並有回復副作用）沒有 Vue 對應；grep app/api/workspace、lib/workspace、vue-workspace/src 皆找不到 employee.promotion.delete
- 缺：舊版歷史頁篩選只有年月與類型，Vue 版相同；但舊版有清除篩選鈕、Vue 有『全部月份』，等價
- 權限判斷方式不同：舊版調店 API 以 profile.role=admin 與 has_permission 判斷；Vue 版 transferAccess 與 canReadMovementHistory（admin 或 employee.promotion.batch 加 employee.store_transfer.create），需測試督導（只有 confirm 權）與營業助理兩類角色
- Vue 版為伺服器端驗證流程：驗證、版本、確認儲存，儲存為整批原子；舊版 /api/employee-movements/batch 逐列處理，行為不同，需要核對任一列失敗時的結果
- Vue 版已加：未來日期調店確認、同月份日期更正預覽、更正歷程；這些是增強或舊版在 app/api/store-transfer-requests 的對應更新
- 舊版代理類型紀錄顯示『代理（舊紀錄）』，Vue 版 route 有相同處理

**業務規則**

- （無）

**API**：舊 POST /api/employee-movements/batch、PATCH、DELETE /api/employee-movements/[id]、GET、POST /api/store-transfer-requests、POST /api/store-transfer-requests/[id]/confirm、POST /api/store-transfer-requests/[id]/reject、POST /api/store-transfer-requests/[id]/effective-date；新 GET /api/workspace/movement-validation（目錄）、POST（驗證與 Excel 解析）、POST /api/workspace/movement-submit、GET /api/workspace/employee-movements（歷史，僅讀取）、GET、POST /api/workspace/transfers 以及 transfers/preview、create、confirm、correct、correct-preview、history

**資料表**：employee_movement_history、store_employees、monthly_staff_status、store_transfer_requests、stores、organization_units、profiles

**既有測試**：scripts/test-workspace-movement-management.py、scripts/test-workspace-movement-draft-ui.py、scripts/test-workspace-movement-draft-file.cjs、scripts/test-workspace-movement-submit.py、scripts/test-workspace-movement-validation.py、scripts/test-workspace-movement-import.cjs、scripts/test-workspace-movement-export.cjs、scripts/test-workspace-movement-fields.cjs、scripts/test-workspace-movement-locations.cjs、scripts/test-workspace-movement-references.cjs、scripts/test-workspace-movement-catalog.py、scripts/test-workspace-movement-catalog-dev.cjs、scripts/test-workspace-movement-history.py、scripts/test-workspace-movement-history-dev.cjs、scripts/test-workspace-transfers.py、scripts/test-workspace-transfers-dev.cjs、scripts/test-workspace-transfer-create.py、scripts/test-workspace-transfer-confirm.py、scripts/test-workspace-transfer-confirm-dev.cjs、scripts/test-workspace-transfer-history.py、scripts/test-workspace-transfer-history-layout.py、scripts/test-workspace-transfer-races.py、scripts/test-workspace-transfer-roles.py、scripts/test-workspace-transfer-roles-dev.cjs、scripts/test-workspace-transfer-correction-plan.cjs、scripts/test-workspace-transfer-months.cjs、scripts/test-employee-movement-date.cjs、scripts/test-store-transfer-effective-date-correction.js、scripts/test-acting-manager-promotion-movement.js、scripts/test-pharmacist-transfer-reconciliation.cjs

**待確認**

- 舊版刪除異動紀錄的完整副作用（回復 store_employees 與 monthly_staff_status）需完整讀 app/api/employee-movements/[id]/route.ts 第 279 行起才能設計對應 RPC
- 舊版 employee-movements/batch 與 Vue 的 workspace_movement_batch RPC 在各異動類型對 monthly_staff_status 與 store_employees 的副作用是否逐項等價，尚未逐類型比對，建議用 test-workspace-movement-submit.py 對照舊 API 輸出
- 舊版頁面上方的『使用說明』與錯誤提示文案在 Vue 版是否保留未全檢查

### 測試案例

**冒煙**

- R-sales-member 開 MovementManagement.vue：能看到批次輸入、歷史、調店三個分頁，console error 為 0；URL ?tab= 能直接切換分頁
- R-supervisor（只有 employee.store_transfer.confirm）只看得到調店分頁
- R-staff 被拒；導覽可見性與舊版一致
- GET /api/workspace/movement-validation（目錄）、/api/workspace/employee-movements、/api/workspace/transfers 對 R-sales-member 都回 200

**單元**

- lib/workspace/movement-fields.ts validateMovementFields：8 種類型各自的必填欄位（入職需生日與是否藥師、升職需職位與新人或行政階級、代理只記代理店長、調店需原與新門市且不可相同）；員編轉大寫；範例員編拒絕；超過 MAX_MOVEMENT_ROWS 拒絕
- lib/employee-movement-date.ts getMovementDateError：MOVEMENT_DATE_MIN 邊界、五位數年份、空值
- lib/workspace/movement-import.ts parseMovementWorkbook：日期容錯、門市名稱或代碼容錯解析、名稱有歧義時回提示、超過 MAX_MOVEMENT_FILE_BYTES 拒絕
- lib/workspace/movement-references.ts validateMovementReferences：員編不存在、門市不存在、離職者不能升職等參照錯誤
- lib/workspace/movement-locations.ts movementPlacementOptions：只回總部最下層組織單位
- lib/workspace/movement-errors.ts movementErrors 的訊息對應
- lib/workspace/employee-movements.ts canReadMovementHistory 與 lib/workspace/transfers.ts transferAccess：用角色權限組合表測試（admin、只有 batch、只有 create、只有 confirm、batch 加 create、無權限）
- lib/workspace/transfer-correction-plan.ts transferCorrectionPlan、lib/workspace/transfer-months.ts transferMonthPlan：生效日跨月、同月更正、未來日期
- vue-workspace/src/movement-draft-file.ts movementDraftFile 與 employee-export.ts movementWorkbook：匯出後再匯入（round-trip）結果相同
- 新功能（缺口）：歷史編輯驗證抽成 validateMovementEdit(movement, patch)：姓名必填、日期合法、升職需職位；其行為需與舊版 PATCH /api/employee-movements/[id] 的驗證一致

**整合**

- POST /api/workspace/movement-submit，8 種類型各一筆：比對 employee_movement_history、store_employees、monthly_staff_status 的副作用（入職會新增 store_employees，離職會改 monthly 狀態，留停與復職改狀態，調店改 store_id，升職改 current_position，代理店長的特殊處理）
- 原子性：一批中有一列參照錯誤時，整批都不寫入；requestId 冪等；expected 版本衝突回 409
- GET /api/workspace/employee-movements：年月與類型篩選、每頁 50 或 100、分頁總數正確；舊代理紀錄顯示『代理（舊紀錄）』
- 調店流程：create（R-sales-member）→ preview → confirm（R-supervisor 填生效日）→ store_employees.store_id 與 monthly_staff_status 依 transferMonthPlan 更新 → correct-preview → correct（需原因）→ history 有更正紀錄；reject 後狀態為 rejected 且資料不變
- 調店權限矩陣：R-sales-member 可 create 不可 confirm；R-supervisor 可 confirm 不可 create；R-store-manager-A 都不可；R-staff 403；跨門市督導（只管 ZT902）確認 ZT901 的申請時，依設計記錄結果並與舊版 app/api/store-transfer-requests/[id]/confirm 比對
- 並行：兩個督導同時 confirm 同一筆申請，只能一個成功（沿用 scripts/test-workspace-transfer-races.py）
- 新功能（缺口）PATCH 與 DELETE：待新增的 workspace API 要測：employee.movement.manage、employee.manage、employee.promotion.batch 任一可編輯；只有 employee.promotion.delete 可刪除；刪除 promotion 或 acting_manager 紀錄後，monthly_staff_status 與 store_employees 依 syncEmployeePromotionTimelineToMonthlyStaffStatus 的規則回復；刪除不存在的 id 回 404；R-sales-member（沒有 delete 權限）刪除回 403

**E2E**

- R-sales-member 批次輸入：加入 4 列（入職 FK9060 含生日與藥師、升職 FK9002、離職 FK9003、調店 FK9004 從 ZT901 到 ZT902）→ 員工搜尋自動帶入 → 驗證 → 儲存 → 到歷史分頁篩選 2026-10 可看到 4 筆
- Excel：下載範本 → 匯入含門市名稱歧義的檔案 → 顯示提示 → 修正後匯入 → 匯出草稿，與匯入內容一致
- 調店：R-sales-member 新增 FK9005 的調店申請 → 登出 → R-supervisor 登入，只看到調店分頁 → 確認並填生效日 → R-sales-manager 更正生效日並填原因 → 更正紀錄出現
- 新功能（缺口）：R-sales-manager 在歷史分頁編輯一筆升職的日期與職位 → 儲存 → 列表更新；刪除一筆升職並確認 → 列表移除，人員主檔職位回復成前一個職位

**對等驗證**

- 批次異動：同一組 8 種類型的資料，分別送舊版 POST /api/employee-movements/batch 與 Vue movement-submit（cleanup 後重新 seed），逐類型比對 employee_movement_history、store_employees、monthly_staff_status 快照。這是本領域最重要的 parity 測試，每種類型都要獨立一個案例，才能找出差異
- 部分失敗：舊版逐列、Vue 整批，列入 allowlist（待決策），但全部有效的批次必須完全一致
- 歷史列表：同篩選條件下，舊版與 Vue 版表格的欄位（員編、姓名、門市、類型、藥師、舊值、新值、日期、備註）與分頁總數一致
- 調店：同一序列（create → confirm → correct，以及 create → reject）分別走舊版 /api/store-transfer-requests/** 與 Vue /api/workspace/transfers/**，比對 store_transfer_requests、store_employees、monthly_staff_status 快照
- 編輯與刪除（新功能完成後）：同一筆紀錄分別用舊版 PATCH 或 DELETE /api/employee-movements/[id] 與新 workspace API 處理，比對三張表快照，特別是刪除後的月份職位回復結果
- 權限：9 種角色在兩版的分頁可見性與 API 結果表（允許或拒絕）必須相同；已確認的差異要逐條寫出

**測試資料**

- store_employees：FK9001 到 FK9010 分佈於 ZT901、ZT902，其中 FK9004 有 2026-09 與 2026-10 的 monthly_staff_status
- employee_movement_history：FK9002 有兩筆升職（專員 → 主任 → 副店長），用來測刪除後回復到主任；另有一筆舊格式代理紀錄
- organization_units：總部下兩層，最下層 2 個單位
- store_transfer_requests：pending、confirmed、rejected 各一筆
- xlsx fixture：8 種類型各一列、含門市名稱歧義、含範例員編、超量列
- 角色：全部 9 個，以及一個只管 ZT902 的督導 S3

**風險**

- 歷史編輯與刪除完全缺少 Vue 版，需要新 API、RPC 與 UI；刪除的回復副作用必須完整移植 lib/monthly-staff/promotion-position-sync.ts
- 8 種異動類型的副作用尚未逐項比對
- 權限判斷方式不同（profile.role 加 has_permission 對 transferAccess）

## 領域測試備註

【測試基礎設施（所有頁面共用，先由 Sonnet 建立）】
1. DEV DB 連線：.env.development.local／.env.local 由 @next/env loadEnvConfig 載入；DEV 專案 ref 為 mjpdfpxqttbhzeimmtqr。每個寫入 DEV 的腳本開頭必須沿用 scripts/apply-workspace-dev.cjs 的防呆：NEXT_PUBLIC_SUPABASE_URL 的 ref 等於 mjpdfpxqttbhzeimmtqr、EXPECTED_SUPABASE_PROJECT_REF 相符、ALLOW_DEV_DATABASE_OPERATIONS=true，並先執行 scripts/verify-dev-supabase-environment.js。條件不符就直接 throw，不得連到正式庫。
2. 測試資料命名空間：門市代碼統一用 ZT 開頭（ZT901 營運中 A、ZT902 營運中 B、ZT903 已停止 C、ZT904 加盟店 D），員編用 FK9xxx／FKF9xxxx／FKPT9xx／FKI9xx，備註欄寫入 'E2E-PARITY-<runId>'。cleanup 腳本只刪這個命名空間，並依 FK 依賴順序刪除：employee_movement_history → store_transfer_requests → monthly_staff_status → store_employees → store_managers → store_relocation_history → stores。
3. 角色帳號（seed 一次，全域共用；延用 seed-workspace-store-permissions-dev.cjs、seed-workspace-promotion-permissions-dev.cjs 的作法）：
   R-admin：profiles.role=admin。
   R-sales-member：department='營業部'、role=member、job_title='營業助理'，RBAC 有 store.store.view/create/edit/clone、employee.manage、employee.employee.create/edit、employee.import、employee.promotion.batch、employee.store_transfer.create。
   R-sales-manager：department='營業部'、role=manager、job_title='營業主管'，權限同上，加 employee.promotion.delete、employee.movement.manage、employee.store_transfer.confirm、store.manager.assign、store.supervisor.assign。
   R-supervisor：job_title='督導'，store_managers role_type=supervisor 主責 ZT901，RBAC 只有 store.store.view、employee.store_transfer.confirm。
   R-store-manager-A：job_title='店長'，store_managers role_type=store_manager ZT901，有 monthly.status.view_own。
   R-store-manager-B：店長 ZT902（測跨門市）。
   R-viewer：只有 store.store.view（唯讀）。
   R-staff：一般員工，沒有任何 store.*／employee.* 權限。
   R-sales-trap：department='營業部'、role=member，但 job_title='店長'（舊版會擋，用來驗證 canReadStorePersonnel 的職稱排除條件）。
4. 測試分層與工具：unit 用 node --test 或 tsx 直接 import lib/workspace/*.ts（不連 DB）；integration 用 Node 腳本，以各角色登入取得 cookie，再打 /api/workspace/*，並用 service-role 查 DB 驗證寫入結果；e2e 與 smoke 用 Python Playwright（沿用 scripts/test-workspace-*.py 的寫法），結果放 .tmp-check/<domain>/<page>/。
5. 對等（parity）測試框架：寫一個共用的 scripts/parity/lib.cjs，提供 (a) 以同一角色同時呼叫舊版 API／server action 與 workspace API；(b) snapshotTables(codes) 會把目標表在測試命名空間內的資料依自然鍵（employee_code+movement_date+movement_type 等）排序，並去掉 id、created_at、updated_at、request_id、version 再比對；(c) 每個情境跑兩次：先跑舊版並取快照，cleanup 後重新 seed，再跑 Vue 版並取快照，最後 deepEqual。已知、經使用者確認的差異（整批原子 vs 逐列、員編規則、store_id 歷程範圍、地圖預設已停止）寫進 allowlist 並附原因，不得靜默忽略。
6. smoke 共用規則：每頁 page.on('console') 收集 error 等級訊息，page.on('response') 收集 4xx 與 5xx（排除預期的 403 案例），兩者都必須為 0；並對 lib/workspace/navigation.ts 的選單項目，用 R-admin／R-sales-member／R-supervisor／R-store-manager-A／R-staff 逐一驗證可見性，與舊版 components/Navbar.tsx 的同角色可見性比對。
7. 需使用者決策後才能定稿的預期值（測試先以參數化旗標寫好兩種結果）：員編格式（舊 FK 四種格式 vs Vue ^[A-Za-z0-9_-]{1,20}$，EmployeeCreate.vue review()）、批次匯入或異動的整批原子語意、store-personnel 歷程是否限同店（app/api/workspace/store-personnel/route.ts 第 19 行 .eq('store_id', id)）、門市地圖是否預設含已停止門市、已停止數量顯示、『已有店長』提示、督導統計卡。
8. 已確認的實作細節：StoreEmployees.vue 的排序多了 employee_code 作為第三排序鍵（舊版 app/admin/stores/[id]/employees/page.tsx 第 166-171 行只用 POSITION_ORDER 加姓名），同職位又同姓名時順序可能不同，parity 測試要包含這個情境。舊版 DELETE /api/employee-movements/[id] 在刪除 promotion／acting_manager 後會呼叫 lib/monthly-staff/promotion-position-sync.ts 的 syncEmployeePromotionTimelineToMonthlyStaffStatus，Vue 版目前沒有對應功能，是本領域唯一需要新開發的功能缺口。
9. 唯讀聲明：本規劃只讀取程式碼，沒有修改檔案、寫 DB 或啟停伺服器。

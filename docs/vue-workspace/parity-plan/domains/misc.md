# 跨部門、門市盤點、診所自費、關係會員、督導管理日誌

## 領域共用缺口

- 導覽鏈結：lib/workspace/navigation.ts 中商品主檔、診所自費藥毛利、督導管理日誌、商品部、總務組五項沒有 kind，點擊外開舊版；盤點管理與關係會員已有 kind（inventory／relationships）並由 vue-workspace/src/App.vue 掛載。新增頁面需同步擴充 item() 的 kind union 與 App.vue 的 v-else-if 分派。
- 缺少共用 workspace API 骨架：這五個缺漏頁都需要在 app/api/workspace/** 下建立包裝（參考 inventory/route.ts 的 moduleContext + checkOrigin + failed 模式，或 relationships 的 [[...path]] 模式），並在 lib/workspace/modules.ts 註冊模組。
- 權限對齊：clinic-selfpay 導覽可見碼（monthly.status.*、employee.movement.manage、store.manage）與 API 實際權限（store.clinic_selfpay.*，且含職稱判斷）不一致；maintenance 與總務模組共用 lib/general-affairs/maintenance-permissions 的權限碼，需釐清。
- 檔案／圖片上傳：維修照片、診所截圖、併購掃描照片、督導語音音檔都需要 workspace 的圖片／檔案上傳元件（可參考 vue-workspace/src/components/InspectionPhotos.vue、StoreGps.vue）與 Origin 檢查。
- Excel 處理：vue-workspace/src/lib/inventory-files.ts 已有動態載入 xlsx 的 readRows／download，可抽成共用工具供商品主檔、診所價格檔、關係會員範本使用。
- 商品主檔搜尋 API（GET /api/products-master，不檢查權限）被商品部缺貨回報借用，建議先在 workspace 提供共用查詢。
- DEV 測試資料與資料庫：supabase/workspace-dev 目前沒有 stockout、maintenance、clinic_selfpay、acquisition、supervisor_management 的 DEV SQL／apply 腳本（scripts 下僅有 inventory、relationships 等對應 apply-workspace-*-dev.cjs）；需確認 DEV 資料庫是否已有這些資料表與 storage bucket（clinic-selfpay-screenshots、maintenance-photos）。
- 既有測試缺口：五個缺漏頁都沒有 scripts/test-workspace-*.py；只有舊版 scripts/test-supervisor-management-*.js、test-general-affairs-maintenance-*.js、test-production-legacy-*-compatibility.js。盤點與關係會員已有 Playwright 測試，可作為新測試的樣板。
- route-inventory.json、full-migration-checklist.md 這五個缺漏頁狀態為「待逐項盤點」，與本次程式碼檢查結論（missing）一致；盤點管理在文件自評為補齊，但程式碼比對仍有輸出檔名與驗證行為差異。
- AI 語音功能（督導日誌）需 OPENAI_API_KEY，測試時需決定 mock 或使用 LOCAL_RULE_FALLBACK 路徑。

## /cross-dept/merchandise

- 狀態：**missing**（L）— vue-workspace/src、app/api/workspace、lib/workspace 內 grep stockout／merchandise 皆無命中；lib/workspace/navigation.ts:261 僅有無 kind 的導覽連結，等同外開舊版頁。
- 舊版：`app/cross-dept/merchandise/page.tsx（1357 行，單檔含 AddReportModal、RespondModal、主頁）`
- Vue：（無）
- 權限：cross_dept.stockout.view_all（查看全部門市、回覆、刪任意回報）、cross_dept.stockout.respond（回覆商品部、查全部、刪任意回報）、cross_dept.stockout.submit（提交回報、限管轄門市範圍查詢、僅刪自己的回報）、API：無 store 條件的查詢需 view_all 或 respond；提交需 submit／view_all／respond 任一；回覆與刪回覆需 respond 或 view_all
- 相依：商品主檔搜尋 API（products-master）的 workspace 版或共用查詢、workspace 共用 Modal.vue、分頁元件、DEV 資料庫需有 stockout_* 資料表與測試商品／門市／管轄關係（supabase/workspace-dev 下尚無對應 SQL）、navigation.ts 需新增 kind 並在 App.vue 掛上頁面

**舊版功能**

- 頁首「商品部管理」與工具分頁（目前只有「缺貨商品管理」一個分頁）
- 查詢篩選：關鍵字搜尋（商品編號／品名，300ms debounce）、狀態（全部／待回覆／已回覆）、門市下拉（來源為 store_managers 管轄門市）
- 時間範圍：近 30 天（預設）、歷史月份展開／收合，月份按鈕顯示 YYYY-MM（筆數），由 API 回傳 monthBuckets
- 統計卡片：全部回報筆數、待回覆品項數、已回覆品項數
- 工具列：「全部門市／我的門市」分頁（僅 canViewAll 或 canRespond 且有管轄門市時顯示）、狀態切換、重新整理、新增缺貨回報按鈕
- 清單依商品編號聚合（AggregatedProduct），可展開各門市回報明細，每頁 30 筆分頁（上一頁／下一頁）
- 新增缺貨回報 Modal：商品編號輸入即查 /api/products-master（80ms debounce、競態序號防舊請求覆蓋）、建議下拉選單、選定後自動帶品名／單位並聚焦數量、選擇門市、需求數量；商品編號與品名必填、須選門市
- 新增時若該商品已有有效商品部回覆，跳出提醒 Modal（可 Esc 關閉）顯示回覆內容與預計到貨日；過期回覆顯示不同提示
- 商品部回覆 Modal：回覆內容（必填）與預計到貨日（必填，缺填顯示「請填寫預計到貨日」）、新增／編輯回覆
- 回覆顯示：商品部回覆內容、回覆者、時間、ETA；過期（超過 ETA 15 天）顯示「最近一次回覆（已過預計到貨日）」；可展開／收合「回覆歷程」（history API，page=1、pageSize=10）
- 刪除單筆門市回報（confirm「確定刪除這筆回報？」），本人可刪自己的，view_all／respond 可刪任意
- 刪除商品部回覆（API 支援 DELETE /api/stockout-responses?product_code=）

**缺少或不同**

- 整頁無原生 Vue 版本：沒有 Vue 頁面、沒有 workspace API 包裝、App.vue 沒有對應 tab kind（vue-workspace/src/App.vue 僅 import Relationships、Inventory 等已復刻頁）
- navigation.ts:261-265 的 item("商品部") 沒有第四個 kind 參數，點擊會外開舊版
- 舊頁以 supabase client 直讀 store_managers 取管轄門市；Vue 版需由 workspace API 提供
- 舊頁以 /api/permissions/check 逐項檢查三個權限；Vue 版需改由 capabilities 回傳

**業務規則**

- ETA 有效期限：eta_date 為空視為有效；eta_date >= 今天-15 天（Asia/Taipei）視為有效回覆；超過 ETA 30 天則完全不再顯示提醒、視同新回報（頁面 getResponseReminderLowerBound）
- 新增回報時 API 依 stockout_product_responses 的有效性決定 status 為 responded 或 pending（app/api/stockout-reports/route.ts POST）
- 回覆以 product_code 為唯一鍵 upsert，並同步寫入 stockout_product_response_history
- 刪除最後一筆回報時 API 會一併清除該商品的商品部回覆（route.ts DELETE 後段查 stockout_product_responses；細節 uncertain，需再讀 route.ts 250 行之後）
- 一般提交者的列表預設為「我的門市」；有 view_all／respond 預設為「全部門市」
- 分頁 pageSize 預設 30、上限 100

**API**：舊 GET/POST/DELETE /api/stockout-reports、GET/POST/DELETE /api/stockout-responses（含 history=1 歷程）、GET /api/products-master?q=、POST /api/permissions/check、/api/permissions/check-multiple；新 —

**資料表**：stockout_reports、stockout_product_responses、stockout_product_response_history、products_master、store_managers、stores、profiles

**既有測試**：無專屬 workspace 測試。scripts/test-production-legacy-*.js 系列僅為資料庫相容性，未見 stockout 專屬腳本（已 ls scripts | grep stockout 無結果）

**待確認**

- 刪除最後一筆回報是否一併刪除商品部回覆，僅讀到 route.ts 的片段，未讀完整
- month 與 status 篩選在 API 的精確 SQL 條件未完整閱讀

### 測試案例

**冒煙**

- 以 admin 登入 /workspace/index.html，開啟選單點「商品部」：應在工作頁內開啟（不外開），標題「商品部管理」可見，「缺貨商品管理」分頁存在，統計卡三張（全部回報、待回覆品項、已回覆品項）顯示數字，pageerror 與 console error 皆為 0
- GET /api/workspace/stockout（新建）以 admin 呼叫回 200，回傳 reports、monthBuckets、capabilities{canViewAll,canRespond,canSubmit}
- 導覽可見性：admin、stockout_responder、store_mgr_A（submit）看得到「商品部」；no_perm 看不到；anon 呼叫 API 回 401
- 手機 390x844 開頁時 document.documentElement.scrollWidth<=innerWidth

**單元**

- 抽出 lib/stockout/response.ts 的 isResponseActive(response, today) 與 shouldShowResponseReminder(response, today)，today 以參數注入（原 app/cross-dept/merchandise/page.tsx 50-62 行）。案例：response=null 回 false；eta_date=null 回 true；以 today=2026-11-02 測 ETA=2026-10-18（等於 -15 天，active=true）、2026-10-17（active=false 但 reminder=true）、2026-10-03（reminder=true）、2026-10-02（reminder=false）
- getDateInTaipei(offset, now) 時區測試：now=2026-11-01T16:30:00Z 時應回 2026-11-02（Asia/Taipei 跨日）
- 聚合函式 aggregateByProduct(reports, responses)（原 page.tsx 844 行 aggregated IIFE）：同 product_code 多門市回報合併為一筆，總數量加總、門市明細保留，activeMap 只收 isResponseActive 為 true 的回覆
- 分頁計算：pageSize 預設 30、超過 100 夾到 100，page<1 視為 1（對照 app/api/stockout-reports/route.ts GET 參數處理）
- 新增表單驗證：商品編號、品名必填、必須選門市、需求數量>0，錯誤訊息文字與舊版相同；商品搜尋競態序號：較舊請求晚回來時不得覆蓋較新結果（以假 fetch 依序 resolve 測試）

**整合**

- 角色矩陣 GET（無 store 條件）：admin、view_all、respond 回 200 且含全部門市；submit-only（store_mgr_A）回 403 或只回管轄門市 A（依舊版 API 行為對照）；no_perm 回 403；anon 回 401
- 跨門市：store_mgr_A 以 store_id=B 查詢應被拒或回空；store_mgr_A POST 門市 B 的回報應回 403
- POST 回報：商品已有有效回覆（ETA=今天）時新建 status='responded'；回覆 ETA=今天-20 天時新建 status='pending'；無回覆時 pending
- POST 回覆：respond 角色 upsert 同一 product_code 兩次，stockout_product_responses 只有 1 筆，stockout_product_response_history 有 2 筆；缺 eta_date 回 400；submit-only 回覆回 403
- GET 回覆歷程 history=1&page=1&pageSize=10，筆數與順序（新到舊）正確
- DELETE 回報：store_mgr_A 刪自己建的回 200；刪 store_mgr_B 建的回 404 或 403（舊版是 eq reported_by 過濾，實際刪 0 筆，需確認回應碼）；view_all 刪任意回 200
- 刪除最後一筆回報時回傳 clearedResponse:true，DB 中該 product_code 的 stockout_product_responses 被清除；還有其他門市回報時 clearedResponse:false，回覆保留
- DELETE /api/workspace/stockout/responses?product_code= 由 respond 與 view_all 執行回 200，submit-only 回 403
- 並行：兩個 respond session 同時 POST 同一 product_code 回覆（Promise 併發），結束後 responses 僅 1 筆、history 2 筆，無 unique violation 500
- Origin 錯誤的 POST 回 403；空 body 回 400；商品編號不存在於 products_master 時的行為與舊版一致

**E2E**

- submit 角色流程：開商品部，預設分頁為「我的門市」；新增缺貨回報，輸入商品編號前綴，下拉出現建議後選定，品名與單位自動帶入、焦點移到數量；選門市 A、數量 3 送出；清單出現聚合列，展開後看到門市 A 明細；刪除時出現 confirm「確定刪除這筆回報？」，確認後消失
- respond 角色流程：預設分頁為「全部門市」；狀態篩選「待回覆」看得到上筆；開回覆 Modal，未填 ETA 送出顯示「請填寫預計到貨日」；填內容與 ETA 送出後狀態變已回覆，顯示回覆者、時間、ETA；展開回覆歷程看到 1 筆；再編輯一次後歷程變 2 筆
- 重複提醒：回覆後以 submit 角色再新增同商品，應跳出提醒 Modal 顯示回覆內容與 ETA，Esc 可關閉
- 過期回覆：DB 預置 ETA=今天-20 天的回覆，清單顯示「最近一次回覆（已過預計到貨日）」
- 歷史月份：展開歷史月份，按鈕文字為 YYYY-MM（筆數），點擊後清單只剩該月資料
- 搜尋 debounce：快速輸入後 300ms 內只送出 1 次查詢（以 page.on('request') 計數）
- 分頁：預置 35 個商品，第 1 頁 30 筆、下一頁 5 筆
- 失敗路徑：以 page.route 攔截 POST 回 503，Modal 保留輸入並顯示錯誤；未存離開時出現放棄確認

**對等驗證**

- 同一 DEV 資料、同一角色（admin、store_mgr_A），以相同參數（status、store、month、keyword、page）分別呼叫 GET /api/stockout-reports 與 GET /api/workspace/stockout，比對 reports 的 id 集合、monthBuckets、總筆數、pending／responded 計數
- 畫面比對：舊版 /cross-dept/merchandise 與 Vue 版以同一角色、同篩選讀出統計卡三個數字、第一頁聚合列的商品編號順序與總數量，必須完全相等
- 寫入對等：在舊版 POST 一筆、Vue 版 POST 一筆（不同 token），從 DB 讀出 stockout_reports 兩列，除 id、created_at、product_code 外所有欄位（status、store_id、reported_by、quantity、unit）相同；回覆的 history 欄位結構相同
- 刪除對等：在兩邊各刪掉「最後一筆」回報，兩邊都回 clearedResponse:true，回覆都被清除

**測試資料**

- products_master：VUETEST-SO-001..035 共 35 筆（含品名、單位，is_active=true）
- stores：門市 A、B（沿用 DEV 既有，例 0002、0003）；store_managers：store_mgr_A 對 A、store_mgr_B 對 B
- stockout_product_responses：一筆 ETA=今天、一筆 ETA=今天-20、一筆 ETA=今天-40、一筆 ETA=null
- stockout_reports：跨兩個月份（本月、上月）各數筆，用來驗 monthBuckets
- 角色：admin、stockout_responder（cross_dept.stockout.respond）、stockout_viewall（view_all）、store_mgr_A／store_mgr_B（submit）、no_perm、anon
- 需新增 supabase/workspace-dev/stockout 測試 seed 與 cleanup SQL（目前不存在）

**風險**

- 舊版以瀏覽器端 supabase client 直讀 store_managers，Vue 版改走 API 後管轄門市來源要一致
- ETA 判斷依賴當日日期，測試要注入 today，否則跨日會不穩定
- DELETE 非本人時舊版是加過濾條件而非 403，回應碼要先確認再寫斷言
- 商品搜尋依賴未檢查權限的 /api/products-master GET，workspace 版是否要加權限要先決定

## /cross-dept/maintenance

- 狀態：**missing**（XL）— Vue 端無維修／總務工單相關頁面或 API（grep maintenance 只命中 navigation.ts）；導覽項「總務組」無 kind，外開舊版。
- 舊版：`app/cross-dept/maintenance/page.tsx（1696 行）`
- Vue：（無）
- 權限：cross_dept.maintenance.view_all、cross_dept.maintenance.submit、cross_dept.maintenance.update、cross_dept.maintenance.category.edit、API 另引用 lib/general-affairs/maintenance-permissions 的 SHARED_MAINTENANCE_REQUEST_VIEW_ALL_CODES／CREATE_CODES（與總務模組共用權限，具體碼未逐一展開，uncertain）
- 相依：workspace 圖片上傳與預覽元件（可參考 InspectionPhotos.vue）、與總務服務中心（/general-affairs/*）的邊界釐清、DEV 資料庫維修相關表及 storage bucket 需確認存在

**舊版功能**

- 頁首「總務組管理」；無任何相關權限時顯示無權限畫面
- 篩選：門市（canViewAll 可選「全部門市」，否則只列管轄門市）、年月（type=month）、維修分類（全部分類／未分類／各分類）、狀態、關鍵字（搜尋維修項目）、分頁
- 各門市狀態統計摘要表（僅 canViewAll）：未受理／已受理／處理中／待處理／進行中／已完成／總計，依年月查 /api/maintenance-requests/summary
- 維修分類管理區（canEditCategories，權限 cross_dept.maintenance.category.edit）：新增、改名、排序、啟用／停用分類，可顯示停用分類
- 新增維修回報 Modal：選門市、維修項目（必填）、說明、前置照片（photo_type=before，最多 5 張，含預覽與移除），建立後再上傳照片，上傳失敗時提示「維修回報已建立，但照片上傳失敗」
- 回報列表卡片：標題、優先度徽章（low/normal/high/urgent）、狀態徽章、進度階段、分類（有 update 權限時為下拉可直接改分類，PATCH /api/maintenance-requests；否則為唯讀徽章）、門市、回報人、回報時間
- 展開卡片：詳細說明、照片（signed_url）、補傳照片（最多 5 張）、進度更新歷程（含更新照片、PUBLIC／INTERNAL 可見度）
- 進度更新（canUpdate）：狀態（已受理／處理中／處理完成，請門市確認）、進度階段（16 種階段標籤）、更新說明、進度日期、進度照片（最多 5 張），POST /api/maintenance-updates 及 /api/maintenance-update-photos
- 門市端（canSubmit）操作：對已回報完成的單據確認／回報（STORE_CONFIRM_COMPLETE／REPORT_UNRESOLVED，lib/maintenance/status.ts 定義 action），由 ticket-events API 處理（頁面中 grep 未直接命中 ticket-events，uncertain）
- 刪除維修回報（confirm「確定要刪除這筆維修回報嗎？」；本人、view_all、update 可刪）
- 舊狀態相容：legacy pending／in_progress／completed／closed 以 normalizeMaintenanceStatus 轉為 UNACCEPTED／ACCEPTED／PROCESSING／COMPLETED

**缺少或不同**

- 整頁無 Vue 版；所有功能（篩選、統計、分類管理、照片上傳、進度更新、刪除）皆需復刻
- 需重新設計圖片上傳（signed URL 與 storage bucket）到 workspace API，並維持 Origin 檢查（lib/workspace/server.ts 的 checkOrigin）
- 注意：lib/workspace/navigation.ts 另有「總務服務中心」群組與 GA_MAINTENANCE_MODULE_CODES（總務維修／工單），與此跨部門頁並存，需確認兩者是否共用資料表與 API（此為另一個領域，未讀）

**業務規則**

- submit 僅限自己管轄門市（getManagedStoreIds 查 store_managers）；無門市條件的查詢需 view_all
- 每筆回報照片最多 5 張，每次進度更新照片最多 5 張
- 狀態機：UNACCEPTED -> ACCEPTED -> PROCESSING -> COMPLETED，完成需門市確認，亦有 ADMIN_FORCE_CLOSED 強制結案（lib/maintenance/status.ts）
- 進度事件可見度 PUBLIC／INTERNAL
- 分類刪除／停用與排序規則見 /api/maintenance-categories（未逐行閱讀）

**API**：舊 /api/maintenance-requests（GET/POST/PATCH/DELETE）、/api/maintenance-requests/summary、/api/maintenance-categories、/api/maintenance-photos、/api/maintenance-updates、/api/maintenance-update-photos、/api/maintenance-progress-stages、/api/maintenance-ticket-events；新 —

**資料表**：maintenance_requests、maintenance_photos、maintenance_updates、maintenance_update_photos、maintenance_categories、maintenance_ticket_events、maintenance_progress_stages、store_managers、stores、profiles、storage bucket maintenance-photos

**既有測試**：scripts/test-general-affairs-maintenance-ui.js、scripts/test-general-affairs-maintenance-views.js、scripts/test-production-legacy-general-affairs-maintenance-compatibility.js（皆為總務模組或資料庫相容性，非本頁 Vue 復刻測試）

**待確認**

- 頁面是否直接呼叫 maintenance-ticket-events（grep 未命中，狀態轉換可能經 maintenance-updates API 內部觸發）
- 1224-1285 行門市確認按鈕的實際 API 呼叫未逐行確認

### 測試案例

**冒煙**

- admin 開「總務組」在工作頁內開啟，標題「總務組管理」可見，篩選列（門市、年月、分類、狀態、關鍵字）存在，清單載入，無 console error
- no_perm 直接開工作頁（若 URL 可直達）顯示無權限畫面；導覽中看不到「總務組」
- view_all 角色看得到各門市狀態統計摘要表（未受理、已受理、處理中、待處理、進行中、已完成、總計）；submit-only 看不到
- GET /api/workspace/maintenance、/summary、/categories 以 admin 呼叫皆回 200

**單元**

- lib/maintenance/status.ts normalizeMaintenanceStatus：legacy pending→UNACCEPTED、in_progress→ACCEPTED 或 PROCESSING（依程式實際對應寫斷言）、completed→COMPLETED、closed→COMPLETED 或 ADMIN_FORCE_CLOSED（依實作）；大小寫與空白容錯；未知值回 null
- normalizeProgressStage：16 種合法階段原樣回傳，非法值回 null；getProgressStageLabel 與 MAINTENANCE_PROGRESS_STAGE_LABELS 一一對應（16 個標籤無遺漏、無重複）
- getMaintenanceStatusLabel 對每個狀態回正確中文；EXECUTION_PROGRESS_STAGES 成員快照
- lib/maintenance/status-service.ts 狀態轉移表：UNACCEPTED→ACCEPTED→PROCESSING→COMPLETED 合法；COMPLETED 需門市確認；STORE_CONFIRM_COMPLETE 與 REPORT_UNRESOLVED 的前置狀態限制；任意狀態可被 ADMIN_FORCE_CLOSED
- 照片數量驗證抽成 validatePhotoBatch(files, existingCount, max=5)：第 6 張被拒、非圖片 MIME 被拒
- 優先度徽章對應 low/normal/high/urgent 的標籤與樣式 class 快照

**整合**

- 角色矩陣 GET：view_all 看全部門市；submit（store_mgr_A）只看到門市 A，帶 store_id=B 回 403 或空；update 角色可見範圍以舊版 API 實測為準；no_perm 403；anon 401
- POST 回報：store_mgr_A 建門市 A 成功；建門市 B 回 403；缺維修項目回 400
- 照片：POST before 照片 5 張成功，第 6 張回 400；回傳 signed_url 可 GET 200；storage bucket maintenance-photos 有檔案；刪回報後檔案被清除（依舊版行為確認）
- PATCH 分類：update 角色可改，submit-only 回 403
- 進度更新：update 角色 POST /maintenance-updates（status=ACCEPTED、stage、說明、日期），maintenance_updates 與 maintenance_ticket_events 各新增 1 筆；附 5 張進度照片成功、6 張失敗；visibility=INTERNAL 的更新，以 submit 角色 GET 時不可見
- 門市確認：COMPLETED 待確認的單據由 store_mgr_A 執行 STORE_CONFIRM_COMPLETE 成功；store_mgr_B 對 A 的單據執行回 403；REPORT_UNRESOLVED 讓狀態回到處理中（依 status-service）
- 分類管理：category.edit 角色新增、改名、排序、停用成功；無 category.edit 回 403；停用分類不出現在一般下拉、勾選「顯示停用」時才出現
- DELETE：本人、view_all、update 可刪；他人 submit 回 403
- summary：指定年月時，各門市各狀態計數等於直接查 DB 的 group by 結果
- 並行：兩個 update session 同時對同一單 POST 狀態轉移，最終狀態合法、events 順序一致，無重複轉移
- 與總務服務中心共用權限碼（lib/general-affairs/maintenance-permissions 的 SHARED_MAINTENANCE_REQUEST_VIEW_ALL_CODES／CREATE_CODES）：只具總務碼的角色在兩邊 API 結果一致

**E2E**

- store_mgr_A：新增維修回報，選門市 A、填維修項目與說明、上傳 2 張前置照片（預覽可見，移除 1 張後剩 1 張），送出後卡片出現，狀態「未受理」
- 照片上傳失敗：以 page.route 讓照片 API 回 500，顯示「維修回報已建立，但照片上傳失敗」，卡片仍存在；展開卡片補傳照片成功
- maintenance_updater：展開該卡，進度更新選「已受理」與一個階段、填說明與日期、附 1 張照片送出；時間線出現該筆並顯示照片；再更新為「處理完成，請門市確認」
- store_mgr_A：看到待確認按鈕，按下確認完成後狀態變已完成；另一張單按「回報未解決」後狀態回處理中
- 分類下拉：updater 在卡片上直接改分類，重新整理後保留；submit-only 只看到唯讀徽章
- 分類管理區：category.edit 新增分類、上移排序、停用，篩選下拉同步更新
- 篩選：年月、分類「未分類」、狀態、關鍵字組合後清單正確；分頁可切換
- 刪除：confirm「確定要刪除這筆維修回報嗎？」，確認後消失

**對等驗證**

- 同角色、同年月與門市，比對 GET /api/maintenance-requests 與 /api/workspace/maintenance 的 id 集合、normalize 後狀態、分類、照片數
- /api/maintenance-requests/summary 與 workspace summary 的每門市各狀態計數逐格相等；畫面上兩版統計摘要表數字也逐格比對
- 對同一筆舊資料（legacy status=in_progress）兩版顯示相同的中文狀態與徽章
- 寫入對等：兩版各建一筆含 1 張照片的回報並完成同一序列的狀態轉移，比對 maintenance_requests、maintenance_updates、maintenance_ticket_events 的欄位序列（排除 id 與時間）

**測試資料**

- stores A、B；store_managers：store_mgr_A 對 A、store_mgr_B 對 B
- maintenance_categories：啟用 3 筆、停用 1 筆，前綴 VUETEST
- maintenance_requests：各狀態至少 1 筆（含 legacy pending／in_progress／completed／closed 原始值各 1 筆），跨兩個年月，含未分類
- maintenance_progress_stages 確認 DEV 已有 16 階段
- 測試圖片：.tmp-check/maint-1.jpg 至 maint-6.jpg（小尺寸 jpeg）
- storage bucket maintenance-photos 存在於 DEV；cleanup 要刪 storage object
- 角色：admin、maint_viewall、maint_updater（update）、maint_category（category.edit）、store_mgr_A／store_mgr_B（submit）、no_perm、anon

**風險**

- 頁面是否直接呼叫 maintenance-ticket-events 尚未確認（uncertain），門市確認的 API 路徑要先讀 page.tsx 1224-1285 行
- 與 /general-affairs 維修模組共用資料表與權限，測試資料可能互相影響，查詢要用 token 過濾
- signed URL 有效期限會造成截圖比對不穩定

## /cross-dept/products-master

- 狀態：**missing**（XL）— Vue 端無 products-master 相關檔案；navigation.ts:152 的「商品主檔」無 kind，外開舊版。
- 舊版：`app/cross-dept/products-master/page.tsx（89 行）+ components/products-master/StandardProductsMasterTab.tsx（194 行）+ components/products-master/AcquisitionProductsTab.tsx（1381 行）`
- Vue：（無）
- 權限：store.products_master.manage（頁面與 POST/DELETE API 皆檢查；GET /api/products-master 本身不檢查權限，亦被商品部回報頁借用）
- 相依：xlsx 動態載入（可參考 vue-workspace/src/lib/inventory-files.ts）、商品主檔搜尋 API 是商品部缺貨回報頁的相依項，建議先做、相機／檔案上傳元件

**舊版功能**

- 權限閘：POST /api/permissions/check store.products_master.manage，無權限顯示「沒有存取此頁面的權限」
- 頂部兩個分頁：「商品主檔」與「併購藥局商品主檔整理」
- 商品主檔分頁（StandardProductsMasterTab）：載入全部商品（GET /api/products-master?all=1）、搜尋商品編號或品名、匯入 .xlsx/.xls（POST FormData，顯示「成功匯入 N 筆商品」或錯誤）、停用商品（confirm 確定停用商品「code」→ DELETE ?product_code=）
- 併購藥局分頁（AcquisitionProductsTab）含四個子分頁 dashboard／import／scan／unmatched
- dashboard：統計 products_master 筆數、product_barcodes 筆數、未解決 acquisition_unmatched 數、今日 acquisition_scans 清單；資料表不存在時顯示 TableMissingState
- import：選 .xlsx/.xls、解析前列、欄位對應（未完成對應會 alert「請先完成欄位對應」）、預覽（品號、品名、單位、條碼）、確認後分批 upsert products_master 與 product_barcodes（onConflict barcode,product_code）
- scan：條碼輸入框（Enter 查詢；normalizeBarcode／buildBarcodeCandidates 產生多組候選條碼比對）、可用相機（getUserMedia）拍照或上傳圖片（多張）、命中商品寫入 acquisition_scans、未命中可填商品名稱／條碼／供應商／備註存入 acquisition_unmatched、日期切換、清除該日所有掃描紀錄（confirm）、刪單筆掃描（confirm）
- unmatched：未建立商品列表（掃描條碼、商品名稱(OCR)、商品條碼(OCR)、供應商、照片、狀態、操作）、編輯、切換已解決、刪除（confirm）、匯出 Excel「未建立商品」

**缺少或不同**

- 整頁缺漏，包含兩個分頁與所有子功能
- 併購分頁直接以瀏覽器 supabase client 讀寫 products_master、product_barcodes、acquisition_scans、acquisition_unmatched，沒有 API 層；Vue workspace 規範是走 /api/workspace/**，需新建後端 API 並處理 RLS／權限
- 相機拍照與圖片上傳需移植（照片存放方式 uncertain，需讀 AcquisitionScan 完整程式）

**業務規則**

- 商品停用而非刪除（DELETE 為停用，細節 uncertain）
- 條碼比對使用多組候選碼（前導零、檢查碼等變體），邏輯在 AcquisitionProductsTab.tsx 70-155 行 normalizeBarcode／buildBarcodeCandidates
- 匯入以 product_code 為鍵 upsert，條碼表衝突鍵 (barcode, product_code)
- 未建立商品匯出檔名含日期（見 handleExport，約 1120-1140 行）

**API**：舊 GET/POST/DELETE /api/products-master、瀏覽器直接 supabase 查詢（無 API）；新 —

**資料表**：products_master、product_barcodes、acquisition_scans、acquisition_unmatched

**既有測試**：scripts/test-production-legacy-product-relationship-clinic-performance-compatibility.js（資料庫相容性，非 UI）

**待確認**

- DELETE 實作是硬刪除或設 is_active=false（僅讀到 route 第 147-160 行表名，未讀完整）
- 掃描照片是否上傳至 storage 或僅存 base64（未讀完）
- acquisition_* 資料表是否已存在於 supabase/migrations（ls 篩選未命中 acquisition，可能在較早的 migration，未確認）

### 測試案例

**冒煙**

- admin 開「商品主檔」在工作頁內開啟，可見「商品主檔」與「併購藥局商品主檔整理」兩分頁，標準分頁載入清單（筆數>0），無 console error
- no_perm 看不到導覽項；直接呼叫 workspace API 回 403，畫面顯示「沒有存取此頁面的權限」
- 併購分頁四個子分頁（總覽、匯入、掃描、未建立商品）都能切換；資料表不存在時顯示 TableMissingState 而非白畫面

**單元**

- 抽出 lib/products-master/barcode.ts 的 normalizeBarcode（原 components/products-master/AcquisitionProductsTab.tsx 70 行）："'4710000000001"→'4710000000001'；'4710-000 000001'→'4710000000001'；'4987170870977.0'→'4987170870977'；'4.98717087E+12'→'4987170870000'（依 toFixed 結果）；''→''
- buildBarcodeCandidates（95 行）：輸入 "'4710000000001" 的候選含原字串、normalized、digitsOnly、"'"+normalized、normalized+'.0'，且去重；空字串回 []
- 匯入欄位對應 mapColumns(headerRow, mapping)：未完成對應時拋出「請先完成欄位對應」；預覽列輸出品號、品名、單位、條碼
- 匯入資料轉換 buildUpsertRecords(rows)：product_code 去空白與補零（若舊版有）、空品號列略過、同檔重複品號以最後一筆為準（依舊版行為）、條碼紀錄鍵為 (barcode, product_code)
- compressImage（1318 行）：寬度大於 900 時等比例縮到 900，小於等於 900 不放大（在 jsdom 加 canvas mock，或 Playwright evaluate）
- 未建立商品匯出檔名 buildUnmatchedExportName(date)：符合舊版 handleExport 格式（含日期）

**整合**

- GET /api/workspace/products-master?all=1：manage 角色回 200；no_perm 回 403（舊版 GET 不檢查權限，workspace 版需定義：頁面讀取要權限，商品搜尋子路徑供缺貨回報使用時改為登入即可，兩者分開測）
- POST 匯入 xlsx：manage 角色回 success 與 count；10 筆的 xlsx 匯入後 DB 有 10 筆、is_active=true；重匯同品號為 upsert 不重複；非 xlsx 檔回 400；no_perm 回 403
- DELETE 停用：manage 角色回 200，DB 中 is_active=false 且資料列仍在；no_perm 必須回 403（舊版 route.ts 147-165 行 DELETE 只檢查登入，是漏洞，workspace 版需修正並記錄為已知差異）；缺 product_code 回 400
- 併購 API（新建，取代瀏覽器直連 supabase）：import 分批 upsert products_master 與 product_barcodes，1200 筆分批後筆數正確；scan 命中寫入 acquisition_scans；未命中寫入 acquisition_unmatched；清除該日掃描只刪該日；未建立商品狀態切換、編輯、刪除；全部需要 manage 權限
- dashboard 統計：products_master、product_barcodes、未解決 unmatched、今日 scans 的計數，與直接 count 查 DB 相等
- 並行：兩個 session 同時匯入重疊品號，結束後無重複列、無 500

**E2E**

- 標準分頁：搜尋品號前綴 VUETEST 篩出 N 筆；上傳測試 xlsx 後顯示「成功匯入 N 筆商品」；停用一筆時跳出 confirm 確定停用商品「code」，確認後從清單消失（或標示停用，依舊版）
- 併購匯入：選 xlsx、完成欄位對應、預覽 4 欄、確認匯入；未完成對應直接按確認時出現提示
- 掃描：輸入框輸入 "'VUETESTBC001" 後按 Enter，比對命中，今日清單新增一筆；輸入不存在的條碼後填商品名稱、供應商、備註並存為未建立；刪除單筆掃描與清除該日（兩個 confirm）
- 相機：以 Playwright 的 --use-fake-device-for-media-stream 授權後拍照產生縮圖；另測上傳多張圖片
- 未建立商品：編輯、切換已解決、刪除；匯出 Excel，下載檔名與舊版格式一致，內容欄位標題相同
- 失敗路徑：匯入 API 回 503 時保留已選檔案與對應設定

**對等驗證**

- 同一份測試 xlsx 先後用舊版與 Vue 版匯入（不同 token 前綴），比對 products_master 與 product_barcodes 的資料列（排除時間、上傳者）完全相同
- GET /api/products-master?all=1 與 workspace 版的 product_code 集合與欄位一致
- 條碼比對：準備 20 個不同格式的條碼字串，分別在舊版 UI 與 Vue 版掃描，命中結果（命中品號或未命中）逐一相同；單元層用同一個抽出的函式
- 未建立商品匯出：兩版匯出的 xlsx 以 SheetJS 讀成 JSON 後 deep equal

**測試資料**

- products_master：VUETEST-PM-001..010；product_barcodes：每個品號各 1-2 個條碼，含前導零、.0、單引號等格式
- 匯入 xlsx：.tmp-check/pm-import-10.xlsx（標準）、pm-import-1200.xlsx（分批）、pm-import-dup.xlsx（重複品號）、bad.txt
- acquisition_scans 與 acquisition_unmatched：今日與昨日各數筆
- 測試圖片 2 張；Chromium fake media stream
- 角色：admin、pm_manager（store.products_master.manage）、no_perm、anon
- 需先確認 DEV 是否有 acquisition_scans 與 acquisition_unmatched 資料表（migration 位置 uncertain）

**風險**

- 舊版併購分頁由瀏覽器直接讀寫 supabase（受 RLS 約束），改成 workspace API 後若用 admin client 可能放寬權限，必須以權限矩陣驗證
- DELETE 權限漏洞：要決定修正或沿用，並讓使用者知道
- 掃描照片儲存方式（storage 或 base64）尚未確認
- 大量匯入分批大小不同，可能造成部分成功的差異

## /inventory

- 狀態：**partial**（S）— Vue 已原生復刻離線三模組與結果分析（匯入、複盤、刪除、原因、門檻、Top10、CSV），導覽有 kind=inventory；但輸出檔名、驗證行為與舊版有可見差異，且 Vue 另增 CSV 匯出。依程式碼不能判定為完全一致，故標 partial（差距小）。
- 舊版：`app/inventory/page.tsx（3013 行）+ app/api/inventory/result-analysis/route.ts（1260 行）`
- Vue：`vue-workspace/src/pages/Inventory.vue（1174 行）`、`vue-workspace/src/components/InventoryOffline.vue（267 行）`、`vue-workspace/src/lib/inventory-files.ts（173 行）`
- 權限：inventory.manage、inventory.inventory.access、inventory.inventory.view（離線工具）、inventory.result_analysis.view_own（只看自己門市的分析）、inventory.result_analysis.import、inventory.result_analysis.delete、差異原因門檻設定：由 API 回傳 can_manage_difference_reason_threshold（依 inventory.manage 判定）
- 相依：無必先頁面；測試需 DEV 資料庫的盤點批次資料與 supabase/workspace-dev/ 的 apply-workspace-inventory-dev.cjs 已套用

**舊版功能**

- 功能區切換：「離線盤點匯入匯出工具」（需 inventory.manage／inventory.inventory.access／inventory.inventory.view）與「盤點結果分析報表」（需 inventory.result_analysis.view_own 或上述）
- 全域 1F 當日商品資料上傳（必填；讀第二列為標題，欄位含品號、品名、條碼、庫存、主要儲位、UN／單位）
- 模組一「產出外盤複盤清單」：匯入外盤公司原始檔（品號重複即 alert 拒絕並列出重複品號）與 FKS0701 盤點紀錄，依品號加總與庫存比對，僅輸出外盤檔內有盤差的品號，檔名「外盤應複盤清單_日期.xlsx」；無需複盤時提示「沒有需要複盤的品項」
- 模組二「內部＋外盤整合之複盤表與未盤表」：預盤資料（選填、可多檔並顯示成功／失敗檔案數）、FKS0701、外盤公司 Stock 明細檔（貨號、數量、貨架、棚板、序號），輸出「內部盤點複盤資料_日期.xlsx」與「系統有庫存但未盤點檔案_日期.xlsx」，並保留盤差為 0 的品項供模組三使用
- 模組三「產出匯入DPOS檔案」：匯入修改後內部複盤資料與修改後未盤點檔案，合併模組二無盤差品項，輸出「M月D日盤點結果檔.xlsx」（品號、庫存量、實際量、盤差量）
- 結果分析：年月、批次名稱（空白用檔名）、匯入 .xlsx（欄位：店號、店名、盤點單號、結案?、品號、品名、單位、儲位1、儲位2、盤差量、盤差額(會員)、成本、單位成本、庫存量、庫存額）、匯入說明可收合
- 查詢：店號或店名、盤點單號、年月；進入頁面不自動載入，需先查詢
- 批次清單、選批次、報表視圖（batch／merged／recount_changes）、複盤匯入（再次盤點）、刪除批次（confirm）
- 分類摘要卡（點分類篩選、可收合）、排除特殊分類、只看有盤差、只看需填原因（成本門檻預設 100）、盤虧／盤盈前十名
- 明細表排序（品號、分類、品名、儲位、盤差量、成本、會員價盤差金額、庫存量、庫存額）、每頁 200 筆分頁
- 差異原因：逐列填寫並儲存（PATCH）、原因 Excel 匯出與匯入（含爭議異動明細匯出）、門檻設定（can_manage_difference_reason_threshold 才可見）

**缺少或不同**

- 輸出檔名不同：舊版 外盤應複盤清單_YYYY/M/D.xlsx、內部盤點複盤資料_日期.xlsx、系統有庫存但未盤點檔案_日期.xlsx；Vue download() 固定為「外盤應複盤清單」「內部複盤資料」「未盤表」等無日期名稱（InventoryOffline.vue 的 save 呼叫與 inventory-files.ts download）
- Vue 的 download() 工作表名固定「盤點資料」，舊版為 Sheet1（匯出原因報表為「盤差原因」「爭議異動明細」）
- Vue 的 finalRows 在品號同時存在無盤差與複盤資料、或庫存量不一致時直接拋錯；舊版 generateModule3Result 不驗證，僅累加（行為較嚴格，屬差異）
- 舊版預盤多檔匯入會逐檔容錯並彙總「成功 N/M，失敗檔案列表」；Vue upload 只要任一檔錯誤就整批中止（inventory-files normalize 拋錯）（依程式推論，需實測）
- 舊版模組一 canvas：無需複盤時以 alert 提示；Vue 是否有對應提示未見（InventoryOffline.vue run() 僅設定 external，無空結果訊息，uncertain）
- Vue 新增了舊版沒有的 CSV 匯出（Inventory.vue 約 426-471 行）；舊版只有原因 Excel／爭議異動 Excel
- 舊版 1F 商品資料讀取以 header:1 找欄位索引與 XLSX 格式容錯（FKS0701 以欄名 includes 比對）；Vue 以 range=1 讀取並 includes 比對，二者等價性需用同一測試檔比對
- Vue 的離線／分析以「工作頁 tab」呈現並有 dirty 離開保護，屬版面差異

**業務規則**

- 品號補零至 8 位（Vue code()），舊版 formatProductCode
- 盤差 = 全店盤點數量加總 - 庫存；僅盤差非 0 進複盤表；庫存非 0 且未被盤點者列入未盤表
- 外盤原始檔品號不可重複
- 差異原因成本門檻預設 100，達門檻才需填原因
- 分析明細每頁 200 筆；報表視圖支援一般批次、合併複盤結果、複盤差異
- API 讀寫共用同一支 result-analysis route，workspace 僅包裝 moduleContext("inventory") 與 Origin 檢查

**API**：舊 GET/POST/PATCH/DELETE /api/inventory/result-analysis；新 GET/POST/PATCH/DELETE /api/workspace/inventory（app/api/workspace/inventory/route.ts，包裝原 route）

**資料表**：inventory_result_batches、inventory_result_items（名稱依 migration 20260817093000_inventory_result_analysis_recount_versions.sql 推定，未逐一確認）、inventory_difference_reason 相關設定表（uncertain）

**既有測試**：scripts/test-workspace-inventory.py、scripts/test-workspace-inventory-analysis.py、scripts/test-workspace-inventory-files.cjs、scripts/test-inventory-result-analysis-merged-summary.js、scripts/test-inventory-result-analysis-query-behavior.js、.tmp-check/inventory-external.xlsx、inventory-internal.xlsx、inventory-final.xlsx 與桌機／手機截圖（離線與分析頁）

**待確認**

- 離線三模組的計算結果與舊版逐列是否一致，需以同一組 Excel 對跑；只讀程式碼無法保證
- 舊版 1F 商品資料是否會有額外欄位處理（如 K 欄）未逐行比對
- docs/vue-workspace/feature-parity-review.md 2026-10-30 自評已補齊，本次以程式碼為準仍發現檔名與驗證差異

### 測試案例

**冒煙**

- admin 開「盤點管理」（kind=inventory），兩個功能區（離線工具、結果分析）都可切換，無 console error；結果分析進頁時不會自動查詢（network 中沒有 GET /api/workspace/inventory 的資料查詢，或查詢只取 meta）
- 權限可見性：只有 inventory.result_analysis.view_own 的角色看不到離線工具、看得到分析；只有 inventory.inventory.view 的角色看得到離線工具、看不到匯入與刪除按鈕；no_perm 看不到導覽項
- 重跑既有 scripts/test-workspace-inventory.py、test-workspace-inventory-analysis.py、test-workspace-inventory-files.cjs 必須全部 PASS

**單元**

- vue-workspace/src/lib/inventory-files.ts code()／formatProductCode 對等：'123'→'00000123'、123→'00000123'、'00000123'保持不變、空值行為與 app/inventory/page.tsx 333 行 formatProductCode 相同（同一組 20 個輸入對兩個函式斷言）
- num()：'1,234'→1234、''→0、'-3'→-3、非數字→0（與舊版一致）
- normalize(rows,'external')：外盤原始檔有重複品號時拋錯，錯誤訊息列出重複品號（對應舊版 alert）
- integrate(base, records)：盤差=盤點總和-庫存；盤差 0 的列不進複盤表但保留供模組三；庫存非 0 且未盤的列進未盤表
- finalRows(zero, internal, missing)：輸出欄位為品號、庫存量、實際量、盤差量；記錄 Vue 在品號衝突、庫存不一致時拋錯，與舊版 generateModule3Result 只累加不同（測試用來固定此差異，等決定沿用或修正）
- download() 輸出檔名與工作表名：目前 Vue 的檔名不含日期、工作表名為「盤點資料」，舊版為「外盤應複盤清單_YYYY/M/D.xlsx」等、工作表 Sheet1。修正後以單元測試鎖定為舊版格式
- Inventory.vue 原因門檻判斷 needsReason(row, threshold=100)：|成本| >= 門檻才需填（依實作確認是用 >= 還是 >）

**整合**

- 沿用 test-workspace-inventory-analysis.py 並擴充角色矩陣：view_own 只看自己門市的批次（門市 B 的批次 id 不在回應中）；import 權限才可 POST；delete 權限才可 DELETE；PATCH 原因需有對應權限；no_perm 403；anon 401；Origin 錯 403
- 門檻設定：can_manage_difference_reason_threshold=true 的角色可改門檻，其他角色 PATCH 回 403
- 複盤匯入（再次盤點）產生新版本後，報表視圖 batch、merged、recount_changes 三種結果與舊 API 相同
- 並行：兩個 session 同時 PATCH 同一列差異原因，最後寫入勝出，無 500
- 錯誤路徑：xlsx 缺必要欄位（例如沒有盤差量欄）回 400，訊息與舊版相同

**E2E**

- 離線模組一：上傳 1F 當日商品資料、外盤原始檔、FKS0701，產出並下載，檔名符合「外盤應複盤清單_日期.xlsx」（修正後），內容只含有盤差的品號；無盤差時顯示「沒有需要複盤的品項」（目前 Vue 是否有此提示 uncertain，先寫成會失敗的測試）
- 外盤原始檔有重複品號時顯示錯誤並列出重複品號
- 模組二：預盤 3 檔（其中 1 檔格式錯）。舊版行為是成功 2/3 並列出失敗檔案，Vue 需相同（目前 Vue 會整批中止，寫成待修測試）。下載複盤表與未盤表 2 個檔案
- 模組三：匯入修改後的兩個檔案，下載「M月D日盤點結果檔.xlsx」
- 結果分析：查詢店號、選批次、切換三種視圖、點分類摘要卡篩選、只看有盤差、只看需填原因、Top10、表頭排序、200 筆分頁、逐列填原因並儲存、原因 Excel 匯出再匯入、門檻設定、刪除批次（confirm）
- dirty 離開保護：原因填到一半切換頁籤時出現確認視窗

**對等驗證**

- 離線三模組黃金檔比對：以同一組輸入檔（.tmp-check/inventory-*.xlsx 與新增邊界檔：補零品號、負庫存、儲位空白、K 欄額外欄位）分別在舊版 /inventory（Playwright 操作並攔截下載）與 Vue 版產出，SheetJS 讀成 JSON 後逐列 deep equal（品號排序後），同時比對檔名與工作表名
- 結果分析 API：同角色、同批次與參數，GET /api/inventory/result-analysis 與 /api/workspace/inventory 的 JSON deep equal（workspace 只是包裝，應完全相同）
- 畫面比對：兩版同一批次的分類摘要卡數字、Top10 品號與金額、第 1 頁 200 筆的品號順序（同一排序鍵）相同
- 原因 Excel 匯出：兩版匯出檔的工作表名（盤差原因、爭議異動明細）與內容相同
- Vue 的 CSV 匯出是新增功能，不列入對等，但要標成已知差異

**測試資料**

- 沿用 apply-workspace-inventory-dev.cjs 與 .tmp-check/inventory-external.xlsx、inventory-internal.xlsx、inventory-final.xlsx
- 新增邊界檔：inv-1f.xlsx（第二列為標題）、inv-external-dup.xlsx（重複品號）、inv-predisk-bad.xlsx、inv-nodiff.xlsx（無盤差）
- inventory_result_batches：門市 A、B 各 1 批，以及 1 個複盤版本
- 角色：admin、inv_manage、inv_view（inventory.inventory.view）、inv_view_own_A（result_analysis.view_own，門市 A）、inv_importer、inv_deleter、no_perm、anon

**風險**

- 已知差異：輸出檔名與工作表名、模組三的嚴格驗證、預盤多檔容錯、無盤差提示，必須由使用者決定以舊版為準（建議以舊版為準）
- feature-parity-review.md 自評已補齊，但與程式碼不符
- 大型 Excel 可能讓瀏覽器測試逾時，timeout 要放寬

## /store/clinic-selfpay-margin

- 狀態：**missing**（XL）— Vue 端與 app/api/workspace 無 clinic 相關檔案；navigation.ts:140 的「診所自費藥毛利計算」無 kind，外開舊版。
- 舊版：`app/store/clinic-selfpay-margin/page.tsx（1262 行）+ app/api/clinic-selfpay/**（9 支 route + _lib.ts）`
- Vue：（無）
- 權限：store.clinic_selfpay.margin（舊總權限，同時授予計算器與對應主檔）、store.clinic_selfpay.calculator.use、store.clinic_selfpay.mapping.manage、store.clinic_selfpay.batch.delete、職稱補充規則（_lib.ts getClinicSelfpayAccess）：門市職稱或主管職稱（isStoreScopedJobTitle／isManagerJobTitle）自動具 canUseCalculator；主管職稱自動具 mapping 與 delete 權限、navigation.ts 目前導覽可見條件為 monthly.status.view_own／view_all／employee.movement.manage／store.manage，與 API 內部權限碼不一致，需對齊
- 相依：xlsx 讀檔與 PDF 輸出工具、DEV 資料庫與 storage bucket clinic-selfpay-screenshots 的 DEV 設定、門市選擇元件／storeScope 規則（可參考其他 workspace 頁的 session.stores）

**舊版功能**

- 門市下拉（GET /api/clinic-selfpay/stores）與年月選擇；兩個分頁：「計算器」與「對應主檔」（對應主檔分頁僅 canManageMapping 可見）
- 步驟 1：匯入診所自費藥檔（.xlsx/.xls，健保系統匯出，讀 A 欄藥品資訊、優先使用 M 欄總量、舊格式回退 K 欄）；健保系統截圖必填（png/jpeg/webp，可多張、可 Ctrl+V 貼上、前端壓縮 compressImage）
- 匯入結果訊息：共 N 筆、匹配 M 筆、未匹配 K 筆；有未匹配品項時 API 回傳 unmatched 清單
- 歷史匯入紀錄（依門市）表：診所機構代碼、月份、自費藥總額、毛利總額；canDeleteBatch 才有刪除（confirm「刪除後不可復原，店長需重新上傳」）
- 計算結果報表：健保代碼、藥品名稱、數量、品號、會員價、成本、總額、毛利、狀態（匹配／未匹配）
- 診所請款明細 PDF 匯出（jsPDF + html 轉圖分頁，檔名「{門市}診所請款明細_{診所代碼}_{年月}.pdf」，含資訊區塊 INFO_BLOCK_HTML）
- 健保系統截圖回看 Modal：多張切換、縮圖列、上一張／下一張
- 對應主檔分頁：匯入月價格檔（DPOS，.xlsx/.xls，依分頁年月匯入，關帳月份不覆蓋）、主檔清單（DPOS品號、DPOS品名、診所藥品健保碼、診所開立藥品名稱、主檔月份）、關帳／開帳切換（confirm 說明覆蓋規則）、歷史會員價與成本 Modal（月份、品號、品名、會員價、成本）

**缺少或不同**

- 整頁缺漏
- 需新建 workspace API 包裝 9 支 clinic-selfpay route 並保留 admin client 與 storage bucket clinic-selfpay-screenshots 的存取
- PDF 匯出、貼上截圖、圖片壓縮需在 Vue 重做，注意舊版用 jspdf 與 html2canvas（vue-workspace/src/activity-calendar-pdf.ts 已有 PDF 先例可參考）

**業務規則**

- 價格檔匯入：同年月已關帳則略過，不覆蓋；開帳後可再次匯入覆蓋（confirm 文案）
- 診所檔匯入以健保代碼比對 DPOS 對應主檔（clinic_selfpay_price_entries），匹配者計算毛利，未匹配者列為未匹配並回傳
- 門市範圍：stores 依 profiles 與 store_managers（is_active 的門市）去重排序（_lib.ts 約 66-100 行）
- 截圖必填、儲存在 storage bucket clinic-selfpay-screenshots，刪批次時一併移除檔案

**API**：舊 GET /api/clinic-selfpay/permissions、GET /api/clinic-selfpay/stores、GET /api/clinic-selfpay/batches、GET/DELETE /api/clinic-selfpay/batches/[id]、POST /api/clinic-selfpay/batches/import、GET /api/clinic-selfpay/mappings、POST /api/clinic-selfpay/mappings/close、GET /api/clinic-selfpay/mappings/history、POST /api/clinic-selfpay/prices/import；新 —

**資料表**：clinic_selfpay_claim_batches、clinic_selfpay_claim_items、clinic_selfpay_price_entries、clinic_selfpay_price_month_closures、profiles、stores、store_managers、storage bucket clinic-selfpay-screenshots

**既有測試**：scripts/test-production-legacy-product-relationship-clinic-performance-compatibility.js（僅資料庫相容性）、無 workspace clinic 測試

**待確認**

- 健保匯入欄位判定規則在 batches/import/route.ts 約 100-290 行，未逐行讀
- DEV 是否已有 clinic_selfpay_* 資料表與 bucket，需查 supabase/migrations 與 DEV 連線（只讀未確認）

### 測試案例

**冒煙**

- store_mgr_A（門市職稱）開「診所自費藥毛利計算」在工作頁內開啟，有門市下拉（只有 A）、年月選擇、「計算器」分頁；看不到「對應主檔」分頁；無 console error
- 主管職稱或 mapping.manage 角色看得到「對應主檔」分頁
- 導覽可見性需改用 API 實際權限：store.clinic_selfpay.* 或門市、主管職稱的角色看得到；只有 monthly.status.view_own 但非門市職稱的角色依新規則斷言（目前 navigation.ts:140 的條件與 API 不一致，修正後鎖定）
- GET /api/workspace/clinic-selfpay/permissions、/stores 回 200

**單元**

- app/api/clinic-selfpay/_lib.ts 的 parseNumber：'1,234.5'→1234.5、''→0、null→0、'abc'→0
- parseRocDateToIso：'1151102'→'2026-11-02'、'115 11 02'→'2026-11-02'、'1151302'→null、'115111'→null
- toYearMonth：'2026-11-02'→'2026-11'、null→null、'2026/11/02'→null
- batches/import/route.ts 抽出 lib/clinic-selfpay/parse.ts：parseClinicInfo、parsePeriod、parseClinicCodeFromRange、parseCodeAndNameFromColA、parseClaimQty（優先 M 欄總量，空白時回退 K 欄）、parseClaimDrugName、roundTo1、extractItems（用固定的健保匯出樣本列 any[][] 做快照）
- prices/import/route.ts 抽出：getCell（多欄名別名）、parseYearMonthSheetName、buildRecords、deduplicatePriceRecords（同品號與健保碼去重規則）
- 毛利計算 computeMargin(item, priceEntry)：總額=數量x會員價、毛利=總額-數量x成本、四捨五入到 1 位；未匹配時 status=unmatched、金額為 0
- getClinicSelfpayAccess 職稱規則抽成純函式 resolveAccess(permissions, jobTitle)：門市職稱自動 canUseCalculator；主管職稱自動 mapping 與 delete；舊總權限 margin 同時授予計算器與對應主檔
- PDF 檔名 buildClaimPdfName(store, clinicCode, ym)='{門市}診所請款明細_{診所代碼}_{年月}.pdf'

**整合**

- 角色矩陣：calculator.use 可 POST batches/import；mapping.manage 可 POST prices/import 與 mappings/close；batch.delete 可 DELETE batches/[id]；無權角色各回 403；anon 401；store_mgr_A 以門市 B 匯入回 403
- batches/import：上傳樣本健保 xlsx 與截圖（png）回傳 total、matched、unmatched，以及 unmatched 清單；clinic_selfpay_claim_batches 1 筆、claim_items N 筆；截圖存在 bucket clinic-selfpay-screenshots；缺截圖回 400；截圖格式 gif 回 400
- prices/import：月份未關帳時匯入成功；mappings/close 關帳後再匯入同月，資料不變（略過）；開帳後再匯入會覆蓋
- mappings/history 回傳指定品號的歷月會員價與成本
- DELETE batch：DB 中 batch 與 items 刪除，storage 截圖也刪除
- stores：回傳 profiles 門市與 is_active 的 store_managers 門市去重，並依 store_code 排序
- 並行：同一門市同月同時匯入兩次，結果依舊版規則（覆蓋或兩批並存，先讀 route 確認）且無 500

**E2E**

- 計算器：選門市 A 與年月、上傳健保 xlsx、以 Ctrl+V 貼上截圖（page.evaluate 派發 ClipboardEvent 帶 File）、再上傳 1 張，送出後顯示「共 N 筆、匹配 M 筆、未匹配 K 筆」，報表表格欄位齊全，未匹配列狀態為「未匹配」
- 歷史匯入紀錄出現該批；點擊後開截圖回看 Modal，上一張、下一張與縮圖切換正常
- 匯出 PDF：expect_download，檔名符合格式，檔案大小大於 0，頁數大於等於 1（以 pdf 解析器或 %PDF 開頭檢查）
- 對應主檔：匯入月價格檔、清單出現；關帳時出現說明覆蓋規則的 confirm；關帳後再匯入顯示略過；開帳；開歷史價格 Modal
- 刪除批次：confirm「刪除後不可復原，店長需重新上傳」，確認後消失
- 失敗路徑：匯入 API 回 503 時保留檔案與截圖

**對等驗證**

- 同一份健保 xlsx、同一份價格檔、同一門市與月份，分別經舊版 /api/clinic-selfpay/batches/import 與 workspace 版匯入（各自清理），比對 claim_items 每列的健保代碼、品號、數量、會員價、成本、總額、毛利、狀態完全相同，總額與毛利加總相同
- GET /api/clinic-selfpay/batches、mappings、stores、permissions 與 workspace 對應端點，以同角色呼叫，JSON 正規化後相等（特別是 permissions 的職稱推導結果）
- PDF：兩版用同一批次輸出，以 pdf 文字抽取比對資訊區塊與明細文字相同（不比對像素）
- 畫面：計算結果報表的列數、總額、毛利合計兩版相同

**測試資料**

- 健保匯出樣本：clinic-claim-new.xlsx（有 M 欄）、clinic-claim-old.xlsx（只有 K 欄）、含未匹配品項
- 價格檔：clinic-price-2026-10.xlsx（工作表名為年月），含對應健保碼的 DPOS 品號
- 截圖：png、jpeg、webp 各 1 張，另有 1 個 gif 負向檔
- clinic_selfpay_price_month_closures：一個已關帳月份
- storage bucket clinic-selfpay-screenshots 在 DEV 存在
- 角色：admin、store_mgr_A（門市職稱、無明確權限）、area_manager（主管職稱）、clinic_calc（calculator.use）、clinic_mapping（mapping.manage）、clinic_delete（batch.delete）、legacy_margin（store.clinic_selfpay.margin）、no_perm、anon

**風險**

- 導覽可見權限與 API 權限不一致，修正後可見範圍會改變，需使用者確認
- 職稱推導權限依賴 profiles.job_title 字串，DEV 資料要準確
- PDF 由 html2canvas 產生，跨瀏覽器像素會不同，只能比對文字
- 匯入欄位判定（route 100-290 行）尚未逐行讀，樣本檔要從真實匯出取得並去識別化

## /store/relationship-members

- 狀態：**done**（S）— Vue 頁面逐項涵蓋舊版的會員表單、四個篩選分頁、FKRS 最後編號、核可／駁回、編輯、刪除、銷售明細查詢、xlsx 匯入與範本下載；workspace API 直接呼叫原 route handler 並回傳 capabilities，權限一致；且有真實 DEV 資料的 Playwright 測試。僅有 UI 布局差異（搜尋框、分頁為新增能力）。
- 舊版：`app/store/relationship-members/page.tsx（伺服端權限）+ RelationshipMembersClient.tsx（580 行）+ app/api/relationship-members/**、app/api/relationship-sales/**`
- Vue：`vue-workspace/src/pages/Relationships.vue（711 行）`
- 權限：relationship_member.view、relationship_member.edit、relationship_member.delete、relationship_member.approve、canSubmit／canViewSales = view || edit；canEdit = edit；canDelete = delete；canApprove = approve
- 相依：無

**舊版功能**

- 兩個分頁：會員申請與檢視、銷售明細報表（canViewSales 才顯示）；重新整理
- 新增／編輯會員表單（canSubmit）：姓名、電話、關係（placeholder 配偶、父母…）、會員編號（僅編輯時可填，已填寫後鎖定）
- 關係會員檢視表篩選分頁（含計數）：全部、待填寫(已核可)、待核可、已駁回
- 在「待填寫(已核可)」分頁顯示 FKRS 會員編號最後一號
- 表格欄位：姓名、電話、關係、填表人、會員編號、核可狀態；操作：核可、駁回（填寫理由，API 要求 rejection_reason）、編輯、刪除（confirm，銷售明細保留）
- 銷售明細：匯入 .xlsx（欄位：門市代號、銷售日期 YYYY/MM/DD HH:MM、會員編號、品號、品名、數量、金額）、下載範本「關係會員銷售明細匯入範本.xlsx」、依姓名／會員編號查詢與清除、統計（筆數、數量合計、金額合計）、明細表

**缺少或不同**

- 未發現功能缺漏。差異皆為新增或排版：Vue 增加關鍵字搜尋（姓名、電話、會員編號、申請人）與會員／銷售兩個分頁各自分頁；欄位合併顯示（會員姓名／電話合欄）、新增「匯入來源／時間」欄
- 舊版統計卡（明細筆數、數量合計、金額合計）在 Vue 是否保留未確認（grep Relationships.vue 未見對應字樣，uncertain）

**業務規則**

- 會員編號一旦填寫即鎖定，嘗試改成不同值回 409（測試腳本斷言）
- 駁回必須有 rejection_reason，否則 400
- 刪除會員保留銷售明細
- 銷售匯入需 .xlsx 且日期格式 YYYY/MM/DD HH:MM
- FKRS 編號比對規則 /^FKRS(\d+)$/i 取最大序號

**API**：舊 GET/POST /api/relationship-members、PATCH/DELETE /api/relationship-members/[id]、POST /api/relationship-members/[id]/approve、/reject、GET /api/relationship-sales、POST /api/relationship-sales/import；新 /api/workspace/relationships/[[...path]]（GET 清單+capabilities、POST 新增、PATCH/DELETE [id]、POST [id]/approve|reject、GET sales、POST sales/import）

**資料表**：relationship_members、relationship_sales（及 relationship_sales_imports）、migration 20260818090000_relationship_member_rejection_reason.sql

**既有測試**：scripts/test-workspace-relationships.py（真實 DEV：建立／駁回／核可／編輯／編號鎖定／xlsx 匯入／銷售查詢／刪除保留銷售，另有 UI 分頁、對話框與未存離開檢查、清理驗證）

**待確認**

- 統計卡片（筆數／數量／金額合計）在 Vue 的對應位置
- 舊版 sales 查詢是否受門市範圍限制（由原 API 決定，Vue 沿用同一 handler，故一致）

### 測試案例

**冒煙**

- 重跑 scripts/test-workspace-relationships.py 必須 PASS（已涵蓋 401、Origin 403、400、CRUD、匯入、桌機與手機）
- 以 viewer（只有 relationship_member.view）登入：導覽看得到「關係會員」，看得到「銷售明細報表」分頁；看不到核可、駁回、刪除按鈕
- no_perm 看不到導覽項，GET /api/workspace/relationships 回 403

**單元**

- FKRS 最後編號 lastFkrsNumber(members)：['FKRS0012','fkrs0105','ABC','FKRS'] 應回 FKRS0105（regex /^FKRS(\d+)$/i 取最大序號），空陣列回空值；舊版與 Relationships.vue 抽成同一函式
- 篩選分頁計數 countByTab(members)：全部、待填寫（已核可但沒有會員編號）、待核可、已駁回，計數加總邏輯正確
- 銷售匯入列驗證：日期必須為 YYYY/MM/DD HH:MM，'2026/9/30 14:30' 或 '2026-09-30' 依舊版規則判定，數量與金額轉數字
- Vue 新增的搜尋 filterMembers(keyword)：比對姓名、電話、會員編號、申請人，不分大小寫

**整合**

- 補角色矩陣（既有測試只用 administrator）：view 可 GET 與 POST（canSubmit=view||edit）；只有 edit 可 PATCH；只有 delete 可 DELETE；只有 approve 可 approve 與 reject；其餘各回 403；capabilities 回傳值與角色一致
- 門市範圍：sales 查詢是否受門市限制，以 store_mgr_A 與 admin 查同一會員編號比對兩版 API 結果一致
- 並行：兩個 session 同時 PATCH 同一會員填不同會員編號，一個成功、一個 409
- 重複匯入同一個 xlsx：依舊版行為（重複或拒絕）斷言兩版一致

**E2E**

- 既有測試已涵蓋；補上：viewer 角色完整流程（新增申請後看到待核可，無核可按鈕）
- approver 角色：在待核可分頁按駁回，未填理由不能送出，填理由後移到已駁回分頁，計數同步變化
- 待填寫（已核可）分頁顯示 FKRS 最後一號
- 銷售明細統計（筆數、數量合計、金額合計）：確認 Vue 的 .sales-total 顯示 3 個值；若缺少則標成差異（uncertain）

**對等驗證**

- 同角色呼叫 GET /api/relationship-members 與 /api/workspace/relationships，members 的 id 集合與欄位 deep equal（workspace 是直接呼叫原 handler，應完全相同）
- GET /api/relationship-sales 與 /api/workspace/relationships/sales 以同樣 member_number 或 name 參數比對
- 畫面：舊版與 Vue 的四個分頁計數、FKRS 最後一號、銷售統計三個數字相同
- 寫入：舊版建立並核可 1 筆、Vue 建立並核可 1 筆，DB 列除 id、時間、姓名外欄位相同

**測試資料**

- 沿用既有測試的臨時會員（VUEREL+token）與臨時銷售 xlsx
- 預置會員：已核可無編號、已核可有 FKRS 編號（FKRS0012、FKRS0105）、待核可、已駁回各 1 筆（token 前綴）
- 角色：admin、rel_view、rel_edit、rel_delete、rel_approve、store_mgr_A、no_perm、anon

**風險**

- status 為 done，但只有 administrator 角色的測試，角色矩陣未驗證
- 統計卡在 Vue 的位置尚未確認

## /supervisor-management-log

- 狀態：**missing**（XL）— Vue 與 workspace 皆無 supervisor-management 檔案（grep 無命中）；navigation.ts:218 的「督導管理日誌」無 kind，外開舊版。
- 舊版：`app/supervisor-management-log/page.tsx（2190 行）+ app/api/supervisor-management-log/**（cases、cases/[id]、records、followups、categories、daily-plans、options、today、voice/draft、voice/transcribe）+ lib/supervisor-management-log/{access,validation,voice}.ts`
- Vue：（無）
- 權限：supervisor.management_log.view_own、supervisor.management_log.view_team、supervisor.management_log.create、supervisor.management_log.update_own、supervisor.management_log.follow_up、supervisor.management_log.manage、lib/supervisor-management-log/access.ts：檢視=六碼任一；建立=create 或 manage；更新=update_own／follow_up／manage 任一；管理=manage；寫規劃=create／update_own／follow_up／manage 任一
- 相依：workspace 錄音與音檔上傳元件、語音 API 的 DEV 金鑰或 mock 策略、門市與員工選項（可沿用 options API）、共用 Modal.vue 與時間線元件

**舊版功能**

- 頁首「督導管理日誌」，兩個工作台分頁：「今日工作台」「管理案件」
- 今日工作台：日期標題、今日管理規劃（新增／編輯／刪除；狀態 尚未開始／處理中／已完成／已取消，可直接切換狀態）
- 今日待追蹤：列出 7 日內待追蹤案件（空時顯示「目前沒有 7 日內待追蹤案件」）
- 快速口述：錄音（MediaRecorder + getUserMedia）或上傳音檔（audio/*）-> POST /voice/transcribe 轉文字；亦可手動貼文字稿；POST /voice/draft 產生草稿（OpenAI，未設 OPENAI_API_KEY 時以本機規則 LOCAL_RULE_FALLBACK）
- 草稿審核：管理對象、發現、判斷、動作、追蹤（是否需要與日期）、正式主檔 Entity Matching（比對門市／員工代碼，未偵測時提示人工確認），確認後建立
- 快速新增管理紀錄、新增管理結果、追蹤結果回填（追蹤狀態 已改善／改善中／未改善／延後追蹤／結案，追蹤方式 現場訪查／電話追蹤／LINE／會議／系統紀錄／其他）
- 今日管理紀錄清單（空時「今天尚無管理紀錄」）
- 管理案件分頁：篩選（狀態、對象類型 門市／人員／區域／跨部門／其他、關鍵字「案件標題、對象、摘要」）、案件列表、狀態（待處理／待追蹤／改善中／已改善／已結案／已取消）、優先度（低／一般／高／緊急）
- 新增案件表單：標題、對象類型、門市、員工、分類（來自 supervisor_management_categories）、優先度等；行動選項快選（現場說明、主管約談、教育訓練、限期改善、跨部門協調、文件補正、持續追蹤）
- 案件時間線：紀錄類型（管理紀錄／追蹤安排／結果紀錄／備註）、追蹤、事件；編輯案件、刪除案件（軟刪除 supervisor_management_soft_delete_case）、刪除規劃（軟刪除 RPC）

**缺少或不同**

- 整頁缺漏，包含今日工作台、案件管理、語音草稿與時間線
- 語音功能依賴 OPENAI_API_KEY 與 OPENAI_TRANSCRIPTION_MODEL（預設 gpt-4o-mini-transcribe）；DEV／測試環境需決定是否 mock
- RLS 以 supabase 使用者身分運作（lib/supabase/server createClient），workspace 版需保持相同使用者身分而非 admin client，否則會繞過權限

**業務規則**

- view_own 只看自己負責案件，view_team 看團隊，manage 全部（由 RLS 與 API 查詢決定，細節 uncertain）
- 案件、規劃使用軟刪除 RPC
- 今日待追蹤範圍為 7 日內
- 草稿為 AI 產生需人工審核後才寫入，提供 AI provider 標記 OPENAI／LOCAL_RULE_FALLBACK

**API**：舊 GET/POST /api/supervisor-management-log/cases、GET/PATCH/DELETE /cases/[id]、POST /cases/[id]/records、POST /cases/[id]/followups、GET /categories、GET/POST /daily-plans、PATCH/DELETE /daily-plans/[id]、GET /options、GET /today?date=、POST /voice/transcribe、POST /voice/draft；新 —

**資料表**：supervisor_management_cases、supervisor_management_records、supervisor_management_followups、supervisor_management_categories、supervisor_management_daily_plans、supervisor_management_case_events、stores、store_employees、profiles、RPC supervisor_management_soft_delete_case／supervisor_management_soft_delete_daily_plan、migrations 20260812093000／20260813063209 等

**既有測試**：scripts/test-supervisor-management-log-foundation.js、scripts/test-supervisor-management-log-ui.js、scripts/test-supervisor-management-daily-plans.js、scripts/test-supervisor-management-daily-plans-api.js（皆針對舊版頁面／API／資料庫，非 Vue）

**待確認**

- view_own／view_team 對案件清單的實際過濾條件需讀 cases/route.ts 完整程式與 RLS migration
- 語音草稿 Entity Matching 邏輯在 lib/supervisor-management-log/voice.ts，未逐行讀
- 頁面 2190 行僅讀取常數、區塊標題與 API 呼叫，各表單欄位完整清單未全部展開

### 測試案例

**冒煙**

- supervisor_view_own 開「督導管理日誌」在工作頁內開啟，可見「今日工作台」「管理案件」兩分頁，今日工作台日期標題為 Asia/Taipei 今天，無 console error
- 空資料時顯示「目前沒有 7 日內待追蹤案件」與「今天尚無管理紀錄」
- no_perm 看不到導覽項，workspace API 回 403；anon 401
- GET /api/workspace/supervisor-log/today?date=、/options、/categories 回 200

**單元**

- lib/supervisor-management-log/validation.ts：validateCasePayload（必填標題、對象類型 enum、優先度 enum、partial 模式只驗有給的欄位）、validateRecordPayload（紀錄類型 enum）、validateFollowupPayload（追蹤狀態與方式 enum）、validateDailyPlanPayload（狀態：尚未開始、處理中、已完成、已取消）、validateDeletionReason（空白拒絕）、validateUuid（非 uuid 拒絕），每個函式各有合法與非法案例
- lib/supervisor-management-log/voice.ts：normalizeTranscript（去空白、截長）、todayTaipeiDate（注入時間跨日測試）、buildLocalDraft（含「限期改善」「LINE」字樣的逐字稿，推斷出對應行動選項與追蹤方式）、extractEntityMentions（門市代碼與員工代碼樣式）、normalizeDraft（缺欄位時補預設值）、getBlockingFields（未匹配實體或需要追蹤卻沒填日期時列為阻擋欄位）
- matchEntities 以假的 supabase 查詢結果測評分排序（scoreCandidate），以及多候選時的處理
- 今日待追蹤 7 日範圍 isWithinFollowupWindow(date, today)：今天+7 包含、+8 排除、逾期包含與否依 today route 實作確認
- lib/supervisor-management-log/access.ts 抽出純函式 resolveSupervisorAccess(codes)：檢視為六碼任一；建立為 create 或 manage；更新為 update_own、follow_up、manage 任一；管理為 manage；寫規劃為 create、update_own、follow_up、manage 任一。用表格驅動測 2^6 個組合中具代表性的 12 組

**整合**

- 角色矩陣（必須用使用者身分的 supabase client，不可用 admin client）：view_own 只看自己負責的案件（建立 2 位督導各自的案件，互相看不到）；view_team 看團隊；manage 看全部；以 SQL 直接查 RLS 比對
- 寫入權限：只有 view 的角色 POST cases 回 403；create 可建；update_own 只能改自己的，改他人的回 403 或 404；follow_up 可 POST followups；manage 可刪任何案件（軟刪除 RPC 後 deleted_at 有值，清單不再出現）
- daily-plans：GET、POST、PATCH 狀態、DELETE（軟刪除 RPC）；無寫規劃權限回 403
- cases/[id]/records 與 followups 會新增 case_events，時間線順序正確
- voice/draft：不設 OPENAI_API_KEY 時回 provider=LOCAL_RULE_FALLBACK 與草稿結構；voice/transcribe 無金鑰時回明確錯誤碼（依舊版），不得 500；以 msw 或 route 攔截模擬 OpenAI 成功回應（若 server 端可注入）
- 錯誤路徑：非 uuid id 回 400；不存在的 id 回 404；Origin 錯 403
- 並行：兩個 session 同時 PATCH 同一案件狀態，不會產生重複事件或 500

**E2E**

- 今日工作台：新增規劃，狀態切換為處理中再切成已完成，編輯後刪除（軟刪除）
- 快速口述：上傳測試音檔（攔截 transcribe 回固定逐字稿）或直接貼上文字稿，產生草稿後顯示 provider 標記；Entity Matching 顯示匹配到的門市與員工，未偵測時顯示人工確認提示；勾選需要追蹤但不填日期時不能確認；補齊後建立，今日管理紀錄出現該筆
- 錄音：Chromium fake audio device 授權麥克風，開始錄音、停止，產生音檔並送出（攔截 API）
- 管理案件：新增案件（標題、對象類型門市、門市 A、分類、優先度高、行動快選「限期改善」），在清單以狀態、對象類型、關鍵字篩選找到；開時間線新增管理紀錄、追蹤安排（日期為今天+3），回到今日工作台的待追蹤看到該案件；回填追蹤結果為已改善；編輯案件；刪除案件（軟刪除）
- 權限 UI：view_own 角色看不到刪除與管理按鈕

**對等驗證**

- 同角色、同日期，GET /api/supervisor-management-log/today、cases（相同篩選）、options、categories 與 workspace 對應端點 JSON deep equal
- RLS 對等：view_own、view_team、manage 三個角色各自在兩版看到的案件 id 集合相同
- 寫入對等：兩版各走一次「建案、紀錄、追蹤、結案」流程，cases、records、followups、case_events 的欄位序列（排除 id、時間、標題 token）相同
- 語音草稿：相同逐字稿呼叫兩版 voice/draft（LOCAL_RULE_FALLBACK），草稿 JSON 與 blockingFields 相同
- 畫面：今日工作台的規劃數、待追蹤數、今日紀錄數兩版相同

**測試資料**

- supervisor_management_categories：DEV 既有或新增 VUETEST 分類 3 筆
- stores A、B；store_employees：門市 A 2 位員工（含員工代碼）
- cases：督導 S1 與 S2 各 2 件（含 1 件 7 日內待追蹤、1 件 8 日後追蹤）；同團隊與不同團隊的設定（view_team 的團隊定義需先讀 RLS migration 20260812093000、20260813063209）
- daily_plans：今天 3 筆、昨天 1 筆
- 測試音檔 .tmp-check/voice-sample.webm（短秒數）；固定逐字稿文字
- 角色：sup_view_own（S1）、sup_view_own_2（S2）、sup_view_team、sup_create、sup_update_own、sup_follow_up、sup_manage、no_perm、anon
- 測試 server 不設定 OPENAI_API_KEY

**風險**

- workspace 版若使用 admin client 會繞過 RLS，必須以使用者 session 轉呼叫
- view_team 的團隊定義未確認
- OpenAI 路徑無法在 DEV 實測，只能驗 fallback 與 mock
- 日期依 Asia/Taipei，測試要固定時間或在台北午夜附近避開執行

## 領域測試備註

【共用測試基礎（所有頁面適用，Sonnet 實作前先建立）】
1. 執行環境：沿用 scripts/test-workspace-relationships.py 樣板（Python Playwright，B='http://localhost:3002'，Origin header，POST /api/workspace/login 以 administrator + 環境變數 WORKSPACE_TEST_PASSWORD 登入），結果與截圖放 .tmp-check/；清理用 scripts/dev-cleanup-query.cjs 執行 DELETE SQL。DEV 連線資訊在 .env.development.local（NEXT_PUBLIC_SUPABASE_URL 等），測試前先跑 scripts/verify-dev-supabase-environment.js 確認指向 DEV 而非 production，指向 production 時整個測試必須中止。
2. 角色帳號矩陣（DEV 共用，建立一次並寫入 supabase/workspace-dev/ 的 seed SQL 或 apply 腳本）：
   - admin（administrator，全權）
   - store_mgr_A：門市職稱、store_managers 管轄門市 A（例 0002）
   - store_mgr_B：管轄門市 B（跨門市測試用）
   - viewer：只有各模組 view 類權限
   - no_perm：已登入但沒有任何本領域權限
   - 各模組專屬角色（例 stockout_responder、maintenance_updater、clinic_mapping_mgr、supervisor_view_own／view_team／manage）
   - anon：未登入
3. 測試資料都要帶唯一 token 前綴（例 'VUETEST'+uuid），finally 區塊要清除，並斷言既有資料的 ID 集合不變（同 relationships 測試）。
4. 每個 workspace API 的標準錯誤路徑：
   - 未登入回 401
   - Origin 錯誤（http://invalid.test）的寫入回 403（lib/workspace/server.ts 的 checkOrigin）
   - 驗證失敗回 400
   - 權限不足回 403
5. 對等驗證通則：同一角色先後呼叫舊版 API（/api/xxx）與 workspace API（/api/workspace/xxx），以同一組查詢參數比對 JSON：排序後的 id 集合、筆數、金額加總。寫入類各做一次，再用 dev-cleanup-query 讀 DB 比對欄位，要排除 id、created_at。
6. 導覽可見性：smoke 每頁都要以各角色登入 /workspace/index.html，打開「選單」，斷言 .catalog-item[title="X"] 是否存在、有 kind 時點擊不會外開新分頁（page.context.pages 數量不變）。
7. 已確認的程式事實：
   - 刪除最後一筆缺貨回報會一併刪除 stockout_product_responses，回傳 clearedResponse:true（app/api/stockout-reports/route.ts 約 245-262 行）。
   - products-master DELETE 是軟停用（is_active=false），而且只檢查登入、不檢查 store.products_master.manage（app/api/products-master/route.ts 約 147-165 行）。這是舊版的權限漏洞，復刻時要決定沿用或修正，並寫成明確測試。
   - 商品部提醒有兩個門檻：isResponseActive 用 ETA>=今天-15 天；shouldShowResponseReminder 用 ETA>=今天-30 天（app/cross-dept/merchandise/page.tsx 40-62 行）。
8. 純函式目前多數寫在舊頁或 route 內部、沒有 export。單元測試前先把它們抽到 lib/<domain>/*.ts（例 lib/stockout/response.ts、lib/products-master/barcode.ts、lib/clinic-selfpay/parse.ts），舊版與 Vue／workspace 共用同一份，對等性才有保證。
9. 不可在測試中呼叫真實 OpenAI：督導語音一律走 LOCAL_RULE_FALLBACK（測試 server 不設 OPENAI_API_KEY），或以 page.route 攔截。

# 總務服務中心（一）：設備、設施、零件、資產掃碼

## 領域共用缺口

- Vue 側完全沒有總務服務中心的設備/設施/零件原生頁：vue-workspace/src/pages 無 General/Equipment/Facility/Part 頁；app/api/workspace 與 lib/workspace 皆無 general-affairs 目錄；main.ts 只有 / 與 /work/:id 路由。Vue 導覽 lib/workspace/navigation.ts 只有「服務中心首頁」與「庫存管理」兩項，其餘為 App.vue 的 legacyHref 外開舊站連結。docs 內 full-migration-checklist.md 與 route-inventory.json 對這 18 頁皆標「待逐項盤點」，與程式碼一致。
- 需先建立 workspace 版共用 API：general-affairs/access（權限）、categories（equipment/facility/part 三型共用）、attachments（上傳/列表/soft delete，bucket general-affairs-attachments）、parts/target-compatibilities、maintenance-requests 唯讀。舊版這些位於 app/api/general-affairs/**，驗證邏輯在 lib/general-affairs/{equipment,facilities,parts,categories}/{access,validation,types}.ts，可抽共用邏輯至 lib/workspace/ 避免兩邊分叉。
- 需新增共用 Vue 元件：樹狀分類表、分類選擇器(AssetCategoryPicker)、據點選擇器(AssetSitePicker/AssetSiteFilter)、附件上傳面板(ResourceAttachmentPanel)、資產 Drawer/表單殼(AssetManagementUI)、未儲存離開確認、QR Code 產生與列印版型。
- DEV 資料庫：這些功能的資料表（ga_equipment、ga_facilities、ga_parts 等）與 RPC 皆由 supabase/migrations/*general_affairs*.sql 定義；workspace-dev SQL（supabase/workspace-dev/ 與 scripts/apply-workspace-*-dev.cjs）目前沒有總務資產相關腳本，需確認 DEV 庫是否已套用 20260826013000 (QR token)、20260920093000 (facility templates)、20260916093000 (target compatibilities) 等 migration。
- 權限：舊版有權限矩陣 migration（20260727015132_dev_general_affairs_role_matrix_permissions.sql、20260926153000_general_affairs_production_role_matrix.sql），Vue 側 navigation 已使用 general_affairs.equipment/facility/part.view|manage，但缺 equipment_template.view|manage 與 category 相關的導覽權限。
- 測試現況：舊版有 scripts/test-general-affairs-*.js 共 30 支（多為舊站 UI/API 測試），無任何 test-workspace-* 對應總務設備/設施/零件；需新建 Vue 版 e2e 並與舊版比對（QR 掃描頁目前舊版也沒有專屬測試）。
- QR 掃描頁的永久網址 /general-affairs/assets/scan/{token} 已印在實體標籤上；Vue 使用 hash router（createWebHashHistory），需決定整合模式下如何保留此路徑（直接沿用 Next 路由或 Vue 路由 redirect），否則已貼標籤會失效。
- 建議實作順序：附件/分類/權限共用 API → 分類(3 頁共用元件) → 設備型號/設施架型 → 零件主檔與新增 → 適用料件 → 設備/設施主檔與新增 → 保固與維修紀錄(只讀) → QR 標籤與掃描頁。總工作量估計 XL（約 18 頁、舊版元件合計約 1 萬行）。
- exclude 判定：此領域 18 頁皆為使用者功能頁，無除錯頁，無需排除。

## /general-affairs/equipment

- 狀態：**missing**（XL）— vue-workspace/src/pages 無任何設備頁；app/api/workspace 下無 general-affairs 或 equipment 目錄；lib/workspace/navigation.ts 只有「服務中心首頁 /general-affairs」與「庫存管理 /general-affairs/inventory」兩項，App.vue 對非原生項目只顯示外開舊站連結（legacyHref）。vue-workspace/src/main.ts 路由只有 / 與 /work/:id。
- 舊版：`app/general-affairs/equipment/page.tsx -> components/general-affairs/equipment/EquipmentManagementClient.tsx (1203 行)`
- Vue：（無）
- 權限：general_affairs.equipment.view、general_affairs.equipment.manage、general_affairs.service_center.access、general_affairs.maintenance_request.view_own_store / view_all、general_affairs.work_order.view_own_store / view_all、門市主管身分（store_managers 表，isStoreManagerForStore）影響門市範圍
- 相依：共用元件：分類選擇器(AssetCategoryPicker)、據點選擇器(AssetSitePicker/AssetSiteFilter)、附件面板(ResourceAttachmentPanel)、資產管理 UI 外殼(AssetManagementUI)、workspace 版 general-affairs access/permission 判斷 API、equipment/categories、equipment/templates 頁（資料來源）、Vue 導覽新增總務項目

**舊版功能**

- 據點設備清冊列表（伺服器分頁、排序 name/asset_code/status/updated_at/created_at/warranty_end_date）
- 篩選：關鍵字、分類、狀態、保固狀態（全部/保固中/即將到期/已過保/無保固/保固日未填）、建檔進度、據點
- 統計卡：設備總數、需留意狀態（暫停/退役/報廢）、保固需確認
- 新增設備（導向 /equipment/new）
- 編輯設備 Drawer/表單：名稱、分類、公司設備型號(template)、品牌/型號、序號、資產編號(只讀)、狀態、重要程度、區域/詳細位置、用途、安裝日期、購買金額、保固、標籤(逗號分隔)、備註
- 設備詳情：基本資料、狀態與位置、保固與備註、資產識別、QR 掃描入口
- 圖片與附件：設備照片、貼標位置照片、其他附件（上傳/預覽）
- 建檔 / 貼標進度與總務複核：通過（完成設備建檔複核）或退回重拍（必填原因，呼叫 onboarding-review）
- 刪除設備（soft delete，必須輸入刪除原因，最多 200 字）
- 列印 QR 標籤入口（單台或目前篩選結果）
- 維修歷程：讀取 /api/maintenance-requests?source=general_affairs&store_id=… 並顯示（API 不可讀時提示）
- 離開未儲存表單的確認提示

**缺少或不同**

- 整頁缺失：無 Vue 頁面、無 workspace API（舊 API 為 app/api/general-affairs/equipment/** 共 8 支 route）
- Vue 導覽 lib/workspace/navigation.ts 無「設備管理」項目，僅能靠舊站外連

**業務規則**

- 無保固時不可填保固到期日（lib/general-affairs/equipment/validation.ts）
- 購買金額不可為負；日期格式 YYYY-MM-DD；狀態/重要程度/建檔狀態需在列舉內
- 圖片路徑只能是相對 Storage path，不可絕對路徑、反斜線、..
- 刪除需填原因且 ≤200 字，為 soft delete
- 資產編號由 DB sequence 產生（migration 20260730002830_generate_equipment_asset_code_sequence.sql）
- 退回重拍必須填寫原因；複核通過後建檔進度完成
- 門市範圍依角色權限與門市主管關係限制

**API**：舊 GET/POST /api/general-affairs/equipment、GET/PUT/DELETE /api/general-affairs/equipment/[id]、POST /api/general-affairs/equipment/[id]/onboarding-review、GET /api/general-affairs/equipment/onboarding-review-tasks、GET /api/general-affairs/equipment/store-onboarding-tasks、GET /api/general-affairs/categories?type=equipment、GET /api/general-affairs/equipment/templates、GET/POST/DELETE /api/general-affairs/attachments、GET /api/maintenance-requests；新 —

**資料表**：ga_equipment、ga_equipment_templates、ga_resource_attachments、stores、store_managers、maintenance_requests、RPC: ga_soft_delete_equipment、ga_sync_equipment_onboarding_status、Storage bucket: general-affairs-attachments

**既有測試**：scripts/test-general-affairs-equipment-master.js、scripts/test-general-affairs-asset-management-ui.js、scripts/test-general-affairs-asset-form-validation.js、scripts/test-general-affairs-availability.js、scripts/test-general-affairs-maintenance-ui.js、（以上皆測舊版，無 test-workspace-* 對應腳本）

**待確認**

- onboarding-review-tasks / store-onboarding-tasks 由哪個舊頁面消費，未逐一追蹤（可能是總務首頁或任務中心）
- EquipmentManagementClient 內 Drawer 與頁面實際分區未逐行確認

### 測試案例

**冒煙**

- R_GA_MGR 開 Vue 設備清冊頁：200、表格載入至少 1 筆 ZZTEST-GA1 設備、3 張統計卡（設備總數/需留意狀態/保固需確認）有數字、console 無 error、無 4xx/5xx 網路請求
- R_GA_VIEW 開頁：列表可見、『新增設備』『刪除』『複核通過/退回』按鈕不存在或 disabled
- R_NOPERM、R_STAFF_A：Vue 導覽沒有『設備管理』項目；直接輸入 hash 路由顯示無權限頁，不是白頁
- ANON：導回登入頁
- 帶 ?id=<設備id>（掃碼 management_path 為 /general-affairs/equipment?id=...）時自動開啟該設備 Drawer

**單元**

- lib/general-affairs/equipment/validation.ts validateEquipmentPayload：(1) 無 store_id/category_id 非 partial → throw '門市 id 格式錯誤'；(2) has_warranty=false + warranty_end_date='2027-01-01' → '無保固時不可填寫保固到期日'；(3) partial 只送 warranty_end_date 不送 has_warranty → 不 throw（記錄舊版行為）；(4) purchase_amount=-1 → '購買金額不可為負數'，'abc' → '必須是數字'，''→null；(5) installed_at='2026/01/01' → 格式錯誤；(6) status='BROKEN' → '設備狀態錯誤'，缺省→'ACTIVE'；criticality 缺省→'NORMAL'；onboarding_status 缺省→'NEEDS_EQUIPMENT_PHOTO'；(7) tags 35 個 → 只剩 30，含空白字串會被濾掉；tags='a,b' 字串 → '標籤必須是陣列格式'；(8) image_path：'https://x'、'/a.png'、'a\b'、'a/../b' 各自對應錯誤訊息，'equipment/x.png' 通過；(9) specs=[] → '規格 必須是物件格式'
- validateDeletionReason：null/'  ' → '請輸入刪除原因'；201 字 → 超過 200 字；200 字通過且 trim
- 新抽出 lib/workspace/general-affairs/equipment-filters.ts（建議）：把 Vue 篩選狀態轉 query string 的函式（keyword/category/status/warrantyStatus/onboarding/store/sortBy/page），sortBy 白名單 name|asset_code|status|updated_at|created_at|warranty_end_date，非法值回預設
- 統計卡計算函式：需留意狀態 = status ∈ {SUSPENDED/RETIRED/SCRAPPED 對應列舉}（以 lib/general-affairs/equipment/types.ts EQUIPMENT_STATUSES 實際值為準，uncertain）
- Vue 表單 -> payload 轉換：標籤逗號字串 split/trim 成陣列；空字串欄位轉 null；asset_code 不得出現在 PUT payload

**整合**

- GET /api/workspace/general-affairs/equipment 角色矩陣：R_ADMIN/R_GA_MGR/R_GA_VIEW 200 看全部門市；R_STORE_MGR_A 只看到 STORE_A（若舊 API 有此範圍）或 403（以舊 API 實測結果為準）；R_NOPERM 403；ANON 401
- 分頁：pageSize=500 → 回應 pageSize=100；page=0 → 1；totalPages=ceil(count/pageSize)
- 篩選：warrantyStatus=expiring 只回 has_warranty 且 0..30 天到期的 seed；onboarding 篩選；store_id=STORE_B 篩選
- PUT /equipment/[id]：R_GA_MGR 200 並寫入 DB；R_GA_VIEW 403 且 DB 不變；送 asset_code 不得被改（比對 DB）；送 has_warranty=false+warranty_end_date → 400 訊息相同
- DELETE /equipment/[id]：無 reason → 400；合法 → 呼叫 RPC ga_soft_delete_equipment，DB deleted_at 非 null、列表不再出現；重複刪除 → 404 或與舊版相同碼
- POST /equipment/[id]/onboarding-review：approve → onboarding_status 變完成；reject 無原因 → 400；reject 有原因 → 狀態回待重拍並記錄原因；R_GA_VIEW 403
- 並行：兩個 R_GA_MGR session 同時 PUT 同一設備不同欄位，兩個都 200，最後 DB 狀態可預期（後寫者勝），不得 500；同時對同一設備 DELETE 兩次只有一次成功
- 附件：GET /attachments?resourceType=equipment&resourceId=… 回 signed URL；R_NOPERM 403
- 維修歷程：GET maintenance-requests?source=general_affairs&store_id=STORE_A 無權限時 403，Vue 顯示『API 不可讀』提示而非整頁錯誤
- 錯誤路徑：id 非 UUID → 400 '設備 id 格式錯誤'類訊息；不存在 id → 404

**E2E**

- R_GA_MGR：開列表 → 關鍵字搜尋 ZZTEST-GA1-冰箱 → 篩選保固『即將到期』→ 排序 warranty_end_date → 筆數與 seed 預期一致
- 開 Drawer 編輯：改名稱、狀態、標籤 'a, b ,c' → 儲存 → toast 成功 → 重新整理後值保留，DB tags=['a','b','c']
- 編輯中改值後點關閉/切路由 → 出現未儲存確認；取消留在頁面、確認離開不寫入
- 無保固設備填到期日 → 前端阻擋並顯示同舊版訊息
- 上傳設備照片與貼標照片 → 預覽出現 → onboarding 進度更新 → 總務複核『退回重拍』不填原因被擋、填原因成功 → 再上傳 → 『通過』→ 進度顯示完成
- 刪除：不填原因按鈕 disabled/錯誤；填 201 字被擋；填 10 字 → 列表消失
- 點『列印 QR 標籤』（單台與目前篩選）→ 開到標籤頁且帶相同 query
- R_GA_VIEW 走同樣流程只能看不能改

**對等驗證**

- 同一 R_GA_MGR、同一 seed：舊 GET /api/general-affairs/equipment 與新 workspace API 在 10 組 query（各篩選、各 sortBy、page 1/2）下 data 的 id 序列與 pagination 完全一致
- 統計卡三個數字在舊頁與 Vue 頁 Playwright 擷取值相等
- 在舊版與 Vue 版各執行一次相同編輯（同 payload）於兩台 seed 設備，service role 讀 ga_equipment 比對除 id/asset_code/qr_token/時間戳外欄位相等
- 錯誤訊息比對：同一非法 payload 送舊/新 API，status code 與 error 字串相同
- 刪除後兩版列表皆不顯示、DB deleted_at/刪除原因欄位格式一致

**測試資料**

- STORE_A(ZZTEST-GA1-A)、STORE_B(ZZTEST-GA1-B)；R_STORE_MGR_A 在 store_managers 綁 STORE_A
- 設備分類樹：根『ZZTEST-GA1-冷藏』→ 葉『冰箱』『冷凍櫃』（ga_equipment_categories）
- 設備型號 1 筆（ga_equipment_templates，default_warranty_months=12）
- 設備 25 筆（>20 以測分頁）：STORE_A 15、STORE_B 10；保固組合：無保固 3、has_warranty 無到期日 3、已過保 3、10 天內到期 3、200 天後 13；狀態含 ACTIVE 與各需留意狀態各 1；onboarding 各狀態各 2；1 筆已 soft delete（不得出現）
- 每筆設備需有 qr_token（24-64 小寫英數）
- 2 筆 ga_resource_attachments（設備照片、貼標照片）+ storage 小 png
- maintenance_requests 3 筆 source=general_affairs 指向 STORE_A 設備
- 角色帳號：R_ADMIN、R_GA_MGR、R_GA_VIEW、R_STORE_MGR_A、R_STAFF_A、R_NOPERM

**風險**

- 舊頁 onboarding-review-tasks/store-onboarding-tasks 由誰消費未確認，可能漏掉首頁待辦
- 門市範圍：R_STORE_MGR_A 能否看設備清冊需以舊 API 實測為準，不可推測
- 附件 signed URL 每次不同，parity 比對需去掉 token

## /general-affairs/equipment/new

- 狀態：**missing**（L）— 無對應 Vue 頁與 workspace API。
- 舊版：`app/general-affairs/equipment/new/page.tsx -> EquipmentCreatePageClient.tsx (1062 行)`
- Vue：（無）
- 權限：general_affairs.equipment.manage
- 相依：/general-affairs/equipment 列表頁（建立後導回）、設備分類頁、公司設備型號頁、附件上傳共用元件與 workspace 附件 API

**舊版功能**

- 多步驟精靈：建檔方式（新購/新開店設備 或 既有資產補登）→ 選據點 → 選設備分類 → 基本資訊 → 位置 → 保固 → 圖片 → 完成確認（含上一步）
- 搜尋並指定公司設備型號（品牌/型號/名稱），找不到可導去新增公司設備型號
- 基本資訊：名稱、品牌、型號、序號、用途/功能、狀態、重要程度、標籤
- 安裝資訊：安裝位置(必填)、所在區域、安裝日期
- 新增數量（批次建立多台）、每台購買金額、本次購買總額、購買日期、購買途徑/供應商（新購需填購買日期）
- 保固：有保固/無保固、到期日、申請保固方式（上網登錄/序號登錄/供應商原廠保固卡/保留發票收據/免單據/合約報價單/其他）、保固文件附件
- 圖片：設備照片、貼標位置照片、其他附件上傳（上傳至 attachments API）
- 建立摘要與建檔/貼標進度（待上傳設備照片、待貼標照片、待總務複核）
- 資產編號只讀（由系統產生）
- 離開未儲存確認
- 建立成功訊息（已新增 N 台）

**缺少或不同**

- 整頁缺失

**業務規則**

- 名稱、分類、品牌、安裝位置、數量必填；數量>0
- 購買金額不可為負
- 有保固需填到期日；無保固不可填到期日
- 新購設備必填購買日期
- 建立後依照片/複核狀態計算 onboarding_status（ga_sync_equipment_onboarding_status）

**API**：舊 POST /api/general-affairs/equipment、POST /api/general-affairs/attachments、GET /api/general-affairs/categories?type=equipment、GET /api/general-affairs/equipment/templates；新 —

**資料表**：ga_equipment、ga_equipment_templates、ga_resource_attachments、stores

**既有測試**：scripts/test-general-affairs-asset-form-validation.js、scripts/test-general-affairs-equipment-master.js

**待確認**

- 批次新增數量上限與是否單一交易，需讀 app/api/general-affairs/equipment/route.ts POST 段確認

### 測試案例

**冒煙**

- R_GA_MGR 開 Vue 新增設備頁：精靈第一步『建檔方式』顯示，分類與型號 API 載入成功，console 無 error
- R_GA_VIEW/R_NOPERM 開頁：無權限畫面或導回列表，且導覽/列表無『新增設備』按鈕

**單元**

- 精靈步驟驗證函式（建議抽 lib/workspace/general-affairs/equipment-create.ts validateStep(step, form)）：名稱、分類、品牌、安裝位置、數量必填；數量 0/-1/1.5/101 被擋；新購模式未填購買日期被擋、既有補登可空；有保固未填到期日被擋；無保固填到期日被擋；購買金額負數被擋
- 購買總額計算：每台金額 × 數量（含小數、空值→不顯示/0，與舊版顯示一致）
- 建檔摘要 onboarding 進度推算：無設備照片→待上傳設備照片；有設備照片無貼標照片→待貼標照片；兩者皆有→待總務複核
- 型號自動帶入：選 template 後帶入品牌/型號/分類/預設保固月數 → 到期日 = 購買日 + N 月（若舊版有此行為，uncertain 需讀 EquipmentCreatePageClient）
- validateEquipmentPayload 同列表頁單元測試共用

**整合**

- POST /api/workspace/general-affairs/equipment quantity=1 → 201，DB 產生 asset_code（sequence，格式與舊版一致）與 qr_token
- quantity=3 → 3 筆，asset_code 連號遞增、qr_token 互不相同；quantity=0/101/1.5 → 400 訊息與舊版相同
- quantity=100 單次 insert；中途失敗（例如第 50 筆故意 category_id 不存在→整批 FK 錯）時 DB 0 筆寫入（驗證原子性）
- 權限：R_GA_VIEW、R_NOPERM 403；ANON 401；R_STORE_MGR_A 依舊版實測
- 送 asset_code / onboarding_status 由 client 指定 → 被忽略或拒絕（與舊版行為一致）
- 附件上傳 POST /attachments：建立後用回傳 id 上傳，路徑在 bucket general-affairs-attachments；非法 mime/過大檔與舊版一致錯誤
- 建立後 ga_sync_equipment_onboarding_status 執行：上傳兩種照片後 onboarding_status 變待總務複核
- 並行：兩 session 同時建立 quantity=5，asset_code 無重複（sequence）

**E2E**

- R_GA_MGR：選『新購』→ 選 STORE_A → 選分類葉節點 → 搜尋型號並套用 → 填基本資訊 → 位置 → 保固（有、到期日、申請方式『上網登錄』、上傳保固文件）→ 圖片上傳設備照片 → 確認頁摘要正確 → 建立 → 顯示『已新增 1 台』→ 導回列表看到新設備
- 數量 3、每台 1000 → 確認頁總額 3000 → 建立後列表多 3 筆
- 『上一步』來回切換不遺失已填資料
- 填一半離開 → 未儲存確認
- 找不到型號點『新增公司設備型號』→ 導去型號頁

**對等驗證**

- 同一 payload（固定 store/category/template/日期/金額/保固）分別透過舊頁與 Vue 頁建立，service role 讀 ga_equipment 比對所有業務欄位（排除 id/asset_code/qr_token/created_at）相同，specs JSON deep-equal（保固申請方式等存放位置一致）
- 兩版 asset_code 格式 regex 相同，皆由 DB sequence 產生
- 同樣非法輸入在兩版前端出現相同錯誤文字

**測試資料**

- 同設備列表頁的門市、分類、型號
- 測試用 png（<100KB）與 pdf（保固文件）
- R_GA_MGR、R_GA_VIEW、R_NOPERM

**風險**

- 保固申請方式、購買途徑等可能存 specs 子欄位，Vue 若改欄位名會導致保固頁顯示不同
- 附件上傳失敗時舊版是否回滾設備紀錄未確認（uncertain）

## /general-affairs/equipment/categories

- 狀態：**missing**（M）— 無對應 Vue 頁與 workspace 分類 API。
- 舊版：`app/general-affairs/equipment/categories/page.tsx -> components/general-affairs/assets/AssetCategoryManagementClient.tsx (kind=equipment，666 行，與 facilities/parts 共用)`
- Vue：（無）
- 權限：general_affairs.service_center.access（讀）、config.viewPermission / managePermission（依 type 對應 equipment/facility/part 的 view/manage）
- 相依：workspace categories API（三種 type 共用）、Vue 共用樹狀表格元件

**舊版功能**

- 樹狀分類列表（展開/收合、層級、排序、上層路徑）
- 搜尋分類名稱或代碼
- 統計：分類總數、可供主檔選用的最末層分類
- 新增第一層分類 / 新增子分類 / 編輯（名稱、代碼、上層、排序、描述）
- 啟用/停用切換
- 刪除（soft delete，已被使用的分類會被擋）
- 無權限提示：目前帳號沒有分類管理權限

**缺少或不同**

- 整頁缺失；此元件三種 kind 共用，一次實作可涵蓋設備/設施/零件三頁

**業務規則**

- 上層分類必須存在
- 僅最末層分類可供主檔選用
- 已有下層或已被主檔使用的分類不可刪除（UI 顯示「此分類已有…」）
- 分類代碼必填且唯一性由後端檢查

**API**：舊 GET/POST /api/general-affairs/categories?type=、PUT/DELETE /api/general-affairs/categories/[id]?type=；新 —

**資料表**：ga_equipment_categories 等分類表（由 lib/general-affairs/categories/types.ts 的 getCategoryConfig 決定，待確認實際表名）、RPC: ga_soft_delete_category

**既有測試**：scripts/test-general-affairs-categories.js

**待確認**

- 分類實際資料表名稱未確認（需讀 lib/general-affairs/categories/types.ts）

### 測試案例

**冒煙**

- R_GA_MGR 開 Vue 設備分類頁：樹狀列表載入、統計『分類總數』『可供主檔選用的最末層分類』有數字，console 無 error
- R_GA_VIEW：可看樹、無新增/編輯/刪除/啟停按鈕
- R_NOPERM：顯示『目前帳號沒有分類管理權限』

**單元**

- lib/general-affairs/categories/validation.ts（逐一列出 export 並測）：名稱/代碼必填、parent_id UUID 格式、sort_order 整數
- lib/general-affairs/categories/types.ts getCategoryConfig('equipment'|'facility'|'part') → table 分別為 ga_equipment_categories / ga_facility_categories / ga_part_categories，非法 type throw
- 新抽 Vue 樹處理函式 buildCategoryTree(rows)：依 parent_id 組樹、依 sort_order+name 排序、計算 path（上層路徑字串）、isLeaf；孤兒節點（parent 不存在）處理與舊版 AssetCategoryManagementClient 一致
- leafCount 計算：最末層且 is_active 的數量（以舊版為準）
- 搜尋函式：名稱或代碼模糊比對，命中子節點時保留祖先路徑

**整合**

- GET /api/workspace/general-affairs/categories?type=equipment：R_GA_MGR/R_GA_VIEW 200，R_NOPERM 403，type=xxx 400
- POST：parent_id 不存在 → 400；代碼重複 → 與舊版相同錯誤碼/訊息；R_GA_VIEW 403
- PUT 啟用/停用：DB is_active 改變
- DELETE：有子分類 → 擋；已被 ga_equipment 使用 → 擋（訊息同舊版『此分類已有…』）；空葉節點 → 呼叫 ga_soft_delete_category 成功
- 並行：兩 session 同時建立同代碼分類 → 一個成功一個 4xx（不可兩個都成功）
- type 越權：用 equipment 權限去 POST type=facility → 依 facility 權限判斷（R 只有 equipment.manage 時應 403）

**E2E**

- 新增第一層『ZZTEST-GA1-新根』→ 新增子分類 → 編輯名稱/排序/描述 → 展開收合正常 → 停用 → 啟用 → 刪除子再刪根
- 嘗試刪除已被設備使用的分類 → 顯示擋下訊息
- 搜尋代碼 → 結果含祖先路徑

**對等驗證**

- 同角色舊/新 GET categories?type=equipment 回應正規化後 deep-equal
- Playwright 擷取兩版統計卡數字與樹節點（path 列表）一致
- 同一 POST/PUT/DELETE 序列在兩版各執行於不同代碼前綴，DB 結果結構相同

**測試資料**

- ga_equipment_categories：3 層樹 6 節點（含 1 停用、1 被設備使用的葉、1 空葉）
- R_GA_MGR、R_GA_VIEW、R_NOPERM、只有 equipment.manage 沒有 facility.manage 的角色 R_EQ_ONLY

**風險**

- 三個 kind 共用一個 Vue 元件，kind 切換時權限碼對應錯誤是高風險

## /general-affairs/equipment/templates

- 狀態：**missing**（L）— 無對應 Vue 頁與 workspace API。
- 舊版：`app/general-affairs/equipment/templates/page.tsx -> EquipmentTemplatesClient.tsx (735 行)`
- Vue：（無）
- 權限：general_affairs.equipment_template.view、general_affairs.equipment_template.manage、general_affairs.part.view（適用料件）
- 相依：設備分類、零件主檔與 target-compatibilities API

**舊版功能**

- 公司設備型號列表（搜尋名稱/品牌/型號、分類、狀態篩選、分頁）
- 新增/編輯公司設備型號：名稱、設備分類、品牌、型號、描述、預設保固月數、啟用狀態
- 啟用/停用切換
- 刪除（需輸入名稱確認，soft delete）
- 適用料件設定：搜尋零件並勾選，儲存到 target-compatibilities（targetType=EQUIPMENT_TEMPLATE）
- 既有設備歸戶：列出尚未連結型號的設備，可能相符提示，多選後批次 link-assets
- 顯示每型號已登錄台數
- 未儲存離開確認

**缺少或不同**

- 整頁缺失

**業務規則**

- 預設保固月數不可為負
- 刪除需確認名稱
- 歸戶只針對 template_id 為空的設備
- templateStatus=unlinked 篩選用於歸戶清單

**API**：舊 GET/POST /api/general-affairs/equipment/templates、PUT/DELETE /api/general-affairs/equipment/templates/[id]、POST /api/general-affairs/equipment/templates/[id]/link-assets、GET/POST /api/general-affairs/parts/target-compatibilities、GET /api/general-affairs/equipment?templateStatus=unlinked；新 —

**資料表**：ga_equipment_templates、ga_equipment、ga_parts、ga_part_target_compatibilities、RPC: ga_soft_delete_equipment_template

**既有測試**：scripts/test-general-affairs-equipment-master.js（可能涵蓋 template）、scripts/test-general-affairs-part-compatibilities-ui.js

### 測試案例

**冒煙**

- R_GA_MGR 開 Vue 公司設備型號頁：列表、分類篩選、已登錄台數顯示，console 無 error
- R_GA_VIEW（equipment_template.view）：唯讀
- R_NOPERM：無權限畫面

**單元**

- validateEquipmentTemplatePayload：category_id 非 UUID → '分類 id 格式錯誤'；name 空 → '請輸入設備範本名稱'；default_warranty_months=-1 → 不可為負；=1.5 → 必須是整數；''→null；is_active 缺省→true；specs/default_fields 陣列→錯誤；image_path 同設備規則
- 刪除確認：輸入名稱需完全相等（trim 後）才允許，抽 confirmNameMatches(input, name)
- 歸戶候選『可能相符』判斷函式（品牌+型號比對，以舊版 EquipmentTemplatesClient 實作為準，uncertain）

**整合**

- GET/POST/PUT/DELETE templates 角色矩陣：R_GA_MGR 全可；R_GA_VIEW 只 GET；R_NOPERM 403；ANON 401
- DELETE 呼叫 ga_soft_delete_equipment_template，之後 GET 不出現；已有設備連結時的行為與舊版一致
- POST /templates/[id]/link-assets：只會更新 template_id 為空的設備；傳入已連結他型號的設備 id → 被忽略或 4xx（同舊版）；DB 驗證
- GET equipment?templateStatus=unlinked 只回 template_id is null
- target-compatibilities POST targetType=EQUIPMENT_TEMPLATE：寫入 ga_part_target_compatibilities，重送相同集合冪等、移除勾選會刪除；targetType=FOO → 400 '相容性對象類型錯誤'；需 part.view 才能讀料件
- 並行：兩 session 同時 link-assets 同一設備到不同型號，最終只連一個且不 500

**E2E**

- 新增型號（名稱/分類/品牌/型號/保固 12 月）→ 編輯 → 停用/啟用 → 設定適用料件勾 2 件儲存 → 重開顯示 2 件
- 既有設備歸戶：勾選 3 台未連結設備 → 批次歸戶 → 已登錄台數 +3，歸戶清單減少 3
- 刪除：輸入錯名稱按鈕 disabled，正確名稱後刪除成功
- 改欄位未儲存離開 → 確認提示

**對等驗證**

- 舊/新 GET templates（含分頁、篩選）回應一致，已登錄台數一致
- 同一 link-assets 操作後兩版 ga_equipment.template_id 結果一致
- target-compatibilities 讀回集合一致

**測試資料**

- 型號 4 筆（1 停用、1 已有 3 台設備、1 無設備可刪）
- 未連結型號設備 5 筆（含 2 筆品牌型號相符）
- ga_parts 3 筆啟用料件
- R_GA_MGR、R_GA_VIEW、只有 equipment_template.manage 沒有 part.view 的角色

**風險**

- 已登錄台數若由前端計數而非 API，需確認資料來源一致

## /general-affairs/equipment/warranties

- 狀態：**missing**（S）— 無對應 Vue 頁。
- 舊版：`app/general-affairs/equipment/warranties/page.tsx -> EquipmentWarrantyClient.tsx (277 行)`
- Vue：（無）
- 權限：general_affairs.equipment.view、general_affairs.equipment.manage
- 相依：設備列表 workspace API、附件 API

**舊版功能**

- 保固管理列表（讀最多 100 筆，依保固到期日升冪）
- 統計：設備總數、保固中、30 天內到期、已過保、保固日未填
- 篩選：保固狀態、分類、門市、關鍵字
- 顯示申請保固方式（上網登錄/序號登錄/原廠卡/保留單據/免單據/合約/其他）
- 文件/單據欄：讀 attachments 顯示保固文件
- 資產資訊未填提示

**缺少或不同**

- 整頁缺失；只讀頁，無編輯

**業務規則**

- 保固狀態：無保固 / 保固日未填 / 保固中(>30 天) / 即將到期(30 天內) / 已過保
- 30 天為即將到期門檻

**API**：舊 GET /api/general-affairs/equipment?pageSize=100&sortBy=warranty_end_date、GET /api/general-affairs/attachments；新 —

**資料表**：ga_equipment、ga_resource_attachments

**既有測試**：scripts/test-general-affairs-equipment-master.js

**待確認**

- pageSize=100 上限在大資料量下是否漏資料（舊版即有此限制）

### 測試案例

**冒煙**

- R_GA_VIEW 開 Vue 設備保固頁：5 個統計（總數/保固中/30 天內到期/已過保/保固日未填）有數字，表格載入，console 無 error
- R_NOPERM：無權限；導覽不可見

**單元**

- getWarrantyState(row, now)（移植自 components/general-affairs/equipment/EquipmentWarrantyClient.tsx 第 52 行，需改為可注入 now）：has_warranty=false→none；無到期日→missing；到期日昨天→expired；今天→diffDays=0 或 1（UTC 解析邊界，Asia/Taipei 08:00 前後各測一次，結果需與舊版函式同輸入相同）；+30 天→expiring；+31 天→active
- 以舊函式與新函式對 500 組隨機（日期, now）輸入跑差分測試，結果需全等
- getWarrantyClaimMethod / getWarrantyClaimNotes 代碼→中文標籤對照（上網登錄/序號登錄/原廠卡/保留單據/免單據/合約/其他）
- 統計 count(bucket) 函式

**整合**

- GET workspace equipment?pageSize=100&sortBy=warranty_end_date：排序升冪、最多 100 筆
- GET attachments 依設備批次讀取：無權限時頁面不整頁失敗
- 角色：R_GA_VIEW/R_GA_MGR 200、R_NOPERM 403

**E2E**

- 篩選保固狀態『即將到期』→ 只剩 3 筆；加分類與門市篩選 → 筆數正確；關鍵字搜尋
- 點保固文件連結開 signed URL 成功

**對等驗證**

- 固定系統時間（Playwright clock 或 page.addInitScript 覆寫 Date.now）在兩版擷取 5 個統計數字與每列狀態標籤，完全相同
- seed 筆數 >100 時兩版皆只顯示前 100（記錄為已知限制，兩版一致即可）

**測試資料**

- 沿用設備列表 seed 的保固組合；另加 1 筆到期日=今天、1 筆=+30 天、1 筆=+31 天
- 3 筆保固文件附件

**風險**

- Date.now 與時區造成邊界日不同，測試必須固定時間
- pageSize=100 上限漏資料（舊版即有）

## /general-affairs/equipment/maintenance-history

- 狀態：**missing**（S）— 無對應 Vue 頁。
- 舊版：`app/general-affairs/equipment/maintenance-history/page.tsx -> AssetMaintenanceHistoryClient.tsx (kind=equipment，236 行，與 facilities 共用)`
- Vue：（無）
- 權限：general_affairs.maintenance_request.view_own_store / view_all、general_affairs.work_order.view_own_store / view_all、cross_dept.maintenance.view_all
- 相依：維修需求/工單 workspace API（屬總務服務中心其他領域）

**舊版功能**

- 設備維修紀錄列表（來源 maintenance-requests，source=general_affairs，pageSize=100）
- 篩選：狀態（全部/未完成/已完成或已結案）、門市
- 欄位：工單、問題描述、涉及門市、狀態、建立時間
- 未命名工單/未標示等空值處理
- API 不可讀時顯示「維修紀錄暫不可讀」

**缺少或不同**

- 整頁缺失

**業務規則**

- 僅顯示設備類（依 kind）工單；完成/結案狀態判斷依 components/general-affairs/maintenance/status.ts

**API**：舊 GET /api/maintenance-requests?source=general_affairs&pageSize=100；新 —

**資料表**：maintenance_requests

**既有測試**：scripts/test-general-affairs-maintenance-ui.js、scripts/test-general-affairs-maintenance-views.js

**待確認**

- 如何區分設備 vs 設施工單的過濾邏輯需讀 AssetMaintenanceHistoryClient 第 79 行後

### 測試案例

**冒煙**

- R_GA_MGR 開 Vue 設備維修紀錄頁：列表載入，只含有 equipment_id 的工單，console 無 error
- R_STORE_MGR_A（view_own_store）：只看到 STORE_A 工單
- R_NOPERM：顯示『維修紀錄暫不可讀』而非白頁

**單元**

- statusTone(status)（移植 AssetMaintenanceHistoryClient.tsx 第 56 行）：completed/done/closed/RESOLVED/COMPLETED→green；processing/in_progress/IN_PROGRESS→blue；pending/new/OPEN→amber；null/其他→slate
- filterByKind(rows,'equipment'|'facility')：依 equipment_id / facility_id 是否存在
- buildStoreOptions(rows)：去重、store_code 缺時取 store_id 前 8 碼、依 store_code 排序
- 完成/未完成篩選以 components/general-affairs/maintenance/status.ts 的判斷函式為準（直接 import 測）

**整合**

- GET maintenance-requests?source=general_affairs&pageSize=100 角色矩陣：view_all→全部；view_own_store→只本店；cross_dept.maintenance.view_all→全部；無→403
- Vue 若改由 workspace API 在伺服器端過濾 kind，需證明結果集合等於舊版『取 100 後前端過濾』（見 parity）

**E2E**

- 篩選狀態『未完成』→ 筆數正確；篩選門市 STORE_B；關鍵字；空值顯示『未命名工單』『未標示』

**對等驗證**

- 同角色兩版列表工單 id 集合與順序相同；在 seed 中刻意放 >100 筆 general_affairs 工單（其中設備類分布在第 100 筆之後）以檢驗兩版是否同樣截斷——若 Vue 改成伺服器端過濾導致多顯示，需列為『有意差異』並經使用者確認

**測試資料**

- maintenance_requests：設備類 8 筆、設施類 5 筆、無資產 2 筆，狀態涵蓋各 tone，STORE_A/STORE_B 分布；額外 100 筆填充工單測截斷
- R_GA_MGR、R_STORE_MGR_A、R_NOPERM

**風險**

- 舊版前端過濾 + 100 筆上限會漏資料，Vue 修正與否影響 parity

## /general-affairs/equipment/labels

- 狀態：**missing**（S）— 無對應 Vue 頁。
- 舊版：`app/general-affairs/equipment/labels/page.tsx -> EquipmentQrLabelsClient.tsx (359 行)`
- Vue：（無）
- 權限：general_affairs.equipment.view、general_affairs.equipment.manage
- 相依：設備列表 API、QR 產生函式庫（需確認舊版用哪個 package）

**舊版功能**

- QR 標籤列印頁：單台設備（?id=）或目前列表篩選結果（帶 query 參數）
- 每張標籤顯示設備名稱、設備編號、QR Code（內容為 /general-affairs/assets/scan/{qr_token}）、「掃描查看設備資訊」
- 尚未設定設備編號/無 token 的提示
- 列印按鈕（瀏覽器列印排版）
- 載入失敗提示

**缺少或不同**

- 整頁缺失；需有 QR 產生與列印 CSS

**業務規則**

- QR 內容為穩定 token 路徑，不隨維修流程變更（見 migration 20260826013000_general_affairs_asset_qr_scan_tokens.sql）
- token 作廢後掃描回 404（20260826030000_..._qr_auto_revoke.sql）

**API**：舊 GET /api/general-affairs/equipment?...（含 qr_token）、GET /api/general-affairs/equipment/[id]；新 —

**資料表**：ga_equipment（qr_token、qr_token_issued_at、qr_token_revoked_at）

**既有測試**：—

**待確認**

- QR 產生套件與標籤尺寸規格未讀 EquipmentQrLabelsClient 全文確認

### 測試案例

**冒煙**

- R_GA_VIEW 開 Vue 標籤頁 ?id=<設備>：顯示 1 張標籤含名稱、設備編號、QR 圖、『掃描查看設備資訊』，console 無 error
- 帶篩選 query：張數 = 列表篩選結果數
- R_NOPERM：無權限

**單元**

- buildQrUrl(origin, token) → `${origin}/general-affairs/assets/scan/${token}`（必須是 Next 永久路徑，不可是 Vue hash 路徑）
- 標籤資料轉換：無 asset_code → 顯示『尚未設定設備編號』；無 qr_token 或 qr_token_revoked_at 非空 → 不產生 QR 並提示
- QR 產生使用 qrcode 套件 toDataURL（舊版 EquipmentQrLabelsClient.tsx 第 130 行），選項（margin/width/errorCorrectionLevel）需相同

**整合**

- GET equipment 回應含 qr_token；R_GA_VIEW 可讀；R_NOPERM 403
- 已 revoke token 的設備不得輸出可掃 QR

**E2E**

- 從設備列表點『列印 QR 標籤』→ 標籤頁 → 用 jsQR/zxing 解碼頁面上的 QR 圖片，得到的 URL 開啟後到達掃碼頁並顯示正確設備
- page.emulateMedia('print') 截圖：每頁版面與舊版尺寸一致、無導覽列

**對等驗證**

- 同一設備兩版 QR 解碼字串完全相同
- 同一篩選條件兩版標籤張數與設備順序相同
- print 模式截圖做像素差異比對（容許 <2% 差異），標籤尺寸 mm 相同

**測試資料**

- 設備 3 筆：正常 token、無 asset_code、token 已 revoke
- R_GA_VIEW、R_NOPERM

**風險**

- Vue hash router 若產生 /#/ 路徑會讓已印標籤與新標籤不一致

## /general-affairs/facilities

- 狀態：**missing**（XL）— 無對應 Vue 頁與 workspace API。
- 舊版：`app/general-affairs/facilities/page.tsx -> FacilitiesClient.tsx (906 行)`
- Vue：（無）
- 權限：general_affairs.facility.view、general_affairs.facility.manage
- 相依：共用元件同設備列表、設施分類、設施架型頁

**舊版功能**

- 據點設施清冊列表（分頁、排序）
- 篩選：關鍵字、分類、狀態、據點
- 統計：設施總數、需處理（部分損壞/整修中等）、高重要度（高或關鍵）
- 新增設施（導向 /facilities/new）
- 編輯設施：名稱、分類、公司設施架型、品牌/型號、狀態、重要程度、區域/詳細位置、數量、單位、是否固定資產、安裝日期、整修日期、描述、備註、標籤
- 保固資訊（有/無、到期日、申請保固方式、備註）
- 設施詳情與圖片/附件
- 刪除設施（soft delete，需原因）
- 維修歷程（maintenance-requests）
- 無權限提示：沒有設施資料權限

**缺少或不同**

- 整頁缺失

**業務規則**

- 設施保固資訊存放在 specs.facility_has_warranty / facility_warranty_end_date（見 assets/scan route warrantyStatus）
- 狀態含 使用中/停用中/整修中/部分損壞/退役
- 刪除為 soft delete 並要求原因

**API**：舊 GET/POST /api/general-affairs/facilities、GET/PUT/DELETE /api/general-affairs/facilities/[id]、GET /api/general-affairs/facility-templates、GET /api/general-affairs/categories?type=facility、GET/POST /api/general-affairs/attachments、GET /api/maintenance-requests；新 —

**資料表**：ga_facilities、ga_facility_templates、ga_resource_attachments、maintenance_requests、RPC: ga_soft_delete_facility

**既有測試**：scripts/test-general-affairs-facility-master.js、scripts/test-general-affairs-facility-form-ui.js、scripts/test-general-affairs-asset-management-ui.js

### 測試案例

**冒煙**

- R_GA_MGR 開 Vue 設施清冊：列表、3 統計卡（總數/需處理/高重要度）、console 無 error
- R_GA_VIEW（facility.view）唯讀
- R_NOPERM：顯示『沒有設施資料權限』
- ?id=<設施> 自動開詳情（掃碼 management_path）

**單元**

- lib/general-affairs/facilities/validation.ts validateFacilityPayload：逐一測必填（名稱、單位、詳細位置、分類、據點、狀態）、數量 0/-1 被擋、日期格式、狀態列舉（使用中/停用中/整修中/部分損壞/退役 對應代碼）、image_path 規則、specs 物件
- facilities validateDeletionReason 同設備（空、201 字）
- 設施保固讀取函式 hasWarranty / getWarrantyEndDate（specs.facility_has_warranty === true 嚴格比較，'true' 字串應為 false）
- 統計：需處理 = 部分損壞/整修中等；高重要度 = HIGH|CRITICAL

**整合**

- GET/POST/PUT/DELETE /api/workspace/general-affairs/facilities 角色矩陣同設備（facility.view/manage）
- DELETE 無原因 400；成功走 ga_soft_delete_facility
- PUT 更新保固 → specs.facility_* 正確合併，不得覆蓋 specs 其他鍵
- 並行 PUT 同一設施 specs 不同子鍵：確認舊版是否整包覆蓋（記錄行為），兩版一致
- 分頁/排序/篩選參數與舊 API 一致

**E2E**

- 篩選分類+狀態+據點 → 編輯數量、單位、固定資產、整修日期、保固（有、到期日、申請方式）→ 儲存 → 重開保留
- 上傳附件 → 刪除設施（需原因）→ 列表消失
- 維修歷程區塊顯示該設施工單

**對等驗證**

- 同 R_GA_MGR 兩版 GET facilities 多組 query 結果一致；統計卡一致
- 同一編輯在兩版執行，ga_facilities 業務欄位與 specs JSON deep-equal

**測試資料**

- ga_facility_categories 樹、ga_facility_templates 2 筆（含『ZZTEST-GA1-中島架 HH01款』）
- ga_facilities 22 筆：STORE_A/B；各狀態；重要度含 HIGH/CRITICAL；保固組合（無、有無日期、過保、10 天內、遠期）；1 筆 soft deleted
- R_GA_MGR、R_GA_VIEW、R_NOPERM、R_STORE_MGR_A

**風險**

- specs 合併策略不同會悄悄破壞保固資料

## /general-affairs/facilities/new

- 狀態：**missing**（L）— 無對應 Vue 頁。
- 舊版：`app/general-affairs/facilities/new/page.tsx -> FacilityCreatePageClient.tsx (1061 行)`
- Vue：（無）
- 權限：general_affairs.facility.manage
- 相依：設施分類、設施架型、附件共用元件

**舊版功能**

- 建檔方式：新購/新開店設施 或 既有設施補登
- 選所在據點、據點區域（前場營業區/調劑區/處方作業區/收銀區/藥品儲存區/倉庫後倉/員工休息區/辦公區/廁所/機房設備區/戶外騎樓等）、樓層/區域描述、詳細位置
- 分類選擇與目前分類路徑顯示
- 選公司設施架型並自動套用、顯示尺寸
- 基本資訊：名稱、描述、品牌、型號、數量、單位、是否全店共用設施、狀態、重要程度
- 購買與維護資訊：購買日期、每單位購買金額、購買總額、建置/啟用日期、最近整修日期
- 保固：開始日期、到期日期、申請方式、保固說明/備註、保固文件附件
- 繼承適用料件顯示（由架型帶出）與載入失敗提示
- 附件上傳（含失敗處理）、移除附件
- 確認建立前摘要檢查

**缺少或不同**

- 整頁缺失

**業務規則**

- 數量必須大於 0
- 名稱、單位、詳細位置、分類、據點、狀態必填
- 有保固須填保固開始與到期日
- 適用料件繼承自 FACILITY_TEMPLATE

**API**：舊 POST /api/general-affairs/facilities、GET /api/general-affairs/facility-templates、GET /api/general-affairs/categories?type=facility、GET /api/general-affairs/parts/target-compatibilities?targetType=FACILITY_TEMPLATE、POST /api/general-affairs/attachments；新 —

**資料表**：ga_facilities、ga_facility_templates、ga_resource_attachments、ga_part_target_compatibilities

**既有測試**：scripts/test-general-affairs-facility-form-ui.js、scripts/test-general-affairs-facility-master.js

**待確認**

- 設施據點區域選項是否來自常數或 DB 未確認

### 測試案例

**冒煙**

- R_GA_MGR 開 Vue 新增設施頁：據點、區域選項、分類、架型載入，console 無 error
- R_GA_VIEW/R_NOPERM 無權限

**單元**

- 步驟驗證：數量>0、名稱/單位/詳細位置/分類/據點/狀態必填；有保固需開始與到期日；到期 < 開始（若舊版有擋，uncertain）
- 套用架型：自動帶入名稱/尺寸/品牌型號的轉換函式
- 購買總額 = 單位金額 × 數量
- 據點區域選項常數（前場營業區…戶外騎樓）需與舊版 FacilityCreatePageClient 常數陣列完全相同（直接比對陣列）
- 表單→payload：保固欄位寫入 specs.facility_has_warranty/facility_warranty_end_date/facility_warranty_claim_method/facility_warranty_claim_notes

**整合**

- POST facilities：R_GA_MGR 201，facility_code 產生；R_GA_VIEW 403；非法數量 400 同訊息
- GET target-compatibilities?targetType=FACILITY_TEMPLATE&targetId=… 回繼承料件；架型不存在時前端顯示載入失敗提示
- 附件上傳到新設施 id；上傳失敗不影響已建立的設施（記錄舊版行為）

**E2E**

- 新購 → STORE_A → 區域『調劑區』→ 分類 → 選架型 HH01（顯示尺寸與繼承料件 2 件）→ 數量 4 單位『座』→ 保固 → 附件 → 確認摘要 → 建立 → 列表出現
- 移除已上傳附件；未儲存離開確認

**對等驗證**

- 同 payload 兩版建立後 ga_facilities 列（含 specs）比對相同
- 繼承料件清單兩版一致

**測試資料**

- 架型 HH01 綁 2 筆 FACILITY_TEMPLATE 料件
- 測試 png/pdf
- R_GA_MGR、R_GA_VIEW

**風險**

- 區域選項若來自 DB 而非常數需改測法（uncertain）

## /general-affairs/facilities/categories

- 狀態：**missing**（S）— 無對應 Vue 頁；與設備分類共用同一元件。
- 舊版：`app/general-affairs/facilities/categories/page.tsx -> AssetCategoryManagementClient (kind=facility)`
- Vue：（無）
- 權限：general_affairs.service_center.access、general_affairs.facility.view / manage
- 相依：設備分類頁完成後可複用元件

**舊版功能**

- 同設備分類頁，kind=facility：樹狀、搜尋、新增/子分類/編輯、啟用停用、刪除

**缺少或不同**

- 整頁缺失

**業務規則**

- 同設備分類

**API**：舊 GET/POST /api/general-affairs/categories?type=facility、PUT/DELETE /api/general-affairs/categories/[id]；新 —

**資料表**：設施分類表（待確認）、RPC: ga_soft_delete_category

**既有測試**：scripts/test-general-affairs-categories.js

### 測試案例

**冒煙**

- R_GA_MGR 開 Vue 設施分類頁（同元件 kind=facility）：標題與文案為設施，資料來自 ga_facility_categories
- R_EQ_ONLY（僅 equipment.manage）開此頁不可編輯

**單元**

- 共用設備分類頁 buildCategoryTree 等測試，額外以 kind=facility 參數化執行一次
- kind→權限碼對照函式：facility→general_affairs.facility.view/manage

**整合**

- categories?type=facility 角色矩陣；跨 type 越權（equipment 權限操作 facility）403
- 刪除被 ga_facilities 使用的分類被擋

**E2E**

- 新增/子分類/編輯/停用/刪除流程（同設備分類，換 kind）

**對等驗證**

- 舊/新 GET categories?type=facility deep-equal；統計數字一致

**測試資料**

- ga_facility_categories 3 層 5 節點（含 1 被設施使用）
- R_GA_MGR、R_GA_VIEW、R_EQ_ONLY

**風險**

- 共用元件 kind 傳錯導致讀到設備分類表

## /general-affairs/facilities/templates

- 狀態：**missing**（M）— 無對應 Vue 頁。
- 舊版：`app/general-affairs/facilities/templates/page.tsx -> FacilityTemplatesClient.tsx (571 行)`
- Vue：（無）
- 權限：general_affairs.facility.view、general_affairs.facility.manage
- 相依：設施分類、零件主檔

**舊版功能**

- 公司設施架型列表（顯示名稱/尺寸、分類、架型代碼、寬深高 cm、已登錄數量）
- 新增/編輯架型：名稱、分類、架型代碼、寬度/深度/高度 cm、品牌型號
- 適用料件設定（target-compatibilities，targetType=FACILITY_TEMPLATE）
- 分類載入失敗與資料載入失敗提示
- 未儲存離開確認

**缺少或不同**

- 整頁缺失；舊版範例「中島架 HH01款」

**業務規則**

- 尺寸與代碼用於辨識架型；適用料件由設施繼承

**API**：舊 GET/POST /api/general-affairs/facility-templates、GET/POST /api/general-affairs/parts/target-compatibilities、GET /api/general-affairs/categories?type=facility；新 —

**資料表**：ga_facility_templates、ga_part_target_compatibilities、ga_facilities

**既有測試**：scripts/test-general-affairs-facility-master.js

**待確認**

- facility-templates 無 [id] 路由，編輯/刪除經由何 API 未確認（app/api/general-affairs/facility-templates 僅 route.ts）

### 測試案例

**冒煙**

- R_GA_MGR 開 Vue 設施架型頁：列表顯示名稱/尺寸/分類/代碼/寬深高/已登錄數量，console 無 error
- R_GA_VIEW 唯讀；R_NOPERM 無權限

**單元**

- 尺寸格式化函式：寬×深×高 cm，缺值顯示規則與舊版 FacilityTemplatesClient 一致
- 尺寸數值驗證（非負、數字）——以 app/api/general-affairs/facility-templates/route.ts 內驗證為準（uncertain，需讀）

**整合**

- GET/POST facility-templates 角色矩陣
- 編輯/刪除：舊版只有 route.ts 無 [id]，需先確認舊版是否以 POST upsert 或 PUT ?id= 實作（uncertain），Vue API 必須維持同一語意
- target-compatibilities targetType=FACILITY_TEMPLATE 存取，重送冪等
- 已登錄數量 = 未刪除 ga_facilities.facility_template_id 計數

**E2E**

- 新增架型『ZZTEST-GA1-端架 E02』含尺寸 → 編輯尺寸 → 設定適用料件 → 列表更新；未儲存離開確認；分類載入失敗（攔截 API 回 500）顯示提示

**對等驗證**

- 兩版 GET 列表與已登錄數量一致
- 同一建立/編輯操作 DB 列一致

**測試資料**

- 架型 3 筆（1 有 4 座設施）
- 料件 3 筆
- R_GA_MGR、R_GA_VIEW、R_NOPERM

**風險**

- 舊版編輯/刪除 API 形式未確認

## /general-affairs/facilities/warranties

- 狀態：**missing**（S）— 無對應 Vue 頁。
- 舊版：`app/general-affairs/facilities/warranties/page.tsx -> FacilityWarrantyClient.tsx (289 行)`
- Vue：（無）
- 權限：general_affairs.facility.view、general_affairs.facility.manage
- 相依：設施列表 API

**舊版功能**

- 設施保固管理列表（讀 100 筆，依 updated_at 降冪）
- 保固狀態：保固中、30 天內到期、已過保、無保固、保固日未填、未標記設施保固
- 篩選保固狀態
- 據點/位置、文件/單據（附件）、申請保固方式欄
- 附件載入失敗提示

**缺少或不同**

- 整頁缺失；只讀

**業務規則**

- 保固資訊來自 specs.facility_*，30 天為到期預警門檻

**API**：舊 GET /api/general-affairs/facilities?pageSize=100、GET /api/general-affairs/attachments；新 —

**資料表**：ga_facilities、ga_resource_attachments

**既有測試**：scripts/test-general-affairs-facility-master.js

### 測試案例

**冒煙**

- R_GA_VIEW 開 Vue 設施保固頁：統計（保固中/30 天內/已過保/無保固/保固日未填/未標記）、列表 console 無 error

**單元**

- getWarrantyState（移植 FacilityWarrantyClient.tsx 第 73 行，可注入 now）：facility_has_warranty 非 true→none；無 end→missing；邊界 0/30/31 天；與舊函式差分測試 500 組
- getWarrantyEndDate：非字串→null
- 『未標記設施保固』bucket 定義（舊版統計中出現，需確認對應條件，uncertain）

**整合**

- GET facilities?pageSize=100（updated_at desc）角色矩陣
- 附件讀取失敗（攔截 500）頁面顯示附件載入失敗提示但列表仍顯示

**E2E**

- 篩選保固狀態各選項 → 筆數正確；點文件連結

**對等驗證**

- 固定 Date.now 後兩版統計與每列狀態標籤相同；排序 updated_at desc 一致

**測試資料**

- 沿用設施 seed 保固組合 + 今天/+30/+31 邊界各 1 筆；2 筆保固文件附件

**風險**

- 時區邊界、100 筆上限

## /general-affairs/facilities/maintenance-history

- 狀態：**missing**（S）— 無對應 Vue 頁；與設備維修紀錄共用元件。
- 舊版：`app/general-affairs/facilities/maintenance-history/page.tsx -> AssetMaintenanceHistoryClient (kind=facility)`
- Vue：（無）
- 權限：general_affairs.maintenance_request.view_own_store / view_all、general_affairs.work_order.view_own_store / view_all
- 相依：設備維修紀錄頁共用元件

**舊版功能**

- 同設備維修紀錄頁但 kind=facility，標題為設施維修紀錄

**缺少或不同**

- 整頁缺失

**業務規則**

- 同設備維修紀錄

**API**：舊 GET /api/maintenance-requests?source=general_affairs&pageSize=100；新 —

**資料表**：maintenance_requests

**既有測試**：scripts/test-general-affairs-maintenance-ui.js

### 測試案例

**冒煙**

- R_GA_MGR 開 Vue 設施維修紀錄：標題『設施維修紀錄』，只含 facility_id 工單

**單元**

- 與設備維修紀錄共用測試，以 kind=facility 參數化（filterByKind、statusTone、buildStoreOptions）

**整合**

- 同設備維修紀錄角色矩陣（view_all/view_own_store/work_order.*/cross_dept/無）

**E2E**

- 篩選狀態/門市/關鍵字

**對等驗證**

- 同角色兩版工單 id 集合與順序一致，含 >100 筆截斷情境（同設備頁說明）

**測試資料**

- 沿用設備維修紀錄 seed 的設施類 5 筆

**風險**

- 共用元件 kind 錯置

## /general-affairs/parts

- 狀態：**missing**（L）— 無對應 Vue 頁；Vue 導覽也沒有零件項目（navigation.ts 僅有 general_affairs.part.* 權限列在首頁項目）。
- 舊版：`app/general-affairs/parts/page.tsx -> PartsClient.tsx (569 行)`
- Vue：（無）
- 權限：general_affairs.part.view、general_affairs.part.manage
- 相依：料件分類、庫存管理（已有 Vue Inventory.vue，需確認與零件主檔如何銜接）

**舊版功能**

- 料件列表（共 N 筆）：料號、名稱、品牌型號、用途（維修零件/消耗品/備品/通用耗材）、狀態啟用停用
- 篩選：關鍵字、分類、狀態、用途
- 資料完整度指標與管理提醒
- 領用規則顯示：可拆包/不可拆包、可小數/限整數、最小領用量、庫存單位、採購換算
- 相容性顯示：通用 / 限制相容
- 條碼、最後更新時間
- 本頁啟用/停用（停用不等於 soft delete）
- 新增料件（導向 /parts/new）
- 分頁與目前列表/選取統計

**缺少或不同**

- 整頁缺失；PartsClient 使用共用 request 函式（fetch(input, init) 第 130 行），實際 query 參數未逐一核對

**業務規則**

- 停用僅改 is_active，不是 soft delete
- 領用規則：允許拆包、允許小數、最小領用量 >0
- 庫存不在主檔建立（庫存屬 inventory 模組）

**API**：舊 GET/POST /api/general-affairs/parts、GET/PUT/DELETE /api/general-affairs/parts/[id]、GET/POST /api/general-affairs/parts/[id]/compatibilities；新 —

**資料表**：ga_parts、ga_part_compatibilities、ga_part_target_compatibilities、RPC: ga_soft_delete_part

**既有測試**：scripts/test-general-affairs-part-master.js、scripts/test-general-affairs-part-holding-status.js、scripts/test-general-affairs-part-form-ui.js

**待確認**

- part-holding-status（持有狀態）是否在 PartsClient 顯示未確認
- Vue Inventory.vue 是否已內含零件選擇，與零件主檔的關係未查

### 測試案例

**冒煙**

- R_GA_MGR 開 Vue 料件列表：顯示『共 N 筆』、料號/名稱/用途/狀態/領用規則/相容性/條碼/最後更新，console 無 error
- R_GA_VIEW 唯讀（無啟停、新增）
- R_NOPERM 無權限；導覽可見性正確

**單元**

- lib/general-affairs/parts/validation.ts validatePartPayload：系統欄位（SYSTEM_FIELDS）由 client 送 → '<key> 為系統欄位，不可由 Client 指定'；未填採購單位但有換算率 → '未填採購單位時，換算率必須留空'；有採購單位換算率 0/負 → '必須大於 0'；不允許小數時最小領用量 1.5 → '必須為整數'；最小領用量 ≤0 被擋；image_path 規則
- validatePartCompatibilityPayload：type 不在 PART_COMPATIBILITY_TYPES → '相容性類型錯誤'；設備範本類缺 equipment_template_id、廠商系列缺 vendor_name、品牌型號缺 brand 各自錯誤
- parts validateDeletionReason
- 列表顯示轉換：用途代碼→中文（維修零件/消耗品/備品/通用耗材）、領用規則文字（可拆包/不可拆包、可小數/限整數）、相容性『通用/限制相容』判斷、資料完整度分數函式（以 PartsClient 實作為準）

**整合**

- GET parts 篩選（keyword/category/status/用途）與分頁 parity
- PUT is_active 切換：只改 is_active，deleted_at 仍 null（停用≠刪除）
- DELETE 走 ga_soft_delete_part 需原因
- 角色矩陣 part.view/manage；R_NOPERM 403
- 並行：兩 session 同時切換同料件啟停，最終狀態與最後請求一致，不 500

**E2E**

- 篩選用途『消耗品』+ 狀態停用 → 啟用其中一筆 → 列表更新；新增料件按鈕導向 /parts/new；分頁切換

**對等驗證**

- 兩版 GET parts 多組 query 一致；Playwright 擷取『共 N 筆』與每列領用規則文字一致
- 啟停操作後兩版 DB 結果一致

**測試資料**

- ga_part_categories 樹；ga_parts 25 筆（各用途、啟停、可拆包/小數組合、有無採購換算、1 筆 soft deleted）；ga_part_compatibilities 3 筆
- R_GA_MGR、R_GA_VIEW、R_NOPERM

**風險**

- part-holding-status 是否在列表顯示未確認；Inventory.vue 與料件主檔銜接未查

## /general-affairs/parts/new

- 狀態：**missing**（M）— 無對應 Vue 頁。
- 舊版：`app/general-affairs/parts/new/page.tsx -> PartCreatePageClient.tsx (934 行)`
- Vue：（無）
- 權限：general_affairs.part.manage
- 相依：料件分類、附件上傳共用（migration 20260810090000_allow_part_resource_attachments.sql）

**舊版功能**

- 快速類型選擇（日常耗用/維修更換/預先備料 等）
- 基本資訊：名稱、料件分類、用途、料號、條碼、品牌、型號、規格（尺寸/顏色/材質）、標籤、描述、備註
- 單位換算：基本庫存單位、採購單位、採購換算率
- 領用規則：允許拆包、允許小數領用、最小領用量
- 狀態：啟用/停用
- 料件圖片上傳（含失敗處理）
- 進階辨識資料與進階領用設定（可收合）
- 送出前欄位檢查摘要（請先修正以下欄位）、確認建立
- 提示：庫存不在主檔建立，不輸入初始庫存

**缺少或不同**

- 整頁缺失

**業務規則**

- 名稱、分類、基本庫存單位必填
- 最小領用量必須大於 0
- 不可拆包時限整數領用
- 建立後必須取得 id 才能上傳圖片（錯誤：建立料件後未取得 id）

**API**：舊 POST /api/general-affairs/parts、POST /api/general-affairs/attachments、GET /api/general-affairs/categories?type=part；新 —

**資料表**：ga_parts、ga_resource_attachments

**既有測試**：scripts/test-general-affairs-part-form-ui.js、scripts/test-general-affairs-part-master.js

### 測試案例

**冒煙**

- R_GA_MGR 開 Vue 新增料件頁：快速類型、分類載入，console 無 error；R_GA_VIEW 無權限

**單元**

- 快速類型（日常耗用/維修更換/預先備料）→ 預設欄位（用途、拆包、小數）對照表與舊版 PartCreatePageClient 常數完全相同
- 送出前欄位檢查摘要函式：名稱、分類、基本庫存單位必填，最小領用量>0，不可拆包限整數；回傳錯誤清單順序與文字同舊版
- 表單→payload：不得含初始庫存欄位

**整合**

- POST parts 201 回傳 id；送系統欄位 400；非法換算率 400（訊息同舊版）
- 建立後上傳圖片到 attachments（resourceType=part，migration 20260810090000 允許）；若 POST 回應無 id → 前端顯示『建立料件後未取得 id』（攔截回應模擬）
- R_GA_VIEW/R_NOPERM 403

**E2E**

- 選『維修更換』→ 填名稱/分類/單位/採購單位+換算率 → 展開進階 → 上傳圖片 → 錯誤摘要（故意清空單位）→ 修正 → 確認建立 → 列表出現

**對等驗證**

- 同 payload 兩版建立 ga_parts 列業務欄位相同（排除 id/part_code 若系統產生）
- 同非法輸入兩版錯誤摘要文字相同

**測試資料**

- 料件分類葉 2 筆；測試 png
- R_GA_MGR、R_GA_VIEW

**風險**

- part_code 是否系統產生未確認

## /general-affairs/parts/categories

- 狀態：**missing**（S）— 無對應 Vue 頁；共用元件。
- 舊版：`app/general-affairs/parts/categories/page.tsx -> AssetCategoryManagementClient (kind=part)`
- Vue：（無）
- 權限：general_affairs.service_center.access、general_affairs.part.view / manage
- 相依：設備分類頁共用元件

**舊版功能**

- 同設備分類頁，kind=part（新增料件分類）

**缺少或不同**

- 整頁缺失

**業務規則**

- 同設備分類

**API**：舊 GET/POST /api/general-affairs/categories?type=part、PUT/DELETE /api/general-affairs/categories/[id]；新 —

**資料表**：料件分類表（待確認）、RPC: ga_soft_delete_category

**既有測試**：scripts/test-general-affairs-categories.js

### 測試案例

**冒煙**

- R_GA_MGR 開 Vue 料件分類頁（kind=part）：資料來自 ga_part_categories

**單元**

- 共用分類樹測試以 kind=part 參數化；kind→part.view/manage 權限對照

**整合**

- categories?type=part 角色矩陣；刪除被 ga_parts 使用的分類被擋；跨 type 越權 403

**E2E**

- 新增料件分類 → 子分類 → 停用 → 刪除

**對等驗證**

- 舊/新 GET categories?type=part deep-equal

**測試資料**

- ga_part_categories 2 層 4 節點（1 被料件使用）

**風險**

- 同設施分類

## /general-affairs/parts/compatibilities

- 狀態：**missing**（M）— 無對應 Vue 頁。
- 舊版：`app/general-affairs/parts/compatibilities/page.tsx -> PartCompatibilityManagementClient.tsx (533 行)`
- Vue：（無）
- 權限：general_affairs.part.manage、general_affairs.equipment_template.manage、general_affairs.facility.manage
- 相依：零件主檔、設備型號頁、設施架型頁、設備與設施列表 API

**舊版功能**

- 適用料件設定：先選管理對象類型（設備型號 / 單台設備例外 / 設施架型共用設定 / 單店設施例外）
- 搜尋並選擇對象（設備型號、單台設備、架型、門市設施）
- 讀取既有相容關係並顯示已加入料件
- 搜尋料件並加入/移除
- 儲存（target-compatibilities POST），顯示「已儲存 N」
- 錯誤提示：相容關係讀取/儲存失敗、請先選擇管理對象、請先選擇共用架型

**缺少或不同**

- 整頁缺失

**業務規則**

- targetType 包含 EQUIPMENT_TEMPLATE、EQUIPMENT、FACILITY_TEMPLATE、FACILITY（由 UI 文字與 API 參數推得）
- 單台/單店為模板外的例外設定

**API**：舊 GET/POST /api/general-affairs/parts/target-compatibilities、GET/POST /api/general-affairs/parts/[id]/compatibilities、DELETE /api/general-affairs/parts/[id]/compatibilities/[compatibilityId]；新 —

**資料表**：ga_part_target_compatibilities、ga_part_compatibilities、ga_parts、ga_equipment、ga_equipment_templates、ga_facilities、ga_facility_templates

**既有測試**：scripts/test-general-affairs-part-compatibilities-ui.js

**待確認**

- targetType 完整列舉未讀 lib/general-affairs/parts/validation.ts 確認

### 測試案例

**冒煙**

- R_GA_MGR 開 Vue 適用料件設定：四種管理對象類型可選，console 無 error
- 未選對象按儲存 → 『請先選擇管理對象』

**單元**

- normalizeTargetType：EQUIPMENT/EQUIPMENT_TEMPLATE/FACILITY/FACILITY_TEMPLATE 通過，其他 throw '相容性對象類型錯誤'（來源 app/api/general-affairs/parts/target-compatibilities/route.ts 第 7、16 行，建議抽成共用純函式後測）
- UI 類型→targetType 對照：設備型號→EQUIPMENT_TEMPLATE、單台設備例外→EQUIPMENT、設施架型共用→FACILITY_TEMPLATE、單店設施例外→FACILITY
- 集合差異函式 diff(current, selected) → 新增/移除清單

**整合**

- GET target-compatibilities?targetType=EQUIPMENT&includeInherited=true：回本身 + template_id 對應 EQUIPMENT_TEMPLATE 的繼承料件（route.ts 第 84-88 行）；FACILITY 同理繼承 FACILITY_TEMPLATE
- POST 儲存集合：DB ga_part_target_compatibilities 只保留選定集合（已刪者 deleted_at 設值），回應 count 與『已儲存 N』一致；重送冪等
- 權限：需 part.manage 與對應 equipment_template.manage/facility.manage；R_GA_VIEW 403；R_NOPERM 403
- DELETE /parts/[id]/compatibilities/[compatibilityId] 角色矩陣
- 並行：兩 session 同時儲存同一對象不同集合，最終無重複列（同 part_id+target 唯一）

**E2E**

- 選『設備型號』→ 搜尋型號 → 加 2 料件 → 儲存顯示『已儲存 2』→ 切『單台設備例外』選該型號下設備 → 看到繼承 2 件 + 新增 1 件例外 → 儲存 → 重新整理仍在
- 攔截 API 500 → 顯示讀取/儲存失敗提示

**對等驗證**

- 同對象兩版 GET（含 includeInherited）deep-equal
- 同一儲存操作兩版 DB 列集合一致

**測試資料**

- 設備型號 1（綁 2 料件）、其下設備 2 台；架型 1（綁 1 料件）、其下設施 1 座；料件 5 筆
- R_GA_MGR、R_GA_VIEW、R_NOPERM、只有 part.manage 無 facility.manage 的角色

**風險**

- 繼承與例外在 UI 混合顯示，容易誤刪繼承項

## /general-affairs/assets/scan/[token]

- 狀態：**missing**（M）— 無 Vue 頁與 workspace API。QR 內容指向此舊路由，若 Vue 為唯一入口需提供等價頁面（Vue 為 hash router，與 QR 永久路徑需另行規劃）。
- 舊版：`app/general-affairs/assets/scan/[token]/page.tsx (198 行，伺服器元件) + app/api/general-affairs/assets/scan/[token]/route.ts (274 行)`
- Vue：（無）
- 權限：完整權限：general_affairs.equipment.manage、facility.manage、request.manage、work_order.manage、store.manage、檢視全部：上列 + equipment.view、facility.view、request.view_all、maintenance_request.view_all、work_order.view_all、cross_dept.maintenance.view_all、維修回報：general_affairs.request.create、maintenance_request.create、cross_dept.maintenance.submit、其餘使用者僅能看自己門市（門市範圍判斷於 route.ts 後段，未逐行確認）
- 相依：登入導向機制、維修回報頁 /general-affairs/reports/new（屬總務其他領域）、設備與設施主檔頁（management_path 目標）

**舊版功能**

- 未登入導向 /login?redirect=該掃描網址
- 顯示資產類型（設備/設施）、名稱、編號、狀態標籤(使用中/暫停使用/備品/退役/報廢/部分損壞/停用中/整修中)
- 資訊卡：目前使用門市、位置(區域/詳細位置)、分類、品牌/型號、保固狀態與到期日
- 維修紀錄清單（標題、狀態、回報日期）或「目前沒有維修紀錄」
- 照片（signed URL）或佔位圖
- 維修回報按鈕：有權限導向 repair_request_path（/general-affairs/reports/new?assetToken=…），無權限顯示停用按鈕與說明
- 查看完整主檔按鈕（management_path，依權限）
- 錯誤頁：403「沒有查看權限」、其他「QR Code 無法辨識」
- 說明文字：維修入口由系統動態導向，QR 不需更換

**缺少或不同**

- 整頁缺失

**業務規則**

- token 需為 24-64 位小寫英數，否則 400
- token 作廢或找不到回 404
- 未登入回 401
- 無權限回 403
- 設備保固：has_warranty + warranty_end_date；設施保固讀 specs.facility_has_warranty / facility_warranty_end_date
- 照片與附件最多 8 筆，優先 is_primary
- 維修回報路徑隨權限動態決定

**API**：舊 GET /api/general-affairs/assets/scan/[token]；新 —

**資料表**：ga_equipment（qr_token、qr_token_revoked_at）、ga_facilities、ga_resource_attachments、maintenance_requests / 工單、stores、Storage bucket: general-affairs-attachments（signed URL 1 小時）

**既有測試**：—

**待確認**

- 門市範圍檢查（一般使用者能否看到他店資產）在 route.ts 120 行後，僅部分讀過
- management_path 的實際產生規則未讀完

### 測試案例

**冒煙**

- R_GA_MGR 開 /general-affairs/assets/scan/<設備token>（必須是永久路徑；若 Vue 接手需由 Next route 轉入 Vue 或維持舊頁）：顯示類型、名稱、編號、狀態、資訊卡、維修紀錄、照片，console 無 error
- ANON 開 → 導向 /login?redirect=<原掃描網址>，登入後回到掃描頁
- 設施 token 也能開並顯示『設施』

**單元**

- normalizeToken：/^[a-z0-9]{24,64}$/ —— 23 字、65 字、大寫、含 '-' 皆回空字串；24 與 64 字通過
- 保固狀態：設備用 has_warranty+warranty_end_date；設施用 specs.facility_has_warranty/facility_warranty_end_date
- 狀態代碼→中文標籤對照（使用中/暫停使用/備品/退役/報廢/部分損壞/停用中/整修中）
- 附件挑選：最多 8 筆、is_primary 優先；非 canOpenAssetDetail 時只回 publicAttachments（測 publicAttachments 過濾規則）
- scope 判斷：canOpenAssetDetail→MANAGE、canViewAll→VIEW_ALL、否則 OWN_STORE
- 路徑產生：repair_request_path=`/general-affairs/reports/new?assetToken=${token}`（僅有 repair 權限）；management_path=`/general-affairs/equipment?id=` 或 `/facilities?id=`（僅 FULL 權限）

**整合**

- API 矩陣（GET /api/general-affairs/assets/scan/[token] 與 workspace 版）：ANON 401；token 格式錯 400 'QR Code 格式錯誤'；不存在或 qr_token_revoked_at 非空 404；R_ADMIN/R_GA_MGR 200 scope=MANAGE、有 management_path；R_GA_VIEW 200 scope=VIEW_ALL、management_path=null；R_STORE_MGR_A 掃 STORE_A 資產 200 scope=OWN_STORE、有 repair_request_path，掃 STORE_B 資產 403（訊息含『可能屬於其他門市』）；R_STAFF_A 掃 STORE_A 資產 403（只認 store_managers）；R_NOPERM 403
- 照片 signed URL 有效期 1 小時（檢查 URL 的 expires 參數 ≈3600）
- 維修紀錄只含該資產的工單
- 作廢流程：service role 設定 qr_token_revoked_at 後同 token 回 404

**E2E**

- R_STORE_MGR_A 掃 STORE_A 設備 → 點『維修回報』導到 /general-affairs/reports/new?assetToken=… ；無 repair 權限的 R_GA_VIEW 看到停用按鈕與說明
- R_GA_MGR 點『查看完整主檔』→ 開設備清冊並自動開啟該設備
- 從標籤頁解碼 QR → 開啟 → 正確資產（與 labels e2e 串接）
- 403 與 404 錯誤頁文案正確

**對等驗證**

- 所有角色 × 4 種 token（STORE_A 設備、STORE_B 設備、STORE_A 設施、revoked）矩陣下，舊 API 與 Vue 使用的 API 回應 status 與 JSON（去除 signed URL token）deep-equal
- 兩版頁面擷取的資訊卡文字與按鈕可用狀態一致
- 永久 URL 不變：同一 token 舊網址在 Vue 上線後仍可開（回歸測試）

**測試資料**

- STORE_A 設備（有照片 is_primary + 9 筆附件測上限 8、2 筆維修紀錄）、STORE_B 設備、STORE_A 設施（specs 有保固）、revoked token 設備 1 筆、格式錯 token 字串
- R_ADMIN、R_GA_MGR、R_GA_VIEW、R_STORE_MGR_A、R_STAFF_A、R_NOPERM、ANON

**風險**

- Vue 為 hash router，若把掃碼頁搬到 /#/ 會讓已貼標籤失效；必須保留 Next 路徑或做伺服器端轉址
- 門市範圍只認 store_managers，若 Vue 改用員工所屬門市會造成權限放寬

## 領域測試備註

【共通前提（已讀程式碼確認）】
1. 這 18 頁在 Vue 端全部是 missing，所以每頁的測試計畫都是給「Vue 頁加 workspace API 完成後」用的驗收規格。先在 lib/workspace/general-affairs/** 抽出共用純函式（建議沿用 lib/general-affairs/{equipment,facilities,parts,categories}/validation.ts，不要另寫一份），單元測試直接 import 舊檔，兩版就不會分叉。
2. 測試 DB：.env.development.local 有 NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、EXPECTED_SUPABASE_PROJECT_REF、ALLOW_DEV_DATABASE_OPERATIONS、ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS。所有寫入 DEV 的測試腳本都要沿用 scripts/apply-workspace-dev.cjs 第 3-13 行的保護：用 @next/env loadEnvConfig 載入，比對 project ref 與 EXPECTED_SUPABASE_PROJECT_REF，並要求 ALLOW_* 等於 "true"；不符就 throw "DEV environment mismatch"。另外要呼叫 verify-dev-supabase-environment.js。.env.local 可能指向正式庫，測試一律不得讀它。
3. 測試資料命名：一律用 ZZTEST-GA1- 開頭（名稱、asset_code 以外的文字欄位、store_code），seed 腳本寫成 scripts/seed-workspace-ga-assets-dev.cjs，cleanup 腳本只刪這個前綴的資料（soft delete 的資料用 service role 硬刪）。產出放 .tmp-check/ga-assets/。
4. 角色矩陣（下面每頁都會引用這些代號）：
   - R_ADMIN：系統管理員。
   - R_GA_MGR：general_affairs.service_center.access、equipment.manage、equipment.view、equipment_template.manage/view、facility.manage/view、part.manage/view、maintenance_request.view_all、work_order.view_all。
   - R_GA_VIEW：service_center.access、equipment.view、equipment_template.view、facility.view、part.view。
   - R_STORE_MGR_A：store_managers 表有 STORE_A 的資料，另有 maintenance_request.view_own_store、request.create，沒有 equipment.view。
   - R_STAFF_A：屬於 STORE_A 的員工，但 store_managers 沒有資料，也沒有任何 GA 權限。
   - R_NOPERM：已登入但沒有任何 GA 權限。
   - ANON：未登入。
   權限碼要對照 migration 20260727015132_dev_general_affairs_role_matrix_permissions.sql 授予。
5. 掃碼的門市範圍（app/api/general-affairs/assets/scan/[token]/route.ts 第 217-228 行）：「本門市」只認 store_managers（isStoreManagerForStore），所以一般門市員工就算在同一門市也會拿到 403。Vue 版必須維持這個行為，不可以自行放寬成員工所屬門市。
6. 會影響 parity 的已知舊版行為，Vue 必須照抄或明確記錄差異：
   (a) 保固狀態用 Date.now() 搭配 new Date('YYYY-MM-DD')（UTC 解析），用 Math.ceil 計算天數，門檻是 ≤30 天；
   (b) 維修紀錄頁抓 pageSize=100 之後，才在前端以 equipment_id 或 facility_id 是否存在來過濾；
   (c) 設備列表 API 的 pageSize 會被 clamp 到 1..100；
   (d) 設備 POST 的 quantity 是 1..100 的整數，以一次 insert 陣列寫入；
   (e) validateEquipmentPayload 在 partial 更新且沒帶 has_warranty 時，不會檢查 warranty_end_date；
   (f) tags 最多保留 30 個；
   (g) 掃碼 token 需符合 /^[a-z0-9]{24,64}$/。
7. Parity 的通用做法：寫 scripts/test-workspace-ga-parity.cjs，用同一個角色的 session 同時打舊 API（/api/general-affairs/**）和新 API（/api/workspace/general-affairs/**）。回應先正規化（去掉 updated_at、signed URL 的 token、排序穩定化）再做 deep-equal。寫入類的比對，是在兩邊各建一筆內容相同的資料，然後用 service role 讀 DB 列，比對除了 id、asset_code、qr_token、時間戳以外的欄位。UI 的比對，是用 Playwright 在 1920x1080 下分別開舊頁與 Vue 頁（Vue 為 hash 路由 /#/...），擷取統計卡數字、表格列（依主鍵排序）與篩選後筆數，再做比對。
8. 測試工具：沿用既有的 Python Playwright（scripts/test-workspace-*.py）與 Node（*.cjs）。新增的檔案建議命名為 scripts/test-workspace-ga-<page>.py / .cjs。單元測試如果專案沒有 vitest，就用 node:test 加 tsx 直接跑 .ts（uncertain：需確認 repo 裡是否已有 tsx/vitest；package.json 只看到 node 腳本）。
9. 不確定的部分：Vue 端導覽項的實際權限欄位名稱、workspace API 路徑命名（建議用 /api/workspace/general-affairs/...），都要等實作時才能定，下面的案例是以這個命名為假設。

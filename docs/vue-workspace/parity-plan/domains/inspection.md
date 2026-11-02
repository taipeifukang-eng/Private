# 巡店與改善

## 領域共用缺口

- 缺少 IndexedDB 離線自動暫存（舊版 fk-inspection-drafts）與頁面離開還原，新舊編輯器行為差異最大，建議列為獨立工作項
- 提交簽名規則不一致：舊版 new/edit 需門市＋督導雙簽名才能送出，Vue 未強制；需產品決定並以後端 workspace_save_inspection 與測試固化
- 列表統計口徑差異：舊版近 6 個月、不分頁，Vue 單月、20 筆分頁與門市篩選；需決定一致規則並補整合測試
- 匯出依賴 WORKSPACE_USE_EXISTING_SESSION 旗標（app/api/workspace/inspection-export/route.ts），需確認各環境啟用並補 e2e
- 評分/評級規則：舊版硬編碼 220 起算與分級門檻，Vue 由 lib/workspace/inspection-scoring.ts 與 inspection_grade_mapping 資料驅動；需對照測試確保同輸入同結果
- 權限判定兩套：舊版 hasPermission 與 getImprovementAccess（user_roles），Vue 為 context().has 與 improvementAccess；需以各角色矩陣（admin、督導、區經理、店長、一般）做雙版本對照
- DB 依賴：improvements 產生與回補 trigger、workspace_save_inspection RPC 僅在 supabase/workspace-dev/*.sql；上線需確認等價 migration 已套用
- 測試資料：需 sonnet 建立含督導/經理單、含缺失與照片、已逾期與已改善之種子資料（可延伸 scripts/seed-workspace-improvement-scope-dev.cjs）
- 舊版除錯頁與 /api/inspection-debug 建議排除復刻並更新 full-migration-checklist.md 的『待逐項盤點』狀態為 exclude
- 文件狀態過時：full-migration-checklist.md 多列為『已原生化』，實測未涵蓋經理權限、手機細節、列印版面對等，不可直接採信
- 共用元件 PrintInspectionReport（舊）與 InspectionReport.vue（新）需做視覺對照測試（A4 列印、簽名、待改善彙整）

## /inspection

- 狀態：**partial**（M）— Vue 已有列表、月份切換、督導/經理類型、統計卡、月曆、已/未巡店門市、匯出、分頁，功能大致原生化；但資料範圍、列表欄位與匯出可用條件與舊版不同，且匯出依賴環境旗標，需實測確認一致。
- 舊版：`app/inspection/page.tsx（含 components/InspectionOverview.tsx、InspectionExportControls.tsx、InspectionCalendar.tsx、InspectionStoreStatus.tsx）`
- Vue：`vue-workspace/src/pages/Inspections.vue`、`vue-workspace/src/components/InspectionOverview.vue`
- 權限：inspection.view_all、inspection.view_store、inspection.view_own、inspection.manager_tab、inspection.create、inspection.compare、inspection.view_store_status、inspection.export
- 相依：共用元件 InspectionContent/InspectionReport（詳情）、lib/workspace/server.ts inspectionScope

**舊版功能**

- 督導巡店／經理巡店分頁切換（經理分頁需 inspection.manager_tab，無權限者導回督導）
- 查詢近 6 個月 inspection_masters，依 tab 過濾 inspection_type（督導含 null）
- 統計卡：總巡店次數、優秀(8-10)、良好(6-7)、需改善(0-5)
- InspectionOverview：月曆與月份切換、已巡店／未巡店門市（inspection.view_store_status；admin 看全部啟用門市，其他看 store_managers 指派門市；以 source_store_id 沿革比對）
- 匯出當月巡店得分 Excel（inspection.export，僅督導分頁）
- 新增督導巡店／新增經理巡店按鈕（inspection.create）
- 月份列表表格：門市(簡稱/代碼)、巡店單號、日期、督導/巡店人員、評級分數、得分數(滿分10分)、狀態徽章、操作
- 經理分頁且有 inspection.compare：「督導 vs 經理 對比分析」連結，以及已完成經理單的「比較」連結（帶 store_id、manager_id）
- 查看詳情連結
- 空狀態提示與新增捷徑

**缺少或不同**

- 舊版列表顯示評級/分數徽章欄（grade 0-10）與『得分數(滿分10分)』欄，Vue 只顯示 total_score / max_possible_score，沒有 grade 欄（Inspections.vue 表頭）
- 舊版查詢範圍是近 6 個月 + RLS，Vue 改為單月 + inspectionScope（view_all／view_store／view_own）；Vue 新增門市篩選與每頁 20 筆分頁（舊版無），屬行為差異，需確認是否接受
- 舊版統計卡以 6 個月全部資料計算，Vue 的 InspectionOverview 以所選月份 records 計算（InspectionOverview.vue:66-72），數字口徑不同
- Vue 巡店比較按鈕出現在列表頁頭且不要求 manager_tab；舊版僅在經理分頁顯示
- Vue 匯出 API app/api/workspace/inspection-export/route.ts 要求環境變數 WORKSPACE_USE_EXISTING_SESSION==='true' 否則回 503，與舊版匯出行為不一致，需確認正式環境設定
- 舊版 URL 參數 tab/month，Vue 以工作頁 tab 狀態取代（設計差異，非缺陷）
- 舊版 inspection.view_store_status 範圍涵蓋 admin 全部門市；Vue coverage 邏輯在 app/api/workspace/inspections/route.ts，需與舊版 InspectionStoreStatus 逐項比對畫面文字與計數

**業務規則**

- （無）

**API**：舊 無獨立 API（server component 直接查 Supabase）、GET /api/inspection/export-monthly-score；新 GET /api/workspace/inspections、GET /api/workspace/inspection-export（轉呼叫舊 export-monthly-score）、GET /api/workspace/stores?module=inspections

**資料表**：inspection_masters、stores（source_store_id 沿革）、profiles、store_managers

**既有測試**：scripts/test-workspace-inspection-calendar.py、scripts/test-workspace-inspection-coverage.cjs、scripts/test-inspection-monthly-store-lineage.js、scripts/test-inspection-date.js

**待確認**

- Inspections.vue 在匯出前是否以 resultMonth 對應舊版 exportMonth 預設（最新巡店月）未逐行比對
- WORKSPACE_USE_EXISTING_SESSION 在目標環境是否為 true 無法由程式碼得知

### 測試案例

**冒煙**

- R1/R2 開啟 Vue 巡店工作頁（Inspections.vue）：GET /api/workspace/inspections?month=當月&type=supervisor 回 200，表格、統計卡、月曆都有渲染，console 0 error、沒有 4xx/5xx 網路請求
- R3 切換到經理類型：type=manager 回 200；R2（沒有 manager_tab）呼叫 type=manager 應被擋（403 或導回督導），UI 不顯示經理分頁
- R5 一般員工：側欄（lib/workspace/navigation.ts）看不到巡店項目；直接呼叫 API 回 403
- 舊版 /inspection 以 R1-R5 各開一次，記錄可見分頁與按鈕，作為對等基準快照
- 月份切換到沒有資料的月份時顯示空狀態，沒有 JS 錯誤

**單元**

- lib/workspace/inspection-coverage.ts inspectionCoverage：(a) 門市有 source_store_id 沿革鏈 S1'->S1，歷史巡店記在 S1 → S1' 算已巡；(b) 鏈有循環 A->B->A 不會無窮迴圈；(c) 名稱比對做 trim、去空白、不分大小寫；(d) 指派門市中有兩家同名 → 不靠名稱判定已巡；(e) history 為空 → 全部未巡
- 抽出統計卡分級計數（優秀 8-10、良好 6-7、需改善 0-5）為純函式（目前在 vue-workspace/src/components/InspectionOverview.vue:66-72），測 grade 邊界 5/6/7/8/10、null grade、字串 grade '10'
- inspections route 的參數驗證抽出（route.ts:17-28）：month '2026-13'、'2026-1'、'1999-01' 拒絕；page 0、10001、1.5 拒絕；'2026-11' 加 page 1 接受
- inspectionScope（lib/workspace/server.ts:169）以 mock ctx 測：view_all → all；view_store 加 store_managers 2 筆 → assigned 2；只有 view_own → own=true；無權限 → requireCapability 拋錯

**整合**

- 角色矩陣 GET /api/workspace/inspections?month=M&type=supervisor：R1/R2 看到 S1、S2、S3 全部；R3 只看到 S1、S2；R6 只看到 inspector_id=自己的單；R5 回 403；查詢結果與 service role 直查 inspection_masters（同月、同類型、督導含 inspection_type is null）逐筆 id 相符
- type=manager：R3 有 manager_tab 回 200，只有經理單；R2 沒有 manager_tab 回 403（route.ts:31）
- 分頁：種子 25 筆同月督導單 → page=1 20 筆、page=2 5 筆、page=3 0 筆；排序固定，兩頁沒有重複 id
- coverage：R2 有 view_store_status → 回應含 visited/unvisited，S1' 因沿革算已巡；拿掉 view_store_status → 回應不含 coverage
- canExport：有 inspection.export 為 true，否則為 false
- 匯出 GET /api/workspace/inspection-export：WORKSPACE_USE_EXISTING_SESSION 未設 → 503 '請使用原測試站工作台'；設成 true → 回 xlsx（content-type 正確），以 xlsx 套件解析後與舊版 GET /api/inspection/export-monthly-score 同月輸出逐列相同；R6（無 export）→ 403
- 跨門市：R3 帶 store=S3 篩選 → 0 筆或 403，不可洩漏 S3 資料
- 錯誤路徑：month 缺漏或格式錯回 400，訊息為中文

**E2E**

- R2：開啟巡店 → 切換到上月 → 確認統計卡數字 → 月曆點選有巡店的日期 → 已巡／未巡門市清單 → 點列表某筆『查看詳情』開啟 InspectionDetail 工作頁 → 返回後保留月份狀態
- R2：點『新增督導巡店』開啟 InspectionEditor 工作頁
- R3：切換到經理類型 → 點『比較』開啟 InspectionCompare，並帶入 store_id/manager_id
- R2：點匯出 → 下載檔名與月份正確（環境旗標為 true 的情境）
- 手機 viewport 390x844：表格可橫向捲動、月曆不破版（截圖存 .tmp-check/inspection/list-mobile.png）

**對等驗證**

- 同一個種子月份、同角色 R1/R2/R3：抓舊版 /inspection?tab=X&month=M 表格所有列（巡店單號、門市代碼、日期、督導、total_score、狀態）和 Vue 所有分頁合併後的列做 set diff，必須為空（舊版是近 6 個月，比對時先篩到同月）
- 統計卡：舊版是 6 個月口徑、Vue 是單月口徑 → 先輸出兩邊數字的差異報告；產品決策定案後改成斷言，或把舊版數字重新以單月計算再比
- 已巡／未巡門市：舊版 InspectionStoreStatus 與 Vue coverage 的門市名稱集合逐一相同（含沿革門市 S1'）
- grade 欄：舊版有評級徽章、Vue 沒有 → 列為已知差異；若決議補上，再比對每列 grade 相同
- 匯出 Excel：同月份兩邊檔案以 cell 值逐格比對（忽略產出時間戳）
- 按鈕可見性矩陣（新增、比較、匯出）R1-R6 兩版一致；比較按鈕的位置差異（Vue 不要求 manager_tab）要記錄並由產品確認

**測試資料**

- 門市 ZZTEST-INSP-S1/S2/S3，以及 S1'（source_store_id=S1）
- 當月督導單 25 筆（跨 S1-S3，grade 涵蓋 10/8/7/6/5/0 邊界，含 inspection_type=null 的舊資料 2 筆）、上月 3 筆、7 個月前 1 筆（驗證舊版 6 個月邊界）
- 經理單 4 筆（S1、S2，含 completed 與 draft）
- R6 自己建立的 2 筆單，以及別人建立的單
- 帳號 R1-R6 與 store_managers 指派（R3→S1、S2；R4→S1）

**風險**

- 匯出依賴環境旗標，正式環境若未設定，Vue 匯出會一律 503
- 口徑不同（單月與 6 個月）容易被使用者誤認為數字錯誤

## /inspection/new

- 狀態：**partial**（L）— Vue 編輯器已涵蓋門市、日期、溫度、GPS、當班人員、評分、照片、簽名、草稿與提交，並透過 RPC workspace_save_inspection 寫入；但缺少舊版 IndexedDB 離線自動暫存、提交需雙簽名的限制，且權威後端分數規則為另一套，需驗證等價。
- 舊版：`app/inspection/new/page.tsx`
- Vue：`vue-workspace/src/pages/InspectionEditor.vue`、`vue-workspace/src/components/SignatureInput.vue`、`vue-workspace/src/components/InspectionPhotos.vue`
- 權限：inspection.create、inspection.manager_tab（經理類型）、inspection.view_all/view_store/view_own
- 相依：/admin/inspection-templates（範本與評級設定）、月報人員 monthly_staff_status、inspection_grade_mapping 設定

**舊版功能**

- 支援 ?type=manager 的經理巡店
- 自動產生巡店單號與 client_request_id（防重送）
- 選擇門市（必填）、巡店日期、室內溫度（必填，°C）
- GPS 定位：高精度逾時後降級、記錄 accuracy 與 capturedAt、可疑時間檢查，巡店日期依 GPS 時間認列
- 當班人員：從上個月 monthly_staff_status 載入（排除 resigned/leave_of_absence/transferred_out）、手動新增、移除、勾選當班主管
- 檢查範本依區塊分組可展開，勾選缺失項、可設數量、扣分上限、備註、最多 5 張照片（壓縮 800px/0.7）
- 總分 220 起算扣分，評級 0-10（220=10、≥215=9、≥191=8 …≥121=1）即時顯示
- 門市人員簽名與督導簽名
- 督導備註（改善建議）
- IndexedDB 自動暫存草稿（fk-inspection-drafts）、離開頁面警示、還原草稿、已送出草稿比對清除
- 儲存草稿（跳轉編輯頁預覽報表）／送出記錄（跳詳情頁）
- 重複送出偵測（同 client_request_id 或同門市同日已存在）
- 提交後寫 inspection_masters、inspection_results、inspection_on_duty_staff；DB trigger 產生 inspection_improvements
- 錯誤訊息含 RLS / 欄位缺失提示

**缺少或不同**

- Vue 沒有 IndexedDB 離線暫存與還原：InspectionEditor.vue 內無 indexedDB/localStorage，只有 tab.dirty 與後端草稿（grep 結果為空）
- 舊版送出前要求兩個簽名（edit/page.tsx 按鈕 disabled 條件），Vue 提交僅檢查門市與溫度（InspectionEditor.vue save()），簽名非必填
- Vue 後端驗證要求範本雜湊一致（templateHash），範本更新時會拒絕，舊版無此機制（行為不同，較嚴格）
- Vue 提交後鎖定頁面並提示，不再自動跳轉詳情／報表預覽；舊版存草稿後導向編輯頁預覽報表，Vue 無草稿階段報表預覽
- Vue 的門市下拉為 ctx.auth 可見門市（stores 全部 RLS 可見）與舊版一致，但 inspection-form GET 僅在 inspection.create 通過後可用
- 評分計算實作於 lib/workspace/inspection-scoring.ts 與 DB RPC；需逐案例核對與舊版 220 起算／分級門檻相同（舊版硬編碼，Vue 讀 inspection_grade_mapping）
- Vue 載入名冊用 loadRoster 手動按鈕，舊版選門市即自動載入
- 經理巡店 (type=manager) 權限與手機細節驗收仍待補（full-migration-checklist.md:23）

**業務規則**

- （無）

**API**：舊 無（client 直接寫 Supabase）；新 GET/POST /api/workspace/inspection-form、RPC workspace_save_inspection（supabase/workspace-dev/20261028010000_vue_inspection_write.sql）

**資料表**：inspection_masters、inspection_results、inspection_on_duty_staff、inspection_templates、inspection_grade_mapping、monthly_staff_status、stores、inspection_improvements（trigger）、workspace_inspection_settings_revision

**既有測試**：scripts/test-workspace-inspection-editor.py、scripts/test-workspace-inspection-write.py、scripts/test-workspace-inspection-transaction.cjs、scripts/test-inspection-submit-deduplication.js、scripts/test-inspection-gps-timestamp.js、scripts/test-inspection-request-identity.js

**待確認**

- Vue 是否刻意放寬簽名必填，文件未明示
- SignatureInput/InspectionPhotos 的壓縮參數與舊版是否完全一致未逐行檢查（編輯器內 canvas 0.7 品質有確認）

### 測試案例

**冒煙**

- R2 開啟 InspectionEditor（新增模式）：GET /api/workspace/inspection-form 回 200，範本區塊、門市下拉、評級顯示都正常，console 0 error
- 以 ?type=manager 對應的經理模式（R3）開啟：表頭顯示經理巡店；R2 沒有 manager_tab 時開經理模式應被拒
- R6/R5（沒有 inspection.create）開啟 → 顯示無權限，API 回 403
- 舊版 /inspection/new 以 R2 開啟，作為基準

**單元**

- lib/workspace/inspection-scoring.ts scoreInspection：(a) 沒有缺失 → total 220、grade '10'；(b) 扣 5 → 215、'9'；扣 5.1 → 214.9、'8'；(c) 每個門檻邊界 191/190.9、181/180.9 … 121/120.9 → 120.9 為 '0'；(d) 浮點：0.1+0.2 扣分四捨五入到 1 位；(e) requires_quantity 數量 3 × 扣 2 = 6；未提供數量時預設 1；(f) 數量 0、-1、1.5、10001 拋『缺失數量必須為正整數』；(g) 項目扣分大於 max_score 拋錯；(h) 總扣分超過 220 拋錯；(i) inputs 少一個範本或 template_id 重複，拋『檢查項目已變更』；(j) checked_items 重複或 label 不存在時拋錯；(k) 自訂 mappings（從 inspection_grade_mapping 讀取）時的結果
- 對等 unit：把舊版 app/inspection/new/page.tsx:854 calculateTotals 的門檻邏輯複製成 fixture 函式 legacyGrade(total)，以 0 到 220、間隔 0.1 全部掃描，與 scoreInspection 的預設 mappings 結果完全相同
- GPS 與日期邏輯：沿用並擴充 scripts/test-inspection-gps-timestamp.js、test-inspection-date.js，指向 Vue 編輯器使用的同一個函式（若 Vue 自己另有實作，要求抽出到 lib 後測試：GPS 時間與裝置時間差距過大要標記可疑、巡店日期依 GPS 時間以台北時區認列）
- client_request_id／writeId 產生與重送判定：沿用 scripts/test-inspection-request-identity.js、test-inspection-submit-deduplication.js
- 名冊過濾：上月 monthly_staff_status 排除 resigned/leave_of_absence/transferred_out（抽出為純函式後測試）
- 照片壓縮參數：最大邊 800px、品質 0.7，最多 5 張（測試抽出的 resize 計算函式）

**整合**

- POST /api/workspace/inspection-form（RPC workspace_save_inspection）R2 提交 S1：在同一個交易內寫入 inspection_masters、inspection_results（每個範本一列，given_score、deduction_amount 與 scoreInspection 一致）、inspection_on_duty_staff；trigger 為每個扣分項目產生 inspection_improvements（數量 = is_improvement 列數）
- templateHash 不符：先 GET 表單，再以 R7 改範本，然後 POST → 拒絕並提示重新載入，DB 沒有任何寫入
- 重送防護：同一個 writeId／client_request_id 連續 POST 兩次 → 只產生 1 筆 master，第二次回傳同一個 id
- 並行：兩個 session 同時以不同 writeId 提交同門市同日 → 依舊版規則偵測重複（記錄實際行為；舊版會偵測同門市同日已存在）
- 權限：R6、R5 POST 回 403；R2 POST type=manager 回 403；R3 POST 不在轄區的 S3 → 記錄行為（舊版由 RLS 決定，兩邊要一致）
- 驗證：缺門市或溫度回 400；簽名缺漏時 Vue 目前接受 → 測試記錄為『與舊版不同』，等決策
- 草稿：status=draft 儲存後，GET recordId 能還原所有欄位（溫度、GPS accuracy/capturedAt、人員、勾選、數量、備註、照片、簽名）
- 交易失敗：故意讓 inspection_results 寫入失敗（例如不存在的 template_id）→ master 不會留下孤兒資料（延伸 scripts/test-workspace-inspection-transaction.cjs）

**E2E**

- R2 完整流程：新增督導巡店 → 選 S1 → 按載入名冊 → 新增一名手動人員並勾選當班主管 → 輸入溫度 → 模擬 GPS（context.set_geolocation 加 grant permissions）→ 在 2 個區塊勾缺失，其中一項設數量 3 → 確認即時分數與評級 → 上傳 2 張照片 → 雙簽名 → 送出 → 頁面鎖定提示 → 到列表看到新單，分數相同
- R2 草稿流程：只填門市與溫度後儲存草稿 → 關閉工作頁 → 從列表重新開啟 → 資料還原
- GPS 被拒或逾時：顯示降級提示，仍可送出（與舊版一致）
- dirty 保護：修改後關閉工作頁要跳出確認
- R3 經理巡店流程同上，列表經理分頁出現該筆
- 手機 viewport：簽名 canvas 可繪製，照片選擇可用

**對等驗證**

- 同一組輸入 JSON（門市、勾選項目、數量），分別透過舊版 UI 送出與 Vue 送出，比對 DB 中 inspection_masters（total_score、grade、max_possible_score、inspection_type、status）、inspection_results 每列（given_score、deduction_amount、selected_items、is_improvement）、inspection_improvements 數量與 deduction，必須全部相同（id、時間戳、request id 除外）
- on_duty_staff：同門市同月份自動或手動載入的名冊名單（員編集合）兩邊相同
- 評級：0-220 每 0.1 掃描的 unit 對照（見上）加上 DB 中 inspection_grade_mapping 的實際值和舊版硬編碼門檻相同（若 DEV 的對照表被改過，就列為 parity 失敗）
- 送出條件差異（雙簽名、IndexedDB 離線暫存、送出後不跳轉）輸出到差異報告，等產品決策

**測試資料**

- 啟用中的 inspection_templates（至少 3 個區塊，含一個 requires_quantity 項目、一個 deduction 帶小數 0.5 的項目）
- inspection_grade_mapping 使用預設 11 筆門檻
- S1 上月 monthly_staff_status：5 名 active、1 名 resigned、1 名 leave_of_absence、1 名 transferred_out
- 測試用簽名與照片 PNG fixture（小於 200KB 以及約 6MB 的各一張）
- 帳號 R2、R3、R5、R6、R7

**風險**

- Vue 沒有 IndexedDB 離線暫存，現場網路不穩時資料可能遺失
- 簽名非必填可能讓不完整的單據被送出
- templateHash 嚴格比對：設定變更時，現場正在填寫的人會被拒絕送出

## /inspection/[id]

- 狀態：**partial**（M）— Vue 有明細、列印預覽、刪除（版本檢查與連帶刪除）與照片預覽，主要功能已原生化；與舊版 PrintInspectionReport 的版面、Google Maps 連結、時間顯示等需逐項核對，文件自評也標為未完成對等驗收。
- 舊版：`app/inspection/[id]/page.tsx（含 components/PrintInspectionReport.tsx、DeleteInspectionButton.tsx、InspectionPhotoViewer.tsx）`
- Vue：`vue-workspace/src/pages/InspectionDetail.vue`、`vue-workspace/src/pages/InspectionPrint.vue`、`vue-workspace/src/components/InspectionContent.vue`、`vue-workspace/src/components/InspectionReport.vue`、`vue-workspace/src/components/InspectionFinding.vue`
- 權限：inspection.delete、inspection.manager_tab（經理單）、inspection.view_all/view_store/view_own
- 相依：/inspection/improvements/[id]（改善回報連結）、列印樣式 CSS

**舊版功能**

- 巡店單號、門市、督導、狀態、日期、GPS（Google Maps 連結、座標、精度、時間）、室內溫度
- 當班人員表（員編、姓名、職位、當班主管）
- 評分結果依區塊分組、需改善項目清單（扣分、勾選項目、備註、照片）
- 每個改善項目關聯 inspection_improvements 狀態
- 簽名圖片顯示、督導備註
- 編輯按鈕（建立者且 draft/in_progress）
- 刪除按鈕（inspection.delete，經 DeleteInspectionButton 呼叫 DELETE /api/inspection/[id]）
- A4 列印報表（PrintInspectionReport，含待改善彙整與簽名欄）
- 照片點擊放大檢視

**缺少或不同**

- Vue 列印為獨立工作頁 InspectionPrint.vue 並使用 window.print，需與 PrintInspectionReport 版面逐欄比對（兩邊元件不同）
- 舊版顯示 Google Maps 連結；Vue 需確認 InspectionContent.vue 是否保留連結（本次未逐行核對）
- Vue 新增『回報改善』導向 improvement-detail 的 report() 動作與刪除計數提示、跨工作頁刪除同步（deletedInspectionIds），屬 Vue 加強
- Vue 刪除 API 採 version 樂觀鎖並要求經理單具 inspection.manager_tab（inspection-detail/route.ts:141），舊版 DELETE /api/inspection/[id] 規則需對照
- 其他角色與舊資料仍待驗收（full-migration-checklist.md:28）

**業務規則**

- （無）

**API**：舊 DELETE /api/inspection/[id]；新 GET/DELETE /api/workspace/inspection-detail

**資料表**：inspection_masters、inspection_results、inspection_templates、inspection_improvements、inspection_on_duty_staff、stores、profiles

**既有測試**：scripts/test-workspace-inspection-print-delete.py、scripts/test-workspace-inspection-delete-cascade.cjs

**待確認**

- GPS Google Maps 連結、備註區、簽名顯示在 InspectionContent.vue/InspectionReport.vue 的逐欄對等未逐行確認

### 測試案例

**冒煙**

- R2 開啟 InspectionDetail：GET /api/workspace/inspection-detail?id= 回 200，基本資料、當班人員、評分區塊、待改善項目、簽名都顯示，console 0 error
- 開啟 InspectionPrint 工作頁，版面渲染無錯誤
- R4 開啟自己門市的單 → 200；開啟 S3 的單 → 404 或 403
- 照片點擊放大燈箱可開可關

**單元**

- 把詳情頁的『依區塊分組』『待改善項目彙整（扣分大於 0）』轉換抽成純函式（在 InspectionContent.vue／InspectionReport.vue 中），測排序（section_order、item_order）、空區塊、缺少範本的舊資料
- GPS 顯示格式：座標小數位、精度（m）、Google Maps URL 組成（https://www.google.com/maps?q=lat,lng），以及 null GPS 時不顯示

**整合**

- GET 角色矩陣：R1/R2 任意單 200；R3 經理單需 manager_tab；R4 只能看 S1；R6 只能看自己建立的單；R5 回 403
- DELETE /api/workspace/inspection-detail：R2（inspection.delete）帶正確 version → 刪除 master，連帶刪除 results、on_duty_staff、improvements（延伸 scripts/test-workspace-inspection-delete-cascade.cjs），用 service role 確認 0 列殘留
- DELETE 帶舊 version → 409，資料不變
- DELETE 經理單但沒有 manager_tab → 403（inspection-detail/route.ts:141）
- R6（沒有 delete）→ 403
- 並行：A 開啟編輯、B 刪除 → A 送出回 409 或 404，編輯器進入 recordRemoved 凍結狀態
- 已有改善回報（status=improved）的單被刪除時，回應內的刪除計數正確

**E2E**

- R2：從列表開詳情 → 檢查 GPS 連結 → 點照片放大 → 開列印預覽 → 觸發 window.print（攔截 print 事件）→ 回詳情 → 刪除（確認對話框）→ 列表該筆消失（deletedInspectionIds 跨工作頁同步）
- R4：詳情頁按『回報改善』→ 開啟 ImprovementDetail 對應項目
- 建立者 R2 對草稿單看得到編輯按鈕，對 completed 單看不到；非建立者都看不到

**對等驗證**

- 同一筆單：抓舊版 /inspection/[id] 與 Vue 詳情的 DOM 文字（單號、門市、督導、狀態、日期、溫度、GPS 座標與精度、人員表各列、每項扣分、勾選項目、備註、照片數、改善狀態），正規化後 diff 必須為空
- 列印：以 1920x1080 及 A4 print media 對舊版 PrintInspectionReport 與 Vue InspectionPrint 分別輸出 PDF（page.pdf），比對欄位清單（待改善彙整列數、簽名欄、總分、評級），並附視覺截圖人工審查
- 刪除：兩版各刪一筆內容相同的單，比對 DB 殘留（應都為 0）以及 improvements 處理方式是否一致
- Google Maps 連結（Vue 是否存在未確認）：缺少時列為 parity 失敗

**測試資料**

- 一筆完整督導單：GPS、5 名人員、3 個扣分項目（含照片與備註）、雙簽名、其中 1 個 improvement 已改善
- 一筆沒有 GPS、沒有照片的舊資料單（inspection_type=null）
- 一筆經理單
- 一筆 draft 單（建立者 R2）

**風險**

- 連帶刪除會移除改善紀錄與回補分數，必須確認與舊版行為一致

## /inspection/[id]/edit

- 狀態：**partial**（M）— Vue 編輯器以同一頁面處理新增與編輯，含版本檢查與舊資料數量推算；缺少草稿階段的報表預覽 Modal 與雙簽名提交限制。
- 舊版：`app/inspection/[id]/edit/page.tsx`
- Vue：`vue-workspace/src/pages/InspectionEditor.vue（recordId 模式）`
- 權限：inspection.create、建立者本人（inspector_id）
- 相依：/inspection/new 的共用編輯器邏輯

**舊版功能**

- 僅建立者且 draft/in_progress 可編輯，否則顯示無權限／狀態訊息
- 預填門市、日期、溫度、簽名、GPS、當班人員、評分、照片
- 更新草稿（alert 草稿已更新）／送出記錄（需兩簽名、跳詳情頁）
- 報表預覽 Modal（PrintInspectionReport，僅顯示扣分項目，可關閉）
- 可新增／移除人員、重新載入上月名冊
- 保留原始 inspection_type

**缺少或不同**

- Vue 沒有草稿報表預覽 Modal（InspectionEditor.vue 無 PrintInspectionReport 對應；僅詳情頁可開 inspection-print）
- 送出不需雙簽名，與舊版 edit/page.tsx 按鈕條件不同
- Vue 以 workspace_version 樂觀鎖＋writeId 重送防護，並在紀錄被刪除時凍結（recordRemoved），舊版沒有
- 舊版編輯權限是 inspector_id === user.id；Vue API 同樣限制（inspection-form/route.ts:34），一致
- 舊資料缺數量時 Vue 要求人工核對（InspectionEditor.vue），舊版沿用原值

**業務規則**

- （無）

**API**：舊 無；新 GET/POST /api/workspace/inspection-form

**資料表**：inspection_masters、inspection_results、inspection_on_duty_staff、inspection_templates

**既有測試**：scripts/test-workspace-inspection-editor.py、scripts/test-workspace-inspection-write.py、scripts/test-workspace-inspection-transaction.cjs

### 測試案例

**冒煙**

- R2 開啟自己的 draft 單（InspectionEditor recordId 模式）：所有欄位預填，console 0 error
- R2 開啟別人的 draft → 無權限訊息（inspection-form/route.ts:34）
- 開啟 completed 單的編輯 → 狀態訊息，不可編輯

**單元**

- 舊資料缺 workspace_quantities 時的數量推算（InspectionEditor.vue 內的邏輯抽成純函式）：deduction_amount / option.deduction 能整除時推算出數量，不能整除時標記為需人工核對
- 表單 dirty 判定、還原值比較函式

**整合**

- GET recordId：建立者 200；非建立者 403；completed 單回狀態錯誤
- POST 更新 draft 帶正確 workspace_version → 成功，version 遞增；帶舊 version → 409
- POST 從 draft 改為 completed → results 被重寫，improvements 由 trigger 產生，沒有重複
- 保留 inspection_type：經理 draft 更新後仍是 manager
- 被刪除後 POST → 404

**E2E**

- R2：從詳情進入編輯 → 改溫度與一個缺失數量 → 更新草稿 → 重新開啟確認 → 補簽名 → 送出 → 詳情顯示 completed，分數更新
- 兩個瀏覽器 context 同時編輯同一草稿：後送出者收到版本衝突提示，資料不被覆蓋
- 從列表重新載入上月名冊（新增或移除人員）

**對等驗證**

- 同一份 draft，在舊版編輯與 Vue 編輯做相同修改後送出，比對 DB 結果（同 /inspection/new 的欄位清單）
- 舊資料（沒有 quantities）：舊版沿用原值、Vue 要求人工核對 → 記錄差異，並確認人工核對後的分數與舊版相同
- 草稿報表預覽 Modal 在 Vue 缺少 → 列入差異報告

**測試資料**

- R2 建立的 draft 2 筆（督導、經理各一）、別人建立的 draft 1 筆、completed 1 筆
- 舊格式 draft 1 筆：inspection_results 有 deduction_amount，但沒有 workspace_quantities

**風險**

- Vue 沒有草稿報表預覽，督導無法在送出前看到列印版本

## /inspection/compare

- 狀態：**done**（S）— Vue 頁面有門市、督導／經理巡店選擇、逐項比較表、整體備註、照片燈箱，權限需 inspection.compare 與 inspection.manager_tab，功能對應完整；文件稱附件及缺少明細分支待補測。
- 舊版：`app/inspection/compare/page.tsx`
- Vue：`vue-workspace/src/pages/InspectionCompare.vue`
- 權限：inspection.compare、inspection.manager_tab
- 相依：/inspection 列表（入口）

**舊版功能**

- 選擇門市、載入該店督導與經理巡店記錄（可由 URL 帶入 store_id、manager_id）
- 選擇督導單與經理單後執行對比
- 逐檢查項目比較扣分、勾選缺失、備註、照片，標示差異
- 區塊展開／收合
- 督導與經理整體備註（supervisor_notes）顯示
- 照片燈箱（上一張／下一張）
- 無權限畫面（權限不足、返回）
- 返回經理巡店列表

**缺少或不同**

- Vue 比較表『比較』欄與差異標示樣式需截圖對照（不影響功能）
- 附件及缺少明細分支尚未補測（full-migration-checklist.md:30）

**業務規則**

- （無）

**API**：舊 無；新 GET /api/workspace/inspection-compare

**資料表**：inspection_masters、inspection_results、inspection_templates、stores、profiles

**既有測試**：scripts/test-workspace-inspection-compare.py

**待確認**

- 差異判斷細節（如分數相同但缺失項不同）的對等性未逐行比對 compare/page.tsx 與 InspectionCompare.vue 計算段落

### 測試案例

**冒煙**

- R3（compare 加 manager_tab）開啟 InspectionCompare：GET /api/workspace/inspection-compare 回 200，門市與巡店選單載入，console 0 error
- R2（沒有 manager_tab）→ 無權限畫面；R5 → 403
- 帶 store_id、manager_id 進入時自動預選

**單元**

- 把比較計算抽成純函式（InspectionCompare.vue 的計算段落）：逐 template 對齊督導與經理結果；差異判定案例：(a) 扣分不同；(b) 扣分相同但勾選項不同；(c) 一方沒有該範本的明細；(d) 都沒有扣分；(e) 照片數不同
- 對照舊版 app/inspection/compare/page.tsx 的差異判定，寫成相同 fixture 跑兩邊函式（舊版邏輯複製成 fixture）

**整合**

- GET 指定門市：只回該門市的督導單與經理單；R3 查 S3（非轄區）→ 403 或空
- GET 比較明細：回應中每個 template 都有兩邊的 deduction、selected_items、notes、photo_urls，與 DB 一致
- 缺明細分支：經理單沒有 inspection_results → 回應不報錯，標示無資料（文件稱待補測）
- 附件：photo_urls 為空陣列或 null 都能正確處理

**E2E**

- R3：選 S1 → 選督導單與經理單 → 執行對比 → 展開或收合區塊 → 有差異的列有標示 → 開照片燈箱並按上一張、下一張 → 返回經理巡店列表

**對等驗證**

- 同一組督導單與經理單：抓舊版與 Vue 比較表每列（項目、督導扣分、經理扣分、差異旗標、勾選項），diff 為空
- 整體備註 supervisor_notes 兩邊顯示相同
- 權限矩陣 R1-R5 進入結果兩版一致

**測試資料**

- S1 同月督導單 1 筆與經理單 1 筆，刻意製造差異：扣分不同 1 項、扣分相同但勾選不同 1 項、只有一方扣分 1 項、都有照片 1 項
- 沒有明細的經理單 1 筆

**風險**

- 差異判定細節（扣分相同但缺失項不同）可能與舊版不同

## /inspection/improvements

- 狀態：**partial**（M）— Vue 有門市與狀態篩選（含各狀態計數）及表格；呈現方式由卡片改為表格，缺少舊版的急迫標記與預設狀態等細節，需比對。
- 舊版：`app/inspection/improvements/page.tsx + app/api/inspection/improvements/route.ts`
- Vue：`vue-workspace/src/pages/Improvements.vue`
- 權限：inspection.improvement.view_all、inspection.improvement.view_own、inspection.improvement.view_own_store、inspection.improvement.manage、inspection.improvement.submit、inspection.view_all（搭配角色管理權限）
- 相依：巡店寫入後產生 improvements 的 DB trigger（supabase/workspace-dev/20261028020000_vue_improvements.sql）

**舊版功能**

- 待改善／已改善／已逾期狀態篩選（預設 pending，可由 ?status 帶入）與各狀態數量
- 卡片顯示門市、項目、扣分、期限、剩餘天數；2 天內到期標示急迫
- 已改善顯示回補分數與花費天數
- 逾期自動判定（pending 且 deadline < 今日 → overdue）
- 點擊進入詳情
- 401/403 提示與權限不足畫面
- 資料存取範圍：admin/view_all 看全部，指派門市主管看自己門市，巡店人看自己的單

**缺少或不同**

- Vue 預設狀態為 pending 並提供 all 選項，但無『急迫』（2 天內到期）標示（Improvements.vue 未見）
- Vue 以表格取代卡片，且新增門市篩選
- 權限判定在 lib/workspace/improvements.ts improvementAccess，與舊版 getImprovementAccess（user_roles/roles 查詢）邏輯不同，需以實際角色逐案驗證
- Vue 逾期於讀取時計算（improvements/route.ts:97），舊版是在 API 讀取後修改 status 顯示；是否寫回 DB 兩者不同需確認

**業務規則**

- （無）

**API**：舊 GET /api/inspection/improvements；新 GET /api/workspace/improvements

**資料表**：inspection_improvements、inspection_masters、stores、profiles、store_managers、user_roles、roles

**既有測試**：scripts/test-workspace-improvements.py、scripts/test-workspace-improvement-scope.py、scripts/test-inspection-improvements-rls-safe-query.js、scripts/seed-workspace-improvement-scope-dev.cjs

**待確認**

- 舊版 getImprovementAccess 的 user_roles 細節未逐行讀完（僅確認其存在於 route.ts:63-110）

### 測試案例

**冒煙**

- R2 開啟 Improvements.vue：GET /api/workspace/improvements 回 200，預設狀態 pending，計數徽章顯示，console 0 error
- R4 只看到 S1 的項目；R5 回 403 並顯示權限不足畫面

**單元**

- lib/workspace/improvements.ts improvementToday：以 fake timer 設在 UTC 15:59 與 16:01（台北時間跨日），確認回傳台北日期
- 逾期判定：pending 且 deadline < today → overdue；deadline == today 不算逾期；improved 永遠不算逾期（抽出 improvements/route.ts:97 附近的邏輯）
- 剩餘天數與急迫判定（舊版 improvements/page.tsx:108、248：pending 且剩餘天數 <=2）：抽成純函式，以 -1/0/2/3 天測；Vue 目前沒有 → 列為待補
- improvementAccess 用 mock ctx 測：admin；improvement.view_all；inspection.view_all 加 role.permission.assign → all；inspection.view_all 但沒有管理權限 → 不是 all；profiles.role=supervisor 但沒有權限 → scoped；什麼都沒有 → 403

**整合**

- 角色矩陣 GET：R1/R2 全部；R3 只有 S1、S2（store_managers）；R4 只有 S1；R6（view_own、inspector 本人）只有自己巡店單產生的項目；R5 回 403；每個角色都與 service role 依相同規則直查的 id 集合比對
- status 篩選 pending/improved/overdue/all，計數與 DB 依台北日期計算的結果一致
- 確認 GET 不會把 overdue 寫回 DB（讀取前後 inspection_improvements.status 不變）
- 門市篩選：R3 帶 S3 → 空或 403

**E2E**

- R2：切換各狀態 → 計數與列數吻合 → 套用門市篩選 → 點一列開啟 ImprovementDetail
- URL 或初始狀態 ?status=overdue 的對應行為（舊版支援 query 帶入；Vue 以工作頁狀態處理，需記錄）

**對等驗證**

- 同角色同種子：舊版 GET /api/inspection/improvements?status=X 的 JSON id 集合與 Vue /api/workspace/improvements?status=X 的 id 集合相同（R1-R6 每個角色、每個狀態各比一次）；不一致時輸出是哪個角色規則造成的（舊版 getImprovementAccess 與 Vue improvementAccess 差異）
- 每列欄位：門市、項目、扣分、期限、剩餘天數、回補分數、花費天數兩邊相同
- 急迫標記：舊版有、Vue 無 → 差異報告

**測試資料**

- inspection_improvements：S1 pending 期限 +5 天、+2 天、今天、-3 天（逾期）各 1 筆；S2 improved 1 筆（含 bonus_score、days_taken）；S3 pending 1 筆；R6 巡店產生的項目 1 筆
- 可延伸 scripts/seed-workspace-improvement-scope-dev.cjs
- 帳號 R1-R6；額外一個只有 profiles.role=supervisor、沒有任何 RBAC 權限的帳號（測 scoped 後援路徑）

**風險**

- 兩套權限判定邏輯不同，跨門市資料可能外洩或漏看
- 台北時區跨日判定

## /inspection/improvements/[id]

- 狀態：**partial**（M）— Vue 已有問題描述、問題照片、回補規則、改善說明與照片（1-5 張）提交、結果顯示及版本衝突保護；少了回到原巡店記錄的連結等小項，其餘邏輯等價但需實測。
- 舊版：`app/inspection/improvements/[id]/page.tsx`
- Vue：`vue-workspace/src/pages/ImprovementDetail.vue`
- 權限：inspection.improvement.submit、inspection.improvement.view_all、inspection.improvement.view_own、inspection.improvement.view_own_store、inspection.improvement.manage
- 相依：/inspection/improvements 列表、inspection_bonus_config 設定、DB triggers calculate_bonus / update_bonus_total

**舊版功能**

- 顯示狀態標籤（待改善／已改善／已逾期）、期限、剩餘天數
- 問題描述與問題照片（燈箱）
- 加分（回補）規則列表（inspection_bonus_config），待改善時顯示
- 有提交權限（admin、指派門市主管）且 pending 才能填寫
- 改善說明必填、至少 1 張至多 5 張照片（壓縮 800px/0.7）
- 提交寫入 improvement_description、improvement_photo_urls、improved_by、improved_at、status=improved；DB trigger 計算 days_taken、bonus_score
- 已改善結果顯示（說明、照片、回補分數）
- 無提交權限提示
- 連結到原巡店記錄 /inspection/[id]

**缺少或不同**

- ImprovementDetail.vue 未找到『查看原巡店記錄』連結（grep inspection-detail 為空）
- 舊版允許 pending 與 overdue 狀態皆可提交填寫區塊（page.tsx:604），但 canSubmit 僅 pending（:170）；Vue 對 overdue 是否可提交需確認（API 於 improvement-detail/route.ts:55 將逾期映射為 overdue）
- Vue 提交以 API 驗證（說明≤8000 字、照片 1-5、容量 8MB）並使用樂觀版本鎖，舊版僅前端檢查
- 提交權限：Vue 為 admin／指派門市／inspection.improvement.submit，舊版為 admin／指派門市主管（多了 submit 權限）

**業務規則**

- （無）

**API**：舊 無（client 直接 update）；新 GET/POST /api/workspace/improvement-detail

**資料表**：inspection_improvements、inspection_masters、inspection_bonus_config、stores、profiles、store_managers

**既有測試**：scripts/test-workspace-improvements.py、scripts/test-workspace-improvement-scope.py

**待確認**

- 逾期項目在 Vue 是否仍可回報，需實測

### 測試案例

**冒煙**

- R4 開啟 S1 的 pending 項目：GET /api/workspace/improvement-detail 回 200，問題描述、照片、回補規則（inspection_bonus_config）、提交表單都顯示，console 0 error
- R2 開啟 improved 項目：顯示結果區（說明、照片、回補分數），沒有提交表單
- R4 開啟 S3 項目 → 404 '找不到可查看的改善項目'

**單元**

- 提交驗證抽成純函式（improvement-detail/route.ts）：說明為空或超過 8000 字 → 拒絕；照片 0 張或 6 張 → 拒絕；1 張與 5 張接受；總容量超過 8MB 拒絕
- 回補分數規則：依 days_taken 對應 inspection_bonus_config 的計算（若邏輯只存在 DB trigger，改在 integration 測）

**整合**

- POST 提交：R4 對 pending 帶正確 version（updated_at）→ status=improved，並寫入 improvement_description、improvement_photo_urls、improved_by、improved_at；trigger 算出 days_taken 與 bonus_score，master 的 bonus 總分由 update_bonus_total 更新
- 逾期項目（DB status=pending、deadline 已過）：Vue canSubmit 依 route.ts:52 只看 DB status，所以仍可提交 → 測試確認提交成功，並與舊版（page.tsx:604 允許 pending/overdue）行為一致
- 並行：兩個 session 同時提交 → 一個成功、一個 409（eq status pending 加 version 條件）
- 權限：有 inspection.improvement.submit 但不是門市主管的帳號 → 可提交（Vue 新增行為，記錄差異）；R6 只能看、不能提交 → 403；improved 項目再提交 → 409 或 400
- 照片上傳失敗或超過容量 → 錯誤訊息，DB 不變

**E2E**

- R4：開啟 pending 項目 → 看回補規則 → 填說明 → 上傳 3 張照片（確認被壓縮到 <=800px）→ 提交 → 畫面切成已改善結果，顯示回補分數 → 回列表，該項移到已改善
- R4：只填說明不傳照片 → 提交鍵擋下並顯示提示
- R6：開啟項目 → 顯示無提交權限提示
- 查看原巡店記錄連結（Vue 目前沒有）→ 預期失敗，列為待補

**對等驗證**

- 同一筆 pending 項目複製成兩份，分別用舊版與 Vue 提交相同說明與照片，比對 DB 中 status、days_taken、bonus_score、master 的 bonus 總分相同
- 畫面欄位（狀態標籤、期限、剩餘天數、回補規則列表）兩版 DOM 文字 diff
- 提交權限矩陣（admin、指派主管、只有 submit 權限、view_own）兩版差異輸出

**測試資料**

- inspection_bonus_config 啟用規則 3 筆（例如 1 天內、3 天內、7 天內，各有不同加分）＋停用 1 筆
- S1 pending 2 筆（期限內與已逾期）、improved 1 筆
- 帳號 R1、R2、R4、R6，以及一個只有 inspection.improvement.submit 的帳號
- 照片 fixture：3 張約 3000x2000 的 JPG、1 張約 9MB 的檔案

**風險**

- Vue 多了 submit 權限路徑，提交權限比舊版寬
- 缺少回原巡店記錄連結

## /admin/inspection-templates

- 狀態：**partial**（M）— Vue 提供範本、評級對照、回補規則的列表與編輯頁（含版本檢查、停用），涵蓋舊版三個分頁；刪除動作改為停用、改為逐項編輯；需驗證排序、新增區塊與總分提示等細節。
- 舊版：`app/admin/inspection-templates/page.tsx + app/api/inspection-templates/*、app/api/inspection-grade-mapping/route.ts`
- Vue：`vue-workspace/src/pages/InspectionSettings.vue`、`vue-workspace/src/pages/InspectionSettingEdit.vue`
- 權限：inspection.template.manage
- 相依：巡店編輯器（templateHash 相依）、supabase/workspace-dev/20261028030000_vue_inspection_settings.sql、20261028040000_inspection_settings_guard.sql

**舊版功能**

- 權限檢查 inspection.template.manage，無權限導回 dashboard
- 分頁：檢查範本／得分數對照表／改善加分規則
- 範本依區塊分組可展開，顯示滿分總和、區塊滿分、缺失選項與扣分、數量計算標記
- 新增檢查項目（可選既有區塊或新建區塊、區塊排序、項目排序）
- 編輯範本：名稱、說明、滿分(>0)、scoring_type、缺失選項（label、deduction、requires_quantity/單位）
- 刪除範本＝設為停用（confirm）
- 評級對照表編輯並一次保存（alert 已保存）
- 改善加分規則新增／編輯／刪除（is_active=false）

**缺少或不同**

- 舊版頁面內顯示全部啟用範本滿分總和，Vue 設定頁需確認是否顯示（InspectionSettings.vue 表頭含滿分欄，未確認合計）
- Vue 以 workspace_save_inspection_settings RPC 與 revision 控制，修改範本後正在填寫的編輯器會因 templateHash 失效，舊版無
- Vue 將 bonus 規則停用併入編輯表單 is_active，舊版有獨立刪除按鈕＋confirm
- 舊版 /api/inspection-templates 與 /api/inspection-grade-mapping 為獨立 REST；Vue 統一於 /api/workspace/inspection-settings
- 需驗證評級對照表驗證規則（連續性、門檻）與舊版保存相同

**業務規則**

- （無）

**API**：舊 GET/POST /api/inspection-templates、PUT/DELETE /api/inspection-templates/[id]、GET/POST /api/inspection-grade-mapping；新 GET/POST /api/workspace/inspection-settings、RPC workspace_save_inspection_settings

**資料表**：inspection_templates、inspection_grade_mapping、inspection_bonus_config、workspace_inspection_settings_revision

**既有測試**：scripts/test-workspace-inspection-settings.py、scripts/test-workspace-inspection-settings-race.cjs

**待確認**

- 未逐行核對 InspectionSettingEdit.vue 的總分提示與舊版頁面統計一致

### 測試案例

**冒煙**

- R7 開啟 InspectionSettings.vue：GET /api/workspace/inspection-settings 回 200，範本、評級、回補規則三組資料載入，console 0 error
- R2（沒有 template.manage）→ 側欄不顯示，API 回 403
- 開啟 InspectionSettingEdit 編輯單一範本，欄位預填

**單元**

- 評級驗證（inspection-settings/route.ts:147-162）抽成純函式：grade 0-10 必須 11 筆連續；grade 0 的 min_score 必須是 0；門檻必須嚴格遞增；min_score 超過 220 或小於 0 拒絕；小數 grade 拒絕
- 範本驗證：滿分必須 >0；缺失選項 label 不可重複、不可為空；deduction >=0；requires_quantity 時必須有 unit
- 滿分總和計算（所有啟用範本 max_score 合計應為 220）與區塊滿分計算

**整合**

- POST kind=templates：R7 新增一個項目（新區塊、指定排序）→ inspection_templates 新增一列，revision 遞增
- 帶舊 revision 版本 → 409（延伸 scripts/test-workspace-inspection-settings-race.cjs 兩個 session 同時保存）
- 停用範本（is_active=false）→ 列表與巡店表單不再出現；既有巡店單詳情仍能顯示
- POST kind=grades：有效的 11 筆 → 保存；每一種無效情況回 400，DB 不變
- bonus 規則：新增、編輯、停用
- 相依：保存設定後，正在填寫的巡店編輯器 POST 因 templateHash 不符被拒（與 /inspection/new 整合測試串接）
- R2、R5 POST → 403

**E2E**

- R7：新增檢查項目到新區塊 → 設定兩個缺失選項，其中一個要數量與單位 → 保存 → 列表出現並顯示在正確區塊 → 編輯滿分 → 停用 → 確認
- R7：修改評級對照表一個門檻 → 保存 → 重新載入確認；輸入非遞增門檻 → 顯示錯誤
- R7：新增、停用回補規則
- 結束後執行 cleanup，恢復原本的範本與評級（測試前先快照，結束後還原）

**對等驗證**

- 同一個 DEV DB：舊版 GET /api/inspection-templates、/api/inspection-grade-mapping 的回應與 Vue GET /api/workspace/inspection-settings 的 templates、grades 欄位逐筆相同
- 用舊版 UI 與 Vue 做相同修改（各在一份快照上操作），比對 DB 結果相同（排序欄位、checklist_items JSON、is_active）
- 評級驗證：舊版接受、Vue 拒絕（或相反）的輸入列成差異表
- 滿分合計顯示：舊版頁面有，Vue 需確認 → 差異報告

**測試資料**

- 保存原始 inspection_templates、inspection_grade_mapping、inspection_bonus_config 的 JSON 快照，用來還原
- 專用測試區塊 'ZZTEST-INSP 區塊'，以及 2 個測試範本
- 帳號 R7、R2、R5

**風險**

- 修改設定會影響共用 DEV 上其他測試（templateHash），必須序列化執行並還原
- 改用停用取代刪除，舊資料的顯示需要確認

## /inspection/debug

- 狀態：**exclude**（S）— 開發除錯頁：顯示查詢 log、user 與 inspection 原始資料，不是業務功能；僅文件 route inventory 列為待盤點，應排除復刻。
- 舊版：`app/inspection/debug/page.tsx`
- Vue：（無）
- 權限：登入即可（無 RBAC 檢查）
- 相依：（無）

**舊版功能**

- 顯示登入使用者 ID、查詢日誌
- 列出 inspection_masters 原始查詢結果與錯誤
- 新增巡店捷徑

**缺少或不同**

- 不需要在 Vue 復刻

**業務規則**

- （無）

**API**：舊 app/api/inspection-debug/route.ts（診斷 API）；新 —

**資料表**：inspection_masters、profiles

**既有測試**：—

**待確認**

- 建議正式環境可考慮保護或移除舊版除錯頁與 /api/inspection-debug（安全面，不在復刻範圍）

## /inspection/diagnostic

- 狀態：**exclude**（S）— 『巡店系統診斷報告』開發診斷頁，逐步測試 RLS 與查詢，非使用者功能，排除復刻。
- 舊版：`app/inspection/diagnostic/page.tsx`
- Vue：（無）
- 權限：登入即可
- 相依：（無）

**舊版功能**

- 顯示巡店系統診斷報告（多個查詢測試結果與錯誤）

**缺少或不同**

- 不需要在 Vue 復刻

**業務規則**

- （無）

**API**：舊 —；新 —

**資料表**：inspection_masters、profiles、stores

**既有測試**：—

## /inspection/test-debug

- 狀態：**exclude**（S）— 八段式診斷測試頁（用戶資料、簡單查詢、關聯查詢、權限、店長身份），純除錯用途，排除復刻。
- 舊版：`app/inspection/test-debug/page.tsx`
- Vue：（無）
- 權限：登入即可
- 相依：（無）

**舊版功能**

- 顯示用戶資料、簡單查詢、帶 Store／Inspector 關聯、完整查詢、用戶權限、督導記錄、店長身份等診斷區塊

**缺少或不同**

- 不需要在 Vue 復刻

**業務規則**

- （無）

**API**：舊 —；新 —

**資料表**：profiles、inspection_masters、store_managers

**既有測試**：—

## 領域測試備註

規劃依據（已實際讀過）：lib/workspace/inspection-scoring.ts scoreInspection（預設門檻 [220,215,191,181,171,161,151,141,131,121,0] 與舊版 app/inspection/new/page.tsx:854-885 calculateTotals 硬編碼一致；Vue 額外檢查：扣分超過項目滿分、數量 1-10000 整數、總分<0、範本數量不符時拋錯，舊版無）；lib/workspace/improvements.ts improvementAccess / improvementRecord（canSubmit = admin || 指派門市 || inspection.improvement.submit）；app/api/workspace/improvement-detail/route.ts:52-56（canSubmit 僅限 DB status==='pending'，逾期只是顯示映射，DB 仍為 pending，所以逾期項在 Vue 仍可提交；:98 以 updated_at 作 version 樂觀鎖，:114 update 帶 eq status pending）；lib/workspace/server.ts:169 inspectionScope（view_all→全部；view_store→store_managers；view_own→inspector_id）；app/api/workspace/inspections/route.ts（month 必須 YYYY-MM、page 1-10000、每頁 20、manager 類型需 manager_tab、:97 coverage 需 view_store_status、:147 canExport=inspection.export）；app/api/workspace/inspection-export/route.ts:14 WORKSPACE_USE_EXISTING_SESSION!=='true' 時回 503；app/api/workspace/inspection-settings/route.ts:147-162 評級驗證（grade 0-10 連續、grade0 min_score=0、門檻嚴格遞增、min_score 0-220）；舊版送出鍵 disabled 條件 app/inspection/new/page.tsx:1774 需兩個簽名＋門市＋溫度，存草稿 :1766 只需門市＋溫度；舊版急迫標記 app/inspection/improvements/page.tsx:248（pending 且剩餘天數<=2）。
DEV DB：.env.development.local 含 NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、EXPECTED_SUPABASE_PROJECT_REF、ALLOW_DEV_DATABASE_OPERATIONS。所有種子／整合腳本開頭都必須比對 URL 中的 project ref 等於 EXPECTED_SUPABASE_PROJECT_REF，而且 ALLOW_DEV_DATABASE_OPERATIONS==='true' 才可以寫入；不符就立即 exit(1)。所有種子資料一律加前綴 'ZZTEST-INSP-'（門市代碼、巡店單號、員編）或固定 UUID 命名空間，方便清除；每支腳本都附 --cleanup。
共用角色矩陣（同一批帳號給舊版與 Vue 共用）：R1 admin（profiles.role=admin）；R2 督導（inspection.view_all、create、compare、export、view_store_status、delete、template.manage 以外的權限，加 improvement.view_all）；R3 區經理（manager_tab、create、compare、view_store、improvement.view_own_store，store_managers 指派 S1、S2）；R4 店長（view_store、improvement.submit 或只靠 store_managers 指派 S1）；R5 一般員工（沒有任何 inspection.* 權限）；R6 唯讀督導（只有 view_own，沒有 create/delete/export）；R7 範本管理員（只有 inspection.template.manage）。門市：S1、S2（R3 轄區）、S3（無人指派）、S1' 新門市（source_store_id=S1 舊店，用來測沿革）。
測試分層建議：unit 用 node:test 或 vitest 直接 import TS 純函式（scripts/test-workspace-*.cjs 已有前例）；integration 用 Node 腳本以各角色登入取得 session cookie 後呼叫 /api/workspace/*，並用 service role 驗證 DB 結果；e2e 用 Python Playwright（延續 scripts/test-workspace-*.py），結果放 .tmp-check/inspection/。對等比較一律採「同一份種子、同一角色，分別打開舊版 Next 頁面與 Vue 工作頁，擷取 DOM 數值並正規化後做 diff」，產出 JSON 差異報告；已知的設計差異（分頁、單月、表格與卡片）放進 allowlist，不算失敗。
需要產品決策才能定案的期望值（測試先以「記錄差異」模式執行，決策後再改成斷言）：(1) 送出巡店是否必須雙簽名；(2) 列表與統計口徑要用近 6 個月還是單月；(3) 是否補做 IndexedDB 離線暫存；(4) 經理分頁以外是否顯示巡店比較按鈕；(5) 是否補回急迫標記與『查看原巡店記錄』連結；(6) 正式環境的 WORKSPACE_USE_EXISTING_SESSION 設定。排除的頁面：/inspection/debug、/inspection/diagnostic、/inspection/test-debug（另建議 smoke 確認正式環境的 /api/inspection-debug 有保護，屬安全項目，不在復刻範圍）。不確定處：舊版 getImprovementAccess 只確認位於 app/api/inspection/improvements/route.ts:63-110，未逐行比對；InspectionContent.vue 是否有 Google Maps 連結未讀。

# Vue 工作台復刻計畫

> 產生日期：2026-11-02。由盤點 workflow（9 領域 Sonnet 盤點 + Opus 測試規劃 + Opus 彙整）產出，只讀程式碼得出。決策項目待使用者確認後才開始施作。

## 現況

| done | partial | missing | exclude |
|---|---|---|---|
| 24 | 26 | 45 | 5 |

## 里程碑

- M0 測試地基（T00 到 T03）：環境守衛擋住 Production、統一 runner 與報表、角色矩陣 seed、parity 框架、App.vue 路由與權限對照表重構。驗收：用既有一頁（例如 Relationships）跑通四層測試加 parity，產出 summary.json。
- M1 月結核心（W01 到 W04、P01）：每月人員狀態、資料匯出、績效獎金、版更頁，以及藥師、員工購物對等驗收。驗收：保留月份 2099-xx 的匯出 Excel 和獎金數字與舊版逐欄一致。
- M2 人事（W05、W06、P02）：員編規則、異動歷史編輯與刪除、門市與店長督導 11 頁對等驗收。
- M3 任務與首頁（W07 到 W12、P03）：任務刪除、存取範圍、儀表板、首頁聚合。完成後，登入後的第一屏不再連回舊站。
- M4 巡店與改善（W13 到W18、P04）：簽名規則、評分對照、離線暫存、列印視覺對照，以及除錯頁排除登錄。
- M5 活動、組織與認證（W19 到 W24、P05、P06）：活動排程與檢視、組織人員抽屜、公開認證頁、年度行事曆與 Google 同步。
- M6 跨部門（W25 到 W33、P07）：共用 xlsx 與上傳工具、商品主檔、缺貨回報、診所自費、督導日誌、盤點收斂。
- M7 總務一：資產（G01 到 G10）：共用基礎、分類、零件、型號與架型、設備與設施、保固與維修紀錄、QR 標籤與掃描網址。
- M8 總務二：流程（G11 到 G24）：庫存、調撥、回報、需求單、料件處理、工單、跨部門維修、廠商、水電費、總務首頁。
- M9 收尾（F01）：100 個路由全站回歸，所有 parity-report 都沒有未核可差異，文件狀態全部以測試結果為準。

## 工作清單（依施作順序）

| # | ID | 項目 | 狀態 | 量 | 相依 | 舊版路由 | 新版目標 | 理由 |
|---|---|---|---|---|---|---|---|---|
| 1 | T00 | 測試基礎建設：環境守衛、統一 runner、報表目錄、清理 sweeper | infra | L |  |  | tests/support/env-guard.cjs、tests/support/env_guard.py、tests/run-all.cjs、package.json test:* scripts、tests/reports/<runId>/ | .env.local 指向 Production 候選，所有工具都必須只載入 .env.development.local，並在連線前驗證 JWT ref 與 /api/workspace/session 非 503；目前 132 支腳本沒有統一入口、報表與清理機制。後面每一頁都依賴這一項。 |
| 2 | T01 | 角色帳號矩陣 seed 與憑證集中管理 | infra | M | T00 |  | tests/fixtures/role-matrix.json、scripts/seed-workspace-role-matrix-dev.cjs、.tmp-check/test-credentials.json（gitignored） | navigation 帳號沒有可重建的 seed；權限對等測試需要系統管理員、營業主管、督導、店長、代理店長、藥師、盤點組、總務、一般員工、無權限等角色，而且要走 roles/role_permissions/user_roles 正式指派。這屬於重型 RBAC 寫入，需要使用者授權。 |
| 3 | T02 | 雙版本對等框架：parity map、正規化比對器、差異白名單、parity-report.json | infra | M | T00, T01 |  | tests/parity/、tests/support/normalize.ts、tests/parity/map/<page>.json、tests/parity/allowlist.json | 目前只有 permissions-parity 一個先例。四種機制（API 讀取、寫入回讀 DB、UI 擷取或匯出比對、導覽可見性）都要先做成可重用框架，才能讓每頁的對等驗收規格一致。 |
| 4 | T03 | 前端骨架重構：App.vue tab 權限對照表、navigation kind union、公開頁路由策略 | infra | M | T00 |  | vue-workspace/src/App.vue、vue-workspace/src/main.ts、lib/workspace/navigation.ts、vue-workspace/src/workspace-pages.ts（新） | App.vue 第 221 行附近的巨型三元式在新增 45 個以上頁面時很容易出錯；QR 掃描與 register/forgot/reset 都需要先決定路由策略（hash 或 Next 路由）。這項要先完成並跑全站回歸。 |
| 5 | W01 | 每月人員狀態與單店編輯補齊（異動歷程、進階對等） | partial | L | T02 | /monthly-status, /monthly-status/edit/[id] | vue-workspace/src/pages/Monthly.vue、MonthlyEdit.vue、components/MonthlyTools.vue、app/api/workspace/monthly/** | 這是核心月結流程，獎金、匯出、藥師都依賴它。舊版走 server action（app/store/actions.ts），需要用 UI 擷取加 DB 回讀做對等證據；保留月份 2099-xx 用來隔離。 |
| 6 | W02 | 每月資料匯出頁（十種匯出：名冊、實際人力點數、伙食津貼、單品獎金、春節獎金、支援時數、人才培育、交通費等） | partial | L | W01 | /admin/export-monthly-status | 新增 vue-workspace/src/pages/MonthlyExport.vue、app/api/workspace/monthly-export/**（包裝 /api/export-monthly-status/*） | 導覽目前沒有 kind，仍外開舊站。匯出直接影響薪資與獎金發放，需逐檔比對 Excel 與舊版是否 byte 或欄位層級一致。 |
| 7 | W03 | 績效獎金完整對等（角色、舊資料、並行寫入、閾值、處方箋、Excel） | partial | L | W01 | /admin/performance | vue-workspace/src/pages/Performance*.vue、app/api/workspace/performance/**、performance-tools | 文件已記錄「完整角色／舊資料及並行寫入驗收仍待補」。獎金計算需在單元層同時呼叫 lib/performance/bonus-calc.ts 與新版做表格驅動比對；2038 年測試資料目前沒有還原步驟，要一併修正。 |
| 8 | W04 | 每月版更說明頁 | missing | S | T03 | /monthly-release | 新增 vue-workspace/src/pages/MonthlyRelease.vue 或首頁區塊 | 靜態內容頁，工作量小，可與首頁整合方式一起決定。 |
| 9 | P01 | 對等驗收：藥師管理、員工購物管理 | parity-check | M | T02, W01 | /admin/pharmacist-management, /admin/employee-purchases | Pharmacists.vue、EmployeePurchases.vue | 程式碼已完成但沒有四層測試。藥師與每月人員、調店月份同步有關，近期 commit 修過多次名冊問題，屬回歸高風險區。 |
| 10 | W05 | 員工管理缺口與員編格式共用驗證 | partial | S | T02 | /admin/employee-management | Employees.vue、EmployeeCreate.vue、EmployeeEdit.vue、lib/workspace/employee-id-rule.ts（新）、SQL 20261029100000 | 舊版員編規則為 FK+4、FKF+5、FKPT+3、FKI+3，新版只有寬鬆 regex。新增員工、匯入、批次入職都會用到，要先統一。 |
| 11 | W06 | 人事異動、升遷管理：歷史異動編輯與刪除、回復邏輯、日期驗證 | partial | L | W05, W01 | /admin/promotion-management | MovementManagement.vue、MovementDraft.vue、MovementHistory.vue、Transfers.vue、新增 app/api/workspace/employee-movements/[id]（PATCH/DELETE 或 RPC） | 需移植 app/api/employee-movements/[id]/route.ts 的回復邏輯，並共用 lib/employee-movement-date.ts。異動會回寫每月人員狀態，必須用寫入對等（A/B fixture 回讀 employee_movement_history 與 monthly_staff_status）驗證。 |
| 12 | P02 | 對等驗收：門市、店長、督導與門市子頁、員工匯入 | parity-check | L | T02, W05 | /admin/stores, /admin/stores/create, /admin/stores/map, /admin/stores/[id]/edit, /admin/stores/[id]/clone, /admin/stores/[id]/employees, /admin/stores/[id]/employee-management, /admin/stores/[id]/promotion-management, /admin/store-managers, /admin/supervisors, /admin/import-employees | Stores.vue、StoreEditor.vue、StoreMap.vue、StoreRelocation.vue、StoreEmployees.vue、StorePersonnel.vue、StorePromotions.vue、StoreManagers.vue、Supervisors.vue、EmployeeImport.vue | 這 11 頁已完成，但 route-inventory 狀態過時，也缺少同一批 Excel 送新舊匯入 API 的比對，以及角色權限矩陣測試。批次語意已從逐列容錯改為整批原子，需列入白名單並取得使用者核可。 |
| 13 | W07 | 任務流程模板管理：刪除模板、刪除已完成指派、模板詳情存取範圍 | partial | M | T02, T03 | /admin/templates, /admin/template/[id] | TaskManagement.vue、TaskManagementDetail.vue、TaskDispatch.vue、新增 workspace 刪除 API 與 supabase/workspace-dev RPC、確認 Modal | 缺少刪除能力。權限上新版只開放 admin 或 task.manage+manager，比舊版嚴格；模板詳情顯示的是全部指派而不是本人協作指派，需要決策後固化。 |
| 14 | W08 | 任務執行與我的任務：存取範圍、去重與進度算法對等 | partial | M | W07 | /assignment/[id], /my-tasks | TaskRunner.vue、MyTasks.vue、TaskSchedule.vue、lib/workspace/tasks.ts、task-state.ts | 舊版允許 admin/manager 開啟非協作者任務，新版不允許；my-tasks 的去重鍵與區段進度算法也不同。需用同一份 fixture 做新舊對照，並補 task-state、task-template、task-schedule 的單元測試。 |
| 15 | W09 | 已封存任務補齊 | partial | S | W07 | /admin/archived | TaskArchive.vue、TaskArchiveDetail.vue、lib/workspace/task-archive.ts | 有 5 項小缺口，和刪除已完成指派相關。 |
| 16 | W10 | 儀表板頁 | missing | S | W08, T03 | /dashboard | 新增 vue-workspace/src/pages/Dashboard.vue、workspace managed-stores 端點、session capability dashboard | 導覽的「儀表板」沒有 kind，仍連回舊站。 |
| 17 | W11 | 首頁聚合 API：/api/workspace/home | partial | M | W08, W06, P01 | / | app/api/workspace/home/route.ts、lib/workspace/home.ts、session capabilities | 首頁要彙整我的任務、獎金明細、新人入職、壽星、年費與換照提醒、調店待確認數。先完成 API 並做讀取對等，再處理 UI，可降低 XL 單項的風險。 |
| 18 | W12 | 首頁工作總覽 UI（提醒卡片與快捷入口） | partial | M | W11, W04 | / | vue-workspace/src/App.vue welcome 區塊，或新增 pages/Home.vue | 使用者登入後第一眼看到的頁面，要和舊版首頁顯示的提醒項目一致。 |
| 19 | P03 | 對等驗收：任務建立、編輯、派發 | parity-check | S | W07 | /admin/create, /admin/edit/[id], /admin/assign/[id] | TaskTemplateEditor.vue、TaskDispatch.vue | 已完成，但缺少新舊建立結果的寫入對等測試，也缺少共用元件 TaskStepFields 與 TaskSchedule 的回歸。 |
| 20 | W13 | 巡店列表與統計口徑 | partial | M | T02 | /inspection | Inspections.vue、InspectionOverview.vue、lib/workspace/server.ts inspectionScope | 舊版統計近 6 個月、不分頁；新版為單月、分頁 20 筆。統計口徑需決策，並補督導、經理、店長權限矩陣。 |
| 21 | W14 | 巡店編輯器（新增與編輯）：雙簽名規則、評分評級對照 | partial | L | W13, W18 | /inspection/new, /inspection/[id]/edit | InspectionEditor.vue、SignatureInput.vue、InspectionPhotos.vue、lib/workspace/inspection-scoring.ts、RPC workspace_save_inspection | 舊版必須門市與督導雙簽名才能送出，新版沒有強制。舊版評分以 220 起算並硬編碼門檻，新版改為資料驅動，需用同輸入同輸出的單元測試確保一致。 |
| 22 | W15 | 巡店離線暫存（IndexedDB）與離頁還原 | partial | M | W14 | /inspection/new, /inspection/[id]/edit | vue-workspace/src/lib/inspection-drafts.ts（新）、InspectionEditor.vue | 這是新舊編輯器行為差異最大的地方。門市網路不穩時資料可能遺失，需要獨立 e2e（離線模擬、重新整理後還原）。 |
| 23 | W16 | 巡店詳情與 A4 列印報告 | partial | M | W14 | /inspection/[id] | InspectionDetail.vue、InspectionPrint.vue、InspectionContent.vue、InspectionReport.vue、InspectionFinding.vue、inspection-export API | 需要和舊版 PrintInspectionReport 做視覺對照（A4、簽名、待改善彙整）。匯出依賴 WORKSPACE_USE_EXISTING_SESSION 旗標。 |
| 24 | W17 | 改善追蹤列表與改善詳情 | partial | M | W14 | /inspection/improvements, /inspection/improvements/[id] | Improvements.vue、ImprovementDetail.vue、DB trigger（improvements 產生、calculate_bonus、update_bonus_total） | 依賴 DB trigger 與改善獎金設定。需要 sonnet 建立含逾期、已改善、照片的種子資料，並確認正式 migration 等價。 |
| 25 | W18 | 巡店範本與評級設定 | partial | M | W13 | /admin/inspection-templates | InspectionSettings.vue、InspectionSettingEdit.vue、SQL 20261028030000、20261028040000 | 編輯器以 templateHash 依賴範本，所以要先完成；評級對照也由這裡設定。 |
| 26 | P04 | 對等驗收：巡店比較；除錯頁排除登錄 | parity-check | S | W16 | /inspection/compare, /inspection/debug, /inspection/diagnostic, /inspection/test-debug | InspectionCompare.vue；docs/vue-workspace/full-migration-checklist.md 標記 exclude | 比較頁已完成，只需做對等驗收；三個除錯頁與 /api/inspection-debug 不復刻，要在文件記錄為 exclude。 |
| 27 | W19 | 活動排程頁缺口（圖片拖曳排序、inventory 類型分頁、督導區顏色、自動排程對等） | partial | L | T02 | /admin/activity-management/schedule/[id] | CampaignSchedule.vue、CampaignStoreEditor.vue、CampaignDepartment.vue、CampaignPreviewTable.vue、campaign-scheduling.ts | 同一份特殊日期與門市設定，自動排程結果必須和舊版完全一致，要做表格驅動的單元對等測試。campaign-tools 直接 import 舊 route handler，舊 API 的 RBAC 不可更動。 |
| 28 | W20 | 活動檢視獨立入口、活動計畫頁、受眾權限統一 | partial | M | W19, T03 | /activity-management, /activity-view/[id] | 新增 pages/ActivityList.vue、ActivityView.vue（重用 ActivityPlan、ActivityCalendar、ActivityOverview、activity-calendar-pdf.ts）、lib/campaign-access.ts | 目前只能從月報工具進入，權限用的是 activity.management.access，和舊版 campaign.view/view_all 加受眾判斷不一致。門市端看不到活動是高影響差異。 |
| 29 | P05 | 對等驗收：活動列表、特殊日期、活動設定 | parity-check | M | W19 | /admin/activity-management, /admin/activity-management/events, /admin/activity-management/settings | Campaigns.vue、CampaignEdit.vue、CampaignConfiguration.vue | 舊版寫入權限以 profiles.role 判斷，新版以 RBAC 判斷，需用角色矩陣驗證同帳號結果一致。另外要更新 feature-parity-review.md 的過時描述。 |
| 30 | W21 | 組織與部門：人員抽屜（職掌統計）、組織圖卡片視圖 | partial | M | T02 | /admin/organization, /admin/departments | Organization.vue、OrganizationEditor.vue、Departments.vue、DepartmentDetail.vue、新增 components/PersonDrawer.vue | 兩頁共用組織 revision 與人員抽屜，合併處理。 |
| 31 | W22 | 登入頁補齊與公開頁：註冊、忘記密碼、重設密碼 | partial | M | T03 | /login, /register, /forgot-password, /reset-password | App.vue login-layout、新增公開 hash 路由頁面，或決定保留 Next 舊頁並由新版連結 | 依賴 Supabase redirect URL、NEXT_PUBLIC_SITE_URL 與 /auth/callback。公開頁不適合放進需登入的 tab 機制，要先決策。 |
| 32 | W23 | 年度行事曆：檢視與編輯 | missing | L | T03, W21 | /organization/calendar | 新增 pages/OrganizationCalendar.vue、app/api/workspace/calendar/**（包裝 /api/organization/calendar/*） | 整頁缺失。DEV 需確認已套用 20261008100000 migration。 |
| 33 | W24 | 年度行事曆：Google Calendar 同步與 OAuth 回導 | missing | M | W23 | /organization/calendar | OrganizationCalendar.vue 同步區塊、OAuth callback 回導至 workspace | OAuth 範圍驗證在近期 commit 剛修正過；e2e 需 mock Google，或使用測試帳號。 |
| 34 | P06 | 對等驗收：角色、角色權限、使用者管理 | parity-check | S | T02 | /admin/roles, /admin/roles/[id], /admin/users | Roles.vue、Users.vue | 已有 permissions-parity 先例，要擴充到全角色並納入統一 runner。程式為壓縮單行風格，只能用 UI 行為驗證。 |
| 35 | W25 | 門市盤點缺口（輸出檔名、驗證行為） | partial | S | T02 | /inventory | Inventory.vue、InventoryOffline.vue、lib/inventory-files.ts | 有 8 項小差異，已有 Playwright 樣板，可快速收斂。 |
| 36 | P07 | 對等驗收：關係會員 | parity-check | S | T02 | /store/relationship-members | Relationships.vue | 已完成，只需要納入四層測試與對等比對。 |
| 37 | W26 | 共用工具抽取：xlsx 讀寫、圖片與檔案上傳元件（相機、限制、Origin 檢查） | infra | M | T03 |  | vue-workspace/src/lib/xlsx.ts、components/FileUpload.vue、components/ImageLightbox.vue | 商品主檔、診所自費、督導日誌、跨部門維修與總務全部依賴。先做可避免後面重複實作。 |
| 38 | W27 | 商品主檔：共用搜尋 API、查詢與維護 | missing | L | W26 | /cross-dept/products-master | 新增 pages/ProductsMaster.vue、app/api/workspace/products-master/**、lib/workspace/modules.ts 註冊 | 商品部缺貨回報依賴這裡的搜尋 API，所以要先做。 |
| 39 | W28 | 商品主檔：Excel 匯入與相機拍照 | missing | M | W27 | /cross-dept/products-master | ProductsMaster.vue 匯入 Modal | 把 XL 頁拆成兩輪，讓每輪都能完整測完。 |
| 40 | W29 | 商品部缺貨回報 | missing | L | W27 | /cross-dept/merchandise | 新增 pages/Merchandise.vue、app/api/workspace/stockout/** | DEV 需補 stockout_* 資料表檢查與 DEV SQL。 |
| 41 | W30 | 診所自費藥毛利：價格檔匯入與毛利計算 | missing | L | W26 | /store/clinic-selfpay-margin | 新增 pages/ClinicSelfpay.vue、app/api/workspace/clinic-selfpay/** | 導覽可見權限碼和 API 實際權限（store.clinic_selfpay.* 加職稱）不一致，需要先對齊。 |
| 42 | W31 | 診所自費藥毛利：截圖上傳與 PDF 輸出 | missing | M | W30 | /store/clinic-selfpay-margin | ClinicSelfpay.vue、storage bucket clinic-selfpay-screenshots（DEV） | 把 XL 頁拆成兩輪；PDF 要和舊版做輸出對照。 |
| 43 | W32 | 督導管理日誌：日誌建立、編輯與時間線 | missing | L | W26 | /supervisor-management-log | 新增 pages/SupervisorLog.vue、app/api/workspace/supervisor-management/** | 舊版已有 test-supervisor-management-*.js 可作為對照基準。 |
| 44 | W33 | 督導管理日誌：錄音上傳與 AI 摘要 | missing | M | W32 | /supervisor-management-log | SupervisorLog.vue 錄音元件、語音 API 包裝 | 需要 OPENAI_API_KEY；測試一律走 mock 或 LOCAL_RULE_FALLBACK，避免產生費用與不穩定結果。 |
| 45 | G01 | 總務共用基礎：access、categories、attachments、request-targets API，外殼與附件面板 | infra | L | W26 |  | app/api/workspace/general-affairs/**、lib/workspace/general-affairs/*（抽共用驗證）、components/ga/GeneralAffairsShell.vue、ResourceAttachmentPanel.vue、AssetCategoryPicker.vue、AssetSitePicker.vue | 總務兩個領域共 34 頁全部依賴這些共用元件。要確認 DEV 已有 ga_* 表、RLS 與 general-affairs-attachments bucket，並補 general_affairs.* 導覽權限碼。 |
| 46 | G02 | 設備、設施、料件分類（三頁共用樹狀表） | missing | M | G01 | /general-affairs/equipment/categories, /general-affairs/facilities/categories, /general-affairs/parts/categories | 新增 pages/ga/AssetCategories.vue（type 參數） | 三型共用同一元件，是後續主檔的資料來源。 |
| 47 | G03 | 零件主檔與新增零件 | missing | L | G02 | /general-affairs/parts, /general-affairs/parts/new | 新增 pages/ga/Parts.vue、PartCreate.vue | 設備型號、設施架型、適用料件與庫存都依賴零件主檔。 |
| 48 | G04 | 公司設備型號與設施架型 | missing | L | G03 | /general-affairs/equipment/templates, /general-affairs/facilities/templates | 新增 pages/ga/AssetTemplates.vue（equipment 與 facility 模式） | 設備與設施新增時需要選型號或架型。 |
| 49 | G05 | 適用料件對照 | missing | M | G04 | /general-affairs/parts/compatibilities | 新增 pages/ga/PartCompatibilities.vue、target-compatibilities API | 依賴零件與型號或架型兩邊資料。 |
| 50 | G06 | 設備主檔列表、詳情、編輯 | missing | L | G04 | /general-affairs/equipment | 新增 pages/ga/Equipment.vue、AssetDrawer.vue | 舊版是 XL 單頁，拆出新增流程後縮成 L。 |
| 51 | G07 | 新增設備 | missing | M | G06 | /general-affairs/equipment/new | 新增 pages/ga/EquipmentCreate.vue | 需要未儲存離開確認、附件上傳，並在建立後導回列表。 |
| 52 | G08 | 設施主檔與新增設施（重用設備元件） | missing | L | G07 | /general-affairs/facilities, /general-affairs/facilities/new | 新增 pages/ga/Facilities.vue、FacilityCreate.vue | 結構和設備相同，可沿用共用元件。 |
| 53 | G09 | 設備與設施保固、維修紀錄（四頁唯讀） | missing | M | G08 | /general-affairs/equipment/warranties, /general-affairs/facilities/warranties, /general-affairs/equipment/maintenance-history, /general-affairs/facilities/maintenance-history | 新增 pages/ga/AssetWarranties.vue、AssetMaintenanceHistory.vue | 四頁都是唯讀，可共用元件一次完成。維修紀錄先讀舊表，等工單完成後再回歸一次。 |
| 54 | G10 | QR 標籤列印與資產掃描頁（保留實體標籤網址） | missing | M | G08, T03 | /general-affairs/equipment/labels, /general-affairs/assets/scan/[token] | 新增 pages/ga/AssetLabels.vue、AssetScan.vue；/general-affairs/assets/scan/{token} 永久網址轉址策略 | QR 網址已經印在實體標籤上，網址失效會直接影響門市報修，必須用 e2e 驗證舊網址仍可用。 |
| 55 | G11 | 總務庫存：位置與料件設定 | missing | L | G03 | /general-affairs/inventory/locations | 新增 pages/ga/InventoryLocations.vue、workspace inventory locations API | 這是總務庫存（ga_inventory_*），和門市盤點（inventory.*）不同，不可混用模組。 |
| 56 | G12 | 總務庫存：餘額、交易流水、過帳 | missing | L | G11 | /general-affairs/inventory | 新增 pages/ga/GaInventory.vue、balances、transactions、post API | 過帳必須走同一套伺服端邏輯，用寫入對等驗證餘額。 |
| 57 | G13 | 總務庫存調撥（含 query 參數契約） | missing | L | G12 | /general-affairs/inventory/transfers | 新增 pages/ga/InventoryTransfers.vue | 要保留 fromRequestId、partId、quantity 等 query 契約，供需求單轉調撥使用。 |
| 58 | G14 | 維修與料件回報建立 | missing | L | G10, G01 | /general-affairs/reports/new | 新增 pages/ga/ReportCreate.vue（支援 assetToken） | QR 掃描後會導到這一頁。part-requests/new 已併入，排除不另做。 |
| 59 | G15 | 我的回報追蹤 | missing | L | G14 | /general-affairs/reports/mine | 新增 pages/ga/MyReports.vue（留言、店端確認、設備入帳任務） | 門市端最常用的總務頁；需求單與工單有雙向同步，必須走相同伺服端邏輯。 |
| 60 | G16 | 需求單工作台（受理、出庫、採購評估、收貨） | missing | XL | G15, G13 | /general-affairs/requests | 新增 pages/ga/Requests.vue、requests 與 purchase-review/receipt API | 總務最複雜的頁面，牽動庫存與工單。允許跨兩輪完成，但每輪都要跑完四層測試。 |
| 61 | G17 | 料件處理中心 | missing | L | G16 | /general-affairs/part-fulfillments | 新增 pages/ga/PartFulfillments.vue（decision、store-confirmation、exception、documents） | 需要保留 fulfillmentId 參數契約。 |
| 62 | G18 | 工單中心 | missing | XL | G16 | /general-affairs/work-orders | 新增 pages/ga/WorkOrders.vue、maintenance-requests、updates、photos、progress-stages API、工單列印 | 要驗證 ga_service_requests 與 maintenance_* 的雙向同步，必須用寫入對等回讀所有相關表。 |
| 63 | G19 | 跨部門維修（舊維修回報） | missing | L | G18 | /cross-dept/maintenance | 新增 pages/CrossDeptMaintenance.vue（重用工單元件） | 和總務共用 maintenance-permissions 權限碼與資料表，要在工單中心完成後處理，才能釐清邊界。 |
| 64 | G20 | 廠商服務類別與服務區域 | missing | M | G01 | /general-affairs/vendors/categories, /general-affairs/vendors/regions | 新增 pages/ga/VendorCategories.vue、VendorRegions.vue、新增 vendors 相關 workspace API（舊版為 client 直連） | 廠商表單的多選來源。舊版沒有 REST API，對等只能用 DB 回讀比對。 |
| 65 | G21 | 廠商主檔與廠商填寫表列印 | missing | L | G20 | /general-affairs/vendors | 新增 pages/ga/Vendors.vue、列印版型 | 有 5 項缺口，包含列印樣式 ga-vendor-print-*。 |
| 66 | G22 | 廠商統計與採購紀錄 | missing | M | G21, G16 | /general-affairs/vendors/stats, /general-affairs/vendors/purchases | 新增 pages/ga/VendorStats.vue、VendorPurchases.vue | 統計數字要和舊版逐筆對照。 |
| 67 | G23 | 水電網費帳單與報表 | missing | L | G01 | /general-affairs/utility-bills, /general-affairs/utility-bills/report | 新增 pages/ga/UtilityBills.vue、UtilityBillsReport.vue、utility-bills API | 相依少，可以和廠商頁並行排程。 |
| 68 | G24 | 總務服務中心首頁（KPI 與待辦整合） | missing | M | G18, G17, G12 | /general-affairs, /general-affairs/part-requests, /general-affairs/part-requests/new | 新增 pages/ga/GeneralAffairsHome.vue；part-requests 兩頁登錄為 exclude（已併入 reports） | 首頁要彙整其他總務頁的數據，所以排在最後；同時處理 part-requests 的排除登錄與轉址。 |
| 69 | F01 | 全站最終回歸、文件同步與新舊並行切換準備 | infra | M | G24, W12, W33 |  | docs/vue-workspace/route-inventory.json、full-migration-checklist.md、verification.md、docs/CURRENT-DEV-STATUS.md | 所有頁面依角色矩陣跑一次完整的 smoke、parity、e2e，並把 100 個路由的狀態更新為以程式碼與測試為準。 |

## 完成定義（Definition of Done）

- 功能：舊版該頁的所有使用者可見功能、入口、參數契約（query 與永久網址）與權限行為，在 Vue 版都已實作；或已列入差異白名單並經使用者核可。
- 導覽：lib/workspace/navigation.ts 已設定 kind，從工作台開啟時不再外開舊站，App.vue 對照表也已登錄頁面與權限。
- 靜態檢查：node --check、vue-tsc --noEmit、npx tsc --noEmit、Vue build 加同步 public/workspace 全部通過，且沒有新增警告。
- 單元測試：新增或修改的 lib/workspace 純函式都有 Vitest 測試；有計算邏輯的頁面要有新舊函式同輸入同輸出的表格驅動測試，全部通過。
- 冒煙測試：角色矩陣中每個授權角色都能進入頁面、標題可見、主要 API 200、沒有 pageerror、390px 沒有水平溢出；無權限角色看不到入口，且 API 回 403 或 401。
- 整合測試：每支新增或修改的 workspace API，都已驗證權限矩陣、Origin 檢查、400 驗證錯誤、409 版本衝突或重送冪等（有寫入時），並用 service role 回讀 DB；相關 RPC 有 BEGIN…ROLLBACK SQL 測試。
- E2E：桌機 1440 與手機 390 各至少走完一條主要流程（入口、讀取、操作、寫入或下載、回讀、重新開啟），並驗證空資料與失敗分支。
- 對等：parity-report.json 中沒有未列白名單的差異，涵蓋讀取、寫入副作用與匯出或列印（若頁面有）。
- 資料衛生：測試結束後 sweeper 回報孤兒資料為 0，保留月份已清空，長駐基準資料檢查通過，DEV 其他資料筆數不變。
- 安全：守衛已通過並記錄遮罩後的 ref；日誌、報表與 commit 中沒有密碼、JWT、cookie 或金鑰。
- 紀錄：tests/reports/<runId>/summary.json 已產生，結果已寫入 docs/vue-workspace/verification.md、route-inventory.json 狀態、full-migration-checklist.md 與 docs/CURRENT-DEV-STATUS.md。
- 回歸：共用元件（Modal、TaskSchedule、InspectionReport、ResourceAttachmentPanel 等）若有變更，相依頁面的 smoke 測試已重跑並通過。
- 審查：由 Sonnet 子代理做程式審查，沒有未處理的 correctness 問題，才可提交（提交策略依 D11）。

## 待決問題

### D01 測試框架要選哪一套？

- **新框架：@playwright/test（Node/TS）加 Vitest，既有 132 支腳本保留並逐步遷移（建議）**
- 沿用 Python：補裝 pytest 和 pytest-playwright，單元測試維持 transpileModule .cjs
- 混合：單元用 Vitest，冒煙、整合、e2e 沿用 Python pytest-playwright

理由：內建 trace、JUnit 與 HTML 報表、平行化、storageState fixtures；可以直接 import lib/workspace 與舊 lib 的 TS 做對等比對，也和 Vue SFC 同語言。既有腳本不強制遷移，碰到該頁時再改寫，降低一次性成本。

### D02 是否同意新增 devDependencies：vitest、@vue/test-utils、happy-dom、@playwright/test（含 chromium 瀏覽器下載）？

- **同意，加在根目錄 package.json（建議）**
- 同意，但只加在 vue-workspace
- 不同意，只用現有工具

理由：單元測試要同時涵蓋根目錄 lib/workspace、舊版 lib/** 與 Vue 元件，放在根目錄最單純；這些都只是 dev 依賴，不影響正式建置。

### D03 根目錄 .env.local 指向 Production 候選 ref，要怎麼處理？

- **改名為 .env.production-candidate.local.bak 並移出專案讀取路徑，測試 runner 也強制忽略（建議）**
- 保留檔案，但所有測試 runner 強制只讀 .env.development.local 並跑守衛
- 不處理

理由：Vite 在 mode=test、dotenv 預設讀法或 IDE 外掛都可能讀到 .env.local 而連上 Production，這是最大的安全風險，採雙重防護。另外請確認 .env.production.local 指向 DEV 是否是刻意設計。

### D04 測試帳號密碼要怎麼保存？

- **集中到單一 gitignored 檔 .tmp-check/test-credentials.json（由 seed 隨機產生），刪除其他明碼檔（建議）**
- 改用 Windows Credential Manager
- 每次執行以隱藏輸入提供

理由：每完成一頁都要自動跑測試，隱藏輸入會讓子代理無法無人值守執行。目前密碼分散在三個檔案，集中到單一檔可降低外洩面；這些都只是 DEV 帳號。

### D05 是否授權 Sonnet 子代理用 service role 在 DEV 建立或更新長駐角色矩陣帳號、角色、role_permissions 與 user_roles（屬重型 RBAC 寫入）？

- **授權，範圍限 vue_workspace_* 角色與 @example.test 帳號（建議）**
- 每次寫入前都要逐次詢問
- 不授權，由使用者手動建立

理由：權限對等測試必須有完整角色矩陣。把範圍限制在測試專用的角色前綴與網域，不會動到既有 11 位真實使用者與正式角色。

### D06 角色矩陣要涵蓋哪些角色？

- **完整 13 個：admin、navigation、營業主管、營業助理、督導、店長、代理店長、藥師、盤點組、總務、總務廠商管理、一般員工、無權限，加上各模組的 view/edit/delete 細分帳號（建議）**
- 精簡 6 個：admin、主管、督導、店長、一般員工、無權限
- 只沿用現有 editor、viewer、denied、navigation

理由：舊版很多頁面用 role、department、job_title 判斷，新版用 RBAC，差異最容易出現在中間角色（營業助理、代理店長、督導），精簡版會漏測。

### D07 雙版本對等時，舊版的已知 bug 或不合理行為要怎麼處理？

- **新版修正，差異列入白名單，每筆由使用者核可（建議）**
- 完全照抄舊版行為
- 由 Opus 規劃者判斷後直接修正，事後彙報

理由：「功能一致」的目的是業務結果一致，照抄錯誤沒有價值。但每筆差異都可能影響使用者習慣或報表數字，需要使用者核可才可信。

### D08 以下已知的行為差異，是否接受新版較嚴格或較新的做法？（批次匯入、異動、升遷改為整批原子；任務管理權限收緊；任務詳情只限協作者；巡店列表改為單月分頁）

- 全部接受新版做法
- 全部恢復成舊版行為
- **逐項決定（請在補充欄說明）（建議）**

理由：建議如下：批次原子接受（避免半套資料）；任務詳情要開放 admin/manager 檢視（恢復舊版，避免主管無法追蹤）；巡店列表保留分頁，但預設區間恢復近 6 個月；任務管理權限依 RBAC 收緊。

### D09 巡店送出時，是否強制門市與督導雙簽名（舊版規則）？

- 強制雙簽名（同舊版），在後端 RPC 固化
- 只提示不強制
- **草稿可不簽，正式送出才強制（建議）**

理由：保留舊版的稽核效力，同時讓新版的草稿功能可用；規則寫在 workspace_save_inspection，避免繞過前端。

### D10 測試伺服器要由誰啟動？

- 測試 runner 自動 build、啟動 3002 integrated、測完關閉（偵測到已在執行就沿用）
- 使用者先手動執行 start-workspace-preview.ps1

理由：每完成一頁都要跑完整測試，自動化才能讓 Sonnet 子代理無人值守；沿用既有伺服器前會先做 preflight，避免打到錯誤環境。

### D11 提交策略要怎麼安排？

- **每完成一個工作項（四層測試綠燈）就在 feature 分支 commit 一次，每個里程碑開一個 PR 合併回 main（建議）**
- 每個工作項都直接 commit 到 main
- 全部完成後再一次 commit

理由：目前 main 上已有大量未提交變更，需要先整理成一個基準 commit。以工作項為單位提交方便回溯，以里程碑為單位 PR 方便審查。

### D12 施作順序偏好？

- **依建議：測試地基 → 月結與獎金 → 人事 → 任務與首頁 → 巡店 → 活動、組織、認證 → 跨部門 → 總務（建議）**
- 總務服務中心優先（缺口最大，共 34 頁）
- 首頁與任務優先（使用者每天最先看到）

理由：月結與獎金影響薪資，是業務最重要且已部分完成的區塊，越早收斂越好。總務雖然缺口大，但相依鏈長，需要共用基礎；放在後面可以重用前面抽出的上傳、xlsx 元件與測試框架。

### D13 是否排除以下頁面不復刻：/inspection/debug、/inspection/diagnostic、/inspection/test-debug、/general-affairs/part-requests、/general-affairs/part-requests/new？

- **全部排除（除錯頁不復刻；part-requests 已併入 reports，只做轉址）（建議）**
- 除錯頁排除，part-requests 仍復刻
- 全部復刻

理由：除錯頁沒有業務價值；part-requests 的功能已由 reports/new 與 reports/mine 承接，重複實作會增加維護成本。

### D14 QR 掃描永久網址 /general-affairs/assets/scan/{token} 與公開認證頁（register、forgot、reset），在新版要怎麼提供？

- **Next 保留原路徑，轉址到 Vue hash 頁（例如 /workspace/#/scan/{token}）（建議）**
- 繼續使用舊版 Next 頁，不復刻
- Vue 改用 history 模式並由 Next rewrite

理由：已貼出的實體標籤與 Email 連結必須持續有效。用轉址最不會影響既有 hash router，並以 e2e 驗證舊網址可用。

### D15 DEV 測試資料的保留範圍？

- **允許長駐基準資料（VW/ZT 測試門市、角色帳號、保留月份 2099、年份 2038 的設定），單次 fixture 每次清除（建議）**
- 每次全部清除，不留任何資料
- 不清除

理由：長駐基準資料可以讓每頁測試快且穩定；單次 fixture 由 sweeper 與 created.json 保證清除。

### D16 E2E 的 viewport 與瀏覽器範圍？

- **chromium，桌機 1440 加手機 390（建議）**
- chromium、webkit、firefox 加兩種 viewport
- 只測 chromium 桌機

理由：門市人員大量用手機（巡店、回報、盤點），手機版一定要測；三瀏覽器會讓時間加倍，可以留到最終回歸 F01 再跑一次 webkit。

### D17 督導日誌 AI 語音與 Google Calendar 這類外部服務，測試時要怎麼處理？

- **一律 mock（語音走 LOCAL_RULE_FALLBACK，Google 用 page.route 攔截），里程碑結束時人工實測一次（建議）**
- 使用真實金鑰自動測試

理由：避免產生費用與不穩定結果，也避免金鑰出現在測試流程。

### D18 .tmp-check 累積的 445 個舊結果、fixture 與截圖檔要怎麼處理？

- **封存到 .tmp-check/_archive-20261102，新結果改寫到 tests/reports（建議）**
- 全部刪除
- 不動

理由：保留舊證據可供回溯，新舊結果也不會混在一起；明碼憑證檔依 D04 處理。

## 風險

- 環境誤連 Production：.env.local 指向 Production 候選 ref，Vite mode=test、dotenv 或 IDE 外掛可能讀到它；舊版 app/api/** 也沒有 DEV 斷言。對策：T00 守衛加上 D03，preflight 必須打 /api/workspace/session。
- DEV 為共享遠端資料庫，沒有隔離：手動操作與測試並行時會互相干擾，調店、升遷、並行寫入測試尤其不穩定。對策：runId 標記、序列化 workers=1、保留月份 check、sweeper。
- 舊版大量走 server action 或 client 直連 Supabase（app/store/actions.ts、廠商頁），沒有 REST API，對等只能用 UI 擷取或 DB 回讀比對，成本高且較脆弱。
- 權限模型不同（舊版 profiles.role、department、job_title，新版 RBAC），中間角色容易出現看得到、看不到或可寫、不可寫的差異。必須有完整角色矩陣，而且矩陣建立屬重型 RBAC 寫入，需要授權。
- 總務領域 34 頁完全沒有 Vue 版，需求單與工單有雙向同步（ga_service_requests 和 maintenance_*），寫入若只改單表會造成資料不一致；工作量估計為整個計畫的一半以上。
- QR 實體標籤網址與 Email 認證連結若因 hash router 失效，會直接中斷門市報修與帳號流程。
- DEV 資料庫可能缺少 migration 或 bucket（ga_*、stockout_*、clinic_selfpay、行事曆 migration、maintenance-photos），開發中才發現會阻塞進度，要在各工作項開始前先盤點。
- workspace-dev SQL 只套在 DEV，上線時需確認等價的正式 migration（improvements trigger、workspace_save_inspection、刪除 RPC 等），否則新版在正式環境會失效。
- 文件狀態過時（route-inventory.json、full-migration-checklist.md、feature-parity-review.md），若子代理採信文件，可能漏做或重做。對策：以程式碼與測試結果為準，每項完成後更新文件。
- 共用元件（Modal、TaskSchedule、InspectionReport、新的上傳元件）變更可能造成跨頁回歸；App.vue 巨型三元式與壓縮單行的 Vue 檔不易審查。
- main 上已有大量未提交變更與未追蹤檔，若沒先整理成基準 commit，後續工作項的 diff 與回溯會混亂。
- 計算類對等（獎金、評分、自動排程）若只比 UI 而沒在單元層比對新舊函式，邊界值差異可能在發薪時才被發現。
- 外部服務（OpenAI、Google Calendar、Google Maps）相依：測試不穩或產生費用；mock 也可能掩蓋真實整合問題，需要在里程碑結束時人工實測。
- 測試帳號密碼目前以明碼分散保存，自動化測試又需要無人值守取得憑證，安全與便利之間需取捨（D04）。

## 其他文件

- [測試架構](test-architecture.md)
- 各領域逐頁盤點與測試案例：`domains/*.md`

## 月結領域重跑後的修正（2026-11-02）

月結與獎金領域第一次盤點回傳空白，已重跑（見 `domains/monthly-perf.md`）。與上方工作清單的差異：

- **W01 範圍較預期大**：`/monthly-status` 有 10 項缺口（多門市總覽與統計卡片、停用門市切換、確認後自動跳下一間、異動歷程視窗、各門市業績明細展開、刪除人員、送審前的兼職時數與新人階段檢查、細節標籤），`/monthly-status/edit/[id]` 有 6 項（計算區塊預覽、新人升階提醒、時數自動換算等）。施作時拆成 W01a（每月人員狀態總覽）與 W01b（單人編輯）兩輪。
- **W02 狀態應為 missing**：`/admin/export-monthly-status` 沒有 Vue 頁面，需新建。
- **P01 不只是驗收**：藥師管理有 4 項、員購有 3 項小缺口，驗收時一併補齊。
- `/admin/performance` 缺口 6 項、量 S，維持在 W03 內。

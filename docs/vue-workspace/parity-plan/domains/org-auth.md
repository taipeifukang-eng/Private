# 組織、部門、行事曆、角色、使用者、登入註冊密碼

> W21／P06 更新（2026-11-09）：公司組織已補唯讀組織圖卡片（components/OrgChartNode.vue、規則 lib/workspace/organization-rules.ts buildChart／chartCounts）與人員職掌統計抽屜（components/PersonDrawer.vue，公司組織與部門管理兩頁都能開）；部門管理成員表補組織角色與主責／協作／代理計數。Q9 部門管理（導覽、session.capabilities.departments、/api/workspace/department-work）改用舊版頁面條件 DEPARTMENT_PAGE_PERMISSION_CODES；Q10 停用單位的成員與主管可調整（DEV SQL 20261109100000_m5_w21_org_inactive_members_no_unit_sync，附 rollback 與 scripts/apply-workspace-m5-w21-org-dev.cjs）；Q11 DEV 同步 trigger workspace_organization_unit_sync_profiles 已移除（成員異動才同步）。使用者管理（lib/workspace/user-management-rules.ts）：Q12 新增使用者連到 /register、直接建立 API 移除；Q13 授予管理員前醒目確認；Q14 重置密碼不變；Q15 待開通標籤與篩選（API 回傳 is_pending_activation／pendingCount）。角色清單的「顯示 DEV 測試角色」開關原本就在 Roles.vue，本次補齊提示文字與標籤並加測試。下方「缺少或不同」中已完成的項目以此為準。登入頁註冊連結與「帳號待管理員開通」說明頁屬 W22，不在本批。

> W22 更新（2026-11-09）：登入、註冊、忘記密碼、重設密碼已做成 Vue 公開頁（pages/Login.vue、Register.vue、ForgotPassword.vue、ResetPassword.vue，共用 components/PublicShell.vue、LoginForm.vue），原網址 /login、/register、/forgot-password、/reset-password 保留並在 DEV 工作台環境由 middleware 轉到 `/workspace/index.html#/…`（D14；登入頁保留 redirect、重設頁保留 error）。後端為 /api/workspace/auth/register、forgot-password、reset-password（皆檢查 Origin、僅 DEV 工作台守衛內），規則在 lib/workspace/auth-public.ts：Q15 保留公開註冊，新註冊者沒有任何角色，session 回傳 pendingActivation，登入後顯示 components/PendingActivation.vue「帳號待管理員開通」；登入頁放註冊與忘記密碼連結，移除門市數量與「測試環境」字樣；Q16 密碼最短 6；忘記密碼一律回同一句；登入後回原頁只允許站內路徑（safeRedirectPath）；重設信連結維持 /auth/callback?next=/reset-password，缺 NEXT_PUBLIC_SITE_URL 直接報錯，callback 的 next 只允許站內路徑、失敗只帶固定中文。信件測試依 D17 mock（WORKSPACE_AUTH_MAIL_MOCK 只在測試站啟動器開，且只對 @example.test）。下方「領域共用缺口」中公開頁路由機制、登入頁、register、forgot-password、reset-password 的缺口以此為準；測試見 tests/*/W22.public-auth.spec.ts 與 tests/unit/W22。

> W23／W24 更新（2026-11-09）：年度行事曆已做成 Vue 頁（pages/OrganizationCalendar.vue，元件 CalendarGooglePanel、CalendarHolidayImport、CalendarShareDialog、CalendarPeoplePicker），導覽「年度行事曆」改為 workspace 分頁（kind: calendar，session.capabilities.calendar 對所有登入者為 true，Q17）。後端 /api/workspace/calendar/[[...path]] 委派既有 /api/organization/calendar/** handler（舊 RBAC 與寫入規則不動），新規則集中在 lib/workspace/calendar-rules.ts：Q18 分享對象搜尋排除停用／離職（isSearchableColleague）、Q21 同年度再發布要先看差異並二次確認（伺服器端強制 confirm_replace，409 附差異）、Q19 寫到 Google 的事件描述加註「請勿在此修改，請回系統」、Q20 頁頂警示與新的待同步筆數算法（pendingSyncCount；舊算法在授權失效時是 0）。三個行事曆權限維持獨立，按鈕旗標用資料庫語意（沒有管理員繞過），Google 管理維持應用層（管理員放行）。舊網址 /organization/calendar 在 DEV 工作台環境 307 轉到 `/workspace/index.html#/open/calendar`（保留 Google 回調帶來的 google_calendar／google_detail）；回調網址 /api/organization/calendar/google/callback、連結網址與授權範圍完全不變。D17 mock：lib/workspace/calendar-mock.ts（WORKSPACE_CALENDAR_MOCK 與 WORKSPACE_DEV_ENABLED 都為 true 才啟用，只有測試站啟動器設定）提供假 Google 與假人事總處辦公日曆，測試用 /api/workspace/calendar/mock 控制；注意 Playwright 的 page.route 攔不到伺服器 307 轉去 accounts.google.com 的那一跳（實測會連到真實網址並得到 invalid_client），所以 e2e 改攔「連結」請求本身。DEV 原本沒有年度行事曆的資料表：已用 supabase/workspace-dev/20261109110000、20261109110100 補套用（scripts/apply-workspace-m5-w23-calendar-dev.cjs），另 20261109110200 修正「新增個人行程回讀被 RLS 擋下」。上方 /organization/calendar 段落的「missing」以此為準；測試見 tests/*/W23.calendar.spec.ts、W24.google-sync.spec.ts 與 tests/unit/W23、W24。

## 領域共用缺口

- 路由機制：vue-workspace/src/main.ts 只有 hash router（/ 與 /work/:id），頁面以 tab.kind 在 App.vue 切換；公開頁（register/forgot/reset）不適合放進需登入的 tab 機制，需先決定是否以獨立 hash 路由或維持舊站頁面
- 行事曆整頁缺失：需新增 workspace key、session.capabilities 與 App.vue tab kind，並新增 /api/workspace/calendar* 或包裝既有 /api/organization/calendar/*（含 Google OAuth callback 回導）
- 共用 lib/workspace/navigation.ts：『年度行事曆』無 workspace key，目前以 legacyHref 另開舊站分頁
- 組織/部門缺『人員抽屜』（職掌數統計）與組織圖卡片視圖，可抽成共用元件 PersonDrawer.vue
- 測試缺口：行事曆、登入頁(UI/redirect)、register、forgot-password、reset-password 完全沒有 scripts/test-workspace-*；建議補 Python Playwright UI 測試與 API 測試
- DEV 資料庫：supabase/workspace-dev 有 organization 與 department_work SQL，但行事曆兩份 migration 在 supabase/migrations，需確認 DEV 庫已套用並用 scripts/apply-workspace-*-dev.cjs 風格新增套用腳本
- 認證流程相依 Supabase redirect URL 與 NEXT_PUBLIC_SITE_URL；/auth/callback 目前是舊站路由
- App.vue 的 tab 權限判斷寫在單行巨型三元式（App.vue line ~221），新增頁面時易出錯，建議重構為對照表
- Roles.vue、Users.vue、Organization*.vue 皆為壓縮單行風格，審查與維護困難，測試需以 UI 行為驗證而非讀碼

## /admin/organization

- 狀態：**partial**（M）— 核心功能（樹狀檢視、搜尋、類型篩選、含停用、展開收合、縮放平移、拖曳/上層+排序調整整批儲存、新增/編輯單位、設定成員與主管、停用確認、版本衝突核對）已由 Vue 原生實作，並有專屬後端 RPC 與樂觀鎖；但舊版的「組織圖卡片模式」、單位摘要抽屜、人員工作負載抽屜、導覽器(navigator)在 Vue 中沒有等價物，故判為 partial（差異屬於次要）。
- 舊版：`app/admin/organization/page.tsx -> components/admin/OrganizationManagementClient.tsx (mode=overview, 2328 行); API app/api/organization/units、/users`
- Vue：`vue-workspace/src/pages/Organization.vue`、`vue-workspace/src/pages/OrganizationEditor.vue`、`vue-workspace/src/organization.ts`
- 權限：organization.organization.view、organization.department.view、organization.department.create、organization.department.edit、organization.department_workspace.view、organization.department_workspace.manage、organization.member.view、organization.member.manage、organization.manager.view、organization.manager.manage
- 相依：共用 Modal.vue、stores.ts organizationRevision、與 Departments/DepartmentDetail 共用組織資料 revision

**舊版功能**

- 組織架構樹狀檢視與搜尋、展開全部/收合至第二層、重設視角、回到根、縮放(0.5~1.8)與平移
- 調整上下層模式：拖曳單位、上層選單、排序，整批儲存前彙整確認、放棄調整、離開頁面提示
- 新增部門/單位、編輯單位(代碼/名稱/簡稱/類型/上層/排序/狀態/說明)
- 啟用/停用單位(含確認)
- 設定部門成員(多選搜尋)、設定主管(manager/deputy_manager/acting_manager，唯一主要主管)
- 單位摘要抽屜、下層組織卡片
- 組織導覽器抽屜(navigator)
- 含停用單位顯示切換 showInactive
- 權限 gating：檢視/建立/編輯/成員/主管各自控制按鈕

**缺少或不同**

- Vue 無舊版『組織圖(卡片式)』與『未編輯上下層』兩種顯示切換，只有單一樹狀列表 + 側欄 (Organization.vue 的 tree-viewport/aside) — 依據 OrganizationManagementClient.tsx:930-1130 vs Organization.vue
- Vue 無『人員抽屜』顯示個人主責/協作/代理職掌數 (舊版 setPersonDrawerUser, line ~1240、1820)；Vue 成員清單僅顯示代碼/姓名/職稱
- Vue 無舊版離開頁面時『是否儲存拖曳調整』的 beforeunload 流程，改用 tab.dirty 與 tab.save 機制（行為不同但等價）
- 舊版使用 /api/organization/units，Vue 改用 RPC workspace_organization_catalog/workspace_organization_save 並加 requestId 冪等與 expected 版本 hash，並非同一 API
- 舊版『工作交接』分頁僅為靜態空白佔位 (renderHandoverTab)，Vue 未復刻（無實質功能，可不做）

**業務規則**

- （無）

**API**：舊 GET/POST /api/organization/units、GET /api/organization/users；新 GET/POST /api/workspace/organization (app/api/workspace/organization/route.ts)、GET /api/workspace/organization-people

**資料表**：organization_units、organization_memberships、organization_manager_assignments、workspace_organization_requests、profiles

**既有測試**：scripts/test-workspace-organization-api.py、scripts/test-workspace-organization-ui.py、scripts/test-workspace-organization-tree.py、scripts/test-workspace-organization-review.py、scripts/test-workspace-organization-permissions.py、scripts/test-workspace-organization-dev.cjs、scripts/workspace-organization-permissions-dev.cjs、scripts/apply-workspace-organization-dev.cjs、scripts/cleanup-workspace-organization-ui-dev.cjs

**待確認**

- 組織圖卡片模式與『未編輯上下層』視圖是否為使用者必要功能，需產品確認；僅以程式碼比對，未實際執行畫面。

### 測試案例

**冒煙**

- R1 登入後開 Vue 工作台的『組織架構』分頁：頁面渲染出 tree-viewport，根節點（company）可見，console 沒有 error，GET /api/workspace/organization 回 200，GET /api/workspace/organization-people 回 200
- R3 org_viewer：分頁可見、樹狀可見，但看不到『新增單位/調整上下層/設定成員/設定主管/停用』按鈕
- R9 plain_member、R10 store_manager：lib/workspace/navigation.ts 產出的導覽沒有組織架構項目（比對 /api/workspace/session 回傳的 navigation 或 capabilities），直接 GET /api/workspace/organization 要回 403
- R12 匿名：GET /api/workspace/organization 回 401；畫面停在登入面板
- 搜尋框輸入既有單位名稱後，畫面上只留下該單位和它的祖先路徑；勾『含停用』後停用單位出現

**單元**

- vue-workspace/src/organization.ts descendants(units,id)：三層樹、單節點、id 不存在、有循環資料（防無限迴圈，若目前沒有防護則記錄為缺陷）
- vue-workspace/src/organization.ts canMoveUnit(units,id,parent)：移到自己底下要 false、移到子孫底下要 false、parent=null（移到根）、移到兄弟節點要 true
- unitTypes / managerRoles 對照表的鍵集合要等於 lib/admin/organization-management.ts 的 OrganizationUnitType / OrganizationManagerRole（用型別常數或手寫清單做快照測試）
- lib/admin/organization-management.ts 的 ORGANIZATION_NAV_PERMISSION_CODES 和 ORGANIZATION_MUTATION_PERMISSION_CODES 內容做快照，確保 view/manage 權限碼沒有被誤刪
- lib/workspace/navigation.ts workspaceNavigation(ctx)：mock 出 R1/R3/R9 三種 ctx.has，驗證組織管理項目是否出現，以及有沒有 workspace key

**整合**

- 角色矩陣 GET /api/workspace/organization：R1/R2/R3 回 200 且單位數相同；R4 依 department_workspace.view 決定（要記錄結果）；R9/R10/R11 回 403；R12 回 401
- POST /api/workspace/organization 新增單位（code=TEST-ORG-<token>）：R2 成功，DB organization_units 多一筆，parent 和 sort_order 正確；R3 回 403，DB 不變；Origin=https://invalid.example 回 403
- 樂觀鎖：A、B 兩個 context 讀到同一個 expected hash；A 先儲存移動，B 再用舊 hash 儲存，要回 409（或專案定義的衝突碼），B 的變更不會寫入，DB 保持 A 的結果
- 冪等：同一個 requestId 送兩次，DB 只寫一次；workspace_organization_requests 只有一筆
- 錯誤路徑：把單位移到自己的子孫底下 → 400 且 DB 不變；code 重複 → 400/409；名稱空白 → 400；指定兩位 manager（主要主管唯一）→ 400；設定不存在的 profile id → 400
- 停用有下層啟用單位的節點：記錄舊版和新版的行為是否一致（允許或擋下）
- 設定成員/主管：只有 member.manage 沒有 manager.manage 的角色可以設成員、不能設主管（回 403），反過來也要測
- 並行：兩個 context 同時對不同單位做編輯（不同 requestId、相同 expected）→ 驗證第二個請求被判衝突，或依設計合併，結果記錄進文件
- 清理：finally 刪除所有 TEST-ORG-* 單位、membership、manager assignment，最後比對 organization_units 的 id 集合等於測試開始時

**E2E**

- R2：開組織架構 → 新增部門（填代碼、名稱、簡稱、類型=department、上層=總部、排序、說明）→ 儲存 → 樹上出現 → 編輯改名稱 → 重新整理後仍是新名稱
- R2：進入調整上下層模式 → 拖曳 TEST 單位到另一個上層 → 分頁標記為 dirty → 儲存前的彙整確認視窗列出移動項目 → 確認 → 重新整理後結構正確；再做一次後按『放棄調整』，結構要還原
- R2：dirty 狀態下關閉分頁或切到別的分頁，要跳出未儲存提示（tab.dirty 機制）
- R2：設定成員（多選搜尋兩位 test 帳號）→ 設定主管 manager + deputy_manager → 側欄顯示正確
- R2：停用單位 → 確認對話框 → 預設隱藏，勾『含停用』後出現並帶停用標記 → 再啟用
- 縮放/平移/展開全部/收合至第二層/回到根/重設視角：每個按鈕操作後檢查 transform scale 在 0.5~1.8 之間，節點數量符合預期
- 雙視窗衝突：視窗 1 和視窗 2 開同一棵樹，視窗 1 先儲存移動，視窗 2 再儲存時要出現版本衝突核對畫面，可以選擇重新載入

**對等驗證**

- R1 同一個 session：GET /api/organization/units 和 GET /api/workspace/organization，正規化後 {id,code,name,short_name,unit_type,parent_id,sort_order,status} 集合要 deep-equal；membership 和 manager assignment 也比對
- 寫入對等：在舊版 OrganizationManagementClient 新增單位 X（代碼 TEST-OLD-<t>），在 Vue 新增同樣欄位的單位 Y（TEST-NEW-<t>），兩列 organization_units 除了 id/code/時間戳以外全部相同；成員與主管設定同理
- 移動對等：舊版拖曳儲存和 Vue 儲存後 parent_id/sort_order 的結果一致（同一個起始狀態，先快照再還原）
- 權限對等：R3、R4、R9 開舊頁和新頁，可見按鈕集合（新增/編輯/成員/主管/停用）要一致
- 已知差異清單（組織圖卡片模式、人員抽屜、導覽器、工作交接佔位）要列為 accepted-diff，不納入失敗條件，但要在報告中標示，請產品確認

**測試資料**

- DEV 帳號 R1~R4、R9~R12（以 test-org-<role>@example.test 命名，密碼共用 WORKSPACE_TEST_PASSWORD）
- 測試樹：TEST-ORG-ROOT(headquarters) → TEST-DEPT-A、TEST-DEPT-B(department) → TEST-TEAM-A1(team)；外加一個 inactive 的 TEST-DEPT-OLD
- 3 位 test profile 作為成員候選，其中 1 位已是 TEST-DEPT-A 的 manager
- 套用 supabase/workspace-dev/20261028180000_vue_organization.sql 與 20261028190000_vue_organization_profile_sync.sql（用 scripts/apply-workspace-organization-dev.cjs 確認已套用，不重新套用）
- 清理腳本可沿用 scripts/cleanup-workspace-organization-ui-dev.cjs

**風險**

- 舊版和新版走不同的寫入路徑（/api/organization/units 對上 RPC workspace_organization_save），驗證規則可能不同步，特別是主管唯一性和循環檢查
- 單位有停用或下層時的處理規則可能不同
- Organization.vue 是壓縮碼，選擇器不穩，建議先補 data-testid（需要使用者同意修改）

## /admin/departments

- 狀態：**partial**（M）— 部門清單、部門詳情(概況/成員/工作職掌)、職掌新增/編輯、按工作/按人員檢視、搜尋分類篩選均已在 Vue 實作並有專屬測試；差距在人員抽屜的工作量統計、舊版成員表的主責/協作/代理計數欄、工作交接佔位。
- 舊版：`app/admin/departments/page.tsx -> OrganizationManagementClient.tsx (mode=departments) ; API /api/department-workspace/work-items`
- Vue：`vue-workspace/src/pages/Departments.vue`、`vue-workspace/src/pages/DepartmentDetail.vue`、`vue-workspace/src/pages/DepartmentWorkEditor.vue`、`vue-workspace/src/department-work.ts`
- 權限：organization.department_workspace.view、organization.department.view、organization.department_workspace.manage、organization.department.edit、organization.department.create、organization.member.manage、organization.manager.manage
- 相依：Organization 單位資料（OrganizationEditor）、stores.ts departmentRevision/organizationRevision

**舊版功能**

- 部門清單與詳情，分頁：概況、成員、工作職掌、工作交接
- 部門基本資訊、工作責任概況(尚無主責/代理數)
- 成員表含職稱、組織角色、主責/協作/代理計數、狀態
- 工作職掌清單：搜尋、分類篩選、含停用、按工作/按人員切換
- 新增/編輯工作職掌抽屜(標題、分類、類型、重要性、目的、執行情境、完成標準、注意事項、接手重點、指派主責/協作/代理)
- 人員抽屜(個人職掌明細)
- 新增部門、編輯部門、設定成員/主管（沿用組織管理）

**缺少或不同**

- Vue DepartmentDetail 成員表只有『人員/職稱/成員類型』，缺主責/協作/代理計數與組織角色欄 (舊版 OrganizationManagementClient.tsx:1228-1255 vs DepartmentDetail.vue members 區)
- Vue 無『人員抽屜』（舊版 setPersonDrawerUser）；改以『按人員檢視』分組列表近似
- Vue 無『工作交接』分頁（舊版也只是靜態空白佔位）
- Vue Departments 清單頁僅顯示 主管/直接成員數/狀態，舊版為左側組織導覽 + 右側詳情的單頁佈局，互動模式不同

**業務規則**

- （無）

**API**：舊 GET/POST /api/department-workspace/work-items、GET /api/organization/units；新 GET/POST /api/workspace/department-work (app/api/workspace/department-work)

**資料表**：organization_units、organization_memberships、organization_manager_assignments、department_work_items、department_work_categories、department_work_assignments、profiles

**既有測試**：scripts/test-workspace-department-work-api.py、scripts/test-workspace-department-work-ui.py、scripts/test-workspace-department-conflict.py、scripts/test-workspace-department-work-dev.cjs、supabase/workspace-dev/20261028200000_vue_department_work.sql

**待確認**

- department_work_* 資料表名稱依 workspace-dev SQL 檔名推斷，未逐一核對 schema。

### 測試案例

**冒煙**

- R1 開『部門』分頁：Departments.vue 顯示清單（主管、直接成員數、狀態），GET /api/workspace/department-work 回 200，console 沒有 error
- 點進 TEST-DEPT-A，DepartmentDetail 的概況、成員、工作職掌分頁都能切換
- R3 唯讀：看不到新增職掌和編輯按鈕；R9/R10 導覽沒有部門項目，API 回 403；R12 回 401

**單元**

- vue-workspace/src/department-work.ts currentAssignments(item)：只保留 status=active 且沒有 effective_to 的指派；assignments 是 undefined 時回 []
- workTypes / importanceLabels / assignmentLabels / workFields 鍵集合快照，並與 DB check constraint（supabase/workspace-dev/20261028200000_vue_department_work.sql）的列舉值一致
- 若部門詳情中的『按人員分組』或主責/協作/代理計數邏輯在 DepartmentDetail.vue 內嵌，建議抽成 department-work.ts 的 groupByPerson(items) 與 countAssignments(items,userId)，並對舊版 OrganizationManagementClient.tsx:1228-1255 的計數規則寫對照測試

**整合**

- GET /api/workspace/department-work?department=<A>：R1/R2/R3/R4 回 200；R9/R10/R11 回 403；R12 回 401
- POST 新增職掌（標題 TEST-WORK-<t>、分類、類型=fixed、重要性=critical、目的、完成標準、指派 PRIMARY=u1、COLLABORATOR=u2、BACKUP=u3）：R4 成功，department_work_items 與 department_work_assignments 寫入正確；R3 回 403
- 錯誤路徑：沒有標題 → 400；類型不在 workTypes → 400；同一職掌指派兩位 PRIMARY（依規則）→ 400，或記錄允許；指派非部門成員 → 記錄行為；Origin 錯誤 → 403
- 並行衝突（沿用 scripts/test-workspace-department-conflict.py 的模式）：兩個 context 用同一版本編輯同一職掌，後送的要回衝突，DB 保留先送的
- 跨部門：只對部門 A 有管理權的帳號（若後端支援部門範圍）修改部門 B 的職掌要回 403；若無部門範圍，標 uncertain 並記錄實際結果
- 停用職掌後預設不在清單，?include_inactive=1 時才出現
- 清理：刪除 TEST-WORK-* 和它的 assignments

**E2E**

- R4：部門 → TEST-DEPT-A → 工作職掌 → 新增 → 填完抽屜所有欄位並指派三種角色 → 儲存 → 清單出現，切換『按人員』後 u1 底下有這項並標示主責
- 編輯同一職掌改重要性與接手重點 → 重新整理後保留
- 搜尋關鍵字與分類篩選的組合，結果筆數正確；勾『含停用』後顯示停用項
- 雙視窗衝突：A、B 同時編輯，B 儲存時出現衝突提示
- 成員分頁：顯示 TEST-DEPT-A 的成員與職稱；把成員表上的主責/協作/代理計數與舊版比對（目前 Vue 缺少，預期為 accepted-diff 或待補）

**對等驗證**

- 同一個 session：GET /api/department-workspace/work-items?unitId=A 和 GET /api/workspace/department-work?department=A 的 items（id,title,category,work_type,importance,status,assignments[user,role]）正規化後 deep-equal
- 舊版新增一筆 TEST-OLD 職掌、Vue 新增同樣欄位的 TEST-NEW，比對 department_work_items 和 department_work_assignments 的欄位（排除 id、時間）
- 按人員統計：從舊 API 結果自己計算每人主責/協作/代理數，和 Vue『按人員檢視』每組筆數比對
- 已知差異（人員抽屜、成員表計數欄、工作交接佔位、左右分欄版型）列為 accepted-diff

**測試資料**

- 沿用組織頁測試樹 TEST-DEPT-A/B 與 3 位成員 u1/u2/u3
- 部門 A：5 筆職掌（涵蓋 3 種 workType、3 種重要性，其中 1 筆 inactive，1 筆有 effective_to 已結束的指派）；部門 B：2 筆職掌
- 至少 2 個 department_work_categories
- 角色 R1、R2、R3、R4、R9、R10
- 確認已套用 supabase/workspace-dev/20261028200000_vue_department_work.sql（scripts/apply-workspace-department-work-dev.cjs）

**風險**

- department_work_* 資料表名稱是從 SQL 檔推斷的（uncertain），實作前先以 schema 確認
- 舊 API 和新 API 的寫入驗證可能不一致

## /organization/calendar

- 狀態：**missing**（XL）— lib/workspace/navigation.ts 的『年度行事曆』項目(item('年度行事曆','/organization/calendar'))沒有 workspace key，App.vue 以 legacyHref 另開舊站分頁；vue-workspace/src 內沒有對應頁面，app/api/workspace 下也沒有 calendar 路由。
- 舊版：`app/organization/calendar/page.tsx -> components/organization/OrganizationCalendarClient.tsx (1426 行); API app/api/organization/calendar/**; lib/organization/google-calendar.ts (489 行); lib/admin/organization-calendar.ts`
- Vue：（無）
- 權限：organization.calendar.company.create、organization.calendar.company.edit、organization.calendar.holiday.manage、organization.calendar.google.manage、（檢視/個人行程：登入即可，nav item 無權限限制）
- 相依：ActivityCalendar.vue 可參考月曆元件但為活動用途、Google OAuth redirect URI 設定、DEV 資料庫需套用 supabase/migrations/20261008100000_organization_annual_calendar.sql 與 20261010120000_organization_calendar_google_sync.sql

**舊版功能**

- 月檢視與全年(12 個月)清單檢視切換，年月切換
- 來源篩選：公司行事、個人行程、政府假日
- 新增/編輯公司行事(會議/活動/重要事項)，取消公司行事並留有稽核/歷史
- 新增/編輯/刪除個人行程，可分享給他人（共用對象選擇、授予檢視/編輯、撤銷）
- 行事歷史(audit)檢視
- 匯入政府假日 CSV：預覽、發布、更新假日資料，顯示假日來源/修訂/匯入時間；假日型別：國定假日/補假日/補行上班
- Google Calendar 連線：status、connect(OAuth)、callback、sync、diagnose scope、disconnect；同步失敗訊息與授權需更新提示
- 權限控管：公司行事新增/編輯、假日管理、Google 管理

**缺少或不同**

- 整頁缺 Vue 版：需建立 Calendar.vue 與 /api/workspace/calendar* 或包裝既有 /api/organization/calendar/*
- Google OAuth callback 跳轉目前導回舊站 /organization/calendar（app/api/organization/calendar/google/callback/route.ts），Vue 版需改回導或維持跨站流程
- navigation.ts 缺 workspace key，需新增 key（如 'calendar'）與 session.capabilities、App.vue tab kind 對應

**業務規則**

- （無）

**API**：舊 GET /api/organization/calendar、GET/POST/PATCH /api/organization/calendar/company-events、GET/POST/PATCH/DELETE /api/organization/calendar/personal-events、GET/POST/DELETE /api/organization/calendar/shares、GET /api/organization/calendar/people、GET/POST /api/organization/calendar/holidays、POST /api/organization/calendar/holidays/preview、GET /api/organization/calendar/google/status、GET /api/organization/calendar/google/connect、GET /api/organization/calendar/google/callback、POST /api/organization/calendar/google/sync、POST /api/organization/calendar/google/diagnose、POST /api/organization/calendar/google/disconnect；新 —

**資料表**：organization_calendar_events、organization_calendar_event_audit、organization_personal_calendar_events、organization_personal_calendar_event_shares、organization_calendar_holiday_imports、organization_calendar_holidays、organization_calendar_google_connections、organization_calendar_google_event_links

**既有測試**：—

**待確認**

- Google 同步在測試環境無法真實連線，E2E 需 mock；DEV 資料庫是否已套用兩份 calendar migration 未驗證。

### 測試案例

**冒煙**

- （實作後驗收）R9 plain_member 登入，導覽有『年度行事曆』而且是 workspace 分頁（不是 legacyHref 另開舊站）；開啟後顯示當月月曆，console 沒有 error
- GET /api/workspace/calendar?year=2026&month=11（或包裝後的 /api/organization/calendar）回 200，含 company/personal/holiday 三種來源
- 切換全年 12 個月清單檢視、上一月/下一月、年份切換都能渲染
- R7 看得到『新增公司行事』；R9 看不到；R8 看得到『匯入假日』『Google 連線』；R12 匿名回 401
- 實作前先對舊版 /organization/calendar 跑同一套 smoke，建立基準截圖與 API 回應

**單元**

- lib/admin/organization-calendar.ts isCalendarDate：'2026-11-02' 為 true；'2026-02-30'、'2026/11/02'、''、null、數字皆為 false
- lib/admin/organization-calendar.ts cleanCalendarText(value,maxLength)：前後空白 trim、空字串回 null、超過長度截斷或回 null（依實作記錄）、非字串回 null
- ORGANIZATION_CALENDAR_EVENT_TYPES / _LABELS、HOLIDAY_TYPES / _LABELS 鍵集合一致（國定假日/補假日/補行上班）
- app/api/organization/calendar/holidays/preview/route.ts 的 parseOfficialCsv(bytes,year) 與檔名規則 /^\d{2,3}年中華民國政府行政機關辦公日曆表.../：建議 export 或搬到 lib 後測試，涵蓋 UTF-8 BOM、民國年轉西元、補行上班列、非該年資料、欄位缺漏
- lib/organization/google-calendar.ts encryptRefreshToken：同樣輸入兩次加密結果不同（有 IV），且能以對應解密函式還原（若有 export）；isGoogleCalendarConfigured 在缺環境變數時回 false
- Vue 端月曆格線計算（若新建 calendar.ts 的 monthGrid(year,month)）：2026-02 為 28 天且起始星期正確、跨年 12→1、同日多事件依類型排序

**整合**

- 公司行事 POST：R7 成功，organization_calendar_events 新增一筆且 organization_calendar_event_audit 有 create 紀錄；R9 回 403；日期格式錯誤回 400；結束早於開始回 400
- 公司行事 PATCH/取消：R7 有 edit 權限才可以；取消後狀態變為 cancelled，audit 多一筆；沒有 edit 權限回 403
- 個人行程：R9 建立自己的行程成功；R9 PATCH/DELETE 別人的行程回 403/404；分享給 R7（檢視）後 R7 可以讀、不能改；授予編輯後 R7 可以改；撤銷後 R7 不能讀
- 假日：R8 上傳官方 CSV 做預覽（不寫 DB），再發布 → organization_calendar_holiday_imports 與 organization_calendar_holidays 寫入；同年重複發布為覆蓋更新而且修訂號增加；R7、R9 預覽或發布回 403
- Google：在沒有 GOOGLE_* 環境變數的 DEV 環境呼叫 status 要回未設定；connect/sync/diagnose/disconnect 若沒有 google.manage 權限回 403；sync 用 mock（攔截 googleapis fetch）驗證 organization_calendar_google_event_links 寫入
- OAuth callback 回導：callback 完成後的 Location 要指向 Vue 工作台的行事曆（或依決策維持舊站），state 不符時回錯誤
- 並行：兩個 R7 同時 PATCH 同一筆公司行事，記錄最後寫入結果和 audit 筆數（若有版本欄位，第二筆應回衝突）
- DEV 前置：查詢 information_schema 確認 8 張 calendar 資料表存在，不存在就中止並回報（需套用 supabase/migrations/20261008100000 與 20261010120000，這屬於寫 DB 操作，要另外取得同意）

**E2E**

- R7：月檢視 → 點日期 → 新增公司會議（標題、時間、類型=會議）→ 儲存 → 月曆格出現 → 編輯改時間 → 取消行事 → 歷史紀錄顯示三筆
- R9：新增個人行程 → 分享給 R7 並授予檢視 → 用 R7 登入另一個瀏覽器看得到但不能編輯 → R9 撤銷 → R7 重新整理後消失
- R8：匯入假日 → 上傳 fixture CSV → 預覽表格顯示筆數與型別 → 發布 → 月曆標出國定假日與補行上班 → 顯示來源、修訂、匯入時間
- 來源篩選：只勾政府假日時，月曆只剩假日
- Google（mock）：R8 按連線 → 攔截跳轉到 accounts.google.com 的 URL 並檢查 scope → 模擬 callback → 狀態顯示已連線 → 同步 → 中斷連線
- 全年清單檢視列出 12 個月的事件筆數，和 API 統計一致

**對等驗證**

- Vue 頁面如果包裝既有 /api/organization/calendar/*，同一 session 下新舊 API 回應要逐位元組相同；如果另建 /api/workspace/calendar，正規化後的事件（id,date,type,title,source,status）集合要 deep-equal
- 同一份假日 CSV 分別在舊頁、新頁做預覽，預覽 JSON 要完全相同；發布後 organization_calendar_holidays 的列要一致（舊版做完先還原再做新版）
- 權限對等：R7/R8/R9 在舊頁和新頁可見的按鈕集合一致
- 2026-11 月份畫面：兩版擷取每格日期的事件標題清單做比對

**測試資料**

- 角色 R7、R8、R9、R12，另加 1 位分享對象
- fixture：113年與115年中華民國政府行政機關辦公日曆表_utf8bom.csv（取自官方格式並裁成約 20 列，含國定假日、補假、補行上班），存放在 scripts/fixtures/calendar/
- 公司行事：TEST-CAL-<t> 3 筆（會議、活動、重要事項各 1，其中 1 筆已取消）；R9 個人行程 2 筆，其中 1 筆分享給 R7
- Google：環境變數不設定，以及 mock token 兩種情境
- 需確認 DEV 已套用兩份 calendar migration

**風險**

- 整頁缺 Vue 版，是 XL 工作量；navigation.ts 需要新增 workspace key，App.vue 要加 tab kind
- Google OAuth redirect URI 綁定舊站路徑，修改會影響正式環境設定
- DEV 若沒有套用 migration，所有整合測試都會失敗

## /admin/roles

- 狀態：**done**（S）— Roles.vue 在同一頁以清單 + 視窗涵蓋角色搜尋、狀態篩選、新增(名稱/代碼/說明)、啟停用、刪除；後端 app/api/workspace/roles/[[...path]]/route.ts 直接委派既有 app/api/roles 路由，邏輯與舊版一致。
- 舊版：`app/admin/roles/page.tsx + RoleListClient.tsx (393 行); API app/api/roles/route.ts、app/api/roles/[id]/route.ts`
- Vue：`vue-workspace/src/pages/Roles.vue`
- 權限：role.role.view、role.role.create、role.role.edit、role.role.delete、role.permission.view、role.permission.assign、role.user_role.view、role.user_role.assign、role.user_role.revoke
- 相依：lib/permissions/rbac-management.ts 權限常數、types/rbac MODULE_NAMES

**舊版功能**

- 角色清單（搜尋、狀態篩選、是否含 DEV 角色）
- 建立角色（名稱、代碼必填）
- 啟用/停用角色（確認）
- 刪除角色（確認，系統預設角色限制）
- 進入角色編輯
- 權限 gating：create/edit/delete

**缺少或不同**

- Vue 以 modal + 同頁分頁取代獨立路由 /admin/roles/[id]，URL 層級不同（設計差異，非功能缺失）
- 舊版 alert/confirm 改為 Vue 對話框，需 UI 層測試比對訊息

**業務規則**

- （無）

**API**：舊 GET/POST /api/roles、PATCH/DELETE /api/roles/[id]；新 /api/workspace/roles (catch-all，委派 /api/roles/*)

**資料表**：roles、permissions、role_permissions、user_roles

**既有測試**：scripts/test-workspace-roles-api.py、scripts/test-workspace-roles-ui.py、scripts/test-rbac-role-user-assignment-display.js、scripts/test-role-permission-inactive-snapshot.cjs

### 測試案例

**冒煙**

- R1 開『角色權限』分頁：Roles.vue 清單載入，GET /api/workspace/roles 回 200，console 沒有 error
- R6 rbac_viewer：清單可見，看不到新增、啟停用、刪除按鈕
- R9/R10：導覽沒有角色管理（ROLE_MANAGEMENT_NAV_PERMISSION_CODES），API 回 403；R12 回 401
- 搜尋與狀態篩選可以操作，結果筆數會變

**單元**

- lib/permissions/rbac-management.ts 的 ROLE_MANAGEMENT_NAV_PERMISSION_CODES、USER_MANAGEMENT_NAV_PERMISSION_CODES 快照
- 若 Roles.vue 內有清單篩選邏輯（搜尋名稱/代碼、狀態、是否含 DEV 角色），建議抽成 vue-workspace/src/lib/roles.ts 的 filterRoles(roles,{q,status,includeDev})，再和舊版 RoleListClient.tsx 的篩選邏輯用同一組資料做對照測試
- 角色代碼格式驗證（若有規則，例如小寫底線）：抽成 validateRoleCode，測合法、空白、重複大小寫等情況

**整合**

- app/api/workspace/roles/[[...path]]/route.ts 委派：GET /api/workspace/roles 和 GET /api/roles 在同一 session 下回應相同
- POST 建立 TEST_ROLE_<t>：R5 成功，roles 新增一筆；R6 回 403；名稱或代碼空白回 400；代碼重複回 409/400；Origin 錯誤回 403
- PATCH 啟停用：R5 可以；系統預設角色停用要被擋（400/403）；R6 回 403
- DELETE：R5 刪除沒有使用者的 TEST 角色成功；系統角色被擋；有使用者的角色依規則（擋或連帶刪除 user_roles，記錄結果）
- 並行：兩個 context 同時建立同一代碼，只有一筆成功

**E2E**

- R5：角色清單 → 新增（名稱、代碼、說明）→ 清單出現 → 停用（確認對話框）→ 狀態篩選『停用』看得到 → 啟用 → 刪除（確認）→ 消失
- 嘗試停用系統預設角色，畫面要出現錯誤訊息而且狀態不變
- 點角色進入設定視窗（承接 /admin/roles/[id] 流程）

**對等驗證**

- GET /api/roles 和 /api/workspace/roles 回應 deep-equal（委派，應該完全相同）
- 舊頁 RoleListClient 和 Roles.vue 在同一個篩選條件下顯示的角色代碼清單相同
- 舊頁建立 TEST_OLD、新頁建立 TEST_NEW，roles 列除了 id/code/時間以外一致
- 錯誤訊息對照：舊版 alert 文字和 Vue 對話框文字列表比對（允許文案差異，但錯誤種類要相同）

**測試資料**

- R1、R5、R6、R9、R12
- TEST_ROLE_A（含 3 個權限、2 位使用者）、TEST_ROLE_EMPTY（無使用者）、一個 inactive 的 TEST_ROLE_OFF
- 既有系統預設角色（admin、store_manager 等，只讀）

**風險**

- 委派路由若沒有轉送 Origin 或 cookie，權限可能跑掉，所以要跑完整矩陣
- Roles.vue 壓縮碼的選擇器不穩定

## /admin/roles/[id]

- 狀態：**done**（S）— Roles.vue 實作了角色資訊編輯、權限矩陣（依模組/功能分組、資料查看範圍擇一的 radio、view/daily/none 預設組合、高影響權限標記 highImpact/sensitive、搜尋）、未儲存提示(dirty)、員工編號指派(employee_codes)、使用者清單狀態(有效/已到期/已停用)與移除；後端沿用原 API，業務規則同源。
- 舊版：`app/admin/roles/[id]/page.tsx + RoleEditClient.tsx (2012 行); API app/api/roles/[id]/permissions、/users、/users/[userId]`
- Vue：`vue-workspace/src/pages/Roles.vue (角色設定視窗/權限矩陣/使用者區塊，1095 行)`
- 權限：role.role.view、role.role.edit、role.permission.view、role.permission.assign、role.user_role.view、role.user_role.assign、role.user_role.revoke
- 相依：/admin/roles（同一個 Roles.vue）

**舊版功能**

- 角色資訊編輯（名稱、說明、啟停用；系統預設角色不可停用）
- 權限設定：依模組/功能分組、檢視範圍擇一、搜尋、批次預設（唯讀/日常/清除）
- 本次權限變更摘要對話框、高影響權限二次確認
- 未儲存離開/切換/重新載入的確認
- 角色使用者管理：列表、狀態篩選(有效/到期/停用)、以員工編號批次新增、移除確認
- 角色影響使用者數摘要 (summary=1)

**缺少或不同**

- 舊版 RoleEditClient 的『本次權限變更』對話框與『高影響權限確認』對話框是否在 Vue 逐項復刻，僅以 Roles.vue 中 highImpact/sensitive/dirty 的存在判斷，需以 UI 測試確認 (Roles.vue:87-99, 232)
- Vue 的角色使用者區塊未見新增到期日輸入（舊版亦僅以員工編號指派，經 RoleEditClient.tsx:765-790 確認），兩版一致

**業務規則**

- （無）

**API**：舊 GET/PATCH /api/roles/[id]、GET/POST /api/roles/[id]/permissions、GET/POST /api/roles/[id]/users、DELETE /api/roles/[id]/users/[userId]；新 /api/workspace/roles/[id], /permissions, /users, /users/[userId]（皆由 [[...path]]/route.ts 委派）

**資料表**：roles、permissions、role_permissions、user_roles、profiles

**既有測試**：scripts/test-workspace-roles-api.py、scripts/test-workspace-roles-ui.py、scripts/test-role-permission-inactive-snapshot.cjs、scripts/test-rbac-role-user-assignment-display.js、scripts/test-general-affairs-role-matrix-dev.js

**待確認**

- Roles.vue 為單行密集程式碼，變更摘要/高影響確認對話框細節未逐行驗證。

### 測試案例

**冒煙**

- R1 開 TEST_ROLE_A 的設定視窗：權限矩陣按模組分組渲染，GET /api/workspace/roles/<id>/permissions 與 /users 都回 200，console 沒有 error
- R6：矩陣唯讀（checkbox disabled），沒有儲存按鈕，也沒有新增使用者

**單元**

- 權限矩陣『資料查看範圍擇一』邏輯：若在 Roles.vue 內嵌，建議抽成 roles.ts 的 applyScopeRadio(selected,group,code)，測切換範圍時同組其他範圍碼要被移除
- 預設組合 view/daily/none：抽成 applyPreset(permissions,preset)，用一組權限 fixture 比對和 RoleEditClient.tsx 的計算結果相同
- 變更摘要 diffPermissions(before,after) 回傳 {added,removed}；highImpact/sensitive 判斷 isHighImpact(code) 要和舊版清單一致
- 使用者狀態 userAssignmentStatus(row,now)：有效、已到期（expires_at < now）、已停用
- 員工編號批次輸入解析 parseEmployeeCodes(text)：逗號、換行、空白、重複、大小寫

**整合**

- POST /api/workspace/roles/<id>/permissions：R5 新增與移除權限碼，role_permissions 正確；R6 回 403；不存在的權限碼回 400
- 同時傳兩個資料範圍碼（違反擇一）：記錄後端是否擋（舊版只在前端擋的話，標為風險）
- POST /users 用員工編號批次指派：存在的編號指派成功；不存在的回報到錯誤清單；已指派的不重複寫入；R6 回 403
- DELETE /users/<userId>：R5 成功，user_roles 移除；沒有 revoke 權限的角色回 403
- summary=1：影響使用者數等於 user_roles 有效筆數
- PATCH 角色資訊：系統預設角色不能停用
- 並行：兩個 context 同時改同一角色的權限，記錄最後結果（是否 last-write-wins），並與舊版行為比對

**E2E**

- R5：開 TEST_ROLE_A → 搜尋權限 → 勾 2 個、取消 1 個 → 套用『日常』預設 → 儲存 → 出現變更摘要對話框，列出新增/移除 → 含高影響權限時再出現二次確認 → 確認 → 重新開啟後勾選狀態正確
- dirty 狀態下關閉視窗或切分頁時跳未儲存提示；選取消會留在原處
- 使用者區塊：輸入兩個員工編號（1 個有效、1 個無效）→ 新增 → 有效的出現、無效的顯示錯誤 → 狀態篩選『已到期』只顯示到期者 → 移除（確認）
- 編輯名稱與說明 → 儲存 → 清單同步更新

**對等驗證**

- 同一角色：GET /api/roles/<id>/permissions 與 /api/workspace/roles/<id>/permissions deep-equal；/users 亦同
- 相同操作序列（加 A、移除 B、套用日常）分別在舊 RoleEditClient 與 Roles.vue 執行（中間還原），比對 role_permissions 最終集合是否相同
- 變更摘要對話框列出的 added/removed 集合兩版相同；高影響確認是否觸發兩版相同
- 使用者清單三種狀態的筆數兩版相同

**測試資料**

- TEST_ROLE_A：含 1 個高影響權限、1 個資料範圍權限
- 4 位 test 使用者：有效、已到期（expires_at 昨天）、已停用、未指派（只有員工編號）
- R5、R6、R1

**風險**

- 變更摘要與高影響確認對話框在 Vue 中的完整度尚未驗證（Roles.vue:87-99、232）
- 擇一規則可能只在前端擋

## /admin/users

- 狀態：**done**（S）— Users.vue 與 app/api/workspace/users/route.ts 涵蓋清單、搜尋、統計、編輯(姓名/員編/部門/職稱)、相容角色變更、重置密碼、刪除(重用 deleteUser)、RBAC 有效權限詳情，並多了管理員直接新增使用者；權限與驗證規則與舊 actions 一致。
- 舊版：`app/admin/users/page.tsx + components/admin/UserManagementTable.tsx (941 行); app/auth/actions.ts (getAllUsers/updateUserProfile/deleteUser); app/api/admin/reset-password; app/api/admin/users/[id]/rbac`
- Vue：`vue-workspace/src/pages/Users.vue (706 行)`
- 權限：user.user.view、user.user.create、user.user.edit、user.user.delete、user.user.change_role、role.user_role.assign、role.user_role.revoke、（重置密碼：profiles.role === 'admin'）
- 相依：lib/admin/user-rbac-view.ts、Roles.vue（角色連結）

**舊版功能**

- 使用者統計卡：總數/管理員/主管/成員
- 搜尋姓名、郵件、員編
- 行內編輯姓名/員編/部門/職稱(員編唯一、大寫、不可空白)
- 快速升降級相容角色 admin/manager/member(確認；不可改自己)
- 重置使用者密碼(輸入≥6 字元，僅 admin，可複製)
- 刪除使用者(確認；不可刪自己；清除 auth 與關聯)
- 角色與有效權限詳情(RBAC)：有效權限搜尋、複製
- 連結到『角色權限管理』與『新增使用者(/register)』

**缺少或不同**

- 舊版『新增使用者』連到公開 /register（signUp 不帶 email_confirm）；Vue 改為管理員 action:'create'（auth.admin.createUser + email_confirm:true + profiles upsert，預設 member），行為不同但屬刻意設計 (users/route.ts POST)
- 舊版 /api/admin/reset-password 以 profiles.role==='admin' 判定；Vue 為 action:'reset' 同樣檢查 admin，一致
- Vue 新增列出 is_disabled/has_auth/is_dev_test_account 等欄位，舊版 getAllUsers 無，屬增強
- 舊版統計卡與 RBAC 詳情『複製有效權限』按鈕是否在 Vue 復刻，未逐項核對 (需 UI 測試)

**業務規則**

- （無）

**API**：舊 server actions getAllUsers/updateUserProfile/deleteUser (app/auth/actions.ts)、POST /api/admin/reset-password、GET /api/admin/users/[id]/rbac；新 GET/POST/PATCH/DELETE /api/workspace/users

**資料表**：profiles、auth.users、user_roles、roles、role_permissions、permissions

**既有測試**：scripts/test-workspace-users-api.py、scripts/test-workspace-users-ui.py

**待確認**

- 不同於舊版的 is_admin_compatibility 顯示邏輯是否一致，需 UI 測試確認。

### 測試案例

**冒煙**

- R1 開『使用者』分頁：Users.vue 清單與統計卡（總數/管理員/主管/成員）渲染，GET /api/workspace/users 回 200，console 沒有 error
- R6：看得到清單但沒有編輯、刪除、重置；R9 回 403（沿用 scripts/test-workspace-users-api.py 的斷言）；R12 回 401
- 搜尋姓名、Email、員工編號都能篩選

**單元**

- lib/admin/user-rbac-view.ts isDevTestAccount(email)：example.test 網域、大小寫、null
- lib/admin/user-rbac-view.ts isAdminLikeLegacyOrRole(profileRole,roleCodes)：role=admin、roleCodes 含 admin、兩者都沒有、null
- 員工編號正規化（大寫、trim、空白拒絕）：從 app/api/workspace/users/route.ts PATCH 抽成 normalizeEmployeeCode，並與 app/auth/actions.ts updateUserProfile 的規則用同一組輸入比對
- 統計卡計數 countByRole(users)：抽成純函式，和舊版 UserManagementTable 計算的結果比對
- 重置密碼長度驗證 ≥6：新舊共用同一組邊界值（5、6、512、513）

**整合**

- 沿用並擴充 scripts/test-workspace-users-api.py：匿名 401、錯誤 Origin 403、不能改自己的角色 400、不能刪自己 400、不合法 id 400、建立→編輯→改角色→重置密碼→用新密碼登入→刪除，最後原 ID 集合不變
- 重置密碼權限：R5（有 user.user.* 但 profiles.role≠admin）POST action=reset 要回 403，和舊版 /api/admin/reset-password 的判定一致
- 員工編號唯一：把 B 的編號改成 A 已用的 → 400/409；小寫輸入要存成大寫
- GET ?id=<uid> 的 RBAC 詳情：有效權限集合等於 GET /api/admin/users/<uid>/rbac
- 刪除使用者：profiles 與 auth.users 都移除，user_roles 連帶清除
- R10 store_manager 回 403（跨門市角色不能看全公司使用者）
- 並行：兩個 context 同時改同一使用者的不同欄位，記錄是否互相覆蓋（PATCH 是否只更新傳入的欄位）

**E2E**

- R1：新增使用者（Email、姓名、密碼）→ 清單出現且統計卡成員 +1 → 行內編輯姓名、員編（輸入小寫）、部門、職稱 → 儲存後員編顯示大寫 → 升級為 manager（確認）→ 統計卡主管 +1
- 重置密碼：輸入 5 個字元會被擋 → 輸入合格密碼 → 顯示可複製 → 另開瀏覽器用新密碼登入成功
- RBAC 詳情：打開後搜尋有效權限，複製按鈕若存在就驗證剪貼簿內容（若沒有，記錄為 accepted-diff）
- 對自己操作：降級和刪除按鈕要 disabled 或回錯誤
- 刪除：確認後清單消失、統計卡回復

**對等驗證**

- 同一 session：server action getAllUsers 的結果（透過舊頁抓表格，或直接用 service client 依相同查詢取得）與 GET /api/workspace/users 的 users，比對 {id,email,full_name,employee_code,department,job_title,role} deep-equal
- 對同一位 test 使用者用舊版 updateUserProfile 和 Vue PATCH 做相同的編輯（中間還原），profiles 列完全一致
- RBAC：/api/admin/users/<id>/rbac 與 Vue 詳情的有效權限碼集合相同
- 權限對等：R5、R6 在舊頁和新頁可見的操作按鈕集合一致
- 已知差異（Vue 由管理員直接建立帳號並設 email_confirm:true，舊版連到 /register）列為 accepted-diff

**測試資料**

- R1、R5、R6、R9、R10、R12
- 暫時使用者 vue-user-<token>@example.com（測試內建立、finally 刪除）
- 2 位帶員工編號的 test profile，用來測唯一衝突
- 1 位 is_disabled 使用者，1 位只有 profile 沒有 auth 的資料（has_auth=false）

**風險**

- is_admin_compatibility 的顯示邏輯和舊版可能不同
- 刪除使用者是不可逆的，一定要只刪測試內建立的帳號（斷言 target 不在 initial_ids）

## /login

- 狀態：**partial**（S）— Vue 登入畫面透過 /api/workspace/login 使用同樣的 Supabase signInWithPassword 與 resolveLoginEmail（帳號可用簡稱），登入後共用 session cookie（test-workspace-integration.py 已驗證）；但缺少舊版的『忘記密碼』『註冊』連結、依 ?redirect= 導向、門市數動態歡迎文字。
- 舊版：`app/login/page.tsx (161 行); app/auth/actions.ts signIn; lib/auth/dev-login.ts resolveLoginEmail`
- Vue：`vue-workspace/src/App.vue (login-layout 區塊 line ~372-410, login() line 165)`
- 權限：無（公開頁）
- 相依：forgot-password / register 頁面決策

**舊版功能**

- Email/密碼登入，DEV 環境帳號簡稱解析
- 登入成功後依 ?redirect= 安全導向(僅限站內路徑)
- 動態文案：正在同步 N 間門市（讀取 stores 啟用數）
- 連結：忘記密碼、註冊帳號
- 錯誤訊息顯示與載入中狀態
- DEV 環境標示 (isDevLogin)

**缺少或不同**

- Vue 登入頁無『忘記密碼』與『註冊』入口連結 (App.vue login-panel 區塊僅表單)
- Vue 無 ?redirect= 導向邏輯（hash router，登入後回到 '/'）
- Vue 無門市數動態文案（純視覺差異）
- Vue 登入 API 對失敗一律回『帳號或密碼不正確，或帳號暫時無法登入』，舊版回 Supabase 原錯誤訊息，訊息不一致
- 舊版 signIn 可能含 profile/最後登入處理，需核對 app/auth/actions.ts:43-65 與 workspace login route 差異

**業務規則**

- （無）

**API**：舊 server action signIn、Supabase auth signInWithPassword；新 POST /api/workspace/login、POST /api/workspace/logout、GET /api/workspace/session

**資料表**：auth.users、profiles、stores (僅計數)

**既有測試**：scripts/test-workspace-integration.py (登入承接舊站 session)、scripts/test-vue-workspace.py、scripts/test-vue-workspace-recovery.py

**待確認**

- signIn 內是否有額外副作用（例如更新 last_sign_in）未完整讀完 actions.ts 43-65 行。

### 測試案例

**冒煙**

- 未登入開工作台根路徑：顯示登入面板（App.vue login-layout），console 沒有 error
- DEV 環境：輸入 administrator 加 WORKSPACE_TEST_PASSWORD 登入成功，GET /api/workspace/session 回 user
- 登入後重新整理仍維持登入；登出後 /api/workspace/session 回未登入

**單元**

- lib/auth/dev-login.ts resolveLoginEmail：在 NEXT_PUBLIC_SUPABASE_URL=https://mjpdfpxqttbhzeimmtqr.supabase.co 時，'administrator'、' Administrator ' 轉成 administrator@example.test；其他 host、無效 URL、空字串一律原樣（trim）回傳
- 舊版 app/login/page.tsx:43-47 的 safeRedirect 邏輯：抽成 safeRedirectPath(raw)，測 '/admin'→'/admin'、'//evil.com'→fallback、'https://evil'→fallback、null→fallback；Vue 若補 redirect 功能要共用這個函式
- 登入輸入驗證（workspace login route）：email 長度上限 254、password 上限 512、非字串 → 400

**整合**

- POST /api/workspace/login：正確帳密 200 並設 cookie；錯誤密碼 401，訊息是『帳號或密碼不正確，或帳號暫時無法登入』；缺欄位或非字串 400；email 255 字元 400；Origin 錯誤 403
- 停用帳號 R11 登入：記錄新舊版本的回應（舊版回 Supabase 原始訊息，新版統一訊息）
- session 互通：用舊版 signIn（/login 頁）登入後，/api/workspace/session 有效；反過來，Vue 登入後開舊頁 /admin/users 不會被導回 /login（沿用 test-workspace-integration.py）
- POST /api/workspace/logout 後，舊站頁面也變成未登入
- 暴力測試：連續 10 次錯誤密碼，記錄 Supabase rate limit 行為（不要在正式環境做）

**E2E**

- 未登入 → 輸入錯誤密碼 → 顯示錯誤訊息，按鈕回到可用 → 輸入正確 → 進入工作台首頁並顯示使用者名稱
- 按登入時有載入狀態（按鈕 disabled），不能重複送出
- 若實作 ?redirect：開 /#/work/<id> 未登入 → 登入後回到原分頁；redirect=//evil.com 時回到 '/'
- 若補上『忘記密碼』『註冊』連結：點擊後導到對應頁面

**對等驗證**

- 同一帳號分別用舊 /login 和 Vue 登入，取得的 Supabase session 使用者 id 相同，GET /api/workspace/session 的 capabilities 集合完全相同
- 錯誤情境對照表（錯誤密碼、不存在帳號、停用帳號、空白）：記錄兩版的 HTTP 狀態和訊息；訊息不同屬於已知差異，但兩邊都要「失敗」
- DEV 簡稱 administrator 兩版都能登入
- 已知差異：redirect、門市數文案、忘記密碼/註冊連結 → 列為 accepted-diff 或待補，需產品決策

**測試資料**

- administrator（DEV）、R9、R11 停用帳號
- 不存在帳號 nobody-<t>@example.test

**風險**

- Vue 沒有 redirect，深連結的使用者登入後會失去上下文
- 錯誤訊息統一雖然較安全，但和舊版不一致

## /register

- 狀態：**missing**（S）— Vue 無自助註冊頁；僅 Users.vue 提供管理員建立使用者。公開自助註冊（supabase.auth.signUp，需信箱驗證）無對應 Vue 實作。需產品決策是否仍保留公開註冊。
- 舊版：`app/register/page.tsx (169 行); app/auth/actions.ts signUp`
- Vue：（無）
- 權限：無（公開頁）
- 相依：login 頁連結、Supabase 信箱驗證/redirect 設定

**舊版功能**

- 註冊表單：姓名、Email、密碼、確認密碼
- 驗證：密碼一致、長度≥6
- 呼叫 signUp(auth.signUp，user_metadata.full_name)
- 成功後導向 /login
- 錯誤訊息顯示

**缺少或不同**

- 完全缺少 Vue 頁面與 workspace API（app/api/workspace 下無 register）
- 管理員替代流程 Users.vue 新增使用者 email_confirm:true 且不寄驗證信，與公開註冊的信箱驗證流程不同

**業務規則**

- （無）

**API**：舊 server action signUp；新 —

**資料表**：auth.users、profiles (由 trigger 建立，uncertain)

**既有測試**：—

**待確認**

- 是否仍需開放公開註冊（內部系統可能僅允許管理員建立）；profiles 是否由 DB trigger 在註冊時建立未驗證。

### 測試案例

**冒煙**

- （實作或決策後）未登入開註冊頁：表單（姓名、Email、密碼、確認密碼）渲染，console 沒有 error
- 已登入的使用者開註冊頁：記錄行為（舊版不會擋）
- 若產品決定不提供公開註冊：驗證 Vue 沒有入口，而且舊 /register 的處理（保留或導向）符合決策

**單元**

- 註冊表單驗證 validateRegister({fullName,email,password,confirm})：密碼 <6（app/register/page.tsx:29）、兩次不一致、Email 格式錯、姓名空白；新舊版用同一組 fixture 比對錯誤種類

**整合**

- （若新增 POST /api/workspace/register）成功時 auth.users 新增一筆，user_metadata.full_name 正確，profiles 由 trigger 或程式建立（要驗證是否存在，目前 uncertain）；重複 Email 回錯誤；密碼 <6 回 400；Origin 錯誤 403
- Email 驗證：使用 admin API 確認新帳號是 email_confirmed_at=null（和舊版 signUp 一致），驗證前不能登入（依 Supabase 設定，記錄結果）
- 清理：用 service role 刪除 reg-<t>@example.test

**E2E**

- 填表 → 密碼不一致時顯示錯誤 → 修正後送出 → 顯示成功並導向登入頁
- 同一 Email 再註冊一次要顯示錯誤

**對等驗證**

- 舊版 signUp 與 Vue 註冊各建一個帳號（reg-old/reg-new），比對 auth.users（email_confirmed_at、user_metadata）與 profiles 列（role 預設值、full_name），除了 id 和 email 以外相同
- 驗證錯誤種類對照表兩版相同

**測試資料**

- 暫時帳號 reg-old-<t>@example.test、reg-new-<t>@example.test（finally 以 service role 刪除）
- 1 個已存在的 Email，用來測重複

**風險**

- 產品可能決定取消公開註冊，要先問清楚
- DEV 的 Supabase 若開啟 email confirm，會實際寄信到 example.test（無害，但要確認 SMTP 設定）

## /forgot-password

- 狀態：**missing**（S）— Vue 無忘記密碼頁與 API；登入面板也沒有入口。
- 舊版：`app/forgot-password/page.tsx (144 行); app/auth/actions.ts requestPasswordReset`
- Vue：（無）
- 權限：無（公開頁）
- 相依：/reset-password、app/auth/callback、NEXT_PUBLIC_SITE_URL 設定

**舊版功能**

- 輸入 Email 送出重置郵件
- redirectTo = NEXT_PUBLIC_SITE_URL/auth/callback?next=/reset-password
- 成功/失敗訊息顯示
- 返回登入連結

**缺少或不同**

- 完全缺少 Vue 頁面與 workspace API
- 重置信連結導向 /auth/callback?next=/reset-password（舊站路由），Vue 版需決定回到舊頁或新增 Vue 重設頁及 callback

**業務規則**

- （無）

**API**：舊 server action requestPasswordReset、app/auth/callback route；新 —

**資料表**：auth.users

**既有測試**：—

**待確認**

- DEV 環境是否能真實寄信/取得 token；E2E 需 mock 或用 admin generateLink。

### 測試案例

**冒煙**

- （實作後）未登入開忘記密碼頁：Email 輸入框與返回登入連結渲染，console 沒有 error
- 登入面板有『忘記密碼』入口（若決策要補）

**單元**

- redirectTo 組成函式 buildResetRedirect(siteUrl)：結果要是 `${NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password`，或 Vue 版的對應路徑；siteUrl 結尾有斜線時不能出現雙斜線

**整合**

- （若新增 POST /api/workspace/password/forgot）合法 Email 回 200；不存在的 Email 也回 200（避免帳號列舉，記錄舊版行為是否如此）；格式錯誤回 400；Origin 錯誤 403
- 用 service role 的 auth.admin.generateLink({type:'recovery'}) 取得連結，檢查 redirect_to 參數和舊版 requestPasswordReset 相同
- 頻率限制：短時間重送，記錄 Supabase 回應

**E2E**

- 輸入 test 帳號 Email → 送出 → 顯示成功訊息 → 返回登入連結可用
- 輸入錯誤格式 → 顯示錯誤

**對等驗證**

- 同一 Email 分別在舊頁和新頁送出，攔截 Supabase /auth/v1/recover 請求，比對 body 的 email 和 redirect_to
- 成功與失敗訊息種類兩版一致

**測試資料**

- R9 帳號 Email
- 不存在帳號 Email

**風險**

- DEV 是否會真的寄信不確定；E2E 要用 generateLink 或攔截請求，不要依賴收信
- callback 目前是舊站路由，跨站流程要先決定

## /reset-password

- 狀態：**missing**（M）— Vue 無重設密碼頁。
- 舊版：`app/reset-password/page.tsx (428 行); app/auth/actions.ts resetPassword; app/auth/callback`
- Vue：（無）
- 權限：無（需有效重設 session）
- 相依：/forgot-password、app/auth/callback

**舊版功能**

- 驗證 URL error 參數與 session 是否有效（getSession），失效顯示錯誤
- 新密碼 + 確認密碼輸入，顯示/隱藏密碼
- 密碼強度指示(長度≥8/≥12 等計分)
- 驗證長度≥6、兩次一致
- 呼叫 supabase.auth.updateUser，成功後延遲導向 /login
- 錯誤處理

**缺少或不同**

- 完全缺少 Vue 頁面與 API
- 需處理重設連結的 session exchange（app/auth/callback）

**業務規則**

- （無）

**API**：舊 server action resetPassword、GET app/auth/callback；新 —

**資料表**：auth.users

**既有測試**：—

**待確認**

- 密碼強度指示的完整規則僅讀到部分 (reset-password/page.tsx:90-91)。

### 測試案例

**冒煙**

- （實作後）帶有效 recovery session 開重設頁：兩個密碼欄位和強度指示渲染，console 沒有 error
- 沒有 session，或 URL 帶 error 參數：顯示連結失效的錯誤畫面

**單元**

- 密碼強度計分 passwordStrength(pw)（app/reset-password/page.tsx:80-110）：長度 ≥8 +1、≥12 +1、含數字 +1、含小寫 +1、含大寫 +1、含特殊字元 +1；空字串 score 0。Vue 版要抽成共用函式，並用 10 組字串和舊版結果比對（含評級文字）
- validateNewPassword(pw,confirm)：<6、不一致、合格

**整合**

- 以 auth.admin.generateLink({type:'recovery',email}) 取得 token → 走 /auth/callback（或 Vue 版的 callback）換 session → updateUser 新密碼 → 用新密碼 POST /api/workspace/login 成功，舊密碼回 401
- 過期或重複使用的 token 回錯誤
- 沒有 session 直接呼叫更新 API 要回 401
- 清理：測試結束後用 service role 把 R9 密碼還原成 WORKSPACE_TEST_PASSWORD（或使用暫時帳號）

**E2E**

- 從 generateLink 的 URL 進入 → callback → 重設頁 → 輸入弱密碼時強度顯示低 → 輸入不一致時顯示錯誤 → 合格密碼送出 → 成功訊息 → 延遲後導向登入頁 → 用新密碼登入成功
- 顯示/隱藏密碼按鈕切換 input type
- 失效連結進入時顯示錯誤，並提供重新申請的入口

**對等驗證**

- 同一組 10 個密碼字串，在舊頁和新頁輸入，擷取強度分數與文字做比對
- 在兩個暫時帳號上分別走舊流程和新流程，最終都能用新密碼登入，auth.users.updated_at 有更新
- 錯誤情境（無 session、過期 token、不一致、太短）兩版結果種類相同

**測試資料**

- 暫時帳號 reset-<t>@example.test（測試內建立、finally 刪除），避免動到共用帳號
- service role 用來 generateLink

**風險**

- session exchange 依賴 /auth/callback 舊站路由；Vue hash router 不適合承接 recovery token fragment
- 有 E2E 改到共用帳號密碼的風險，一律使用暫時帳號

## 領域測試備註

【測試環境基準（實際讀碼確認）】
- DEV 連線：.env.development.local 內含 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / EXPECTED_SUPABASE_PROJECT_REF / ALLOW_DEV_DATABASE_OPERATIONS。lib/auth/dev-login.ts 寫死 DEV 專案 host 為 mjpdfpxqttbhzeimmtqr.supabase.co，只有在這個 host 下 'administrator' 才會轉成 administrator@example.test。所有寫入 DB 的測試腳本開頭都要加防呆：比對 NEXT_PUBLIC_SUPABASE_URL 的 host 等於 EXPECTED_SUPABASE_PROJECT_REF，而且 ALLOW_DEV_DATABASE_OPERATIONS 必須是 true，否則立即中止。
- 既有測試慣例（scripts/test-workspace-users-api.py）：base 為 http://localhost:3002，使用 Playwright request context，Header 帶 Origin=B（checkOrigin 會擋掉其他 Origin，回 403），密碼取自環境變數 WORKSPACE_TEST_PASSWORD；暫時資料用 uuid token 命名，在 finally 清除，最後確認原本的 ID 集合沒變。新測試一律沿用這套模式，結果寫到 .tmp-check/。
- 單元測試：專案目前沒有 vitest/jest 設定（uncertain，實作前要先查 package.json）。建議 Sonnet 用 node --test 搭配 tsx（或 vitest），測試檔放在 scripts/unit/ 或 tests/unit/，只 import 純函式。
【角色矩陣（各頁共用，以 test- 前綴建立 DEV 帳號，並綁 user_roles）】
R1 admin（administrator，profiles.role=admin）；R2 org_manager（organization.* 全部 view+manage）；R3 org_viewer（只有 organization.organization.view、department.view、department_workspace.view、member.view、manager.view）；R4 dept_ws_manager（department_workspace.manage，沒有 department.edit）；R5 rbac_admin（role.* 全部 + user.user.*，但 profiles.role 不是 admin，用來驗證重置密碼只看 profiles.role）；R6 rbac_viewer（role.role.view、role.permission.view、role.user_role.view、user.user.view）；R7 calendar_editor（organization.calendar.company.create/edit）；R8 holiday_admin（organization.calendar.holiday.manage + google.manage）；R9 plain_member（無任何權限，只能登入）；R10 store_manager（store_manager 角色，綁門市 A；用來跨門市驗證這些總部頁不會因為門市權限被放行）；R11 停用帳號（is_disabled）；R12 匿名。本領域屬總部功能，沒有門市範圍；跨門市案例改成驗證「門市角色不能取得總部資料」，以及「部門 A 主管不能修改部門 B」（如果後端有部門範圍；沒有就標 uncertain，以實測結果為準）。
【對等證明方法】同一份 DEV 資料、同一個角色，舊版和新版都要操作一次：(1) API 對等：用同一個 cookie 打舊 API（/api/organization/units、/api/roles/*、/api/admin/users/[id]/rbac、server action 結果頁）和新 API（/api/workspace/*），把 id、名稱、parent、排序、狀態、成員、主管、權限碼集合正規化後做 deep-equal；(2) DB 對等：舊版做一次操作 → 快照受影響的資料表 → 還原 → 新版做同一個操作 → 再快照，比對兩份快照時排除 updated_at、request_id 等欄位；(3) 畫面對等：兩邊都在 1920×1080 下擷取清單資料（文字），比對筆數與欄位。
【共通風險】Roles.vue、Users.vue、Organization*.vue 是單行壓縮程式碼，測試以 UI 行為和 data-* 選擇器為主，不要依賴讀碼；App.vue 第 ~221 行的權限三元式在新增頁面時容易出錯，每頁 smoke 都要跑完整角色矩陣的導覽可見性；行事曆和 forgot/reset/register 目前沒有 Vue 版，下列案例是「實作後」的驗收規格，實作前可以先對舊版跑同一套案例來建立基準（golden）。

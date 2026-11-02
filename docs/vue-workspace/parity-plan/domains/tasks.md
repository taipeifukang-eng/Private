# 任務派發與首頁儀表板

## 領域共用缺口

- 缺少 workspace 的「刪除」能力：刪除流程模板（legacy deleteTemplate，權限 task.template.delete 或建立者）與刪除已完成指派（deleteAssignment）；需新增 API route、DEV SQL RPC（supabase/workspace-dev）與前端確認 Modal。
- 存取範圍差異待決策：legacy /assignment/[id] 允許 admin/manager 開啟非協作者任務，lib/workspace/tasks.ts taskDetail 明確只允許協作者；legacy /admin/template/[id] 使用 getAssignments（僅本人為協作者的指派）與 Vue 的 templateAssignments（範本全部現行指派）也不同。
- /my-tasks 的去重（template_id+department+section）與進度以區段步驟計算，和 legacy 全範本計算不同，需用同一份測試資料做新舊對照。
- 首頁與 /dashboard 沒有任何 workspace 聚合 API；首頁需要新增 /api/workspace/home（我的任務、獎金明細、新人入職、壽星、年費與換照提醒、調店待確認數），並在 session capabilities 加 dashboard／home 相關旗標。
- lib/workspace/navigation.ts 的「儀表板」項目無 kind，仍連回舊站頁面。
- 測試現況：scripts/test-workspace-task-*.py（Playwright）與 *.cjs（交易、並行）已覆蓋 tasks、archive、dispatch、template、management；首頁、儀表板、刪除、統計卡完全沒有測試。尚缺新舊版同資料對照（parity）測試與單元測試（lib/workspace/task-state.ts、task-template.ts、task-schedule.ts 沒有專屬 *.test.ts，專案內亦未找到）。
- 文件自評過時：docs/vue-workspace/full-migration-checklist.md 的 /dashboard 為「待逐項盤點」，/my-tasks 為「尚待空資料／失敗分支驗收」，與程式碼狀態需以本報告為準。
- 共用元件：TaskSchedule.vue（甘特排程）與 AssignmentGanttModal.tsx 的等價性、TaskStepFields.vue、Modal.vue 皆屬跨頁相依，變更時需同步回歸 TaskRunner／TaskManagementDetail／TaskTemplateEditor。
- legacy 任務動作多處未檢查 task.manage（createTemplateV2 僅檢查登入；updateTemplateV2、archiveAssignment、deleteAssignment 檢查 task.template.edit/delete），Vue 以 taskManagementScope 統一限制為 admin 或（task.manage 且 role=manager），權限比 legacy 嚴格，需確認是否為預期差異。

## /admin/templates

- 狀態：**partial**（M）— Vue 已有任務範本列表、複製、批次封存，但缺少「刪除流程模板」與「刪除已完成任務」兩項破壞性操作，且卡片統計與選單行為不同。
- 舊版：`app/admin/templates/page.tsx + components/admin/TemplateCardWithStats.tsx + app/actions.ts(getTemplates/getAllAssignments/deleteTemplate/duplicateTemplate/archiveAssignment/deleteAssignment)`
- Vue：`vue-workspace/src/pages/TaskManagement.vue`、`vue-workspace/src/pages/TaskManagementDetail.vue`、`vue-workspace/src/pages/TaskDispatch.vue(copy 模式)`
- 權限：task.manage（Navbar/session 入口）、task.template.delete（封存、刪除）、task.template.edit（編輯範本）、profiles.role = admin / manager（資料範圍：admin 全部，其他僅 created_by = 本人）
- 相依：TaskManagementDetail.vue、TaskDispatch.vue、lib/workspace/task-management.ts、需新增 workspace 刪除範本／刪除已完成指派 API 與 DEV SQL RPC（supabase/workspace-dev）

**舊版功能**

- 列出範本卡片：只顯示有未封存指派的範本（templatesWithActiveAssignments）；非 admin 僅見自己建立的範本（getTemplates 依 created_by 過濾）
- 卡片資訊：標題、描述、步驟數、建立日期、指派總數、待處理/進行中/已完成人數、整體完成進度條；無指派時顯示「尚未指派任何任務」
- 右上角選單：編輯（/admin/edit/[id]）、複製流程（prompt 輸入新標題，呼叫 duplicateTemplate）
- 選單：封存已完成任務（需所有指派進度 100%，逐筆 archiveAssignment，回報成功/失敗數）
- 選單：刪除已完成任務（逐筆 deleteAssignment，confirm 確認）
- 選單：刪除流程模板（deleteTemplate，confirm 確認；需 task.template.delete 或為建立者）
- 卡片按鈕：指派（/admin/assign/[id]）、查看詳情（/admin/template/[id]）
- 頁首「建立新任務」按鈕、空狀態畫面（目前沒有進行中的任務）

**缺少或不同**

- 缺：刪除流程模板。app/api/workspace/task-management/route.ts 與 task-template/route.ts 皆無 DELETE；grep 'delete' 於 TaskManagement*.vue 與 app/api/workspace/task* 無結果
- 缺：刪除已完成任務（legacy deleteAssignment / DeleteAssignmentButton）。workspace 無對應 API 或 RPC
- 不同：Vue 列表只顯示現行指派數、完成項目/全部項目、完成指派數，沒有 legacy 的待處理/進行中/已完成分項計數、步驟數、建立日期（TaskManagement.vue 欄位）
- 不同：legacy 封存為逐筆呼叫 archiveAssignment；Vue 為單一 RPC workspace_archive_template_tasks 整批封存，並以 sha256 hash 與 workspaceVersion 做冪等和衝突檢查（行為更嚴謹但語意為全部或全無，需 E2E 驗證同結果）
- 不同：legacy 封存權限檢查 task.template.delete；Vue taskManagementScope.canArchive = admin 或 task.template.delete（一致），但 Vue 列表入口需 admin 或（task.manage 且 profile.role=manager），legacy 頁面本身無此角色檢查（只靠 Navbar 的 task.manage 與 getTemplates 的 created_by 過濾）
- 不同：複製範本在 legacy 是 prompt 輸入標題；Vue 為 TaskDispatch 獨立頁籤＋確認 Modal，並沿用最新現行指派協作者與區段（Vue 行為較豐富，需確認與 duplicateTemplate 資料結果一致）

**業務規則**

- （無）

**API**：舊 app/actions.ts: getTemplates、getAllAssignments、duplicateTemplate、archiveAssignment、deleteAssignment、deleteTemplate；新 GET/POST /api/workspace/task-management、GET/POST /api/workspace/task-dispatch、RPC workspace_archive_template_tasks、RPC workspace_dispatch_task

**資料表**：templates、assignments、assignment_collaborators、logs、profiles

**既有測試**：scripts/test-workspace-task-management.py、scripts/test-workspace-task-archive-action-concurrency.cjs、scripts/test-workspace-task-copy-concurrency.cjs、scripts/test-workspace-task-close.py

**待確認**

- duplicateTemplate（app/actions.ts 1684 起）實際複製的資料欄位與 workspace RPC 是否逐欄一致，未逐行比對 SQL
- legacy 卡片 completionRate 在無步驟時的邊界行為未驗證

### 測試案例

**冒煙**

- admin_role、manager_owner 登入後開 /workspace/index.html，點「任務管理 新版」，TaskManagement.vue 的列表要渲染出至少 1 列 ZZTEST 範本，不可停在 loading；page.on('console') 收不到 error、page.on('pageerror') 為 0
- GET /api/workspace/task-management 回 200，records 是陣列，每筆含 id、title、workspace_version
- 導覽可見性矩陣（依 lib/workspace/navigation.ts＋session capabilities）：admin_role、manager_owner 看得到「任務管理」；member_a、denied 看不到；non_manager_with_manage 看得到入口，但 API 回 403，畫面要顯示錯誤訊息而不是白畫面
- 舊版 /admin/templates 用同一個 manager_owner 開啟，HTTP 200 且有卡片（給 parity 做基準）
- DEV 沒有任何指派時顯示空狀態文字，不可出現 JS error（用 manager_other 測，他沒有自己的範本）

**單元**

- lib/workspace/task-state.ts flattenTaskSteps：輸入主項含 subSteps，輸出依「主項、子項…、下一主項」順序展平；空陣列回空陣列
- lib/workspace/task-state.ts taskState：complete 後 uncomplete 會移除；相同 created_at 依 id 排序決定最後狀態；complete 的 note 是 null 時存成 ''；輸入順序打亂結果不變
- 新抽的純函式（建議放 lib/workspace/task-management.ts，例如 summarizeTemplateCard(assignments, logs, steps)）：計算指派總數、pending/in_progress/completed 分項計數與整體完成率；邊界情況包含 0 步驟（舊版 completionRate 分母為 0 → 期望 0%，不可出現 NaN）、0 指派、全部完成 100%
- canArchive 判定的純函式化（從 taskManagementScope 抽出 (isAdmin, role, caps) => {all, canArchive} 或 403）：涵蓋 admin、manager+delete、manager 沒有 delete、member 有 task.manage → throw 403 這幾個矩陣

**整合**

- 角色矩陣 GET /api/workspace/task-management：admin_role 回 200 且看到全部 ZZTEST 範本（包含 manager_owner 和 manager_other 建立的）；manager_owner 回 200，只看到 created_by=本人；manager_other 看不到 manager_owner 的範本；member_a 回 403（缺 task.manage）；non_manager_with_manage 回 403，訊息「只有管理員或主管可管理任務」；denied 回 403；未登入回 401
- GET ?id=<manager_owner 的範本> 用 manager_other 打，回 404「找不到可管理的任務範本」（跨範圍）
- 封存（POST，RPC workspace_archive_template_tasks）：manager_owner 有 task.template.delete，所有指派 100% 時成功，assignments.archived=true、archived_by=本人；manager_readonly 沒有 delete 權限 → 403；有任一指派未 100% → 4xx，且 DB 完全沒變（全部成功或全部不做）
- 並行與冪等：沿用 scripts/test-workspace-task-archive-action-concurrency.cjs 的模式，同一個 writeId 重送 → 結果相同且不重複寫入；相同 writeId 但 payload 不同 → 409；舊的 workspace_version → 409；兩個 context 同時封存 → 只有一個成功
- 複製（POST /api/workspace/task-dispatch copy 模式）：新 template 的 title 等於輸入值、steps_schema/sections 和原範本 deep-equal、created_by=操作者；同一個 writeId 重送不產生第二份（沿用 scripts/test-workspace-task-copy-concurrency.cjs）
- 【spec-first，需先開發】DELETE 範本：建立者或 task.template.delete 有權 → templates 列被刪除、相關 assignments 依舊版 deleteTemplate 行為處理（要先讀 app/actions.ts deleteTemplate 確認是 cascade 還是被擋）；manager_readonly 回 403；跨範圍回 404；範本已有 in_progress 指派時的行為要和舊版一致
- 【spec-first】刪除已完成指派：只能刪 status=completed 的指派；pending 或 in_progress → 4xx；連帶的 logs、assignment_collaborators 依舊版 deleteAssignment 結果處理
- 錯誤路徑：title 空字串、title 超長、id 不是 uuid → 400；範本已被刪除再封存 → 404

**E2E**

- manager_owner：進任務管理 → 列表找到「ZZTEST-TASK-全完成範本」→ 點封存 → 確認 Modal → 出現成功訊息 → 列表移除該範本 → 進「已封存任務 新版」能找到
- manager_owner：複製範本 → 在 TaskDispatch copy 頁籤輸入新標題 → 確認 Modal → 列表出現新標題（沒有指派時依舊版規則可能不顯示，要和 D 決策對齊）→ 開編輯器內容與原範本相同
- manager_owner：點列表列 → 進 TaskManagementDetail → 返回列表，篩選與捲動位置維持（或至少不報錯）
- 【spec-first】manager_owner：刪除範本 → confirm Modal 取消時不刪 → 再次刪除並確認 → 列表消失、DB 已無該列
- manager_readonly：列表看不到封存、刪除按鈕（或按鈕 disabled），用 page.request 直接打 API 也回 403
- 手機 viewport 390x844：列表沒有水平溢出（document.documentElement.scrollWidth<=innerWidth），截圖存 .tmp-check/task-management-mobile.png

**對等驗證**

- 同一個 manager_owner 和 admin_role：舊版 /admin/templates 用 DOM 擷取卡片標題集合，新版用 API records 的 title 集合；兩個集合要相等（舊版只顯示有未封存指派的範本，新版需要套同樣規則，否則列為差異）
- 每張卡片的指派總數、已完成人數、整體完成率：舊版 DOM 數字和新版欄位逐一比對；待處理、進行中分項計數若新版沒有顯示，列為 missing
- 封存結果 parity：fixture 複本 A 用舊版 UI 選單「封存已完成任務」，複本 B 用新版封存；抽 assignments(archived, archived_by, archived_at 是否非 null) 正規化後相等
- 複製結果 parity：舊版 duplicateTemplate（prompt 輸入標題）和新版 copy 對同一個來源範本各做一次；比對新 templates 的 title、description、steps_schema、sections、created_by，以及有沒有產生 assignments/collaborators。新版沿用協作者是已知差異，要逐欄記錄
- 【spec-first】刪除範本、刪除指派：舊版和新版各自在複本上執行後，抽 templates、assignments、collaborators、logs 的殘留列數要相同

**測試資料**

- templates：ZZTEST-TASK-全完成範本（manager_owner 建立，2 個指派都 100%）、ZZTEST-TASK-進行中範本（1 pending、1 in_progress、1 completed）、ZZTEST-TASK-無步驟範本（steps_schema=[]，測 completionRate 邊界）、ZZTEST-TASK-他人範本（manager_other 建立）、ZZTEST-TASK-已封存範本（所有指派 archived=true，舊版不應顯示）
- 每個範本各準備 A、B 兩份結構相同的複本（給寫入 parity）
- logs：用 complete、uncomplete 交錯，包含相同 created_at 的情況
- 帳號：admin_role、manager_owner、manager_other、manager_readonly、non_manager_with_manage、member_a、denied
- 沿用 scripts/seed-workspace-task-management-dev.cjs，擴充上述資料

**風險**

- Vue 封存是全部成功或全部不做，舊版是逐筆封存可能部分成功；某筆失敗時結果不同
- 刪除功能尚未實作，舊版 deleteTemplate 的 cascade 行為還沒讀清楚，可能造成資料遺失
- 權限比舊版嚴格（D5），可能讓舊版能用的人在新版被擋

## /admin/template/[id]

- 狀態：**partial**（M）— Vue 管理明細可看範本、各指派進度、協作者、逐項狀態與執行軌跡並可複製／派發／編輯／封存，但缺少刪除已完成指派，且資料範圍與呈現方式不同。
- 舊版：`app/admin/template/[id]/page.tsx + components/admin/DeleteAssignmentButton.tsx`
- Vue：`vue-workspace/src/pages/TaskManagementDetail.vue`
- 權限：task.manage、task.template.edit（編輯按鈕）、task.template.delete（封存／刪除）、role admin/manager
- 相依：TaskManagement.vue、TaskSchedule.vue、TaskDispatch.vue、TaskTemplateEditor.vue

**舊版功能**

- 僅 admin/manager 可進入，否則導回首頁；範本不存在顯示「流程不存在」並可返回
- 範本標題、描述、建立時間、步驟數量
- 流程步驟清單（序號、名稱、描述）
- 按鈕：指派任務給使用者（/admin/assign/[id]）、返回列表
- 已指派任務清單：狀態徽章（待處理/進行中/已完成）、協作人數與協作成員名單、完成進度條（含子步驟計算）、指派日期、預計時程
- 每筆指派「查看詳情」連到 /assignment/[id]；已完成者可「刪除」（DeleteAssignmentButton，confirm，僅 completed 可刪）
- 無指派時顯示「立即指派」

**缺少或不同**

- 缺：刪除已完成指派按鈕（DeleteAssignmentButton 對應 deleteAssignment，需 task.template.delete）；Vue 無任何 delete 路徑
- 缺：Vue 明細不顯示建立時間／步驟總數的摘要區，也沒有指派當下的預計時程文字（只有 TaskSchedule 甘特元件於 details 內，uncertain 是否含預計日期顯示）
- 不同：Vue 不連到 /assignment/[id] 的任務執行頁，而是展開逐項狀態表＋備註＋執行時間軌跡（legacy 只在 assignment 頁看軌跡）
- 不同：Vue 的權限為 taskManagementScope（admin 或 task.manage+role=manager，且非 admin 限 created_by=本人）；legacy 頁僅檢查 role in (admin, manager)，且 getTemplates 對 manager 同樣依 created_by 過濾（一致）
- 不同：Vue 以樂觀版本 workspace_version 取得資料並在不一致時回 409；legacy 無版本控制
- 不同：legacy 狀態來自 assignments.status 欄位；Vue 以 logs 重算完成數與「所有項目已完成」文字，狀態欄位未直接顯示 pending/in_progress

**業務規則**

- （無）

**API**：舊 app/actions.ts: getTemplates、getAssignments、deleteAssignment；新 GET /api/workspace/task-management?id=、POST /api/workspace/task-management(封存)

**資料表**：templates、assignments、assignment_collaborators、logs、profiles

**既有測試**：scripts/test-workspace-task-management.py、scripts/test-workspace-task-schedule.cjs、scripts/test-workspace-task-close.py

**待確認**

- legacy getAssignments 回傳的是『本人為協作者』的指派而非範本全部指派，因此 legacy 詳情頁對非協作者的 admin 可能看不到指派（getAssignments line 622-700 以 assignment_collaborators 過濾）；Vue 用 templateAssignments 全量，行為與 legacy 實際不同，需決定以哪一個為準

### 測試案例

**冒煙**

- manager_owner 從任務管理列表點進 TaskManagementDetail，顯示範本標題、各指派進度、協作者名單，console 沒有 error
- GET /api/workspace/task-management?id=<id> 回 200，含 template、assignments（各自有 logs、collaborators）、workspace_version
- 不存在的 id 回 404，畫面顯示錯誤，不可白畫面；舊版顯示「流程不存在」
- member_a 直接用 hash 路由進明細 → 顯示權限錯誤（API 403）

**單元**

- lib/workspace/task-schedule.ts taskSchedule：沒有 sections 時 fallback 成單一 'main' 區段（department=record.department 或 '未分部門'）；子項標成 sub:true；日期非法（2026-02-30、'abc'、數字）會被忽略；planned_start 晚於 end 的處理；週起點對齊週一（monday()）
- 單一指派的進度計算（建議抽成 lib/workspace/task-management.ts 的 assignmentProgress(steps, logs)，從 templateAssignments 內移出）：含子步驟時分母等於 flattenTaskSteps 的長度；全部完成時狀態文字為「所有項目已完成」
- 舊版 status 徽章對照函式 statusLabel(status)：pending→待處理、in_progress→進行中、completed→已完成（新版若要補徽章時使用）

**整合**

- 角色矩陣 GET ?id=：admin_role 看任何範本都回 200；manager_owner 看自己的回 200；manager_other 看 manager_owner 的回 404；manager_readonly 回 200 但回應中 canArchive=false；member_a、denied 回 403
- assignments 的範圍：admin_role 不是協作者時，新版回傳範本全部未封存指派（templateAssignments）；舊版 getAssignments 只回本人協作的指派（D4，記錄差異）
- 版本衝突：取得 workspace_version 後，另一個 context 改了 logs → 用舊版本 POST 封存回 409
- 超過 200 筆指派的分批（templateAssignments 每批 200）：seed 205 筆指派，logs 和 collaborators 的筆數要完整
- 【spec-first】刪除已完成指派 API：completed 的回 200；in_progress 的回 4xx；沒有 task.template.delete 回 403；並行重複刪除 → 一次成功、一次 404

**E2E**

- manager_owner：明細 → 展開某指派的逐項狀態表，看到備註與執行時間軌跡 → 點「查看甘特排程」，TaskSchedule 顯示各區段
- manager_owner：明細 → 派發 → 進 TaskDispatch task-assign 模式並帶入正確範本
- manager_owner：明細 → 編輯 → 進 TaskTemplateEditor 且已載入資料
- 【spec-first】manager_owner：明細 → 已完成指派列的刪除按鈕 → confirm → 該列消失；未完成的列沒有刪除按鈕

**對等驗證**

- 同一個 manager_owner（他同時是協作者），舊版 /admin/template/[id] 的 DOM 擷取指派列（協作人數、進度百分比、狀態徽章文字），新版 API assignments 逐筆比對 collaborators.length、完成百分比（四捨五入規則一致）、狀態
- 以 admin_role（非協作者）比對指派筆數：舊版和新版不同時，輸出差異報告給 D4 決策
- 範本摘要：標題、描述、步驟數、建立時間，舊版 DOM 對新版 template 欄位（新版沒有顯示的列為 missing）
- 刪除指派 parity：在 A、B 複本上分別用舊版 DeleteAssignmentButton 和新版刪除，DB 殘留的 logs、collaborators 列數要相同

**測試資料**

- ZZTEST-TASK-明細範本：2 個 sections、每區段 2 主項，其中 1 主項有 2 子項；3 個指派（completed、in_progress 含部分子項、pending），協作者分佈在兩個區段
- 一個 admin_role 不是協作者的指派（測 D4）
- 205 筆指派的壓力範本（只給分批 integration 用，測完刪除）
- logs 要有備註文字，供軌跡顯示

**風險**

- D4 的資料範圍不同，parity 一定會出現差異，需要使用者決定
- 新版狀態由 logs 重算，舊版讀 assignments.status 欄位；若 DB 欄位和 logs 不一致，兩版顯示會不同

## /admin/create

- 狀態：**done**（S）— Vue TaskTemplateEditor 以原生表單提供部門區段、執行人員、主項／子項、日期、排序與驗證，後端 task-template route 與 normalizeTaskTemplate 做完整驗證，並有交易與復原測試。
- 舊版：`app/admin/create/page.tsx + components/admin/WorkflowBuilderV2.tsx + app/actions.ts(createTemplateV2)`
- Vue：`vue-workspace/src/pages/TaskTemplateEditor.vue`
- 權限：task.manage（入口）、admin 或 role=manager（taskManagementScope）
- 相依：TaskManagement.vue、TaskStepFields.vue、lib/workspace/task-template.ts

**舊版功能**

- 基本資訊：專案標題（必填）、描述、整體預計起始／結束日
- 新增／刪除部門區塊（至少保留一個）、選擇部門（來自 profiles 部門清單）
- 依部門搜尋並勾選執行人員（姓名、Email、員工代號、職位）
- 每個區塊新增／編輯／刪除／上移／下移主步驟：名稱（必填）、描述、必填旗標、步驟預計起迄日
- 每個主步驟新增／編輯／刪除子步驟
- 送出驗證：至少一區塊、每區塊需部門＋至少一位人員＋至少一步驟、步驟名稱不可空、步驟日期區間
- 任務摘要（區塊數、執行人員數、總步驟數）
- 儲存即建立 template，並為創建者與所有區塊人員建立 assignment 與 assignment_collaborators（記錄 section_id）

**缺少或不同**

- 不同：Vue 校驗人員必須屬於所選部門（normalizeTaskTemplate），legacy 僅在 UI 依部門篩選；Vue 更嚴格
- 不同：legacy 建立時為創建者建立 assignment 並以 userIdArray[0] 為 assigned_to；Vue 由 RPC workspace_save_task_template 處理，需以 DB 比對 assignments/collaborators 結果一致（uncertain，未讀 SQL 全文）
- 不同：Vue 上限檢查（50 區段、1000 項、字串長度）為新增限制；legacy 無
- uncertain：legacy 的「任務摘要」卡在 Vue 是否有對應顯示，未在 TaskTemplateEditor.vue 內確認

**業務規則**

- （無）

**API**：舊 app/actions.ts: createTemplateV2、getAllDepartments、app/auth/actions.ts: getAllUsers；新 GET/POST /api/workspace/task-template、RPC workspace_save_task_template

**資料表**：templates、assignments、assignment_collaborators、profiles、logs

**既有測試**：scripts/test-workspace-task-template.py、scripts/test-workspace-task-template-recovery.py、scripts/test-workspace-task-template-transaction.cjs

**待確認**

- legacy createTemplateV2 是否檢查 task.manage 權限：讀到的片段僅檢查登入，未見 requirePermission

### 測試案例

**冒煙**

- manager_owner 進 TaskTemplateEditor（新增模式），表單有標題、描述、日期、至少一個區段，部門下拉有選項，console 沒有 error
- GET /api/workspace/task-template（沒有 id）回 200，含人員清單 people（id、department）與部門清單
- member_a 看不到新增入口，直接打 API 回 403

**單元**

- lib/workspace/task-template.ts normalizeTaskTemplate（需要 mock ./server 的 WorkspaceError 與 uuid）：0 個區段或 51 個區段 → 400「請設定 1 至 50 個部門區段」；步驟總數超過 1000 → 400；名稱空白或只有空白 → 400；日期 '2026-02-30' 或 '2026/01/01' → 400「日期格式不符」；起始日晚於結束日 → 400；區段或項目 id 重複、'__proto__'、長度 >100 → 400；人員不屬於所選部門 → 400；合法輸入時輸出會 trim 字串，日期空字串轉 null
- 與 legacy WorkflowBuilderV2 前端驗證對照的表格測試：至少一區塊、每區塊要有部門加至少一人加至少一步驟；同一組輸入兩邊都必須拒絕（新版較嚴格的部分列出來）

**整合**

- POST /api/workspace/task-template 由 manager_owner 建立：DB 出現 templates（created_by=本人、sections、steps_schema），每位區段人員和建立者都有 assignment_collaborators（section_id 正確），且 assignments 建立數量要和舊版 createTemplateV2 一致（要先讀 SQL 確認）
- 權限：manager_readonly（有 task.manage、role=manager）可以建立（舊版只要登入就行，新版需要 manage）；member_a 回 403；non_manager_with_manage 回 403（D5）
- 交易性：沿用 scripts/test-workspace-task-template-transaction.cjs，RPC 中途失敗（例如給不存在的 user id）→ templates、assignments 都沒有殘留
- 冪等：同一個 writeId 重送不會建立第二份；同一個 writeId 但內容不同 → 409
- 上限：50 區段、1000 項目剛好通過；超過則 400

**E2E**

- manager_owner：新增範本 → 填標題 → 新增第二個部門區段 → 選部門 → 用搜尋勾選 2 位人員 → 新增主項、子項 → 上移、下移排序 → 設日期 → 儲存 → 成功訊息 → 任務管理列表出現（或在派發後出現）
- 驗證錯誤流程：未選人員就儲存 → 顯示錯誤，不送出；結束日早於起始日 → 錯誤訊息
- 刪除區段時只剩一個區段 → 刪除按鈕 disabled 或出現提示
- 沿用 scripts/test-workspace-task-template-recovery.py：重新整理後草稿可恢復

**對等驗證**

- 同一份輸入規格（JSON 定義：2 區段、5 主項、3 子項、2 位人員、日期），由 Playwright 分別在舊版 /admin/create 和新版編輯器填寫送出；抽出新 template 的 sections、steps_schema（去掉 id），以及 assignments、collaborators（user_id 轉角色代號、section_id 依區段順序對應）做 deep-equal
- 比對 assignments.assigned_to、status、department 欄位（舊版 assigned_to=userIdArray[0]）
- 任務摘要（區段數、人員數、總步驟數）：舊版 DOM 與新版顯示（如有）一致

**測試資料**

- 部門 A（member_a、member_b）、部門 B（另外 2 人）的 profiles，department 欄位要正確
- manager_owner、manager_readonly、member_a、non_manager_with_manage 帳號
- 沿用 scripts/seed-workspace-task-template-dev.cjs

**風險**

- 新版 RPC 建立 assignments 的數量和欄位未逐行比對，parity 可能會 fail
- Vue 有人員必須屬於所選部門的校驗，舊版能存的資料新版可能被拒

## /admin/edit/[id]

- 狀態：**done**（S）— 同一個 Vue 編輯器以 recordId 載入既有範本，具完成鎖定、進行中提示、版本衝突處理，後端驗證 task.template.edit。
- 舊版：`app/admin/edit/[id]/page.tsx + components/admin/WorkflowBuilderV2.tsx + app/actions.ts(updateTemplateV2)`
- Vue：`vue-workspace/src/pages/TaskTemplateEditor.vue`
- 權限：task.template.edit、task.manage
- 相依：/admin/create 的同一元件

**舊版功能**

- 載入既有範本（找不到導回 /admin/templates）與既有協作者／日期
- 已有 completed 指派時鎖定編輯並顯示「無法編輯」
- 已有 in_progress 或 completed 指派時顯示警告（hasActiveAssignments）
- 其餘編輯功能與 /admin/create 相同
- 儲存時 updateTemplateV2 需 task.template.edit，並同步更新 assignments／collaborators（含新增協作者寫 log）

**缺少或不同**

- 不同：Vue 採 workspace_version 樂觀鎖並傳 versions（指派清單版本）；衝突時保留草稿提供另開最新版本（legacy 無）
- 不同：legacy 鎖定條件以頁面載入時 completed 指派判斷；Vue 另在儲存時由 RPC 回 COMPLETED 錯誤（409）
- uncertain：legacy updateTemplateV2 對移除的協作者／新增協作者寫入 logs 的行為（actions.ts 1589-1607），Vue RPC 是否重現未驗證

**業務規則**

- （無）

**API**：舊 app/actions.ts: getTemplates、getAssignments、updateTemplateV2、getExistingCollaborators；新 GET/POST /api/workspace/task-template?id=、RPC workspace_save_task_template

**資料表**：templates、assignments、assignment_collaborators、logs

**既有測試**：scripts/test-workspace-task-template.py、scripts/test-workspace-task-template-recovery.py、scripts/test-workspace-task-template-transaction.cjs

**待確認**

- updateTemplateV2 內新增協作者寫 log 的細節與 Vue RPC 的差異

### 測試案例

**冒煙**

- manager_owner 開既有範本的編輯器，所有欄位都已預填（標題、區段、人員、步驟、日期），console 沒有 error
- GET /api/workspace/task-template?id= 回 200，含 workspace_version 與 versions（指派版本）
- 已有 completed 指派的範本 → 顯示鎖定或無法編輯的提示

**單元**

- normalizeTaskTemplate 用在編輯情境：保留既有項目 id；新增項目時產生新 id（mock uuid）
- 衝突判定的純函式（如有，例如比對 versions 陣列）：任一指派版本不同 → 視為衝突

**整合**

- 權限：manager_owner 有 task.template.edit → 200；manager_readonly 沒有 edit → 403；manager_other 編輯 manager_owner 的範本 → 404；admin_role → 200
- 已有 completed 指派時儲存 → 409（RPC 回 COMPLETED）；已有 in_progress → 允許儲存，但回應帶警示（與舊版 hasActiveAssignments 對照）
- 樂觀鎖：A、B 兩個 context 讀同一個版本，A 先存成功，B 再存 → 409，DB 保留 A 的內容
- 協作者異動：移除一位、新增一位後儲存 → assignment_collaborators 正確增刪；logs 是否寫入「新增協作者」紀錄要和舊版 updateTemplateV2（actions.ts 1589-1607）對照
- 沿用 scripts/test-workspace-task-template-transaction.cjs：RPC 失敗時整筆 rollback

**E2E**

- manager_owner：編輯 → 改標題、新增一個子項 → 儲存 → 重新開啟可看到修改
- 衝突流程：開兩個 tab，tab1 儲存後 tab2 再儲存 → 顯示衝突、保留草稿 → 可另開最新版本
- completed 範本：進入編輯畫面時被鎖定，儲存按鈕不可用

**對等驗證**

- A、B 複本各用舊版 /admin/edit 和新版編輯器執行同一組修改（改標題、新增子項、新增一位協作者、移除一位協作者），抽 templates、collaborators、logs（action 種類與數量）正規化後比對
- 鎖定條件：同一個 completed 範本，舊版顯示「無法編輯」，新版也要阻擋

**測試資料**

- ZZTEST-TASK-可編輯範本（只有 pending 指派）、ZZTEST-TASK-進行中範本、ZZTEST-TASK-已完成鎖定範本
- 每個範本各有 A、B 複本

**風險**

- 舊版與新版寫入 logs 的行為差異（uncertain）

## /admin/assign/[id]

- 狀態：**done**（S）— Vue 提供人員搜尋、部門篩選、日期、確認 Modal 與交易式派發 RPC；功能涵蓋 legacy 並增加冪等與衝突處理。
- 舊版：`app/admin/assign/[id]/page.tsx + components/admin/AssignTemplateForm.tsx + app/actions.ts(createAssignment/getExistingCollaborators)`
- Vue：`vue-workspace/src/pages/TaskDispatch.vue(task-assign 模式)`
- 權限：task.manage、admin 或 role=manager（managedTemplate 範圍）
- 相依：TaskManagementDetail.vue、lib/workspace/task-management.ts

**舊版功能**

- 顯示流程名稱
- 預計起始日／完成日（起始日不可晚於完成日）
- 載入既有協作者並預選
- 搜尋使用者（Email、姓名、職稱）並勾選多位使用者；不選則指派給自己
- 送出 createAssignment：若已有指派則更新協作者，否則建立；成功提示指派人數

**缺少或不同**

- 不同：Vue 一律包含操作者本人（checkbox 禁用且必含）；legacy 允許不選任何人而指派給自己，行為等價但選取邏輯略不同
- 不同：Vue 的派發會「取代」協作區段限制，未選入的原協作者失去存取（Modal 有警語）；legacy createAssignment 是增補或更新協作者，是否移除舊協作者需比對 actions.ts 351-411（uncertain）
- 不同：Vue 提供部門篩選與已選人員摘要（legacy 無部門篩選）

**業務規則**

- （無）

**API**：舊 app/actions.ts: createAssignment、getExistingCollaborators、app/auth/actions.ts: getAllUsers；新 GET/POST /api/workspace/task-dispatch、RPC workspace_dispatch_task

**資料表**：assignments、assignment_collaborators、templates、profiles

**既有測試**：scripts/test-workspace-task-dispatch.py、scripts/test-workspace-task-dispatch-transaction.cjs、scripts/test-workspace-task-copy-concurrency.cjs

**待確認**

- createAssignment 更新既有指派時是否移除未選協作者（需讀 actions.ts 320-411 與 RPC SQL 對照）

### 測試案例

**冒煙**

- manager_owner 從明細點派發 → TaskDispatch task-assign 模式顯示流程名稱、人員清單、日期欄位，console 沒有 error
- GET /api/workspace/task-dispatch?id= 回 200，含既有協作者（已預選）與人員清單
- 操作者本人的 checkbox 已勾選且為 disabled

**單元**

- 派發 payload 的驗證純函式（如果在 route 內，建議抽到 lib/workspace/task-management.ts）：起始日晚於完成日 → 錯誤；userIds 自動包含操作者並去重；非法 uuid → 錯誤
- 人員搜尋與篩選的純函式（若在 TaskDispatch.vue 內，建議抽出）：Email、姓名、職稱比對不分大小寫；部門篩選

**整合**

- 權限：manager_owner 回 200；manager_other 派發他人範本 → 404；member_a → 403；admin_role → 200
- 範本已有指派時派發：比對協作者是取代還是增補（D6）。新版是取代，被移除的人 GET /api/workspace/tasks 看不到該任務、GET task-detail 回 404
- 沿用 scripts/test-workspace-task-dispatch-transaction.cjs：RPC 失敗時沒有殘留；同一個 writeId 冪等；用舊版本派發 → 409
- 不選任何人 → 只派給自己，assignment 的 assigned_to 是操作者

**E2E**

- manager_owner：派發頁搜尋「member」→ 用部門篩選 → 勾 member_a、member_b → 設日期 → 確認 Modal 會顯示取代警語 → 送出 → 成功訊息顯示人數 → member_a 登入後在我的任務看得到
- 日期錯誤時不能送出
- 沿用 scripts/test-workspace-task-dispatch.py

**對等驗證**

- A、B 複本：舊版 /admin/assign 勾同一組人、同一組日期送出，新版也同樣操作；抽 assignments（planned 日期、status、assigned_to）與 collaborators 集合（user 換成角色代號）比對
- 已有協作者 X 的情況下只勾 Y 派發：舊版結果（X 留下或移除）與新版結果對照，輸出 D6 差異

**測試資料**

- ZZTEST-TASK-派發範本（無指派）、ZZTEST-TASK-已有協作者範本（協作者為 member_b）
- 兩個部門的人員
- 沿用 scripts/seed-workspace-task-dispatch-dev.cjs

**風險**

- 取代與增補的語意不同（D6）會造成協作者失去存取權

## /admin/archived

- 狀態：**partial**（S）— Vue 有封存列表、月份篩選、名稱搜尋、唯讀明細與複製，核心可用；呈現方式由月份頁籤＋展開卡改為篩選＋獨立明細頁，複製行為語意也不同。
- 舊版：`app/admin/archived/page.tsx + components/admin/ArchivedTasksList.tsx + app/actions.ts(getArchivedAssignments/duplicateArchivedAssignment)`
- Vue：`vue-workspace/src/pages/TaskArchive.vue`、`vue-workspace/src/pages/TaskArchiveDetail.vue`
- 權限：task.view_archived、role admin/manager、archive scope: admin 全部，其餘 created_by 或 archived_by = 本人
- 相依：TaskArchiveDetail.vue、lib/workspace/task-archive.ts

**舊版功能**

- 僅 admin/manager，其餘導回 /dashboard；顯示「共 N 個已封存任務」與空狀態
- 依建立日期年月分組成頁籤（最新在前），預設第一個月份
- 每筆可展開：建立、完成、發起人、負責人、封存日期、封存者、步驟完成度、協作者、部門、任務執行時間軌跡
- 「複製任務」（confirm）：呼叫 duplicateArchivedAssignment，新增一筆指派給本人的 pending 任務，成功提示至「我的任務」查看
- 「查看詳情」連到 /assignment/[id]
- 非 admin 僅見 archived_by 或 created_by 為本人者

**缺少或不同**

- 不同：UI 由月份頁籤改為下拉篩選並新增名稱搜尋；列表欄位為任務/部門、建立/完成/封存時間
- 不同：legacy 複製是用相同 template 建一筆 department=本人部門的 pending assignment；Vue RPC workspace_copy_archived_task 帶 version、writeId 與 p_department，需比對產生資料是否一致（uncertain）
- 不同：legacy「查看詳情」進入可編輯的 ChecklistRunner；Vue 為唯讀封存紀錄（較合理，但行為不同）
- 不同：legacy 以 role 檢查（admin/manager）；Vue archiveScope 另需 task.view_archived（非 admin），權限更嚴格
- 缺：legacy 列表上的「共 N 個」總數文字、封存者與發起人展示僅在明細（Vue 明細有 creator/assignee/archiver，列表沒有）

**業務規則**

- （無）

**API**：舊 app/actions.ts: getArchivedAssignments、duplicateArchivedAssignment；新 GET/POST /api/workspace/task-archive、RPC workspace_copy_archived_task

**資料表**：assignments、templates、logs、assignment_collaborators、profiles

**既有測試**：scripts/test-workspace-task-archive.py、scripts/test-workspace-task-archive-action-concurrency.cjs、scripts/seed-workspace-task-archive-dev.cjs

**待確認**

- workspace_copy_archived_task 的 SQL 實際寫入欄位（supabase/workspace-dev/20261028070000_vue_task_archive_action.sql）未逐行比對

### 測試案例

**冒煙**

- manager_owner 進「已封存任務 新版」→ TaskArchive.vue 列表、月份篩選、搜尋框都有渲染，console 沒有 error
- GET /api/workspace/task-archive 回 200；開明細 GET ?id= 回 200（TaskArchiveDetail 顯示 creator、assignee、archiver）
- 沒有封存資料的帳號 → 顯示空狀態

**單元**

- 月份分組或篩選的純函式（建議抽出，例如 groupArchivedByMonth(rows)）：依 created_at 的年月分組，最新的排前面；跨年；時區（Asia/Taipei 月底 23:30 的資料不可被歸到下個月）
- 名稱搜尋過濾函式：大小寫與前後空白處理
- lib/workspace/task-archive.ts archiveScope 邏輯（抽成純函式 (isAdmin, role, caps)）：非 admin 需要 task.view_archived

**整合**

- 角色矩陣：admin_role 看到全部封存；manager_owner 只看到 created_by 或 archived_by 是本人的；manager_other 看不到 manager_owner 的；沒有 task.view_archived 的 manager → 403（舊版只看 role，因此可以看到 → 記錄差異）；member_a → 403
- 複製封存任務（POST，RPC workspace_copy_archived_task）：產生一筆新的 assignment，status=pending、archived=false，department 等於操作者的部門（與舊版 duplicateArchivedAssignment 一致），collaborators 包含本人；同一個 writeId 重送不產生第二筆；用舊版本 → 409（沿用 scripts/test-workspace-task-archive-action-concurrency.cjs）
- 複製跨範圍的封存任務 → 404

**E2E**

- manager_owner：封存列表 → 選月份 → 搜尋標題 → 開明細看到步驟完成度與時間軌跡（唯讀，沒有 checkbox）→ 複製 → 確認 → 成功訊息 → 我的任務出現新的 pending 任務
- 沿用 scripts/test-workspace-task-archive.py

**對等驗證**

- 同一個 manager_owner：舊版 /admin/archived 的月份頁籤，以及各頁籤的任務標題集合；新版 API 依月份分組後的集合要相等；「共 N 個」的總數等於新版筆數
- 單筆明細欄位（建立、完成、發起人、負責人、封存日期、封存者、步驟完成度、協作者、部門）舊版展開 DOM 與新版明細逐欄比對
- 複製 parity：同一筆封存任務的 A、B 複本，各用舊版和新版複製一次，比對新 assignments（template_id、status、department、assigned_to、created_by）與 collaborators

**測試資料**

- 跨 3 個月份（含跨年 2025-12、2026-01）的封存指派，created_by 和 archived_by 分屬不同人
- 一筆在 Asia/Taipei 月底 23:30 建立的資料（測時區）
- 沒有 task.view_archived 的 manager 帳號
- 沿用 scripts/seed-workspace-task-archive-dev.cjs

**風險**

- 新版權限較嚴格，可能讓舊版看得到封存的人在新版被擋
- 複製 RPC 帶入的 department 來源可能和舊版不同

## /assignment/[id]

- 狀態：**partial**（M）— Vue 任務執行頁提供勾選、備註、父子連動、甘特排程、儲存與樂觀鎖，但存取範圍（僅協作者）與 legacy（協作者或 admin/manager）不同，且部分顯示資訊缺少。
- 舊版：`app/assignment/[id]/page.tsx + components/user/ChecklistRunner.tsx + components/user/AssignmentGanttModal.tsx + app/actions.ts(getAssignment/logAction/updateAssignmentStatus)`
- Vue：`vue-workspace/src/pages/TaskRunner.vue`、`vue-workspace/src/components/TaskSchedule.vue`
- 權限：task.view_own、協作者身分（assignment_collaborators.user_id）、legacy 另允許 role admin/manager
- 相依：MyTasks.vue、TaskSchedule.vue、lib/workspace/task-state.ts、RPC workspace_save_task

**舊版功能**

- 未登入導向登入；任務不存在顯示「任務不存在」並可返回；無權限顯示「無權訪問」
- 存取範圍：協作者，或 role admin/manager
- 顯示標題、描述、預計時程、狀態徽章（待處理/進行中/已完成）、指派日期、使用者所屬部門區塊徽章、協作成員人數與名單
- 勾選／取消主項與子項，父子連動（勾主項→全部子項；子項全勾→勾主項；取消子項→取消主項）
- 每項完成備註（選填）、已完成項目顯示備註
- 樂觀更新＋延遲 300ms 批次寫 logs（logAction），失敗還原並提示「操作失敗，請重試」
- 狀態自動更新：全部完成→completed，有進度→in_progress（updateAssignmentStatus）
- 「建立甘特圖」彈窗（AssignmentGanttModal）
- 全部完成顯示「恭喜！所有項目已完成」
- 依使用者 section 僅顯示自己部門區塊步驟

**缺少或不同**

- 不同（重要）：task-detail route 的 taskDetail 明確限制為協作者（註解 'My tasks is explicitly collaborator-scoped, including administrators'），admin/manager 非協作者不能開啟，legacy 可以（assignment page isAdmin 判斷）
- 不同：Vue 另需 capability task.view_own；legacy 僅需登入
- 缺：Vue 頁首未顯示指派日期、整體狀態徽章、預計時程文字、使用者所屬部門徽章（TaskRunner.vue 僅顯示創建者、我的項目 x/y、協作成員）
- 缺：legacy「恭喜！所有項目已完成」慶祝區；Vue 改為出現「完成並返回我的任務」按鈕
- 不同：Vue 儲存為手動「儲存進度」或離開時儲存（tab.dirty），legacy 為每次勾選自動延遲寫入；Vue 以 sha256 冪等＋workspace_version 衝突處理並每 30 秒檢查更新
- 不同：Vue 的父子連動在 lib/workspace/task-state.ts applyTaskChanges 與 legacy 規則一致（已讀確認）；子項取消父項取消、子項全勾自動勾父項亦一致
- 不同：Vue 的「完成並返回」若無變更會自動把全部主項標為完成（finish() 內 changes 由 data.steps 產生，僅含主項，依賴父項連動勾子項），行為為新增功能

**業務規則**

- （無）

**API**：舊 app/actions.ts: getAssignment、logAction、updateAssignmentStatus、app/auth/actions.ts: getCurrentUser；新 GET/POST /api/workspace/task-detail、RPC workspace_save_task

**資料表**：assignments、templates、assignment_collaborators、logs、profiles

**既有測試**：scripts/test-workspace-tasks.py、scripts/test-workspace-task-transaction.cjs、scripts/test-workspace-task-recovery.py、scripts/test-workspace-task-schedule.cjs、scripts/test-workspace-task-close.py

**待確認**

- AssignmentGanttModal 的完整功能（匯出、欄位）未逐行讀，TaskSchedule.vue 是否等價需另行比對
- admin 非協作者開啟他人任務是否為需求，需使用者決定是否保留 legacy 行為

### 測試案例

**冒煙**

- member_a 從我的任務點「開啟任務」→ TaskRunner 顯示標題、我的項目 x/y、協作成員、checkbox，console 沒有 error
- GET /api/workspace/task-detail?id= 回 200，含 steps（只有本人區段）、sections、state、logs、workspace_version
- 非協作者回 404「找不到指派給你的任務」；已封存的回 404；範本已刪除回 409

**單元**

- applyTaskChanges（lib/workspace/task-state.ts）表格測試：勾主項 → 全部子項 complete；子項全部勾 → 自動勾主項；取消任一子項 → 主項 uncomplete；取消主項 → 全部子項 uncomplete；stepId 不在本區段 → throw「項目不屬於可操作區段」；note 超過 5000 字元或不是字串 → throw；checked 不是 boolean → throw；actions 陣列的順序與內容正確；note 保留既有的值（note 為 undefined 時）
- 對照舊版 ChecklistRunner 的連動規則：把 components/user/ChecklistRunner.tsx 的連動邏輯抽成同樣輸入，跑同一組 case，兩邊結果要一致（若無法 import，就手寫期望值，並註明出處行號）
- taskState 與 status 推導：全部完成 → completed；有任一完成 → in_progress；沒有 → pending（與舊版 updateAssignmentStatus 對照）

**整合**

- 角色矩陣：協作者 member_a → 200；同任務另一區段的 member_b → 200 但 steps 只有自己的區段；非協作者的 admin_role → 404（舊版可看，D1）；viewer 帳號（沒有 task.view_own）→ 403；未登入 → 401
- 寫入範圍：member_a 送出 member_b 區段的 stepId → 400，DB 沒有變化
- 冪等與衝突：沿用 scripts/test-workspace-tasks.py 的案例（同一個 writeId 重送、內容改了 → 409、舊版本 → 409）
- 並行：A、B 兩人在不同區段同時儲存 → 兩邊都成功（或其中一個 409 後重試成功），最終 logs 完整
- status 欄位：完成本區段但其他區段未完成 → status=in_progress；兩區段都完成 → completed（沿用 scripts/test-workspace-task-transaction.cjs）
- 錯誤路徑：區段 id 已從範本移除 → 409「指派區段已變更」

**E2E**

- member_a：開任務 → 勾主項（子項自動勾）→ 填備註 → 儲存進度 → 重新整理後狀態保留 → 取消一個子項，主項也跟著取消 → 儲存
- 多頁籤草稿：切到我的任務再切回，未儲存的備註仍在（沿用 test-workspace-tasks.py）
- 全部完成 → 出現「完成並返回我的任務」→ 點擊後回到列表，狀態顯示已完成
- 甘特：開「查看甘特排程」可看到所有區段（唯讀）；與舊版 AssignmentGanttModal 的欄位對照記錄
- 離開頁面時 dirty 狀態會提示或自動儲存（依 tab.dirty 行為）

**對等驗證**

- 同一組操作序列（勾 a、填備註、取消 a1、勾 b）：A 複本用舊版 /assignment/[id] 的 ChecklistRunner 執行（每次勾選後等 >300ms 讓批次寫入完成），B 複本用新版執行再儲存；比對兩份 logs 最終的 taskState（每個 step 的 complete 與 note）以及 assignments.status。logs 的筆數與中間動作可能不同（舊版逐次寫入），只比最終狀態
- 顯示欄位：標題、描述、協作成員數與名單，舊版 DOM 和新版 DOM 相等；舊版的指派日期、狀態徽章、預計時程、部門徽章若新版沒有，列為 missing
- admin 非協作者的存取：舊版 200 對新版 404，輸出 D1 差異

**測試資料**

- ZZTEST-TASK-執行任務：2 區段（member_a 在 A 區、member_b 在 B 區），A 區有主項 a（子項 a1、a2）與主項 b，並含預計日期
- 非協作者的 admin_role、viewer 帳號
- A、B 兩份複本
- 沿用 scripts/seed-workspace-tasks-dev.cjs 的 .tmp-check/task-fixture.json

**風險**

- D1 存取範圍不同
- 新版改為手動儲存，使用者若沒按儲存，結果會和舊版自動儲存不同
- 「完成並返回」會自動勾全部主項，是新增行為

## /my-tasks

- 狀態：**partial**（S）— Vue 已有本人任務列表、部門與狀態篩選、進度、開啟操作；缺統計卡、發起人部門徽章、描述、步驟數，且 API 額外做去重，列表內容與 legacy 不完全相同。
- 舊版：`app/my-tasks/page.tsx + app/actions.ts(getAssignments)`
- Vue：`vue-workspace/src/pages/MyTasks.vue`
- 權限：task.view_own
- 相依：TaskRunner.vue、app/api/workspace/tasks/route.ts

**舊版功能**

- 登入驗證，未登入導向 /login
- 統計卡：總任務、待處理、進行中、已完成
- 依部門分頁籤（含數量），預設第一個部門
- 任務卡：標題、依進度計算的狀態徽章、發起人（姓名/Email）與發起人部門、描述（2 行截斷）、完成進度條與百分比、步驟數、協作者人數（>1 時）、最後更新時間
- 按鈕：開始執行（0%）/ 繼續執行 / 查看詳情（100%）→ /assignment/[id]
- 空狀態：目前沒有任務

**缺少或不同**

- 缺：四張統計卡（總任務/待處理/進行中/已完成）；Vue 僅在狀態下拉括號顯示各狀態數量
- 缺：發起人部門徽章、任務描述、步驟數、最後更新時間欄（MyTasks.vue 欄位為任務/部門、派發人/協作、我的進度、整體狀態、指派日期）
- 不同：按鈕固定為「開啟任務」，無『開始執行／繼續執行／查看詳情』依進度變化
- 不同：部門分頁籤改為下拉篩選，且預設『全部部門』
- 不同（重要）：app/api/workspace/tasks/route.ts 依 [template_id, department, sectionId] 去重，只保留每組最新一筆；legacy 不去重，同範本多次指派會多筆
- 不同：Vue 進度計算以使用者所屬區段的步驟（含子項）計算，legacy 以整份 template.steps_schema 主步驟＋子步驟計算，區段範本結果可能不同
- 不同：Vue 狀態使用 assignments.status 欄位，legacy 卡片狀態徽章依進度百分比即時推算
- 不同：Vue 需 capability task.view_own

**業務規則**

- （無）

**API**：舊 app/actions.ts: getAssignments、app/auth/actions.ts: getCurrentUser；新 GET /api/workspace/tasks

**資料表**：assignment_collaborators、assignments、templates、logs、profiles

**既有測試**：scripts/test-workspace-tasks.py、scripts/seed-workspace-tasks-dev.cjs

**待確認**

- 去重規則是否為刻意設計（避免重複範本指派）；若要與 legacy 完全一致需移除或由使用者決定

### 測試案例

**冒煙**

- member_a 進「我的任務 新版」→ MyTasks.vue 表格有部門、狀態篩選，ZZTEST 任務列會出現，console 沒有 error
- GET /api/workspace/tasks 回 200，records 只包含本人是協作者的任務
- viewer（沒有 task.view_own）→ 403，畫面顯示錯誤；沒有任務的帳號 → 空狀態

**單元**

- 去重邏輯（app/api/workspace/tasks/route.ts 第 115 行，key=[template_id, department, sectionId]）抽成純函式 dedupeTasks(rows)：同一 key 只保留最新一筆（依 created_at）；不同 section 都保留；department 為 null 的處理
- 進度計算抽成 taskProgress(steps, state)：區段步驟加子項；另寫 legacyProgress(template.steps_schema, logs)，同一份資料比較兩個函式並記錄差異（D3）
- 舊版狀態推算 progressToStatus(pct)：0 → 待處理、介於 0 和 100 → 進行中、100 → 已完成；按鈕文字對應開始執行、繼續執行、查看詳情（若要復刻）
- 【spec-first】統計卡計數函式 countByStatus(rows)：總任務、待處理、進行中、已完成

**整合**

- 角色矩陣：member_a 只看自己的；member_b 看不到 member_a 單獨的任務；admin_role 不是協作者 → 看不到（與舊版一致：舊版 getAssignments 也是依協作者過濾）
- 去重：seed 同一範本、同部門、同區段的 2 筆指派 → 新版只回 1 筆（較新的），舊版顯示 2 筆（D2 差異）
- 已封存的任務不出現
- 大量資料：本人有 120 筆任務時回應完整，不被截斷

**E2E**

- member_a：我的任務 → 部門篩選選 A → 狀態篩選選進行中 → 只顯示符合的列 → 開啟任務 → 返回時篩選仍保留
- 【spec-first】統計卡數字和表格篩選後的筆數一致
- 手機 390 寬沒有水平溢出

**對等驗證**

- 同一個 member_a：舊版 /my-tasks 的統計卡四個數字、各部門頁籤數量、卡片列表（標題與進度百分比）；新版 API records 先套用（或不套用）去重後，比對標題集合、各狀態計數、百分比。差異依 D2、D3 分類輸出
- 發起人姓名：舊版 DOM 和新版的派發人欄位相等

**測試資料**

- member_a 有：pending ×1、in_progress ×1、completed ×1、同 key 重複指派 ×2、已封存 ×1；分屬部門 A 和部門 B 各一部分
- 區段範本（測 D3）：member_a 的區段 2 步驟全部完成，但其他區段未完成
- 沒有任務的帳號
- 沿用 scripts/seed-workspace-tasks-dev.cjs

**風險**

- 去重和進度計算都和舊版不同，parity 必定出現差異，需要使用者決策 D2、D3

## /dashboard

- 狀態：**missing**（S）— lib/workspace/navigation.ts 的「儀表板」項目沒有 kind，vue-workspace/src/pages 與 App.vue 都沒有對應頁面或 workspace API，仍連回舊頁。
- 舊版：`app/dashboard/page.tsx + app/api/user/profile + app/api/user/managed-stores`
- Vue：（無）
- 權限：dashboard.view（Navbar/navigation.ts）、登入即可看到資料（頁面本身無 permission 檢查）
- 相依：MyTasks.vue / tasks API、app/api/user/managed-stores 對應的 workspace 端點（store_managers）、session capabilities 需新增 dashboard

**舊版功能**

- 歡迎訊息「歡迎回來，姓名/Email」與固定文字『您是專案經理…』
- 每 2 秒自動輪詢更新資料，另有手動「刷新」按鈕與更新中動畫
- 若本人有管理門市（/api/user/managed-stores 有資料）顯示「管理功能」任務統計：總任務、待處理、進行中、已完成
- 若無管理門市顯示快速功能：連結到 /monthly-status「查看本月人員狀態」並顯示年月
- 「我的任務」表格：專案名稱＋描述、指派使用者（頭像字、姓名、Email）、依進度推算的狀態、完成進度條、最後活動相對時間（剛剛/分鐘前/小時前/天前）、查看詳情連 /assignment/[id]
- 空狀態：目前沒有任何任務

**缺少或不同**

- 缺：全部功能。無 Vue 頁面、無 workspace API（app/api/workspace 下沒有 dashboard 或 home 相關端點）
- uncertain：legacy getAssignments 回傳的 assigned_user 欄位在前段程式碼中看起來並未填入（只見 creatorProfiles），表格『指派使用者』欄可能一直顯示未命名；需實測確認再決定是否復刻
- 建議：此頁與 /my-tasks 與首頁『我的任務』高度重疊，可與使用者確認是否以現有 MyTasks.vue 加統計卡取代，或獨立復刻

**業務規則**

- （無）

**API**：舊 app/actions.ts: getAssignments、GET /api/user/profile、GET /api/user/managed-stores；新 —

**資料表**：assignments、templates、logs、assignment_collaborators、profiles、store_managers、stores

**既有測試**：—

**待確認**

- assigned_user 是否真有資料
- 2 秒輪詢是否需保留（Vue 版可改為較長間隔或手動）

### 測試案例

**冒煙**

- 【spec-first，頁面尚未實作】實作後：具 dashboard.view 的帳號在導覽看得到「儀表板」，且 lib/workspace/navigation.ts 的項目要有 kind（目前沒有，仍連回舊頁）；點擊後在 Vue 內渲染，不跳到舊站
- GET /api/workspace/dashboard（或決定併入 tasks API）回 200；沒有 dashboard.view → 導覽隱藏、API 403
- 舊版 /dashboard 用 store_manager 和 member_a 開啟，HTTP 200（給 parity 做基準）

**單元**

- 相對時間函式 relativeTime(now, ts)：<1 分鐘 → 剛剛、分鐘前、小時前、天前的邊界（59 秒、60 秒、59 分、24 小時）；要和舊版 app/dashboard/page.tsx 的實作逐 case 對照
- 管理統計 countByStatus：與 /my-tasks 共用
- 是否顯示管理區塊的判定：managedStores.length>0 → 顯示統計，否則顯示 /monthly-status 快速連結與年月

**整合**

- store_manager（store_managers 有綁定）：回應含 managed=true 與 4 個統計數；member_a：managed=false
- 輪詢：如果保留輪詢，API 要能承受每 2 秒（或改後的間隔）請求，不可產生寫入；測連續 30 次請求都回 200 且結果穩定
- 跨門市：store_manager 只能看到自己管理門市的統計（若統計以門市範圍計）——uncertain，舊版統計來源要先讀 page.tsx 確認

**E2E**

- store_manager：開儀表板 → 看到歡迎訊息（姓名）→ 統計卡 → 我的任務表格 → 點查看詳情進 TaskRunner
- 按刷新按鈕：顯示更新中動畫，資料重新載入
- member_a：看到 /monthly-status 快速連結（如果新版有對應頁就連 Vue 頁）

**對等驗證**

- 同一個 store_manager、同一時間：舊版 /dashboard 的 DOM（歡迎文字、4 個統計數、任務表格的標題集合、進度百分比、狀態文字）與新版逐項比對
- 指派使用者欄：先在舊版實測是否一直顯示未命名（uncertain）；若是 bug，新版行為要由使用者決定，記入差異清單
- D7：若決定併入 MyTasks，parity 改為比對 MyTasks 統計卡和舊版 dashboard 統計卡

**測試資料**

- store_manager（store_managers 綁定 1 間 ZZTEST 門市）、member_a（沒有管理門市）
- member_a 和 store_manager 各有 pending、in_progress、completed 任務，以及不同的最後活動時間（剛剛、2 小時前、3 天前）

**風險**

- 整頁尚未實作（D7 需要先決策）
- 舊版 assigned_user 可能本來就是 bug
- 2 秒輪詢可能增加 DEV、PROD 負載

## / (首頁 app/page.tsx)

- 狀態：**partial**（XL）— Vue 只有工作總覽快捷按鈕（巡店、活動、常用功能），完全沒有首頁的資料區塊（我的任務、本月壽星、獎金明細、新人入職、年費與換照提醒、調店待確認、每月版更），也沒有訪客登入頁。
- 舊版：`app/page.tsx（約 1239 行，Server Component）`
- Vue：`vue-workspace/src/App.vue（<main class="welcome"> 工作總覽區塊，僅快捷入口）`
- 權限：monthly.status.view_all、home.bonus_detail.view_own、employee.store_transfer.create、employee.store_transfer.confirm、profiles.role 與 job_title（督導／店長／營業部行政主管）、admin 角色視同全權
- 相依：MyTasks.vue 資料（tasks API）、EmployeeBirthdays 資料邏輯 lib/workspace/employee-birthdays.ts、pharmacist-overview 與 pharmacist API、transfers API、新增 /api/workspace/home 聚合端點、每月版更頁（app/monthly-release/page.tsx）是否另列

**舊版功能**

- 未登入：深色登入落地頁，顯示啟用門市數（stores.is_active count），「登入」「註冊帳號」按鈕
- 已登入：歡迎標題（依姓名/職稱）
- 調店登記確認提醒卡：有 employee.store_transfer.confirm 權限且有待確認 store_transfer_requests 時顯示並連到 /admin/promotion-management?tab=transfer_requests
- 「每月版更內容」連結到 /monthly-release
- 「我的每月獎金明細」：需 home.bonus_detail.view_own，依員編讀 monthly_bonus_records，最近 3 個月展開、較早月份摺疊，各項獎金金額與其他獎金備註，連到 /monthly-status
- 「本月新人入職公告」：店長／代理店長管轄門市本月到職人員（employee_movement_history），欄位到職日、門市、姓名、身分
- 「我的任務」：列出本人 assigned_to 的指派（標題、進度、連 /assignment/[id]）與「查看全部」連 /my-tasks，空狀態文字
- 「本月壽星」：admin/manager、督導、店長可見，依管轄範圍列出員編、姓名、日期
- 「藥師公會年費提醒」：canViewAnnualFeeReminder，讀 pharmacist_annual_fees，欄位員編、姓名、公會、門市
- 「藥師執業執照到期提醒」：管理者／督導／營業部行政主管，可依區域分組，欄位員編、姓名、到期日、門市，可展開收合
- 角色判斷邏輯：督導（職稱含督導）、店長（店長/代理店長且非督導）、管理者（admin 或 manager 且非督導店長）、營業部行政主管

**缺少或不同**

- 缺：上述所有資料區塊在 Vue 皆無對應 UI 與 API（app/api/workspace 下無 home/overview 端點；僅 employee-birthdays、pharmacists、store-personnel 等獨立頁面）
- 缺：未登入落地頁（Vue 為 hash router，登入由 session/login API 處理，首頁畫面為 App.vue 登入區塊，內容不同，uncertain）
- 缺：個人獎金明細（home.bonus_detail.view_own）無 Vue 呈現
- 缺：調店確認提醒數字、每月版更連結、藥師年費與換照提醒、新人入職公告
- 不同：Vue 工作總覽的『我的任務』沒有直接列表，需進 /my-tasks 頁籤
- 重用：EmployeeBirthdays.vue（employee-birthdays API）可作為壽星區塊資料來源；pharmacist 相關 API 可能可重用年費／換照提醒（uncertain）

**業務規則**

- （無）

**API**：舊 app/actions.ts: getAssignments、lib/permissions/check.ts: hasPermission、直接以 createAdminClient 查詢多個資料表（無獨立 API）；新 —

**資料表**：stores、assignments、assignment_collaborators、templates、logs、profiles、monthly_bonus_records、store_managers、store_employees、employee_movement_history、pharmacist_monthly_snapshot、pharmacist_annual_fees、pharmacist_profiles、store_transfer_requests

**既有測試**：—

**待確認**

- 未逐行閱讀 app/page.tsx 的 380-830 行（壽星、年費、換照的詳細查詢條件與分區規則），實作前需補讀
- 「首頁」在 Vue 工作台的定位（是否即工作總覽）需使用者決策
- 本月新人入職、壽星的管轄範圍規則需對照 store_managers 與 supervisor 關聯

### 測試案例

**冒煙**

- 已登入開 /workspace/index.html：App.vue 工作總覽渲染，console 沒有 error，各快捷按鈕依權限顯示
- 【spec-first】實作 /api/workspace/home 後：GET 回 200，回應含 myTasks、bonus、newHires、birthdays、annualFees、licenseExpiry、pendingTransfers 這些區塊；無權限的區塊不回資料（是 null 或省略要先定規格），不可以回空陣列假裝有權
- 未登入：舊版顯示深色落地頁和啟用門市數；新版顯示登入區塊（內容不同，記錄差異）
- 舊版 / 用每一種角色開啟都回 HTTP 200（給 parity 做基準）

**單元**

- 角色判定函式（從 app/page.tsx 抽出到 lib/workspace/home.ts，例如 homeRole(profile)）：職稱含「督導」→ supervisor；店長或代理店長且不是督導 → store_manager；admin 或 manager 且不是督導、店長 → manager；營業部行政主管 → sales_admin_head；同時符合多個條件時的優先序要和舊版逐 case 對照（例如職稱「督導兼店長」）
- 獎金月份摺疊：最近 3 個月展開、其餘摺疊；月份排序；跨年（2026-01 時，最近 3 個月要包含 2025-11、2025-12）
- 執照到期依區域分組 groupByRegion：沒有區域的資料歸到「未分區」（以舊版行為為準，uncertain）
- 本月新人入職的月份範圍：本月第一天到最後一天（Asia/Taipei）
- 可重用 lib/workspace/employee-birthdays.ts 的本月壽星範圍計算（若已有純函式就直接補 case）

**整合**

- 角色矩陣（各區塊可見性）：bonus_owner → bonus 有資料，member_a（沒有 home.bonus_detail.view_own）→ 沒有 bonus；transfer_confirmer 且有待確認 store_transfer_requests → pendingTransfers.count>0，沒有該權限 → 不回；store_manager → newHires、birthdays 只包含自己管轄的門市（跨門市的資料不可出現）；supervisor → 所轄門市；admin_role、manager → 全部；annualFees 只有 canViewAnnualFeeReminder 的人看得到；licenseExpiry 只有管理者、督導、營業部行政主管看得到
- 跨門市：store_manager 管 S1，seed 一位 S2 本月到職的人 → 不可出現在 store_manager 的 newHires
- bonus 範圍：bonus_owner 只看到自己員編的 monthly_bonus_records，換員編或沒有員編 → 空
- myTasks：只回 assigned_to=本人的（舊版首頁使用 assigned_to，和 /my-tasks 的協作者範圍不同，要特別比對）
- 效能：首頁聚合 API 在 DEV 的回應時間 <2 秒（多表查詢）

**E2E**

- bonus_owner：首頁 → 獎金明細最近 3 個月展開，點開較早月份 → 點連結到 monthly-status（新版對應頁）
- transfer_confirmer：首頁 → 調店待確認提醒卡 → 點擊後進升遷調動管理的 transfer_requests 頁籤（Vue 對應頁或舊頁）
- store_manager：首頁 → 新人入職、壽星區塊有資料 → 我的任務點一筆進 TaskRunner →「查看全部」進 MyTasks
- sales_admin_head：執照到期提醒依區域展開或收合
- 每月版更連結可開啟

**對等驗證**

- 對每個角色（admin_role、manager、supervisor、store_manager、sales_admin_head、bonus_owner、transfer_confirmer、member_a），在同一個時間點用 Playwright 擷取舊版 / 各區塊的 DOM 表格（區塊是否存在、列數、每列的員編、姓名、日期、門市、金額），和新版 home API 與 DOM 比對，區塊存在性矩陣必須完全相同
- 數值比對：獎金各項金額（含其他獎金備註）逐月相等；調店待確認數量相等；年費與換照提醒的員編集合相等
- 因為 app/page.tsx 第 380–830 行尚未逐行讀過，期望值一律以舊版 DOM 為準，不可自行推算
- 日期敏感：測試要固定在同一天執行（或 seed 資料用相對本月日期生成），避免月初月底不同步

**測試資料**

- 門市 ZZTEST-S1、ZZTEST-S2（stores.is_active=true），store_managers：store_manager→S1；supervisor 督導 S1 和 S2
- employee_movement_history：S1、S2 各一位本月到職，一位上月到職（不應出現）
- profiles 生日：本月 2 位（S1、S2 各一）、下月 1 位
- monthly_bonus_records：bonus_owner 員編最近 5 個月的資料（含其他獎金備註）
- pharmacist_annual_fees 未繳 2 筆；pharmacist_profiles 執照 30 天內到期 2 筆（不同區域）、已過期 1 筆、一年後到期 1 筆
- store_transfer_requests：待確認 2 筆、已確認 1 筆
- 帳號：admin_role、manager、supervisor、store_manager、sales_admin_head、bonus_owner、transfer_confirmer、member_a
- 可沿用 scripts/seed-workspace-store-managers-dev.cjs、seed-workspace-supervisors-dev.cjs、seed-workspace-store-employees-dev.cjs

**風險**

- XL 工作量，聚合 API 尚未存在
- 角色判定規則複雜，又未完整讀過，容易漏掉邊界
- 獎金是敏感資料，權限錯誤會外洩，integration 的跨帳號案例必須全部通過才能上線

## 領域測試備註

【共通測試基礎設施（已讀程式確認）】
1) DEV 連線：scripts/workspace-backend.cjs 以 @next/env 載入 .env.development.local，並檢查 NEXT_PUBLIC_SUPABASE_URL 的 project ref 必須等於 mjpdfpxqttbhzeimmtqr 且等於 EXPECTED_SUPABASE_PROJECT_REF，否則丟出 "Refusing to start outside DEV"。所有新的 seed、測試腳本都必須複製這段 guard（ref 不符直接 exit 1），禁止連到正式庫。整合模式 `node scripts/workspace-backend.cjs --integrated` 開在 http://localhost:3002，舊版 Next 頁面（/admin/templates、/assignment/[id]、/my-tasks、/dashboard、/）和 Vue 工作台（/workspace/index.html）跑在同一個 server、同一個 DEV DB，所以 parity 測試可以用同一組 cookie 同時打新舊兩版。
2) 帳號：.tmp-check/workspace-accounts.json 現有 key = editor、viewer、denied、navigation。本領域另外需要（由 Sonnet 以 seed 腳本建立，前綴統一用 `ZZTEST-TASK-`，方便清除）：admin_role（profiles.role=admin）、manager_owner（role=manager、具 task.manage/task.template.edit/task.template.delete/task.view_archived/task.view_own）、manager_other（role=manager、同權限，但不是範本建立者 → 測跨範圍）、manager_readonly（role=manager，只有 task.manage、task.view_own，沒有 edit/delete）、member_a/member_b（role=member、只有 task.view_own，分屬部門 A/B）、non_manager_with_manage（role=member 但有 task.manage → 驗 Vue 403 與舊版差異）、denied（沒有任何 task.* 權限）。首頁還需要 store_manager（職稱=店長，store_managers 有綁定）、supervisor（職稱含督導）、sales_admin_head（營業部行政主管）、bonus_owner（有 home.bonus_detail.view_own 和員編）、transfer_confirmer（有 employee.store_transfer.confirm）。
3) 單元測試執行環境：Node v20.20.2，node_modules/.bin 沒有 tsx、vitest、jest；package.json 也沒有 test runner。lib/workspace/*.ts 是 TS，而且 task-template.ts 會 import ./server。建議新增 devDependency vitest（需要使用者同意改 package.json），或者採用不改依賴的方案：用既有 typescript 的 transpileModule 把檔案編成暫存 JS，再用 `node --test` 執行。task-template.ts 依賴 server.ts 的 WorkspaceError 和 uuid，unit 測試時要 mock './server'，或把 normalizeTaskTemplate 的純驗證拆出來。測試檔放在 lib/workspace/__tests__/*.test.ts。
4) 既有 Python 測試的模式：先 POST /api/workspace/login 登入，用 request context 打 API，再拿 storage_state 開 chromium 到 /workspace/index.html，點「XXX 新版」按鈕進頁面，結果寫入 .tmp-check/*-results.json。新測試沿用這個模式，fixture 寫到 .tmp-check/*-fixture.json。
5) Parity 共通方法：同一份 seed、同一個帳號、同一個時間點。(a) 舊版是 Server Component／server actions，沒有 JSON API，所以舊版資料要用 Playwright 開舊頁擷取 DOM 文字（卡片標題、計數、百分比），或用 service role 直接查 DB 重算；(b) 新版取 /api/workspace/* 的 JSON 和 Vue DOM；(c) 寫入類操作的 parity：舊版和新版各自在兩份「結構相同」的 fixture（A、B 複本）上執行同一個操作，再用 SQL 抽出 templates/assignments/assignment_collaborators/logs，正規化（去掉 id、時間戳、workspace_version、write_id 這類欄位，user_id 依角色換成代號）後做 deep-equal。差異只有在已列入「已知且使用者同意的差異清單」時才可以放行，其餘一律 fail。
6) 需要使用者決策、會影響期望值的差異（測試要參數化）：D1 admin/manager 不是協作者時能不能開 /assignment/[id]（舊版可以，Vue 回 404）；D2 /my-tasks 是否要依 template+department+section 去重；D3 進度要用區段步驟還是全範本步驟計算；D4 管理明細只顯示本人協作的指派（舊版 getAssignments）還是範本全部指派（Vue）；D5 Vue 權限比舊版嚴格（role=member 但有 task.manage 時被 403）；D6 派發時是取代協作者還是增補協作者；D7 /dashboard 要獨立復刻，還是併入 MyTasks。在使用者回覆前，parity 斷言對這些項目只記錄差異（report），不判 fail。
7) 清理：每支測試在 finally 依 `ZZTEST-TASK-` 前綴刪除 templates、assignments、collaborators、logs，或做 soft-archive。本規劃不寫 DB，實際執行時由 Sonnet 在 DEV 處理。
8) 尚未實作、要先開發才能測的項目：workspace 刪除範本／刪除已完成指派的 API 與 RPC、Dashboard 頁、/api/workspace/home 聚合端點、首頁各資料區塊、MyTasks 統計卡。這些案例寫成 spec-first，先寫測試（預期 fail），實作後轉綠。
9) uncertain：app/page.tsx 第 380–830 行（壽星、年費、換照的查詢條件）尚未逐行讀過，首頁那些區塊的期望值必須由 parity 從舊版 DOM 取得，不可以自己推算；supabase/workspace-dev/20261028*_vue_task_*.sql 各 RPC 的寫入欄位也還沒逐行比對，所以寫入類 parity 一律用 DB 快照 diff，不信任文件。

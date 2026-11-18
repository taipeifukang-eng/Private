# 新版「該月營業狀態」接業績管理處方箋 設計文件

分支：feature/vue-parity。狀態：已實作（2026-11-18，見第 9 節實作紀錄）。
目的：把舊版已上線的「處方箋連動」移植到新版（vue-workspace），行為與舊版一致。

## 0. 前置事項（動工前必做）

- 舊版實作已合併：git fetch 後 origin/main 為 a5bf991c（PR#15 合併，含 82ea4f8c、557e9b5e、46fef79f），且已含 PR#14（處方箋排除 0000，24a30264）。先前「origin/main 過期、實作只在 feat/monthly-stats-rx-link 分支」的說法已失效。
- feature/vue-parity 目前落後 origin/main 37 個提交、領先 376 個。試合併（merge-tree）只有一個內容衝突：lib/performance/prescription-report-context.ts（PR#14 與新版基準提交都改過），app/store/actions.ts 與 package.json 可自動合併。帶入方式見第 8 節問題 1。
- HEAD 目前不含 PR#14，新版處方箋頁仍可能產生 0000 資料；合併 main 後才會排除。
- app/store/actions.ts、app/monthly-status/page.tsx、app/api/import-store-stats/route.ts、components/ImportStoreStatsModal.tsx 是新舊版共用，合併時以 main 內容為準。
- 舊版測試 tests/monthly-stats-rx/**（含自己的 vitest.config.mts、dev-integration.devtest.ts）會隨合併一起帶入；新版另在 tests/unit、tests/integration 補測，兩邊要確認不互相重複執行或互相干擾（run-all.cjs 是否掃到）。

## 1. 舊版已上線規則（引用，不再問）

- 資料來源：monthly_prescription_reports，主鍵 (year_month, store_id)。
- 一般箋、慢箋張數：處方箋有值（含 0）就用處方箋；沒有時，舊匯入值非 0 才顯示並標「舊匯入」，否則顯示「暫無資料」。
- 健保總點值 = 一般箋點值 + 慢箋點值，兩者都有才算；以萬分之一整數運算；千分位整數顯示。
- 總公司 0000 一律暫無資料（讀取失敗時也不退回舊值）。
- 即時讀取，不複製進月度統計表。
- 三格唯讀，並顯示「資料來自業績管理處方箋，如需修改請至業績管理處方箋頁」；有「讀取中」、「讀取失敗」狀態（讀取失敗時三格都顯示讀取失敗，不退回舊匯入值，0000 例外）。
- 伺服端用 admin client 讀處方箋；權限 = monthly.status.view_stats 加門市範圍（view_all，或 view_own 且為指派門市）。
- 手動儲存與 Excel 匯入不再寫入兩個張數欄位。
- 權限語意以正式區 has_permission 為準：不檢查 roles.is_active、DB 無 admin bypass、應用層 profiles.role==='admin' 保底（即 ctx.has）。

## 2. 新版接點與改法（檔案清單，已逐一對照原始碼）

| 檔案 | 改法 |
|---|---|
| lib/monthly-stats/rx-link.ts、rx-link-server.ts | 自舊版帶入，純函式規則不改（resolveRxLinkDisplay、sumPointValues、formatPointValue、stripRxDerivedKeys、buildStoreStatsImportPayload、buildSupportHoursUpdate）。loadRxLinkForStore 內部自己會再查一次 stores 取 store_code；新版名冊 GET 已有預取的門市清單，建議直接用 ctx.admin 讀處方箋一筆，再用 resolveRxLinkDisplay（0000 以清單的 store_code 判斷），省一次查詢；或原樣呼叫 loadRxLinkForStore 並接受多一次小查詢（以 monthly-speed 測試結果決定）。canAccessStore 由新版已通過的門市範圍檢查傳入，不用舊的 resolveManagedStores。 |
| lib/workspace/monthly-meta.ts | STAT_FIELDS 移除 regular_prescription_count、chronic_prescription_count（第 5 行）。meta 新增 rx 區塊（一般箋、慢箋、健保總點值的顯示文字與數值、是否舊匯入、failed 旗標、isHeadOffice）。只有 viewStats 時才含 rx。讀取失敗只標 failed，不丟錯，避免拖垮名冊 GET。 |
| app/api/workspace/monthly/route.ts（約 196–229 行） | 名冊 GET 先以 allStores（含已停止）驗證門市範圍，meta 只對有效門市附上（storeActive）。rx 讀取要放進既有 Promise.all（與 rosterPage、fetchSummaries 並行），不要放在 buildMonthlyMeta 內序列執行，否則名冊變慢。已停止門市維持不附 meta，也就不附 rx（舊版 getStoreMonthlyRxLink 用 include_inactive 可讀，屬既有新版差異，見第 6 節）。 |
| app/api/workspace/monthly/tools/route.ts | GET op=meta（requireStore，預設排除已停止門市，回 403）同樣補 rx，與名冊 GET 共用同一函式。POST op=stats 的 keys 陣列（第 131 行）移除兩個張數欄位：該迴圈只讀 keys 內的鍵，前端多帶的兩欄自然被忽略，不會回 400（可再呼叫 stripRxDerivedKeys 明示）。注意迴圈對 keys 內每個鍵都要求是數字，因此前端不能漏送其餘 7 個欄位。kind=stats 匯入仍轉給 import-store-stats。 |
| app/api/import-store-stats/route.ts（205–206 行） | 改用 buildStoreStatsImportPayload，不讀不寫兩個張數欄，既有值保留。新舊版共用，改一次兩邊生效（隨合併 main 取得）。 |
| components/ImportStoreStatsModal.tsx（舊版欄位說明 144–145 行） | 舊版 main 已移除兩欄並加提示；新版隨合併取得。Vue 的匯入視窗（MonthlyTools.vue 第 66–70 行）沒有欄位清單，只需補一行說明「一般箋、慢箋張數與健保總點值改由業績管理處方箋提供，不需在此匯入」。 |
| vue-workspace/src/components/MonthlyTools.vue | statsFields（第 26 行）移除兩欄，編輯表單不再出現、開啟表單不再預填（第 62 行迴圈自動隨之）。統計卡（第 139 行 dl）新增第三列三格唯讀、舊匯入標籤、提示文字、讀取中與失敗狀態。存檔後既有 emit('refresh') 會重讀名冊與 meta。人力點值、日毛利、客毛利、日來客數這四個衍生值只用人數、毛利、來客數、處方加購，不用張數，不受影響。匯入說明補上述一行。 |
| vue-workspace/src/pages/Monthly.vue | 結構不改；切換門市或月份時重設 rx 狀態，避免短暫顯示上一家門市的值。 |
| app/store/actions.ts、app/monthly-status/page.tsx | 隨合併 main 取得 getStoreMonthlyRxLink、updateStoreMonthlySummary 剝除兩欄、StoreMonthlyStatsForm 三格唯讀。新版 workspace 不呼叫，但共用檔案要避免衝突。 |
| tests/support/w01a-fixtures.ts（89–91）、w02-fixtures.ts（85）、w05-fixtures.ts（145，op=stats 的 updates 帶兩欄）、tests/unit/SPEED/monthly-speed.test.ts（59） | 夾具與假資料內仍有兩欄，要更新；w05 那筆保留兩欄不動，反而可當「多帶兩欄被忽略」的回歸案例。 |
| tests/perf/monthly-speed.cjs snapshot、docs/vue-workspace/parity-plan/monthly-speed-results.md | 改前改後 JSON 比對只允許新增 meta；meta.stats 少兩鍵、多 rx，基準要重錄並註明原因。 |
| docs/vue-workspace/parity-plan/domains/monthly-perf.md（88、109、711 行）、README | 更新為處方箋連動說明；若有新遷移才更新 README 套用順序。 |

查證結果（不需改動）：
- 匯出：整合 Excel、名冊、實際人力點值、交通費等所有匯出（app/api/export-monthly-status/**、workspace monthly-export、op=excel 的 exportMonthlyStatusForBonus）只讀 monthly_staff_status 與各獎金表，沒有任何一支讀 monthly_store_summary 的兩個張數欄位。草稿問卷的 N1 前提不成立。
- 衍生值：Vue 統計卡的衍生值不使用張數。草稿問卷的 N2 前提不成立。
- 其他讀取者：lib/workspace/home.ts、position-headcount-data.ts 等只讀 store_status；績效與獎金計算讀的是 store_performance 與處方箋表，不讀這兩欄。

權限與門市範圍共用現有函式，不新增：ctx.has、名冊 GET 的 allStores 檢查、tools 的 requireStore(ctx,'monthly',store)、ctx.admin。

## 3. API 與權限

- 不新增路由。處方箋連動資料隨 /api/workspace/monthly 名冊 GET 的 meta 與 /api/workspace/monthly/tools?op=meta 回傳（兩者共用 buildMonthlyMeta 的 rx 欄位來源）。
- 讀取條件：ctx.has('monthly.status.view_stats') 且已通過門市範圍檢查（view_all 全部；view_own 只限 store_managers 指派門市，由 moduleStores 決定）。無 view_stats 的角色 meta 不含 stats 也不含 rx，且完全不碰處方箋表。
- 跨店（view_own 非指派門市）沿用現有 403，不洩漏處方箋值。
- 讀取處方箋使用 ctx.admin（該表只授權 service_role）。
- 讀取失敗：meta.rx 回 { failed: true }，其餘 meta 照常；前端顯示「讀取失敗」。
- 寫入端：op=stats 與匯入 kind=stats 不寫兩個張數欄位，多帶的鍵忽略。

## 4. 資料庫

- 表 monthly_prescription_reports 已存在於 DEV（20261028100000_vue_prescription_reports.sql），不需新表、不需改 RLS。
- 審查結論：workspace_save_monthly_summary（DEV 20261029180000_vue_monthly_tools.sql 約 46–64 行）的白名單含兩個張數欄位，但唯一呼叫者 tools route 的 keys 已在路由層移除這兩欄，資料庫函式不會再收到。因此不改資料庫也能達成「不寫入」，且正式區零變動。是否仍要改函式，見第 8 節問題 2。
- 若問題 2 選擇要改：函式內對兩欄「略過不報錯」（現行寫法是遇到白名單外的鍵直接 raise 'invalid field'，改成只對這兩欄 continue，其餘未知鍵仍報錯）。DEV 新增 supabase/workspace-dev/20261118160000_monthly_rx_link_save_whitelist.sql 與 .rollback.sql；正式區草稿 docs/vue-workspace/parity-plan/m7m8-sql/ 目前最大號 49，接續 50-monthly-rx-link-save-whitelist.sql 與 -rollback.sql，並更新該 README 的套用順序（現為 41-42-44-48-47-45-46-49-43）。草稿前先唯讀確認 DEV 現行函式定義與遷移檔一致（尚未驗證）；正式區套用前須先附 DEV 驗證結果；本次不碰正式區。
- 另外 workspace_monthly_roster_page 以 to_jsonb(整列) 回傳 summary，所以兩欄舊值仍在 summary 內，但 buildMonthlyMeta 的欄位白名單會擋掉，不外洩也不顯示。
- 既有 monthly_store_summary 的兩欄舊值保留不清除（作為「舊匯入」退回值）。

## 5. 測試計畫

### 5.1 unit
- 新增 tests/unit/W01a/rx-link.test.ts（自舊版 tests/monthly-stats-rx/rx-link.test.ts 搬移）：處方箋有值含 0 用處方箋；NULL 或無資料時舊值非 0 標舊匯入、舊值 0 暫無資料；只退回該欄；總點值兩邊都有才算、萬分位整數運算、千分位整數顯示；0000 暫無資料；stripRxDerivedKeys 與匯入 payload 不含兩欄；loadRxLinkForStore（或新版改用的讀取函式）權限與範圍（無 view_stats 不碰表、不可見門市不碰表、年月格式錯、找不到門市、0000 不查表）。
- 更新 tests/unit/SPEED/monthly-speed.test.ts（第 59 行假資料）；tests/unit/W01a/monthly-status-rules.test.ts 與 W03 並未引用兩欄，不需改（原稿誤列）。新增 buildMonthlyMeta 單元：有 view_stats 才有 rx、失敗只標 failed、meta.stats 不含兩欄。
- tests/unit/W03/sweeper-2038.test.ts 若調整清除規則（見 5.3）要同步更新。

### 5.2 smoke
- 更新 tests/smoke/W01a：名冊 GET 回應含 meta.rx 結構，頁面可載入。

### 5.3 integration（DEV，測試門市 VW001、ZT01-ZT03）
- 新增 tests/integration/W01a.monthly-stats-rx.spec.ts：處方箋有值回三格正確；無處方箋加舊值非 0 回舊匯入；舊值 0 回暫無資料；0000 暫無資料；無 view_stats 不含 stats 與 rx；view_own 只能讀指派門市、跨店 403；view_all 與應用層 admin 可讀全部；不檢查 roles.is_active 的等價案例（沿用 PERM.context-semantics 手法）；op=stats 與匯入 kind=stats 帶兩欄也不寫入（回讀不變）；讀取失敗時 meta.rx.failed 且其餘 meta 正常；處方箋修改後 meta 立即變動且 monthly_store_summary 無複製寫入；已送審或已確認月份處方箋修改後畫面仍跟著變。
- 更新 tests/integration/SPEED.monthly-speed.spec.ts（第 33–34 行只斷言部分鍵，補 rx 結構）與 PERM.context-semantics；W01a.monthly-status.spec.ts 沒有列兩欄，視需要補斷言。
- 測試月份與清除（原稿的 2038 做法有缺口）：tests/support/sweep-targets.cjs 目前 monthly_store_summary 只在保留月份 2099-% 清除，monthly_prescription_reports 只在保留年份 2038-% 清除，同一個測試月份無法兩表都被清掉。建議用 2099-xx（與既有 W01a 測試、parity 一致），並把 monthly_prescription_reports 加入 RESERVED_MONTH_TABLES（該表無 id 欄，走保留月份規則；非測試門市的列照舊整體中止），同步更新 sweeper 單元測試。這樣不會污染 DEV 既有 2026-04（處方箋 3 筆）與 2026-07（舊匯入）資料。

### 5.4 e2e（1080p）
- 新增 tests/e2e/W01a.monthly-stats-rx.e2e.spec.ts：統計卡第三列三格唯讀（無輸入框）、提示文字、讀取中與讀取失敗（route 攔截）、舊匯入標籤、千分位；編輯表單已無兩個張數輸入框。
- 多角色劇本（走到底）：
  - A 店長看自己門市，三格正確且唯讀。
  - B 同一店長切到非指派門市，被擋，API 與畫面都無處方箋值。
  - C 管理員看全部門市，含 0000 暫無資料。
  - D 業績管理角色在處方箋頁改 ZT01 後，店長重新整理（或依問題 4 的結果切回分頁）即見新值，且月度統計表沒被複製寫入。
  - E 舊匯入規則：舊值 5 無處方箋標舊匯入；補處方箋後改顯示處方箋值；處方箋清空後退回；0 視為有值不退回。

### 5.5 parity
- 更新 tests/parity/map/monthly-status.json 與 tests/parity/W01a.monthly-status.spec.ts，新增 entry rx-link-cells（ui-extract，舊頁第三列對新頁三格逐格比對）、rx-link-store-scope（api-read，舊 getStoreMonthlyRxLink 對新 meta）、並以 write-readback 比對「儲存與匯入不寫兩欄」。每個 entry 須在 spec 以 'id' 引用。舊站與新站共用同一 DEV 資料庫，可寫入同一份處方箋資料；月份用 2099-xx。
- 比對結果有任何差異先視為 must-fix，不預先登記 allowlist。

## 6. 與舊版差異（allowlist）

- 預期無新增條目：規則、權限語意、顯示文字皆與舊版一致，parity 不應出現差異。
- 既有且與本題無關的新版差異（動工時留意，不需登記）：統計存檔走 workspace_save_monthly_summary 並有 p_version 樂觀鎖，已送審或已確認回 409；匯入 kind=stats 需 monthly.import.store_stats 加 view_all；統計資料隨名冊 meta 一併回傳而非獨立呼叫；已停止門市不附 meta（舊版 getStoreMonthlyRxLink 以 include_inactive 對已停止門市也可讀處方箋，新版已停止門市本來就沒有統計卡，故不會顯示）。
- 唯一可能需要登記的情況：新版讀取失敗時以 meta.rx.failed 呈現（舊版為獨立呼叫失敗），若 parity 比對出現差異，才登記 allowlist（decision 為 fix 時 approvedBy 須為 null，等使用者核可）並同步更新 STILL_PENDING。

## 7. 風險

1. 合併 origin/main 有一個內容衝突（lib/performance/prescription-report-context.ts），且 feature/vue-parity 與 main 差距大（37 對 376）；需人工解衝突並重跑處方箋相關測試。
2. HEAD 缺 PR#14，合併前新版處方箋頁可能仍產生 0000 資料；0000 以 store_code 判斷，不依賴資料。
3. 名冊 GET 多一次處方箋讀取；若放在 buildMonthlyMeta 內會序列執行，須併入既有 Promise.all，並確認 monthly-speed 測試不退步、snapshot 基準重錄。
4. 即時讀取代表已送審或已確認的月份，處方箋事後修改會讓畫面數字變動（舊版同行為，已決定）。
5. 前端舊分頁或舊程式若仍送兩欄，必須被忽略而非 400（路由層 keys 已處理；w05 夾具可當回歸）。
6. 測試資料污染：monthly_store_summary 與 monthly_prescription_reports 的清除月份規則不同（2099 對 2038），需補 sweep 規則，見 5.3。
7. 若選擇修改資料庫函式：DEV 現行定義尚未驗證是否與遷移檔一致；未連 DEV 查證。
8. 已用 grep 確認 vue-workspace 其他頁面（總覽、首頁、季度、業績）沒有顯示 monthly_store_summary 的兩欄，唯一顯示處是 MonthlyTools.vue；未開瀏覽器逐頁確認。
9. Vue 工作台是分頁式，使用者可能在「業績管理處方箋」分頁改完資料後切回月度分頁；不處理的話畫面是舊值，見問題 4。

## 8. 待使用者決定（4 題，對應回傳 JSON）

審查後刪除原稿 N1（匯出）、N2（衍生值）：經查沒有匯出或衍生值使用這兩個欄位，不需要問。

- 問題 1（merge）：用什麼方式把舊版已上線內容帶進新版？建議：合併 origin/main，並人工解 lib/performance/prescription-report-context.ts 的一個衝突。
- 問題 2（db）：要不要順便修改資料庫儲存函式的白名單（出草稿 50）？建議：不改，路由層已保證不寫兩欄，正式區零變動。
- 問題 3（place）：三格放在哪？建議：統計卡第三列，並在「編輯統計」視窗內放一行提示文字，說明張數已改由處方箋提供。
- 問題 4（refresh）：在處方箋分頁改完資料，切回每月人員狀態分頁要不要自動更新三格？建議：切回分頁時自動重新讀取。

## 假設（直接採用，不問）

- 舊匯入的兩欄歷史資料保留在資料庫，不清除、不遷移。
- 處方箋讀取失敗時，只有三格顯示「讀取失敗」，其他統計與名冊照常可用。
- 即時讀取，已送審或已確認月份也跟著處方箋變動（舊版已決定）。
- 路由層收到兩個張數欄位直接忽略，不報錯。
- 已停止門市維持新版現況：不附統計與處方箋連動。
- 正式區 SQL 只出草稿，不自行套用（僅在問題 2 選擇要改時才有草稿）。
- 權限與門市範圍沿用新版現有判斷（ctx.has 與門市範圍檢查），不另寫一套。
- 測試用測試門市與 2099 月份，並補清除規則，不碰正式資料與 DEV 既有真實樣本。

## 9. 實作紀錄（2026-11-18）

使用者問卷決定（全照建議）：M1 把 origin/main 整個合併進 feature/vue-parity（已合併，merge commit 1337efbb，唯一衝突 lib/performance/prescription-report-context.ts，保留 main 的 0000 排除與註解）；D1 不改資料庫（只在路由層移除與忽略兩個張數欄位，不出 SQL 草稿）；U1 三格唯讀放在統計卡第三列，編輯統計視窗加一行提示「一般箋、慢箋張數改由業績管理處方箋提供」；R1 切回每月人員狀態分頁時自動重新讀取。

實作與設計文件的差異或補充：

- 讀取函式不用 loadRxLinkForStore，改在 lib/workspace/monthly-meta.ts 新增 fetchMonthlyRx（ctx.admin 讀一筆，0000 以門市清單的 store_code 判斷、不查表，失敗回 { failed: true }）與 buildRxMeta；顯示規則仍是 rx-link.ts 的 resolveRxLinkDisplay。requireStore 改為回傳通過檢查的門市列，tools?op=meta 用它取 store_code。
- 名冊 GET 的 Promise.all 變成四項（rosterPage、fetchSummaries、isAssigned、fetchMonthlyRx）；tools?op=meta 以 Promise.all 讓統計與處方箋並行。
- 重新讀取：MonthlyTools.vue 監看 work.active，切回此分頁時只呼叫 tools?op=meta 並更新 rx（不動名冊、不動開啟中的編輯視窗）；名冊開始重新載入時（新增 loadingRoster prop，由 Monthly.vue 傳入）先清空 rx 並顯示讀取中，避免閃現上一家的數字。
- 舊匯入說明：Vue 匯入統計視窗補一行「一般箋、慢箋張數與健保總點值改由業績管理處方箋提供，不需在此匯入」。
- sweeper：RESERVED_MONTH_TABLES 加入 monthly_prescription_reports（2099-xx）。該表同時在保留年份 2038 清單，原本刪除階段以表名找第一個條件，會讓兩個條件互相遮蔽，已改為依位置對應（tests/support/sweeper.cjs），並更新 sweeper-2038 單元測試。
- 多角色劇本中「跨店被擋」用 supervisor（只有 view_own，指派 ZT01 至 ZT03）驗證；store_manager 在 DEV 角色矩陣同時有 view_all，不適合當跨店對象。DEV 沒有有效的 0000 門市時，0000 的畫面比對自動略過，由單元測試保證不查表。
- parity：沒有新增 allowlist 條目，三個新 entry（rx-link-cells、rx-link-store-scope、rx-link-write-readback）全部直接 pass。rx-link-store-scope 的舊版端是 server action，以舊頁表單呈現的數字對照新版 meta。
- tests/perf/monthly-speed.cjs compare 先拿掉 meta.rx 與 stats 的兩個張數鍵再比對，並檢查 rx 有無與 viewStats 一致；往返次數未重新量測（見 monthly-speed-results.md 補記）。

測試：tests/unit/W01a/rx-link.test.ts（自舊版搬入）、monthly-rx-meta.test.ts；tests/integration/W01a.monthly-stats-rx.spec.ts；tests/smoke/W01a、tests/integration/SPEED 補 rx 結構斷言；tests/e2e/W01a.monthly-stats-rx.e2e.spec.ts（桌機 1440、手機 390，含角色劇本 A 至 E）；tests/parity/W01a.monthly-status.spec.ts 增三項。

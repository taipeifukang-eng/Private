# Vue 測試工作台驗證

## 全站目標進度：巡店月曆與覆蓋狀態（2026-10-28）

- Vue 增加完整月份月曆、單日全部紀錄對話框、工作頁籤明細、前後月與今天、已巡/未巡門市、得分統計、當月 Excel 得分匯出。
- 概覽取全月資料，不以列表 20 筆分頁計算；沿用舊版以巡店紀錄存在認列門市（包含草稿）的語義，沒有自行改為只計完成狀態。
- 門市狀態需 `inspection.view_store_status`；匯出需 `inspection.export`；原本 own/store/all 與經理巡店權限持續生效。
- 搬店沿革以 `source_store_id` 追溯，沒有沿革資料才用清單內唯一的正規化名稱備援；其他門市沿革只供後端計算，不回傳前端。
- `scripts/test-workspace-inspection-calendar.py`：7 項通過，含 23 筆跨列表頁測試、權限、單日完整紀錄、月份切換、原生明細、Excel 下載與桌機/手機。實際讀取下載活頁：一張「巡店得分」工作表、4 列門市。
- `scripts/test-workspace-inspection-coverage.cjs`：5 個案例通過（多階搬店、唯一名稱備援、同名隔離、空月份、循環沿革終止）。Vue build 與 TypeScript 檢查通過。
- 畫面檢視：`.tmp-check/inspection-calendar-desktop.png`、`inspection-calendar-mobile.png`；日曆窄螢幕在容器內捲動，無整頁橫向溢出。
- 全站目標仍進行中；巡店新增/編輯、評分、照片、簽名、GPS、當班人員、完整儲存及其他全站項目尚未完成，不能標示巡店或全站功能對等已完成。

## 五模組原生頁面（2026-10-28）

使用者要求功能內容真正改成 Vue。五個主入口現在皆開啟本地 Vue 元件及獨立頁籤，不另開舊站或嵌入 iframe。

| 模組 | 已移植的核心操作 | 尚未完整移植的舊站子功能 |
| --- | --- | --- |
| 每月人員狀態 | 門市/月名冊、職位/任職狀態/出勤/新人行政階段/特殊身分/支援外務編輯、初始化與提交/確認/退回介面 | 各項獎金補助專用表單、手動增刪人員、各類專用匯入與 PDF 匯出 |
| 巡店 | 分月分店查詢、權限範圍、獨立紀錄明細、檢查分數/備註/照片連結 | 新增巡店、現場評分與上傳、改善追蹤與列印 |
| 活動 | 檔期基本資料新增/編輯、版本衝突、門市排程查詢及儲存 | 部門附件、器材車趟、支援人員、檢核表、發布流程 |
| 業績 | 每店全年列表、單月 18 個目標與實績欄位編輯、版本衝突 | 獎金與季績效分析、處方報表、匯入與門檻設定 |
| 盤點 | 結果分析查詢、Excel 匯入、複盤檢視、盤差原因編輯、明細 CSV 匯出及批次刪除介面 | 舊站離線檔案轉換的三個工具、原因批次匯入及分類彙總視圖 |

以上是五模組核心操作的原生化，並非完整舊站功能對等。既有子功能仍由原測試站提供。

資料庫：DEV 補上盤點複盤欄位、約束及索引，檔案 `supabase/workspace-dev/20261027150000_vue_inventory_compatibility.sql`。有專案識別與 CLI guard；未接觸正式環境、未整批推送歷史 migration。

`test-workspace-five-modules.py`：13 項通過，包括五個原生入口、低權限讀寫拒絕、人員跨模組草稿、關閉確認、實際儲存、人員與業績原子版本衝突、業績單月表單、盤點 Excel 匯入與原因儲存/匯出、巡店明細、活動排程儲存、無 iframe/無跳頁及桌機手機瀏覽器檢查。測試只使用 VW001/VW002 和 Vue 命名假資料。

`test-workspace-five-recovery.py`：4 項通過，涵蓋全站門市只影響新頁、兩份月狀態頁獨立、查詢條件變更禁止編輯舊列、儲存失敗對話框與草稿保留，以及深色/手機人員表單。截圖檢查後修正勾選框尺寸。

原站整合測試更新後重跑 9 項通過；Vue build、Next.js 整合 build、根 TypeScript 檢查通過。

Core Value Review：五入口留在工作台、查詢與編輯使用真實測試資料、失敗保留內容，PASS。Craft Floor Review：1440×950 與 390×844 畫面檢視，表格在容器內橫向捲動、無全頁溢出，欄位與按鈕可辨識，PASS。截圖 `.tmp-check/five-monthly.png`、`five-inventory.png`、`five-mobile.png`。

以下為前一階段的歷史驗證紀錄。

日期：2026-10-27。範圍：第一階段共用框架、巡店列表、活動基本資料。
產品來源：[product.md](product.md)。選定概念：多頁籤作業工作台。

## 環境與隔離

- 初期在 `codex/vue-workspace-dev` 分支的獨立 worktree 實作；依使用者補充，已將新版工作台整合回原總務測試站。
- 原工作目錄既有業務修改保留，新增測試入口、共用登入與權限導覽；未 commit、push、部署正式環境。
- 本次整合入口 http://localhost:3002/workspace/index.html；與原測試站同源。5173/3100 僅為先前獨立開發模式。
- DEV 專案識別 `mjpd…mtqr`；後端需明確啟用並驗證 URL、expected ref 與兩把 JWT key 的 ref/role。
- 已套用 `supabase/workspace-dev/20261027120000_vue_workspace_phase1.sql` 至 DEV；未整批推送舊 migration，未改寫 migration history。
- 已建立專屬 Vue 測試編輯、單店唯讀、無權限帳號與假門市／巡店／活動資料。憑證僅保留於 gitignored `.tmp-check`。

## Core Value Review

產品承諾：跨門市查詢與活動編輯時保留進度，明確處理關閉與衝突。

- PASS：登入後兩個主要入口清楚，頁面主操作為查詢紀錄或儲存活動。
- PASS：每頁獨立門市／月份，全站預設只影響新開頁。
- PASS：草稿切換保留，關閉提示、取消保留、儲存失敗不關閉。
- PASS：批次關閉列出全部草稿；先全部儲存成功再卸載頁面。
- PASS：新建重送不重複；相同版本同時更新只允許一筆成功，另一筆回 409。
- PASS：空資料與網路錯誤分開；錯誤可重試。
- PASS：唯讀、無權限、跨門市、過期登入、撤權皆有真實後端拒絕。
- PASS：登出前仍確認草稿，過期後也能離開再登入。
- PASS：頁籤關閉後銷毀，再開新增頁無殘留表單。

## Craft Floor Review

- PASS：無虛假統計、裝飾燈號、無效按鈕；顯示資料均來自測試資料庫。
- PASS：工作區採側欄、頁籤、表格、表單，無等權重裝飾卡片或嵌套卡片。
- PASS：原生 dialog 提供焦點限制與 Escape；頁籤支援方向鍵、Home、End。
- PASS：欄位有標籤與錯誤訊息，驗證失敗移到第一個錯誤欄位。
- PASS：桌機 1440×950、1366×900 與手機 390×844 檢視；手機無整頁水平溢出，資料表可在容器內橫向捲動。
- PASS：深色模式、手機抽屜、長頁籤名稱省略、儲存狀態都有可辨識文字。
- 修正：手機遮罩縮至側欄外側，避免中心點被側欄攔截；衝突時不重複顯示過期提示。

## 動態驗證

原總務測試站整合：`python scripts/test-workspace-integration.py`，9 項通過。完整權限帳號可見 33 個功能入口；涵蓋原站共用登入、五個優先模組與全站分組、Navbar 進入新版免再次登入、原總務頁另開且保留登入、新版巡店查詢、手機導覽、依權限過濾及共用登出。結果：`.tmp-check/workspace-integration-results.json`；畫面：`integrated-workspace.png`、`integrated-general-affairs.png`、`integrated-mobile-nav.png`。

整合模式 Vue 與 Next.js build 均通過，TypeScript 檢查通過。以下 26 項為先前獨立 5173 模式的驗證紀錄，不算作本次 3002 的重跑結果。

`python scripts/test-vue-workspace.py`：15 項通過。

涵蓋未登入拒絕、無能力拒絕、單店範圍、唯讀寫入拒絕、Origin 拒絕、重送識別、版本衝突、獨立頁籤、草稿切換、取消關閉、雙編輯頁衝突、驗證失敗不關閉、beforeunload、手機抽屜、主題與瀏覽器錯誤檢查（部分合併為同一案例）。

`python scripts/test-vue-workspace-recovery.py`：11 項通過。

涵蓋同時更新、空結果、網路重試、批次關閉取消、批次儲存、快取銷毀、登入過期隱藏、過期草稿確認、重新登入入口、角色撤回與無權限手機畫面。

結果：`.tmp-check/workspace-test-results.json`、`.tmp-check/workspace-recovery-results.json`。
截圖：`.tmp-check/inspections-verified.png`、`conflict.png`、`mobile-form.png`、`mobile-nav.png`、`dark-form.png`、`no-access-mobile.png`。

## 邊界

- 本次是原總務 DEV 測試站中的共用框架預覽；人員月狀態、業績、盤點與總務等入口仍連到原測試頁，尚未全站 Vue 化；活動附件／排程及巡店新增也未遷移。
- 未完成整個歷史 migration 的對帳；本階段增補 SQL 未登錄為整批 migrations 已同步。
- 草稿僅在記憶體；重新整理／關閉瀏覽器提示受瀏覽器限制，不承諾重啟恢復。
- 既有 Next.js 全站建置有原先捕捉 dynamic server usage 的警告，不表示本次工作台端點失敗。
- 本機測試配置不是正式部署配置，正式 HTTPS／同源路由與登入策略須另行驗證。


## 2026-10-28 巡店原生新增／草稿／提交
- DEV 專用 atomic RPC、版本檢查、重送 idempotency、伺服器計分，服務角色限定執行；套用 SQL 在 supabase/workspace-dev/20261028010000_vue_inspection_write.sql。
- DEV 原範本表為空，依原 repository 27 題／220 分業務內容安全補種；拒絕非空表，沒有執行原種子 TRUNCATE。
- test-workspace-inspection-write.py：7 項通過；transaction.cjs 強制人員寫入失敗，確認主檔與明細交易回復。
- test-workspace-inspection-editor.py：9 項通過，涵蓋 27 題載入、GPS 取得與清除、當班人員、扣分、簽名、照片壓縮、草稿關閉取消、草稿保存與資料讀回、提交鎖定、原生明細附件查看。
- Vue build/typecheck 與根專案 TypeScript 檢查通過；最新靜態檔已複製到原測試站 public/workspace；localhost:3002 可操作。
- 明細現可查看當班人員、溫度、備註、GPS、缺失項與數量、照片、雙方簽名。
- 尚未完成全站遷移；巡店仍須補改善追蹤／跨期比較／列印刪除／範本評級管理，及經理、舊資料、手機完整驗收。


## 2026-10-28 巡店比較原生頁
- 對照原 app/inspection/compare：同店最近各 20 筆已完成督導／經理紀錄、不同日期選取、27 項扣分／建議／照片、整體建議、分區展開、差異統計、原生明細頁籤。
- 新增 API 每次驗證 compare、manager_tab 與巡店資料範圍；拒絕跨店、未完成及錯誤巡店類型。歷史已停用但有明細的題目保留；無明細不視為滿分。
- 新增側欄／列表入口；新頁依全站預設門市，開啟後獨立。
- scripts/test-workspace-inspection-compare.py 六項通過：27 題分類計算、跨店／錯誤類型／草稿拒絕、無權限拒絕、原生頁比較與差異篩選、跨頁保留與全站門市不連動、390px 無頁面溢出。
- 圖片 .tmp-check/inspection-compare-desktop.png、inspection-compare-mobile.png。Vue build/typecheck 及根 TypeScript 檢查通過。
- 尚待：比較照片燈箱與缺明細分支測試；完整巡店及全站仍未完成。


## 2026-10-28 改善追蹤與回報
- 原 Vue 測試庫 inspection_improvements／inspection_bonus_config 為空，且缺少業務觸發器（僅 updated_at trigger）。已以 DEV guards 套用 20261028020000_vue_improvements.sql：沿用原專案督導 completed 產生改善項目、3／5／7 天回補扣分 20／10／5% 規則。只在規則表空時補種；不回填歷史項目、不重算既有分數。
- 回補日數採台北日期，總分保留小數；主檔加分彙總先鎖定該巡店，以避免同筆巡店的並行回報覆寫總分。
- 新 Vue 原生列表／狀態／門市篩選／回報頁：原問題與照片、回補規則、改善說明、最多 5 張壓縮照片、提交確認、結果與附件檢視。
- 後端依既有 improvements API 的角色／權限／管理門市或自己巡店資料範圍；回報須具提交權限、管理該門市或管理員。保留原 pending 才能回報的規則；顯示用 overdue 不寫入資料。
- 寫入使用 updated_at + pending 條件防止覆寫；相同本人內容重送可讀回已成功結果；不同內容再次提交拒絕。
- 回報草稿僅頁籤保留，關閉可取消／放棄；不把「全部儲存」暗中變成正式提交。
- scripts/test-workspace-improvements.py 8 項通過：完成巡店自動生成、必填照片與版本衝突、無權限 API 拒絕、回補與重送、原問題照片與上傳、關閉提醒、503 復原、提交鎖定與桌機手機附件。
- 巡店明細補上改善回報區塊、回補分數與原生回報入口。頁面已 build 並複製到原 localhost:3002/workspace/index.html。
- 待補驗收：各管理角色門市隔離、逾期分支、同時提交多個改善項目。全站目標仍進行中。


## 2026-10-28 巡店範本與評級／回補設定
- 新增 Vue 範本設定入口及獨立編輯頁籤：區塊、排序、名稱說明、滿分、缺失選項、依數量扣分及單位、啟停；0–10 評級；改善回補天數／比例／排序／啟停。
- inspection-settings API 每次要求 inspection.template.manage。設定 RPC 使用全域 revision、交易寫入、寫入識別防重送；舊介面直接異動也會提升 revision。
- 拒絕缺失名稱重複、回補天數重疊、非遞增評級及不完整設定。區塊排序沿用資料庫的 1–5 限制。
- DEV SQL 20261028030000_vue_inspection_settings.sql 建立缺少的評級表與版本／交易機制；不批次修改歷史巡店分數。
- 新表單及提交後端讀同份評級，評級變更也改變表單 hash。資料庫新分數異動時重新依設定評級（涵蓋改善回補）。修正 SELECT grade::text 的 ORDER BY 誤用文字排序，改以來源數字欄位排序。
- scripts/test-workspace-inspection-settings.py 已驗證範本防重送／版本衝突、欄位與重疊驗證、回補新增編輯、拒絕無權限、門檻變更實際影響巡店評級、舊表單拒絕、Vue 編輯數量選項、關閉草稿保留、衝突保留欄位及桌機手機。
- 測試只建立停用的 Vue 測試設定，評級整合測試在 finally 還原原門檻。正式環境未更動。
- 尚待：範本讀取與巡店交易寫入之間的設定異動競態、完整回補與評級編輯 UI 分支、全部巡店角色及其餘全站功能。全站目標仍進行中。


## 2026-10-28 巡店列印與刪除
- Vue 原生列印預覽與 A4 報表：門市地址、巡店人員、當班人員、總分評級、全部檢查項、缺失照片、改善回報、整體建議、雙方簽名及手寫補充空間。
- 只將目前選取且仍具查看權限的報表掛入列印輸出區；不混印其他頁籤、工作台導航或已刪除紀錄。列印前檢查圖片載入及逾時；過程切換頁籤或權限變更則中止。
- inspection-detail DELETE 每次檢查 Origin、inspection.delete、巡店範圍與經理權限；workspace_version 條件刪除防止刪除新版本。
- 使用單一主檔 DELETE，既有 FK ON DELETE CASCADE 同交易移除 results、on_duty_staff、improvements，不再分次刪除明細和主檔。
- 確認視窗列門市、日期、編號與相關筆數。失敗保留明細可重試；成功更新列表、明細及列印狀態。其他頁籤草稿保留，不能將已刪巡店再次存回。
- scripts/test-workspace-inspection-print-delete.py 7 項通過：權限／Origin／過期版本、原生預覽與列印、A4 PDF 實際文字與圖片、多報表隔離、取消、失敗重試、刪除後失效與其他紀錄保留。
- scripts/test-workspace-inspection-delete-cascade.cjs 5 項通過：四個表中該假資料均為 0，另一份測試紀錄未變。
- PDF 驗證依 pdf skill，以 Chromium 產生 .tmp-check/inspection-print.pdf，PyMuPDF 檢查 A4 尺寸、文字、圖片擺放數及渲染；相同測試圖在 PDF 去重，應檢查圖片實際擺放次數而非資源物件數。
- 預覽測試的 print mock 原因是 evaluate 返回的函式被額外執行，已修正，實際按鈕只呼叫一次。Vue build/typecheck 及根 TypeScript 已通過，最新版已複製至 public/workspace。
- 尚待完整巡店驗收（各角色門市、經理、逾期、並行回報、設定競態、舊資料）及其餘全站模組；不宣稱全站完成。


## 2026-10-28 巡店設定競態與改善範圍／並行驗收
- DEV SQL 20261028040000_inspection_settings_guard.sql：workspace_save_inspection 在寫入前鎖住設定 revision 並比對由伺服器讀得的版本。設定修改需等待交易完成；版本已變則整筆拒絕。
- templatesFor 在讀取範本及評級前後核對版本，避免跨多次查詢混用設定；POST 將伺服器版本送入 RPC，客戶端無法自行指定。
- test-workspace-inspection-settings-race.cjs 兩項通過：實際新增停用測試範本推進設定版本後，過期版本及缺少版本皆於 RPC 拒絕，沒有殘留主檔。
- test-workspace-inspection-transaction.cjs 回滾測試通過；test-workspace-inspection-write.py 原有七項正常／衝突／重送／權限／提交測試全部通過。
- 新增獨立 Vue 測試主管帳號，只指定 VW001，不更動既有帳號權限。帳密只存 .tmp-check/improvement-manager-account.json，不印到日誌。
- test-workspace-improvement-scope.py 五項通過：主管只能查管理門市且跨店 API 拒絕、同項並行不同回報只有一份成功、同巡店不同項並行回報全部回補入帳、已過日期但資料狀態 pending 保持既有可回報且零回補、資料狀態 overdue 不可回報。
- 保留原系統「顯示逾期」與「資料狀態逾期結案」的差別；GET 不會更改狀態。測試只修改本次標記為 Vue 改善範圍與並行測試的假資料。
- TypeScript 檢查通過；服務仍在原 localhost:3002。巡店仍有經理角色、舊資料、診斷頁及部分 UI 分支待驗收；全站其他模組尚未完成。


## 2026-10-28 我的任務：原生操作第一批

- 側欄「我的任務」改為 Vue 清單；部門／狀態篩選、本人指派、區段進度、最新指派去重及獨立編輯頁籤。
- 主／子項勾選連動、備註草稿、明確儲存、跨頁籤保留已實作；全任務完成依全部區段計算，防止單一區段完成誤標整體。
- DEV 已套用 `20261028050000_vue_tasks.sql`：服務端專用整批 RPC、回執防重送、版本檢查；舊版 logs／協作／範本修改也更新任務版本。僅操作 DEV 專用假任務。
- `scripts/test-workspace-tasks.py`：9 項通過。涵蓋本人範圍、跨區段拒絕、主子項與備註、重試、衝突、權限、Vue 實際儲存、頁籤草稿、排程與手機寬度。
- `scripts/test-workspace-task-transaction.cjs`：4 項通過。涵蓋失敗整批回滾、舊版寫入使版本失效、範本更新使版本失效、同版本並行恰好一筆成功。
- 根專案 TypeScript 與 Vue production build 通過；靜態檔同步至原測試站 public/workspace。
- 桌機／手機畫面已檢視，清單與輸入沿用既定字級、邊界、色彩及工作頁籤；圖表狀態來自已儲存資料。內部捲動區需要另捲至表單檢視，整頁截圖不能代表下方內容。

Core Value review：本人開啟任務→編輯備註→切換頁籤→返回→儲存，實際資料庫查回一致。資料寫入與協作衝突已驗證。完整恢復流程及全站對等仍未通過，不標模組完成。
Craft review：既定清單／工作頁籤設計維持；無虛構狀態／裝飾性卡片；已檢視 1366px 與 390px 排程畫面。仍須補表單捲動截圖及錯誤／空資料分支。

剩餘：週刻度甘特、原版依任務總日期推算無日期項目、區段負責人、完成並返回、管理者非本人入口、協作刷新提示與完整失敗復原；任務範本編輯／派發／封存／儀表板仍待實作。上述清單持續追蹤，不以這批原生核心操作代表完整任務模組完成。


## 2026-10-28 我的任務：週甘特與復原補齊

- 原生週甘特：週一起算，任務總日期優先、項目日期／指派日期備援，項目範圍裁切、未排期項目依順序分配週次、主子項階層及負責人。進度以已儲存紀錄呈現；推算週次明確標示。
- 作用中任務每 30 秒檢查版本，只提示、不覆蓋草稿；失敗可重查。版本衝突可另開最新版本核對，原頁草稿不消失。
- 完成返回先儲存，再開啟原生我的任務並關閉當前編輯頁；失敗保留頁面與草稿。無新修改時亦重新驗證／寫入完成狀態，避免靜默使用舊版本。
- 修正 App 的任務元件未接入互斥分支、同時掛載活動編輯器的問題。活動編輯僅限 campaign-edit，避免覆寫任務頁的 close-save 回呼。
- `test-workspace-task-schedule.cjs`：5 項通過（週邊界、負責人、未排期分配、範圍裁切、日期備援、空項目與無效日期）。
- `test-workspace-task-recovery.py`：5 項通過（協作提示、版本衝突另開核對、提交失敗重試、週甘特與手機、完成返回且保留其他草稿）。
- 實際截圖 `.tmp-check/task-weekly-desktop.png`、`task-form-desktop.png`、`task-form-mobile.png` 已檢視。手機表單無全頁水平溢出，週表自身可水平捲動；主子項及備註層級可辨識。
- TypeScript 與 Vue build 通過，已同步 public/workspace。

Core Value review：核心填寫、保存、衝突及返回流程通過；系統真實狀態與儲存結果一致，原稿保留。Craft review：週刻度、推算與責任人皆提供操作資訊，既有表格／欄位風格維持；桌機與手機表單實際可讀。全模組仍待管理者非本人入口、列表空／錯誤分支，以及後續範本／派發／封存／儀表板，維持部分完成。

補充驗證：test-workspace-task-close.py 通過。關閉取消保留草稿，全部儲存後關閉確實寫入任務資料，且未發出任何活動 API 請求；任務頁不再掛載無關活動元件。


## 2026-10-28 封存任務清單／明細／複製

- 原生已封存清單可依建立月份（台北時區）及名稱篩選；明細包含發起人、負責人、部門、建立／完成／封存時間、封存者、協作者、主子項最後進度與備註、週甘特及完整執行軌跡。
- 封存唯讀，複製前確認；副本以相同範本、本人／本人部門建立，進度歸零，不複製原協作者或歷史 logs。新增本人 collaborator，修正舊版副本無法出現在我的任務的缺漏。允許明確再複製一份，每次操作獨立回執。
- archiveScope 保留 profiles.role=admin 管理員保底；其他主管須 task.view_archived，且只可讀 created_by／archived_by 本人的紀錄。單純 collaborator 不會取得封存範圍。所有 API 重驗權限與範圍。
- DEV 套用 `20261028060000_vue_task_archive.sql`；copy RPC 僅 service_role，來源版本檢查、交易內建立任務＋協作、重試回執及相同請求並行鎖。
- `test-workspace-task-archive.py`：8 項通過（主管範圍、實際進度與軌跡、版本與防重送、副本可操作且原始資料不變、無權限拒絕、唯讀與取消、失敗重試到新任務實際儲存、桌機手機）。
- `test-workspace-task-copy-concurrency.cjs`：3 項通過（同請求並行只新增 1 任務＋1 協作者、來源版本不變、匿名無法呼叫 RPC）。
- 根 TypeScript、Vue build 通過，public/workspace 同步，地端 3002 持續運行。

Core Value review：封存紀錄→確認複製→新任務出現在我的任務→勾選儲存，實際資料回讀通過；取消／失敗均不假裝成功。Craft review：桌機與 390px 手機畫面已檢視，基本資料逐欄排列、紀錄表自身可捲動，無全頁溢出；成功提示描述複製結果，不持續宣稱副本仍未完成。

仍待：從任務管理將完成任務封存、範本建立／編輯／刪除、派發與重新指派、儀表板、主管非本人現行任務入口，以及封存清單篩選／空資料等剩餘分支驗收。未宣稱全任務模組或全站完成。


## 2026-10-28 任務管理明細與整批封存

- 側欄任務管理已接 Vue 現行範本清單及獨立管理明細；顯示所有現行指派的實際主／子項完成數、協作者、日期、備註、週排程及執行軌跡。
- 管理員可看全部，主管須 task.manage 且只看本人建立範本；封存另外檢查 task.template.delete，與舊版實際權限碼一致。管理員保底保留。
- 整批封存會核對目前全部未封存指派與版本，並在資料庫檢查每個主項、子項最後事件為完成。狀態欄位 completed 不能繞過實際進度。零項目不可封存。任一筆失敗則整批回滾。
- DEV `20261028070000_vue_task_archive_action.sql` 提供服務端專用 RPC、來源範本／指派鎖、回執防重送。保留範本、協作及 logs；封存後移出現行／我的任務，可由原生封存頁查閱。
- `test-workspace-task-management.py`：8 項通過（管理範圍、跨區段未完成拒絕及整批回滾、版本衝突、無權限拒絕、原生明細與取消、排程手機、失敗重試到歷史可查、回執防重送）。
- `test-workspace-task-archive-action-concurrency.cjs`：3 項通過（同版本並行只有一個操作成功、範本／協作／logs 保留且封存時間／人／完成時間正確、匿名不能呼叫 RPC）。
- 根 TypeScript 與 Vue build 通過；已同步 public/workspace。

Core Value review：核對現行指派→確認整批封存→現行清單消失→原生歷史可查，已在 DEV 真實資料驗證；失敗不部分封存、重試不重複。Craft review：`.tmp-check/task-management-desktop.png` 與 `task-management-mobile.png` 已檢視，資訊層次與既定工作台一致，手機無全頁水平溢出，表格在自身容器捲動。

仍未完成：任務範本建立／編輯／複製／刪除、指派與重新指派、個別指派刪除、儀表板等。任務管理只完成核對／封存流程，未宣稱完整模組或全站完成。


## 2026-10-28 範本新增／編輯與原子指派

- 原生流程編輯器：專案標題／說明／總日期，部門區段選人／搜尋，主子項名稱／說明／必填／日期，新增、確認刪除及順序調整。管理清單可新增、明細可依權限開啟編輯。獨立頁籤草稿與關閉儲存沿用工作台。
- 新增範本、指派及協作一次交易；建立者必含在新協作。編輯同步日期、人員與既有 section_id；無 logs 的移除人員會刪除協作，有 logs 者保留。歷史 logs 不刪除。
- GET／POST 檢查管理範圍，編輯另需 task.template.edit；已有完成指派（含封存）不能編輯。範本／所有指派版本比對、會員部門驗證、回執防重送皆於後端落實。
- DEV `20261028080000_vue_task_template.sql` 已套用；模板版本 trigger 亦涵蓋舊版更新。所有新增資料為 Vue namespaced 測試內容。
- `test-workspace-task-template.py`：8 項通過（輸入與會員驗證、原子新增及防重送、任務活動衝突、既有協作換區段／日期更新、保留歷史協作者、無權限拒絕、瀏覽器階層／排序／儲存、跨頁籤草稿與手機）。
- `test-workspace-task-template-transaction.cjs`：3 項通過（建立指派失敗回滾先前範本、編輯日期失敗回滾模板及版本、完成紀錄於交易內阻擋修改）。
- `test-workspace-task-template-recovery.py`：6 項通過（API 完成鎖定、建立不暗授編輯權、UI 鎖定、驗證錯誤可修正、失敗重試、關閉儲存真實資料）。
- TypeScript、Vue build 通過，public/workspace 已同步。

Core Value review：專案與部門人員／主子項設計→儲存→產生可操作指派，資料與瀏覽器流程通過；錯誤不遺失草稿。Craft review：桌機及 390px 手機上方表單畫面已檢視；輸入欄位、按鈕及資料層級沿用現有工作台，無全頁水平溢出。再次修改後清除上次儲存成功提示，避免草稿誤認已儲存。

仍待：複製範本、獨立派發／重新指派、模板及指派刪除、儀表板；範本原生功能另須補多區段／舊資料／刪除有紀錄區段後協作者讀取等完整分支驗收。全站仍未完成。

## 2026-10-28 範本複製與獨立派發／重新指派

- 管理明細可開啟獨立 Vue 複製及指派頁籤。複製保留範本階層、最新現行指派的協作區段，加入建立者；新任務清空進度、軌跡及日期。沒有現行指派也會建立可操作的新任務。
- 獨立派發提供搜尋、部門篩選、選人及日期，明確提示選中者可操作整份流程，提交前再次確認；保留既有執行 logs。僅更新最新未封存指派，只有封存紀錄則建立新指派，避免改動歷史。
- 管理範圍於 API 重驗；DEV `20261028090000_vue_task_dispatch.sql` 使用服務端專用 RPC、範本及指派鎖、版本檢查與防重送回執，一次交易完成操作。未修改正式環境。
- `test-workspace-task-dispatch.py`：8 項通過（所有權、複製內容與重試、重新指派保留軌跡及衝突、封存歷史隔離、權限拒絕、原生取消與失敗重試、草稿及關閉確認、日期真實寫入）。
- `test-workspace-task-dispatch-transaction.cjs`：5 項通過（並行重試只新增一份、來源不變、失敗保留資料且不留成功回執、競爭寫入只有一個成功、匿名禁止 RPC）。
- 根 TypeScript 與 Vue build 通過，已同步 public/workspace。

Core Value review：管理明細→複製／選人派發→確認→真實資料回讀通過；失敗可重試，關閉不繞過提交確認。Craft review：桌機及 390px 手機截圖已檢視，範圍提示、搜尋、人員及日期清楚，無全頁水平溢出。

尚未完成：模板及指派刪除、儀表板，與多區段／舊資料等完整對等驗收；其餘全站模組仍依清單逐項遷移。本次不代表全站完成。

## 2026-10-28 側欄游標分層展開

- 預設精簡模組列；桌機游標移入展開完整側欄，指向模組只展開該組功能。以覆蓋方式展開，工作區座標不變；開啟功能後收合，不影響已開工作頁。
- 手機採點按單組展開；鍵盤 Enter／Space、左右方向鍵、Escape 可操作，aria-expanded 與內容同步。沿用伺服器權限過濾及搜尋空結果。
- Vue 型別檢查與 Vite build 通過；public/workspace 已同步。瀏覽器驗證單組切換、移出收合、工作區不位移、鍵盤、功能實際開啟、搜尋空結果、手機觸控與無水平溢出通過。
- Core Value review：桌機與手機皆可由模組開啟「我的任務」，不必依賴滑鼠懸停才能操作。Craft review：1366×900 與 390×844 畫面已檢視，維持既有色彩、選單層級及焦點提示；桌機展開覆蓋部分內容為預期行為。

## 2026-10-28 全部已原生模組重查與業績補齊

- 依新舊業績截圖追查完整頁面及其子元件/API，產生 `feature-parity-review.md`，覆蓋人員月狀態、業績、活動、盤點、巡店、任務與共用框架。活動七子頁、月狀態補助與明細、盤點三套離線工具仍未遷移，明確保留部分完成狀態。
- 業績補回完整逐月欄位與明細、月獎金權重／達成率／活動日折減、季度目標／實績／季回補、每店五檻金額設定及 Excel 匯入。計算直接 import 舊版 `lib/performance/bonus-calc.ts`，未另寫不同公式。真實 0 與未填值區分，閾值讀取失敗不默默改用預設。
- 處方箋提供年度跨店報表→月份明細、四欄編輯、總慢箋計算、搜尋、Excel 範本下載／匯入；頁籤草稿與關閉確認保留。已修正年度→單月資料被誤判為草稿而阻擋載入的問題。
- 每月獎金提供 21 項欄位、單月／季合計、督導／門市／員工／項目篩選、排序、合計、年度平均兩種分母、Excel 匯入與完整錯誤／略過訊息。
- 新增 `performance-tools/[resource]` 僅允許明列的既有業務處理器；先執行 workspace DEV guard、登入與權限檢查；閾值另檢查門市及五檻非負整數。原有正式 API 檔案未修改。
- DEV 缺少處方箋獨立表與品牌獎金等相容欄位；經兩層環境 guard 套用 `20261028100000_vue_prescription_reports.sql`、`20261028101000_vue_bonus_compatibility.sql`。不複製真實營運資料、不向 PROD 套用。DEV 移除舊的「非零優先」匯入 trigger，以匹配目前匯入 API 的明確零值更新語意；未刪除既有紀錄。
- `test-workspace-performance-parity.py`：9 項通過。使用 VW001 與 2038 年假資料，驗證權限、閾值、三類 Excel／回讀、處方箋錯檔不改資料、公式（活動日月獎金 4,400、季回補 1,100）、原生編輯／年度鑽取／季度彙總、手機及瀏覽器錯誤。
- `test-workspace-performance-recovery.py`：3 項通過。原生匯入取消／失敗重試／清單重載、處方箋失敗後跨頁籤草稿及關閉提醒、實際瀏覽器下載。
- `test-workspace-native-module-review.py`：11 個已原生主入口逐一開啟，無載入 alert 或瀏覽器例外。此為載入巡檢，不能等同未搬移子功能完成。
- 測試 Excel 由 `make-workspace-performance-test-files.cjs` 產生；測試憑證仍只在 gitignored `.tmp-check`，不印出。
- 根 TypeScript、Vue 型別及 Vite build 通過；同步 public/workspace；3002 HTTP 200。

Core Value review：月／季金額與舊共用公式一致，匯入／編輯均以 DEV 真實資料回讀確認；錯誤可修正重試、不清除草稿。Craft review：1440px 桌機及 390px 手機已檢視，季度展開使用整列避免空白拉高相鄰摘要，寬報表在自身容器捲動；年度頂部閾值採緊湊對齊以保留資料掃讀空間。

限制：門檻與處方箋維持既有 API 更新語意，尚無跨人同時編輯的原子版本衝突保護；匯入仍沿用各舊 API 的部分成功／略過規則。其餘角色、舊資料與長清單分支尚未完整驗收，不宣稱業績或全站已全部完成。

## 2026-10-28 組織與門市／店長指派

- 原生入口、列表／姓名員編職稱門市搜尋、獨立編輯工作頁、多門市選擇、單店與全部解除、具名解除確認、草稿／錯誤保留已接通。整個組織與門市目標仍未完成，範圍見 organization-migration.md。
- 新 API 與 session/sidebar 使用 `store.manager.assign` 或 `store.manage`；DEV guard、Origin、後端權限與參數驗證。新 SQL RPC 僅 service_role 可執行，一次交易更新主要 store_manager 指派，保留其他角色和非主要指派，快照衝突 409，相同結果重送無重複記錄。SQL 只套用 DEV。
- `npm --prefix vue-workspace run build`、`npx tsc --noEmit --incremental false` 通過。
- `scripts/test-workspace-store-managers.py` 通過：新增／回讀、多門市、重送、舊快照、兩個並行請求僅一成功、停用門市、重複參數、跨 Origin、無權限讀寫、原生搜尋／編輯／儲存、解除取消／確認、解除全部、錯誤保留草稿、關閉繼續編輯、全部儲存後關閉（含第二層解除確認）、手機無橫向溢出與無 runtime error。
- `scripts/test-workspace-store-managers-transaction.cjs` 通過：以非主要指派唯一鍵衝突逼出 insert 失敗，確認沒有部分新增；既有非主要與督導角色保留；anon 無法呼叫 RPC。
- 使用專用 DEV 新增帳號與三間門市；測試完經 `cleanup-workspace-store-managers-dev.cjs` 驗證 fixture 身分後清除。準備腳本為 `seed-workspace-store-managers-dev.cjs`。不修改三間正式來源門市之業務資料。
- Core Value / Craft Floor：PASS（店長指派本項）。1440×1000、390×844 截圖 `.tmp-check/store-manager-desktop.png`、`store-manager-mobile.png`；必要操作有名稱、儲存回饋、搜尋／空值與錯誤狀態。巢狀對話框測試發現共用標題 ID，已改成唯一 ID 並回歸通過。
- 尚未據此宣稱全組織模組或其他門市功能完成；店長職稱停用後只解除的 UI 分支及大量人員資料量仍可補更廣驗收。

## 2026-10-28 經理／督導管理原生化
- 已接清單、管理職稱搜尋、經理／督導與營運門市統計、督導／兼任店長各自獨立編輯、多店、代理確認、主責／代理狀態、單店／全部解除及關閉前儲存。主責補正只處理督導職稱，經理管理與其他角色保留；相較舊 API 修正跨角色刪除與分次寫入風險。
- 權限：讀取沿用 store.manager.assign / store.supervisor.assign / store.manage 任一；各角色寫入分開檢查。DEV guard、Origin、UUID／角色／代理集合驗證；總部與停用門市不可新增。新 RPC 只授權 service_role，資料快照含角色及主責旗標，交易鎖下重查、同結果重送無重複、衝突 409。
- `scripts/test-workspace-supervisors.py` 通過：主責建立、重送、缺代理確認拒絕、代理建立、解除主責補位、經理共存、兼任店長保留、舊快照、停用／總部／不符職稱／錯誤角色／代理集合拒絕；專用 supervisor-only 與 manager-only 角色交叉寫入 403、viewer 讀取 403、並行只一成功；原生搜尋／代理取消與確認／多店／衝突保留草稿／重載核對／全部儲存後關閉／手機無橫向溢出。非 fixture 的原始指派前後一致。
- `.tmp-check/supervisor-rollback.sql` 於單一測試交易建立限定 fixture 的失敗 trigger，強制新增失敗，確認刪除與主責變更全部回滾、anon/authenticated 無執行權；交易末 ROLLBACK，測試 trigger 不留存。
- Vue build/typecheck、根目錄 TypeScript 檢查通過。Core Value / Craft Floor：PASS（本項）。1440×1000 與 390×844 截圖 `.tmp-check/supervisor-desktop.png`、`supervisor-mobile.png` 確認角色／代理資訊與操作可讀。
- 專用六個 DEV 使用者、四間門市及兩個權限角色已以 `cleanup-workspace-supervisors-dev.cjs` 驗證識別後清除。種子腳本 `seed-workspace-supervisors-dev.cjs`；正式區未變更。
- 限制：全表快照採保守衝突判斷，不同人同時指派也可能要求重新載入；大量資料量與歷史多主責異常可再補驗收。組織與門市整體遷移仍未完成。

## 2026-10-28 門市主檔與搬遷沿革原生化
- 新版門市管理列表、搜尋、停用切換、管理者、最新月份員工統計、新增／編輯完整欄位、GPS 成對貼上／目前位置／清除／Maps 連結、停用確認已接通。
- 搬遷保留同一 store ID，五項識別欄位更新與沿革新增採同一交易。補建歷史、刪除、刪除帶入重填只改沿革；編輯不直接改 store_code。歷史編輯開獨立頁保留主頁草稿。
- 新 RPC／請求表僅 service_role 存取；快照版本、請求防重、代碼唯一鍵衝突、Origin 與細分權限後端驗證。DEV 原缺 store.store.view / view_inactive / edit 定義，依既有 RBAC 腳本補定義，不授權既有角色。
- Vue build/typecheck、根目錄 TypeScript 通過。
- `scripts/test-workspace-stores.py`：新增、編輯、GPS 配對、重複代碼、重送、版本衝突、搬遷 ID 與歷史正確、沿革刪除／補建不變更主檔、非法日期、viewer 讀寫拒絕、原生搜尋／編輯／貼 GPS／停用取消確認／手機／搬遷與刪除重填皆通過。
- `scripts/test-workspace-stores-create.py`：原生新增、模擬瀏覽器 geolocation、清除座標、資料庫回讀、關閉繼續編輯、儲存失敗保留草稿、儲存後關閉通過。
- `scripts/test-workspace-stores-permissions.py`：專用 view-only / create-only 角色驗證；停用清單與 ID 讀取不能繞過、越權編輯拒絕、僅新增使用者儲存後可唯讀查看自己新增的資料。
- `.tmp-check/stores-transaction.sql`：在 rollback 測試交易中注入沿革 insert 失敗，主檔、沿革、請求收據全部回滾；1105 筆最新月份人員＋5 筆前月資料，扣除 2 筆 resigned 正確為 1103，不受 1000 預設上限影響。anon/authenticated 不可直接呼叫 RPC。
- Core Value / Craft Floor：PASS（本次主檔與沿革範圍）。1440×1000、390×844 截圖 `.tmp-check/stores-editor-desktop.png`、`stores-editor-mobile.png`；手機無水平溢出，停用／搬遷／刪除確認具名，失敗不清除草稿。
- 測試專用門市、沿革、請求收據與細分角色／帳號經 `cleanup-workspace-stores-dev.cjs` 驗證識別後清除；正式區與三間複製來源門市未改。
- 門市整個模組仍為部分完成：整合 Google 多門市地圖及人員異動子頁尚待原生化。門市員工月份子頁後續進度見下節；單店 Maps 外連不視為整合地圖已完成。

## 2026-10-28 門市員工月份子頁驗收
- `StoreEmployees.vue` 與 `/api/workspace/store-employees` 接入門市列表「員工」按鈕。沿用 authenticated RLS，分頁讀取月份與人員；最新月份預選、離職切換、姓名／員編／職位搜尋、職位排序、兼職／藥師及每月狀態完整呈現。
- 每一頁固定門市、保留自己的月份與篩選。每月人員狀態入口依 view_all 或 view_own 加門市指派判定，帶入目前門市和月份；不能用全站預設門市更動既有員工工作頁。
- `python scripts/test-workspace-store-employees.py` 通過：1105 筆 September、5 筆 August 完整讀取，最新／歷史／空月份、非法 ID／月份、南港店複製資料數量核對、viewer 403；原生入口、排序、離職、搜尋、藥師與兼職、獨立頁籤、每月人員跳轉、503 後重試及無瀏覽器 runtime error。
- Vue typecheck/build、根目錄 `npx tsc --noEmit --incremental false` 通過，建置同步至地端 `public/workspace`。
- Core Value Review：PASS（本子頁）。月別名單與來源一致，統計不受搜尋影響，無可查看資料與讀取錯誤分開呈現。原頁屬唯讀名單，實際更新導向既有原生每月人員狀態。
- Craft Floor Review：PASS。實際檢視 1440×1000、390×844 截圖 `.tmp-check/store-employees-desktop.png`、`store-employees-mobile.png`；有標籤與鍵盤焦點，人員表不裁切，狀態以文字表示。
- `cleanup-workspace-store-employees-dev.cjs` 驗證測試門市 ID、VWEMP 代碼及名稱後清除專用門市；回查 monthly_staff_status 確認零筆殘留。三間複製資料與正式區不變。
- 範圍限制：本子頁不是 `employee-management` 或 `promotion-management`；兩者包含歷史與異動寫入，仍待實作，組織與門市整體目標保持未完成。

## 2026-10-28 門市員工主檔／歷程原生化
- 新增 StorePersonnel 與 store-personnel API，接門市列表「員工主檔／歷程」。列表包含員編、姓名、目前職位、到職日、最後升遷日；每個員工歷程開獨立工作頁，不共用會被後續請求覆蓋的對話框。
- 後端沿用舊 profile admin 或營業部 member/manager 且非指定督導／店長職稱的查看條件，加既有 workspace 門市存取權限。所有業務查詢走 authenticated RLS，員工 ID 須屬該門市，歷程再限定門市與員編；列表與歷程皆 500 筆迴圈讀取。
- 復用既有 promotion-level 格式：新人／行政階級、代理店長暫代職務、備註移除階級標記，保留其餘備註與日期倒序。空紀錄不假造歷史。
- `scripts/test-workspace-store-personnel.py` 通過：兩名專用員工與三筆歷程，日期順序／階級文字／備註核對、空歷程、非該店員工 ID 404、錯誤門市 ID 400、viewer 403；原生入口、搜尋、獨立頁籤、503 重試、手機無水平溢出、無 runtime error。
- Vue build/typecheck 與根目錄 TypeScript 檢查通過；地端 public/workspace 已同步。
- Core Value / Craft Floor：PASS（唯讀主檔歷程範圍）。實際檢視 `.tmp-check/store-personnel-desktop.png` 1440×1000 與 `store-personnel-mobile.png` 390×844；日期、異動前後、備註分段可讀，無裝飾性時間軸節點，載入失敗清除舊資料並保留重試。
- 專用 fixture 已由 `cleanup-workspace-store-personnel-dev.cjs` 核對門市 ID／VWPER 代碼／名稱後清除，員工／歷程／月狀態三表回查零筆。正式區與既有業務資料未改。
- 尚未驗證大量歷程 UI 與各營業部職稱組合的獨立測試帳號。批次升遷 promotion-management 為另一寫入頁仍待完成，不將本項查閱當作升遷寫入已完成。

## 2026-10-28 批次升遷匯入與預覽基礎（未完成寫入）
- 新增 `lib/workspace/promotion-import.ts`：500 筆／5 MB 限制、逐列驗證、完整西元日期、1900/1904 Excel 日期序號、格式化員編保留前導零、重複列、職位／新人與行政階級、公式／錯誤儲存格拒絕、來源列號與乾淨兩工作表範本。
- 新增 DEV `store-promotions` API：GET 選項／下載範本；POST Excel 或 JSON validate 預覽；採 employee.promotion.batch 加既有門市人事 profile 條件、Origin、門市有效性及 authenticated RLS 員工核對。錯誤回傳列／欄／原因；目前拒絕 save 操作，未接 UI 導航、不宣稱可儲存。
- `node scripts/test-workspace-promotion-import.cjs` 通過：西元／民國年、無效日、Excel 日期系統、員編前導零、有效與無效階段、同日新人不同階允許／完全重複拒絕、空列保留來源列號、公式／Excel 錯誤、標頭缺漏／重複、大小與筆數上限、範本欄位。
- `python scripts/test-workspace-promotion-preview.py` 通過：設定與範本、JSON 預覽、真實 xlsx multipart 上傳、員編／姓名不符、非法操作／檔案、Origin、viewer 403，預覽前後 history 完全相同。fixture 沿用獨立 VWPER 門市兩名員工，測完驗證識別後清除三表相關資料。
- 根目錄 TypeScript 檢查通過；本次無 Vue 畫面修改。
- DEV 實際查詢 `pg_trigger`（`.tmp-check/promotion-triggers.sql`）：employee_movement_history 非內部觸發器僅 trg_employee_movement_history_updated_at → p1c_touch_updated_at，沒有 promotion／movement 同步觸發器。不可依 repo 舊 migration 推斷目前已自動同步。
- 下一步仍須交易 RPC（歷程＋月份同步、版本衝突與請求防重）、原生編輯工作頁、匯入覆蓋草稿確認、儲存／關閉及回滾測試。完整批次升遷與組織門市遷移尚未完成。

## 2026-10-28 批次升遷原生編輯與交易儲存
- `StorePromotions.vue` 已接門市列表「批次升遷」：手動新增／刪除、職位／新人／行政階級、日期、備註、Excel 下載與匯入、逐列驗證、匯入取代草稿確認、具名儲存確認、關閉前繼續編輯／全部儲存後關閉。全站預設門市不變更此固定門市工作頁。
- `20261028150000_vue_store_promotions.sql` 已僅套用 DEV：snapshot 涵蓋相關員編的主檔、歷程、跨店月份與來源門市；鎖後驗證版本，單一交易新增歷程、月份時間線與已生效正式職位主檔、請求收據。RPC 只授權 service_role，收據表 RLS 且無 anon/authenticated 權限。
- 時間線保留較晚升遷；同月採月末已發生的最後正式升遷，同日新人較高階優先；代理店長只加代理標記。未來生效不提前更新今天主檔。相同請求重送回傳原結果，新請求重複升遷拒絕。全表交易鎖採保守設計，後續大量使用時需評估鎖等待。
- `scripts/sql/test-workspace-promotions-transaction.sql` 經 DEV guard 執行，全部在 rollback 交易內：回溯升遷、後續升遷月份界線、調店後月份、重送與版本衝突、重複紀錄、代理保留正式職位、同日新人二階、未來不提早改主檔、注入月狀態 UPDATE 失敗後全量 snapshot 不變、RPC 權限。測試 trigger 與 fixture 隨 ROLLBACK 清除。
- `scripts/test-workspace-promotions.py` 通過：真實 Excel 載入／取消與確認取代、錯誤列、儲存確認取消、模擬 503 後草稿保留、實際儲存與月職位回查、API 重送相同結果、舊版本 409、無 runtime error。
- `scripts/test-workspace-promotions-concurrency.cjs`：同一 snapshot 兩個並行升遷只一成功、一個 WORKSPACE_CONFLICT；日期相同只有一筆歷程；匿名 snapshot RPC 拒絕。
- `scripts/test-workspace-promotions-close.py`：繼續編輯保留草稿，全部儲存後關閉可在確認對話框中完成，回查歷程正確。修正職位／階級 select 的明確 aria-label。
- 匯入單元測試與預覽 API 回歸通過。Vue typecheck/build 與根目錄 TypeScript 檢查通過；地端資產已同步。
- Core Value / Craft Floor：PASS（已列驗證範圍）。檢視 `.tmp-check/promotions-desktop.png` 1440×1000 與 `promotions-mobile.png` 390×844；具名欄位、手機單欄無橫向溢出，草稿星號、操作確認、錯誤與成功狀態可辨識。500 筆實際表單互動效能未壓測。
- 專用 VWPER 門市、主檔、歷程、月份與 promotion receipt 已清除，四表回查零筆；正式區與三店複製資料未改。
- 殘留：未來生效日到期的主檔自動啟用、各營業部職稱組合的專用帳號驗證、500 筆端到端壓測仍需補齊。整個組織與門市目標仍未完成。

## 2026-10-28 升遷到期排程、500 筆及細分權限驗收
- DEV `20261028160000_vue_promotion_activation.sql` 建立私有到期佇列、收據 trigger、service-role worker 及 pg_cron 工作 `workspace-dev-promotion-activation`（每分鐘）。只收錄新版工作台建立的未來升遷，套用台灣日期；未處理佇列刪除／修改日期依目前來源歷程判斷。套用時間線時補同步儲存後才建立的月份。
- `scripts/test-workspace-promotion-activation.cjs`／對應 SQL：rollback 交易內驗證未到期不更新、到期主檔、事後新增月份、較晚升遷保留、代理不覆蓋正式職位、漏跑補處理、重複執行零筆、未入列舊資料不變、月份故障時主檔與處理狀態一起回滾、刪除紀錄取消佇列、anon/authenticated 不可執行。原批次升遷交易測試回歸通過。
- 已查 `cron.job` 為 active=true、schedule=* * * * *；`cron.job_run_details` 在 2026-10-28 15:04 UTC 有 succeeded 實際執行紀錄，並非只建立 SQL 檔。
- `scripts/test-workspace-promotions-load.py`：原生 UI 上傳 500 筆，載入約 3.42 秒，最後一筆可編輯；驗證確認後儲存約 3.03 秒，500 筆月職位回查一致，無 runtime error。超過 500 筆前後端限制已有單元測試；單次測量不是容量 SLA。
- 五個專用角色帳號：營業部 member 助理與 manager 經理具有 batch 權限但未指派門市時，RLS 讀取／驗證／儲存皆 404；加入測試門市指派後可驗證並實際儲存。指定督導職稱、其他部門、缺 batch 權限均在讀取／驗證／儲存拒絕 403。`scripts/test-workspace-promotion-permissions.py`（未指派與 --assigned 兩模式）。未以 service-role 讀取繞過門市範圍。
- 前端補上未來生效主檔自動更新說明，Vue typecheck/build 通過並同步地端。
- 排程採用官方 [Supabase Cron](https://supabase.com/docs/guides/cron) 與 [安裝說明](https://supabase.com/docs/guides/cron/install)；可從 cron.job_run_details 檢查失敗。單次工作最多 500 名員工，超過者下次補跑；持續資料錯誤會使該次交易回滾，需檢查排程失敗紀錄，不宣稱永不延遲。

- 真實排程寫入驗證：將兩筆專用 fixture 未來升遷日期移至當日，`scripts/test-workspace-promotion-scheduled-dev.cjs` 確認兩筆佇列 processed_at 均有值、兩名員工主檔職位均更新為經理；未直接呼叫 worker 來取代這次排程驗證。
- `cleanup-workspace-promotion-load-dev.cjs` 核對 VWPER 門市與五名 Vue 升遷權限驗證帳號／vwpromo 角色後清除；500 筆主檔、月份、所有測試升遷、收據與到期佇列回查無殘留。正式資料庫未存取／修改。

## 2026-10-28 門市整合地圖（實際底圖待來源授權）
- 新增 `StoreMap.vue`、共用 SDK loader 與 authenticated `store-map` API；入口位於新版門市管理。Google AdvancedMarkerElement、標記／清單雙向選取、資訊窗、搜尋同時篩選標記與清單、顯示搜尋範圍、外開 Maps、停用切換、無有效定位與無結果、載入失敗與重試皆已接通。多頁只載入一次腳本，各頁搜尋與選取獨立，關閉清除標記／事件，切回處理畫布大小。
- SDK 依 [Google 載入文件](https://developers.google.com/maps/documentation/javascript/load-maps-js-api) 與 [Advanced Markers](https://developers.google.com/maps/documentation/javascript/advanced-markers/add-marker)；browser key 僅回傳給有地圖權限的登入使用者，測試輸出不列金鑰。資訊窗以 textContent 建立，不直接插入門市文字 HTML。
- `scripts/test-workspace-store-map.py` 使用明確的 SDK test double 驗證網路失敗後重試、雙向選取／資訊窗、標記搜尋範圍、無結果／無效 GPS、腳本共享、雙頁籤獨立、關閉移除標記、手機無橫向溢出；無 runtime error。這個測試不能當作實際 Google 底圖通過。
- `scripts/test-workspace-store-map-coordinates.cjs`：空白、缺值、非數字、無限值、越界座標拒絕；數字字串與 0 座標保留。
- `scripts/test-workspace-store-map-api.py`：1005 筆專用門市完整分頁，預設排除 1 間停用；viewer 403；view-only 指派帳號僅讀取自己的營運門市，傳 inactive=true 不能越權；新增專用 view_inactive 權限後可讀取停用門市。沒有用 admin client 查資料繞過 RLS。
- 查得原 DEV stores RLS 只有 general-affairs access／managed 兩條 active=true SELECT policy，造成已有 view_inactive 權限仍讀不到停用門市。`20261028170000_vue_store_map_inactive.sql` 僅在 DEV 增加 is_active=false 列的權限檢查：明確 view_inactive／store.manage 或未過期有效管理角色可讀停用列，不改既有 active 門市範圍。不額外授權任何既有角色。
- Vue typecheck/build、根目錄 TypeScript 檢查通過；地端已同步。
- 真實底圖驗證：現有金鑰有設定，但 Google 回報 `RefererNotAllowedMapError`，不允許 localhost:3002。最初只等 SDK 根節點的檢查太早，已加強等待與記錄錯誤，並修正 UI 等 tilesloaded 才結束載入；真實驗收目前明確未通過。`scripts/test-workspace-store-map-real.py` 保留失敗，不能以替身測試取代。
- 使用者已回覆會在金鑰網站限制新增 `http://localhost:3002/*` 並完成後通知；尚未收到完成通知。需在新瀏覽器環境重新驗證實際底圖、地圖點選與桌機／手機畫面，才可將此項標為完整。
- Core Value / Craft Floor：互動邏輯與權限通過，實際底圖仍待外部設定後驗收；不宣稱地圖整項完成。
- 專用 1005 間 VWMAP 門市、指派帳號與 vwmap 權限角色已核對識別後清除，各批回查門市零筆殘留；三店複製資料及正式區未改。

### 2026-10-28 公司組織後端基礎（前端尚未接入）
- DEV 實測原先缺少 organization_units／memberships／manager_assignments；已在 workspace-dev/20261028180000_vue_organization.sql 補上既有 domain schema，無正式區連線、無預設公司／部門資料匯入，也未將 profiles 自動回填為組織。
- 表啟用 RLS，撤除 anon／authenticated 直接存取，僅經既有權限檢查的伺服器 API 操作。新增 organization 與 organization-people endpoints；create/edit/member.manage/manager.manage 各別驗權。
- catalog 單一 SQL 取得內容與版本；版本涵蓋全組織及成員／主管歷史，因此其他單位變更亦會要求重新核對。儲存交易鎖涵蓋三表，收據支援相同請求重送。
- 通過 node scripts/test-workspace-organization-dev.cjs：新增、防重送、舊版本阻擋、合法層級互換、循環失敗回滾、跨單位主要成員衝突、成員移除歷史、主管角色變更歷史、catalog 版本及直接寫入限制。所有測試寫入在 SQL ROLLBACK 中，連動 profiles 亦回滾。
- 通過 python scripts/test-workspace-organization-api.py：實際 localhost:3002 登入、總覽／搜尋、匿名 401、無權限 403、Origin 檢查、格式拒絕，未寫入業務資料。
- 通過 npx tsc --noEmit --incremental false。
- 尚待：Vue 組織樹、獨立編輯頁、導航切換、各細分權限實際使用者驗證、瀏覽器互動及響應式驗收。公司組織不可標示已完成；部門工作職掌／交接與其餘模組仍在總目標內。

### 2026-10-28 公司組織 Vue 第一輪操作驗證（仍進行中）
- 公司組織導航已指向原生 Organization.vue；OrganizationEditor.vue 提供基本資料、成員及主管獨立工作頁，頁籤沿用草稿與關閉確認。session capability 與 API 權限均沿用 organization.*。
- 已實作單位／人員搜尋、類型／停用篩選、樹狀層級、展開收合、縮放與滑動／指標平移、選取摘要、上層選擇與排序整批儲存。成員與主管編輯使用分別確認；不能把仍未驗證的分支視為完成。
- npm --prefix vue-workspace run build、npx tsc --noEmit --incremental false 通過；資產已更新 public/workspace，localhost:3002 可用。
- python scripts/test-workspace-organization-ui.py 實際瀏覽器通過新版導航、建立公司、跨頁草稿保留、儲存、樹搜尋／摘要、主管選取與關閉放棄、層級排序儲存、390px 不擴大頁面寬度；無 pageerror。未以此測試宣稱主管／成員寫入端到端已驗證。
- 桌機與手機圖片 .tmp-check/organization-desktop.png、organization-mobile.png 已檢視。修正縮放標籤折行、使用共用 line/primary/soft token 以支援深色模式，再次建置及重跑瀏覽器測試通過。測試公司及專屬收據已清除，沒有新增正式組織資料。
- DUI 核心價值檢查：新增與選取下一步清楚、真實 API 與儲存狀態通過；人員實際儲存、細分 RBAC、衝突回復與多層大量資料驗收尚待，整體不得標示完成。Craft 檢查：沒有假統計／裝飾卡片，桌機樹與摘要、手機上下配置；長名稱、大量成員、深色完整畫面仍待驗收。
- 下一輪需補上／核對拖放調整、兩層展開語意、不同角色權限及真實多層組織資料。測試區此資料表原先不存在，目前顯示空組織是實際資料狀態，不用假公司資料填滿。

### 2026-10-28 組織層級拖放與跨頁更新
- Organization.vue 補上移動握把、拖放至單位／根層、展開至第二層；保留上層選單作為鍵盤與手機替代操作。前端禁止公司移動、自指、循環及移入停用單位，資料庫交易仍再次驗證。
- 儲存成功重設重送識別，避免後續合法相同調整被舊收據略過。新增 organizationRevision：其他工作頁儲存後，沒有草稿的總覽更新，有草稿保留並顯示提示；跨使用者版本衝突仍由 API 阻擋。
- scripts/test-workspace-organization-tree.py 使用明確的四層級測試資料攔截 API（沒有寫入業務資料），通過第一／第二／全部展開、非法循環拖放、合法移動提交內容、根層移動取消還原及搜尋祖先脈絡。測試初期合法拖放失敗原因為目標超出測試視窗，改用可見目標驗證，不能據此宣稱大量資料拖曳自動捲動已驗證。
- scripts/test-workspace-organization-ui.py 擴充實際 DEV 主管指派儲存／API 讀回驗證；選取人員僅指派至專用測試單位，不更動該人員其他組織。第一次暴露總覽版本過舊，已補跨頁更新；並修正自身儲存不應顯示其他工作頁異動提示。
- 剩餘完整驗收包含成員實際儲存與個人主檔同步、各細分角色、長名稱／大量資料／深色畫面及衝突後核對流程；部門工作職掌、交接及其他尚未完成的組織與門市模組繼續保留總目標。
- 最終重跑 Vue build、tree synthetic interaction 及 organization UI 實際寫入讀回全部通過；測試單位、主管指派與專屬收據已清除。組織 API 驗證亦通過。

### 2026-10-28 成員與細分權限驗證
- scripts/workspace-organization-permissions-dev.cjs 建立五個獨立 DEV 角色／使用者（view/create/edit/members/managers）與兩個測試部門；不更動既有使用者權限。
- scripts/test-workspace-organization-permissions.py 全數通過：catalog capability 僅列各角色允許操作、人員搜尋僅允許成員／主管管理、所有不允許操作 403；成員寫入與讀回、主要組織衝突 409、舊版本 409、相同請求重送、profile.department 同步與解除後清空。
- 成員管理單一權限帳號的瀏覽器測試通過選人、確認、儲存與 API 讀回，且沒有新增單位／設定主管控制。測試後兩部門、所有指派／收據、五個角色與使用者均已清除。
- 擴充 SQL rollback 測試發現部門更名後 profiles.department 保留舊名。新增 DEV-only 20261028190000_vue_organization_profile_sync.sql：單位 name/status/type 變更時同步現有主要成員的部門欄位；不回填既有歷史，也不改其他組織資料。測試先失敗，修正後更名、停用清空、重新啟用回復全部通過；其餘交易／歷史測試維持通過。
- Vue build 通過。整體組織與門市遷移仍未完成。

### 2026-10-28 部門職掌後端基礎（Vue 尚未接入）
- DEV-only 20261028200000_vue_department_work.sql 以現有 work_categories/work_items/work_assignments schema 建立職掌資料基礎，加入 RLS、僅 service role 讀寫及私有 RPC，不匯入假部門／假職掌。
- department-work GET 提供部門列表、單部門職掌／分類／指派歷史、管理者人員查詢；POST 僅 department_workspace.manage 或 department.edit 可用，包含 Origin、UUID、字數、enum、指派重複及角色驗證。
- 單部門版本包含單位／分類／職掌／完整指派；儲存收據防重送。分類、工作內容與指派在同筆交易。保留不變指派、移除或換角色保留歷史，拒絕跨部門分類，停用部門不可寫入；依既有模式允許多位主責，不增加未經要求的單一主責規則。
- node scripts/test-workspace-department-work-dev.cjs 通過新增、重送、舊版本拒絕、未變更指派 ID 保留、跨部門分類阻擋、注入指派新增失敗後整筆回滾（含新增分類）、改派備援與歷史、停用拒絕、快照一致性與直接 RPC 限制。測試使用 BEGIN/ROLLBACK，未留下資料。
- 工作交接仍等待完成條件決策；本次只儲存職掌內既有交接說明欄位，不建立猜測的交接狀態機。
- 尚待 Vue 部門列表、部門總覽／按人員職掌、獨立職掌編輯與瀏覽器寫入驗收。部門管理入口維持舊版，不能稱已轉換完成。
- 最終檢查：Vue build、npx tsc --noEmit --incremental false 與 test-workspace-department-work-api.py 全部通過；API 測試涵蓋登入／未登入、清單與人員讀取、錯誤格式、Origin 與無權限拒絕，未對 API 寫入流程作超出測試的完成宣稱。

### 2026-10-28 部門管理 Vue 工作頁
- 部門導航已接 Departments.vue → DepartmentDetail.vue → DepartmentWorkEditor.vue，各部門及編輯頁獨立，沿用工作頁草稿／關閉確認。列表可搜尋及查看停用部門，總覽提供實際職掌／缺主責／缺代理與成員數，不顯示虛構交接數。
- 部門內概況、成員、按工作／人員的職掌清單，分類／搜尋／停用篩選；獨立編輯頁提供分類新增／選取、工作性質／重要性、既有九個內容欄位、人員三種角色、停用與完整指派歷史。保存前顯示部門／工作及指派數確認。只有查看者可開啟內容，表單停用且不顯示儲存控制。
- department-work GET 新增 organizationCapabilities，使部門頁可依權限開啟基本資料、成員／主管編輯，以及從清單新增部門。部門 workspace.manage 權限可直接進新版部門管理，不需要額外公司組織編輯權。
- 第一輪 scripts/test-workspace-department-work-ui.py 已通過實際 API 寫入：新增分類／內容／主責、跨頁草稿、儲存讀回、改派代理保留主責歷史、按人員顯示與 390px 無頁面溢出，無 pageerror。桌機／手機畫面已檢視（.tmp-check/department-work-desktop.png、department-work-mobile.png），使用既有共用配色與表格／分隔線，無裝飾卡片／假指標。
- 本輪補上部門操作入口後重新建置，並擴充唯讀角色的瀏覽器／API 驗證。公司組織長資料量、工作職掌版本衝突 UI、專用 workspace.manage 角色及交接仍須後續驗收，總目標未完成。
- 最終重跑 build 與 department-work-ui 通過，包含唯讀角色可查看／不能編輯／API 403；本輪測試部門、分類、職掌、指派、收據及專用帳號／角色已清除。

### 2026-10-29 職掌版本衝突核對
- DepartmentWorkEditor.vue 補上目前資料／草稿逐欄對照。重新載入保留草稿時，若伺服器內容與原基準不同，須明確核對才能再儲存；可逐欄採用目前值，其餘草稿保持不變。基準改為最新資料，避免使用者回復舊值後被錯認為沒有修改。讀取失敗時保持禁止儲存，避免用不完整快照續寫。
- scripts/test-workspace-department-conflict.py 使用實際 DEV API 建立專用職掌，開啟草稿後透過另一請求修改同筆資料；舊版本 409、草稿保留、核對內容、採用目前備註／保留草稿目的與名稱、最終讀回均通過。
- 同測試將專用部門停用，已開啟編輯頁重新載入後欄位 disabled／不再顯示儲存，直接 API 寫入 400。測試未修改既有業務單位，專用部門／職掌／分類／指派／收據／角色／使用者已清除。
- Vue build 通過，資產更新 public/workspace。實際桌機差異核對畫面 .tmp-check/department-conflict-desktop.png 已檢視，兩欄呈現且操作語意清楚；手機 CSS 為上下欄，此回未另行截圖驗收。
- 尚未完成整體目標；公司組織編輯仍需相同程度的差異核對檢查，職掌大量人員與專用 workspace.manage 角色仍待驗證，交接規則仍待使用者回覆。

### 2026-10-29 公司組織衝突核對與員工管理讀取
- OrganizationEditor.vue 的基本資料／成員／主管均補上目前內容與草稿核對。單位欄位可逐欄採用目前值；成員與主管可採用目前完整指派後再編輯，主管顯示角色與主要人員。未核對前表單與儲存停用，讀取失敗也不允許續寫。
- scripts/test-workspace-organization-review.py 以明確 API doubles 通過三種模式的舊版本 409、保留草稿、差異呈現、採用目前內容與後續儲存 payload；不宣稱此測試是實際 DB 並行測試。先發現儲存按鈕缺少 review disabled 條件，修正後全通過。Vue build 已更新 public/workspace。
- 新增 employee-directory 純函式與 workspace/employees GET，讀取使用 authenticated RLS 並分頁，沿用 employee.manage 加既有職務限制。導航尚未切換，寫入等待歷史月份影響規則回覆。
- scripts/test-workspace-employee-directory.cjs 驗證跨門市在職主檔優先、生日補值、月報／異動單獨來源、升遷優先及離職狀態，通過。員工 API 實際資料與前端尚待驗收。

### 2026-10-29 員工生日匯入解析與預覽
- employee-birthdays.ts 支援 UTF-8 BOM、引號／跳脫引號、姓名逗號與跨行欄位，保留原始列號及員編前導零；三欄標題驗證、10,000 列／5 MB 上限、空生日跳過、重複員編、有效西元日期／閏年／未來生日、姓名與主檔存在性核對。
- workspace/employee-birthdays POST 目前僅預覽，不寫入。需 employee.manage、employee.employee.edit 與既有全域人員職務條件；authenticated RLS 分頁讀取主檔，回傳各員工現有生日供後續預覽。只有月報／歷程沒有主檔者不會被算成已可更新，避免舊版零筆更新卻顯示成功。
- scripts/test-workspace-employee-birthdays.cjs 全通過：CSV 邊界、來源列號、前導零、日期、重複與姓名比對。
- scripts/test-workspace-employee-birthdays-api.py 實際 API 通過正確主檔／姓名、查無主檔、錯誤日期／引號／副檔名、Origin、無權限拒絕；預覽前後 employees GET 完整結果一致，無業務寫入。
- 員工管理尚未切新版入口：仍缺新增／編輯、生日交易寫入及 UI、Excel 匯出／歷程頁。職位修改影響歷史月份的規則仍待使用者回覆，沒有代為選擇。

### 2026-10-29 生日交易儲存
- DEV-only 20261029090000_vue_employee_birthdays.sql 新增私有快照、交易儲存及重送收據。預覽以同一 SQL 快照取得姓名／生日／主檔狀態與版本，再確認所有目標主檔 ID 均在 authenticated RLS 可見集合；不會用不完整跨門市資料整批寫入。
- employee-birthdays PUT 重新檢查權限、Origin、內容／日期／重複員編及 RLS 可見 ID。SQL 鎖定主檔後比對快照、員編存在、目前姓名、有效生日，再一次更新。只更新 birthday，不修改職位／歷史月份。回傳員工數及實際主檔筆數，保存收據避免重送；版本變更 409 要求重新預覽。
- scripts/test-workspace-employee-birthdays-dev.cjs（SQL BEGIN/ROLLBACK）通過範圍拒絕、中途 trigger 故障整批回滾、生日寫入、重送、過期快照、姓名不符、authenticated 無直接 RPC 執行權。
- scripts/test-workspace-employee-birthday-save-dev.cjs 以兩筆專用 DEV 員工執行真實預覽→PUT→employees 讀回，生日均正確，重送回覆一致，舊預覽的新請求 409。finally 已清除兩筆員工與專屬收據，不改現有員工生日。
- 原 test-workspace-employee-birthdays-api.py 預覽／權限回歸通過，npx tsc --noEmit --incremental false 通過。尚待生日 Vue 上傳／預覽／提交頁及完整員工模組接線；職位修改規則仍待使用者選擇。

### 2026-10-29 生日匯入 Vue 操作頁
- EmployeeBirthdays.vue 提供 CSV 範本下載、檔案上傳、來源列錯誤、略過數、目前／匯入生日比較、每頁 100 列、整批送出確認。檔案及預覽在工作頁內保留；替換未送出檔案需確認，關閉採 submitOnly 回頁確認，成功後可直接關閉。
- 版本衝突保留目前 File，可直接重新預覽並看見伺服器最新生日。伺服器／網路失敗保留內容，重試沿用 requestId；成功後不重複送出。範本欄位使用 CSV 引號與公式前綴防護；特殊公式型姓名範本往返尚待額外驗收，不將此檢查推論為完整匯出驗收。
- session／navigation 以 employee.manage、employee.employee.edit 及原人員職務條件顯示獨立「員工生日匯入」新版入口。完整員工管理仍舊入口，不宣稱整個員工模組完成。原生入口使用獨立 href fragment，避免與舊入口的 Vue key 重複。
- node scripts/test-workspace-employee-birthday-save-dev.cjs --ui 通過真實瀏覽器：錯誤日期阻擋、dirty 關閉保護、檔案取代、另一 API 請求修改後衝突、重新預覽舊值、送出／讀回、390px 無頁面溢出與成功後關閉；無 pageerror。finally 清除兩筆專用員工與收據。
- 桌機／手機截圖 .tmp-check/employee-birthdays-desktop.png、employee-birthdays-mobile.png 已檢視；表格獨立橫向捲動，手機表單／按鈕無重疊。Vue build 通過並更新 public/workspace。尚待大量錯誤／列數、範本下載往返及細分角色完整驗收。

### 2026-10-29 生日範本下載往返
- 修正 CSV 公式防護前綴造成特殊姓名無法通過匯入比對。restoreBirthdayNames 僅在前綴移除後與同員編主檔姓名完全相符、且原字串並非主檔姓名時還原；不任意刪除姓名原有的單引號，也不放寬姓名驗證。
- test-workspace-employee-birthdays.cjs 增加公式型姓名、原有單引號及不符主檔時不得還原的測試，通過。
- node scripts/test-workspace-employee-birthday-save-dev.cjs --roundtrip 透過實際 Vue 頁下載生日 CSV 範本，擷取兩筆專用測試員工、修改生日、重新上傳、確認與儲存讀回。驗證含逗號／公式開頭及原有單引號兩種姓名，全部通過；未匯入其他員工列。
- 範本下載暫存檔已刪除，兩筆測試員工與收據由 finally 清除。完整員工新增／編輯、全域清單／歷程與 Excel 匯出仍待，職位修改歷史月份規則與交接流程尚待使用者回覆；總目標保持未完成。


## 2026-10-29 員工新增 API 與 Vue 工作頁
- DEV RPC workspace_employee_create 已接 POST /employees；本輪實際執行 test-workspace-employee-create-api-dev.cjs，驗證授權、Origin、日期、FKI 確認、代碼大寫、新增讀回、防重送及重複員編，通過並清除專用資料與收據。
- --ui 執行實際瀏覽器導覽、表單、未儲存關閉取消、核對返回修改、確認新增及 GET 讀回、成功後關閉。首次發現職位 select 標籤辨識問題，補上明確標籤後重跑通過；無 pageerror。測試資料清理完成。
- Core Value Review：本次新增流程 PASS。資料來源與成功狀態均為真實 API；確認可返回修改，未提交內容保留，成功後欄位鎖定避免重送。新增功能不等於整個員工管理已遷移。
- Craft Floor Review：本次畫面 PASS。已檢視 .tmp-check/employee-create-desktop.png（1440×1000）與 employee-create-mobile.png（390×844）；雙欄／單欄表單、具標籤控制項、單一主要動作，無橫向溢出或裝飾卡片。
- Vue typecheck/build 通過，已同步 public/workspace。根目錄 TypeScript 首次發現導航 kind union 缺 employee-create，已補齊後重驗。
- 限制：本次 UI 未注入網路中斷；API 防重送已驗。員工清單、既有資料編輯及其餘組織與門市功能仍未全數完成；正式區未變更，Maps 真實底圖仍待金鑰設定通知。

- 最終檢查：修正導航型別後，npx tsc --noEmit --incremental false 通過（exit 0）。


## 2026-10-29 員工名冊與異動歷程原生化
- 新增 Employees.vue、原生名冊／歷程 kind、session capability 與導航；舊員工管理尚有待遷移編輯與 Excel 匯出，入口仍保留，未宣稱全模組完成。
- 根目錄 TypeScript、Vue typecheck/build 與 employee-directory 純函式測試通過。前端已同步 public/workspace。
- scripts/test-workspace-employee-directory-ui.py 使用 DEV 真實授權員工資料核對總數／離職篩選／員編與職位交集、歷程總數與升遷篩選，確認獨立頁切回保留篩選、無結果及讀取失敗清空舊表格／重試。錯誤路徑使用明確 HTTP 503 測試替身；正常讀取使用真實 API，本次無資料寫入。
- 初次測試的 has locator 錯將 panel 當作行內祖先，修正測試定位後通過。人工畫面檢視發現 full_month 未中文化，補齊舊版全部狀態及異動類型中文，增加真實資料斷言後重驗。
- Core Value Review：本次名冊查詢與歷程流程 PASS；資料來源、計數及篩選對應真實回傳，失敗可重試。完整員工編輯／匯出尚未完成。
- Craft Floor Review：名冊 1440×1000 與 390×844 截圖已檢視（.tmp-check/employee-directory-{desktop,mobile}.png）；窄螢幕表格保留橫向捲動，頁面不溢出，篩選單欄，操作與鍵盤焦點可辨識。未覆蓋百筆以上分頁的瀏覽器壓力測試，亦未宣稱完整移轉驗收。


## 2026-10-29 員工名冊 Excel 篩選匯出
- 使用既有 xlsx 套件按需載入 employee-export.ts，以點擊時全部篩選結果快照產生 .xlsx；欄位與舊版一致，中文字狀態沿用名冊，員編與日期明確為文字。
- Vue typecheck/build 通過並同步 public/workspace。test-workspace-employee-export.py 實際瀏覽器下載並以標準庫 ZIP/XML 獨立讀取 Office Open XML；真實 DEV 名冊全列六欄與 GET 結果一致，搜尋後檔案僅含符合名單。測試環境未安裝 openpyxl，改用獨立 XML 檢查，沒有新增套件。
- 額外使用明確 API 測試替身（無資料庫寫入）產生 205 位員工，在第二頁下載仍有 205 筆；000000 前導零、=1+1 姓名字面值、日期字串與整月在職中文均保留，檔案沒有公式儲存格。空結果按鈕停用，瀏覽器無 pageerror。
- Core Value Review：本次匯出 PASS。動作緊鄰篩選筆數，輸出涵蓋全部符合資料且不受頁數影響，不重新讀取而混入後來變更。
- Craft Floor Review：本次按鈕與結果列 PASS。已檢視 employee-export-desktop.png（1440×1000）與 employee-export-mobile.png（390×844）；按鈕可辨識且未造成頁面溢出。錯誤提示與處理中／空資料停用均有實作。本次未注入匯出套件載入失敗，也未用桌面 Excel 開啟驗證；檔案儲存格型別由 OOXML 驗證。
- 原員工編輯及其他組織與門市功能仍在遷移；未變更正式區、資料庫或既有員工資料。


## 2026-10-29 人員異動紀錄查詢
- 新增 employee-movements GET（authenticated RLS）、canReadMovementHistory 權限共用函式與 Vue 獨立工作頁／導航／session capability。月份採起日含、次月首日不含，類型白名單與頁數驗證，日期／建立時間／ID 穩定排序及 exact count。
- npm --prefix vue-workspace run build 與 npx tsc --noEmit --incremental false 通過，已同步 public/workspace。
- scripts/test-workspace-movement-history.py：實際 API 與瀏覽器驗證管理者可讀、viewer 403、不合法月份／類型／頁數／大小 400、月份／類型計數、50筆分頁、待套用條件、空結果、503重試及手機無頁面溢出。503 為明確測試替身，其餘為實際 API。
- 初始 DEV 無升遷資料，未以空資料通過作為分頁證據；改以 scripts/test-workspace-movement-history-dev.cjs 新增 105 筆專用 UUID 紀錄，實際跨頁檢查無遺漏／重複、八月邊界與中文內容，再走完整瀏覽器測試。全部通過，finally 依預先生成 IDs 清除 105 筆，無改動既有紀錄。
- Core Value Review：紀錄查詢本輪 PASS；無權限、查無資料、載入／失敗／重試與未套用條件均有明確狀態。批次寫入、調店確認、紀錄編輯刪除與匯出仍未完成，不視為整個模組驗收。
- Craft Floor Review：已檢視 .tmp-check/movement-history-{desktop,mobile}.png（1440×1000、390×844）含實際專用105筆資料；表格無裝飾容器，手機可水平捲動閱讀，查詢控制項可辨識。多角色細分權限及入職藥師各狀態的完整瀏覽器矩陣仍需補驗。
- 正式區未變更。原人員異動管理入口仍保留完整舊流程。


## 2026-10-29 異動紀錄本頁 Excel
- 沿用舊版九欄本頁匯出，在結果摘要旁提供按鈕，檔名標示套用月份及頁數。未套用條件／空結果／下載處理中停用，錯誤保留查詢並可重試；下載使用當頁快照。
- 共用 employee-export.ts 的文字儲存格輸出，新增 movementWorkbook，按需載入避免擴大初次載入。
- Vue typecheck/build 通過並同步 public/workspace。test-workspace-movement-history-dev.cjs 以105筆實際專用紀錄驗證，第二頁下載的 Excel 經標準庫 ZIP/XML 逐欄比較目前API頁面，九欄／筆數／頁碼檔名完全一致；條件變更與空頁禁用匯出。105筆專用紀錄已清除。
- test-workspace-movement-export.cjs 驗證員編前導零、公式樣式姓名為文字、藥師是／否／未知、已格式化階級、備註換行。檔案無公式儲存格；未以桌面 Excel 開啟。
- Core Value Review：本頁匯出 PASS，範圍清楚且實際下載與畫面相符。Craft Floor Review：已檢視新版 movement-history-{desktop,mobile}.png（1440×1000、390×844）；按鈕不擠壓篩選或造成頁面溢出，狀態可辨識。
- 未更動正式區與既有異動資料。完整批次異動、編修刪除與調店確認流程仍待遷移，目標保持進行中。
- 共用匯出程式回歸：test-workspace-employee-export.py 通過真實名冊比對與 205 筆跨頁匯出，未影響員工名冊原有功能。


## 2026-10-29 批次異動欄位驗證基礎
- 新增 movement-fields.ts 純函式與共用八種異動定義；現有異動歷史 API 透過 employee-movements.ts 重匯出共用定義。
- scripts/test-workspace-movement-fields.cjs 通過八種有效異動、閏年／不存在日期／民國拒絕、行政別名及衝突、新人階段、代理舊格式轉換、同批重複、同日不同新人階段、入職組織／生日／布林、調店同店含 UUID 大小寫、非字串欄位、備註長度及 500／501 筆邊界。不修改原輸入。
- Vue typecheck/build 通過。此輪無 UI 新增、無資料庫寫入，尚未交付可提交的批次工作頁。資料庫範圍核對、預覽版本與交易儲存仍待實作，不能將欄位驗證視為完整異動流程。

- 原生異動歷史 API／UI 回歸測試通過，共用異動定義未影響既有查詢。根 TypeScript 首次發現字串物件直接斷言含布林欄位型別，已改為明確字串欄位＋布林物件建構並重跑。
- 後續交易設計盤點：舊 batch API 先 insert 異動歷史，再依序同步主檔狀態、生日、組織成員、月報及調店；中途失敗可能已留下歷史，部分更新未檢查錯誤。新版不可只包裝原 API 就宣稱完整交易。舊狀態同步也直接處理未來生效列，後續需核對排程與既有升遷時間線約定後再移植，尚未改動此行為。
- 修正後 npx tsc --noEmit --incremental false 通過（exit 0）；欄位驗證測試再次通過。


## 2026-10-29 批次異動參照查核 API
- 新增 movement-references.ts 與 /movement-validation POST。欄位不合法直接回逐列錯誤；參照查核採100個 ID／員編分組與每次500列完整分頁，避免URL或預設列數截斷。API 明確僅驗證且不可提交，沒有 INSERT／UPDATE／DELETE。
- test-workspace-movement-references.cjs 通過：有效／停用／不可見門市、組織狀態、缺主檔、不同姓名／來源門市、跨門市姓名不能混用、全域主檔、既有階級重複及舊代理格式。
- test-workspace-movement-validation.py 實際 DEV API 驗證啟用門市入職查核、錯誤生日／不存在門市／缺員工、空批次、viewer403、Origin403，並比較前後員工清單及測試員編歷程未變。未寫入測試資料。
- Vue typecheck/build 通過。根TypeScript首次指出ES5目標不支援Set展開，改Array.from後重驗。
- 限制：未以500列實際API壓力測試，組織可選葉節點與資料庫寫入版本檢查仍未完成；本輪沒有新UI或開放批次提交。正式區未變更。
- 最終根 TypeScript 檢查通過（exit 0），參照規則與實際 API 測試均重跑通過。


## 2026-10-29 批次目錄與總部葉節點規則
- 新增 movement-locations.ts，movement-validation GET 提供批次表單來源，POST 及參照查核共用可入職組織規則。員工與門市使用 authenticated RLS；組織仍依既有 batch 權限後 service-only 讀取。
- test-workspace-movement-locations.cjs 通過總部後代葉節點、無總部 fallback、完整路徑、停用單位／上層、孤兒、循環與輸入不變；test-workspace-movement-references.cjs 回歸通過。
- test-workspace-movement-catalog-dev.cjs 建立6筆專用組織樹，以實際 API 驗證 GET 只回總部最下層、完整路徑、八類異動及員工ID不重複，POST 可接受葉節點並拒絕公司／總部／父部門／總部外／停用單位，viewer403；未新增異動。finally 逆序清除6筆專用組織，完成。
- Vue typecheck/build 與 npx tsc --noEmit --incremental false 均通過。這輪沒有新畫面，仍未開放批次提交；未來生效時機待使用者回覆，交易與月報同步仍待完成。正式區未變更。


## 2026-10-29 批次異動 Excel 解析與驗證
- 新增 movement-import.ts，POST 支援 multipart 並使用實際可讀門市／可選總部葉節點解析，再進欄位與資料庫參照查核；所有回傳明示 validationOnly／不可提交。沒有異動寫入。
- test-workspace-movement-import.cjs 通過舊版標題、員編前導零與補碼、門市人資名稱／代碼、1900與1904日期、月份優先日期、跳空白列仍回原列號、藥師不明文字拒絕、公式／錯誤儲存格拒絕、調店、歧義門市及欄位／大小限制。
- test-workspace-movement-validation.py 真實上傳 XLSX（含空白第2列），有效列來源正確為第3列；不存在門市的參照錯誤也回第3列；不符副檔名400。JSON／權限／Origin／無資料變更回歸通過。
- Vue typecheck/build 與根 npx tsc --noEmit --incremental false 通過。此輪是匯入 API 基礎，尚未交付批次工作頁、下載範本或提交；生效時機待使用者回覆，交易儲存仍待。
- 尚未以實際 .xls 檔案驗證（解析器由 xlsx 支援），未進行桌面 Excel 手動開檔。正式區未變更。


## 2026-10-29 批次異動驗證工作頁
- 新增 MovementDraft.vue，導航／session capability／工作頁種類一併接上。使用 employee.promotion.batch；頁首、驗證成功及關閉提示均明示僅驗證、未開放提交。既有完整舊版入口仍保留。
- 手動逐列編輯、主檔查找帶入、八種類型欄位、最多500列、錯誤列定位、Excel取代確認與失敗保留、移除列確認、dirty close保護。未知藥師匯入不默認否，須重新確認。
- 實際 Playwright test-workspace-movement-draft-ui.py 驗證真實入職查核、切換兩列與調店欄位、缺欄錯誤、移除取消、關閉取消、失敗匯入保留及手機無橫向溢出；前後員工清單與測試員編歷程一致，無寫入。
- 初次測試發現驗證後跳回第一列，修正為保留選取列；同步修正選取樣式使用既有 --primary 變數。匯入失敗測試補等待作業結束，避免把之前的錯誤訊息當新結果。
- Vue typecheck/build 通過，根 TypeScript 檢查通過，已同步 public/workspace。尚待成功匯入的完整UI核對、500列效能／鍵盤及所有類型逐項瀏覽器驗收；此頁不是完成版批次提交。
- Core Value Review：本輪草稿編輯／查核 PASS，未顯示假儲存成功；完整批次提交仍未完成。Craft Floor Review：已檢視 movement-draft-desktop.png（1440×1000）與 mobile.png（390×844），索引與表單分區、選取邊框及單欄手機無重疊；手機後續欄位可垂直捲動。


## 2026-10-29 批次異動範本與草稿備份
- 新增 movement-draft-file.ts 按需產生三個工作表：12欄資料、說明、實際可選任職單位。空範本沒有範例資料列；草稿備份包含全部當前列但不清除dirty狀態、不寫資料庫。
- 解析新增完整員編標題，保留純數字代碼；舊員編標題仍維持FK／FKF補碼，避免破壞既有匯入。
- test-workspace-movement-draft-file.cjs：八種類型輸出後再解析與標準化原稿一致；純數字前導零、公式樣式姓名文字、日期、階級、多行備註、未知藥師不被猜為否；空範本與單位清單檢查通過。既有 movement-import 測試回歸通過。
- 實際 MovementDraft UI 新增下載範本／下載草稿／改名後上傳備份／確認取代流程，驗證原姓名、備註換行及Excel來源列還原，仍查核通過而未儲存；員工／歷程前後不變。測試檔案下載後刪除。
- Vue typecheck/build 通過，已同步 public/workspace。已檢視更新後1440×1000與390×844截圖：下載與匯入控制清楚、手機換列無頁面溢出。Core Value Review：本輪草稿檔往返PASS；Craft Floor Review：本輪工具列PASS。未開放交易提交，完整批次及其他組織門市功能仍未完成。
- 根 TypeScript 檢查 npx tsc --noEmit --incremental false 通過（exit 0）。

## 2026-10-29 調店清單與拒絕驗收
- 原生 Transfers 頁提供狀態、搜尋、100筆分頁、申請／處理／更正資訊及拒絕確認。API 完整分批讀取，沒有舊版200筆截斷；權限依申請／確認與管理門市分別限制。
- test-workspace-transfers-dev.cjs 本輪重跑通過：205筆真實DEV申請、viewer與Origin拒絕、已處理409、同人重送、瀏覽器取消／拒絕／讀回、處理人時間及未產生異動歷程。205筆專用申請已清除。
- 新增 test-workspace-transfer-roles-dev.cjs / .py，四名非管理員各持獨立角色：僅申請、僅確認、兩者皆可、確認但無管理門市。實際驗證調出／調入任一端的查看與拒絕範圍、範圍外404／403、跨處理人409及同人重送。四名使用者、角色、三間專用門市及申請已清除。首次測試補齊 store_managers 必填 role_type 後重跑通過。
- 已檢視桌機1440×1000與手機390×844截圖；桌機完整欄位可讀，手機表格使用容器橫向捲動，沒有頁面橫向溢出。此次新增為權限整合測試及驗收紀錄，未更動產品程式。
- 調店新增、確認與生效日更正仍未原生化；舊版確認流程尚未改為交易，不能以本次拒絕的條件更新聲稱新舊並行完整安全。整體目標仍未完成，正式區未更動。

## 2026-10-29 調店新增原生流程
- Transfers 清單接 TransferCreate：員工查找／手填、兩端門市、備註、核對確認、取消草稿確認、送出成功後待確認清單讀回。dirty／submitOnly 沿用工作頁保護，不受全站門市選擇影響。
- transfers/create GET/POST 要求建立權限，authenticated 查詢維持 RLS；只回最小員工目錄欄位。驗證員編、姓名、門市 UUID／不同門市／啟用與可讀、備註長度。申請 ID 作為請求防重送鍵，同人同內容回同筆，不同內容409；新增只 INSERT 申請，不更新員工、異動紀錄或月報。
- 實際角色矩陣回歸通過。test-workspace-transfer-create.py 通過新增API、Origin403、同店400、無建立權限GET/POST403、重送同筆、內容改變409、UI取消保留／核對返回／送出與讀回、created_by、待確認未設生效日及movement_history_id為空。所有專用使用者、角色、門市與申請已清除。
- 測試發現 DEV 門市 RLS 的全域目錄權限與調店權限分開；未擴張產品存取。建立流程測試在角色矩陣之後另加入 general_affairs.service_center.access，純確認者仍無新增權限。資料不足者只能選擇其可讀門市。
- Vue typecheck/build 通過並同步 public/workspace；根 npx tsc --noEmit --incremental false 通過。構建仍有主chunk超500KB提示，非編譯錯誤。
- Core Value Review：真實送出與清單確認PASS，草稿取消返回PASS，重送不重複PASS。Craft Floor Review：檢視1440×1000桌機與390×844手機截圖；桌機兩欄與手機單欄、主按鈕、具名門市標籤及錯誤狀態清楚，無頁面橫向溢出。員工查找大量資料／深色／鍵盤完整驗收仍待，不宣稱涵蓋所有狀態。
- 調店確認及生效日期更正尚待原生化；完整人員異動與整體組織門市目標仍未完成。正式區未變更。

## 2026-10-29 調店確認月份核對基礎
- 對照舊版 confirm 與 effective-date API：確認依序新增異動、更新申請，再逐筆同步目標門市月資料；同步部分錯誤未攔截。更正也分段更新，不能直接移植成新版完整交易。
- 新增 transfer-months.ts 與僅讀取的 transfers/preview POST，未開放確認提交。計畫包含調出當月與調入已初始化草稿月份、對應日數、調出／入註記及衝突；無INSERT/UPDATE/DELETE。
- test-workspace-transfer-months.cjs 通過月初／月底、閏年、跨年、日數加總、非法與民國日期、不同門市、僅初始化月份插入、既有列更新、後續結案月份、重複員工月列、輸入不變。
- 實際 DEV 權限矩陣增測 preview：可確認者取得空月份計畫、validationOnly且canSubmit=false、僅建立權403、範圍外404、Origin403、無效日期400、申請處理後409。真實已填月資料的預覽整合測試仍待；此次日數／結案案例由純函式測試覆蓋，不宣稱已測真實提交。
- 根 TypeScript 檢查通過。本輪未改Vue畫面，先前新增與拒絕流程繼續保留；確認、日期更正、既有觸發器與完整交易仍未完成。正式區未變更。

## 2026-10-29 調店確認 DEV 交易層
- 實際查核DEV pg_trigger：employee_movement_history 僅 trg_employee_movement_history_updated_at、store_employees 僅 trg_store_employees_updated_at、monthly_staff_status 僅 trg_monthly_staff_status_updated_at；store_transfer_requests 無業務觸發器。新增 audit-workspace-transfer-triggers-dev.cjs 與SQL可重現查核，沿用環境與專案 guard。
- 20261029110000_vue_transfer_confirm.sql 已透過雙環境guard套用DEV。RPC只授予service_role，明確寫主檔而不依賴不存在的同步觸發器。保留來源個人資料、職位、藥師、生日、到職日與任用狀態；來源停用，目標建立或更新。申請與異動及月資料在同一交易內。
- test-workspace-transfer-confirm-dev.cjs 真實SQL交易測試通過：後續目標店結案月拒絕且不寫主檔／異動；注入目標月資料CHECK失敗後驗證主檔、異動、申請全撤回；成功7/15調店來源14天、目標17天、8月31天；主檔藥師／生日／到職日保留；同日同人重送只一筆；換日期衝突；未定義的未來生效政策明確拒絕；anon/authenticated無執行權。整份測試最後ROLLBACK，專用資料與臨時約束均未保留。
- 本輪沒有Vue或HTTP確認操作，不能宣稱已可從新版確認調店。尚需版本核對、非admin完整交易／並行測試、目標已有主檔及月列情境、未來日期政策與日期更正。舊版確認API仍未改交易，完整新舊並行安全未證明。正式區未變更。

## 2026-10-29 調店確認 Vue / API / 版本交易整合
- 新增 TransferConfirm 對話框與 transfers/confirm POST。選日期、核對主檔與月份、確認生效；日期變動會清除預覽，衝突或失敗須重新核對。僅開放今天或過去日期，預約調店規則未確認，畫面與後端均明示未開放。
- 20261029120000_vue_transfer_version.sql 已套用DEV：核對版本含申請、門市、員工主檔、歷程、兩端員工月資料及目標店初始化月份；核對前後與交易鎖內皆檢查版本。移除三參數舊RPC，四參數確認與snapshot僅service_role可執行。鎖住兩端門市列，避免核對後名稱／停用狀態在寫入間變動。
- 發現 has_permission 會要求 auth.uid() 等於使用者，不能直接用於service-role RPC；改成SQL內查核該actor有效角色／未過期授權及任一端管理門市。HTTP端亦先以authenticated申請讀取及權限檢查，沒有把service_role當作使用者權限。
- 已授權申請的兩端門市名稱以限定ID解析，讓只管轄一端的督導仍能辨識另一端；未提供一般門市目錄或範圍外申請。
- test-workspace-transfer-confirm-dev.cjs SQL回歸通過，新增真實snapshot後修改申請備註再確認舊version被拒絕；結案月、故障撤回、主檔／月份、同人同日重送與未來日期guard仍通過。
- test-workspace-transfer-roles-dev.cjs 完整實測通過：原四角色、新增流程與非admin確認UI/API。7/15預覽14/17天；錯誤version409、Origin403、改日期清除預覽、實際確認／清單讀回與重送。服務端直接讀回來源主檔停用／目標啟用、月資料transferred_out=14、transferred_in=17。專用資料與角色已清除。
- Vue typecheck/build、根 npx tsc --noEmit --incremental false 通過。建置同步public/workspace。主chunk仍有>500KB提示。
- 尚待：預約調店政策與到期執行、日期更正、目標既有主檔／月份、完整並行壓測及舊版確認API交易化。不能把本輪成功推論為全模組完成；正式區未變更。
- Core Value Review：非admin實際核對／提交／讀回PASS；日期更動不能沿用預覽PASS；主檔與月資料結果PASS。Craft Floor Review：已檢視桌機1440×1000及修正後手機390×844，兩端名稱與14/31、17/31完整可見、按鈕無重疊。手機調整後以 --confirm-only 再跑實際送出與資料庫讀回通過，測試資料已清除。

## 2026-10-29 調店確認並行與既有目標資料驗收
- 新增 test-workspace-transfer-races.py，以兩個獨立非admin登入session透過asyncio.gather實際並送HTTP請求，不以順序重送冒充並行。
- 三組專用資料都預先有停用的目標門市員工主檔、既有目標月份人員列。兩名確認者競爭回200/409；同人相同請求回200/200且恰一筆alreadyConfirmed；確認與拒絕競爭回409/200、最終rejected。每組只允許與最終狀態相符的異動筆數與主檔／月份結果。
- 直接資料庫讀回驗證：既有目標主檔ID與月列ID保留；成功確認只有一筆歷程與兩份主檔，來源停用／目標啟用；藥師、職位、生日、到職日從來源同步；月列保留手動notes、extra_tasks陣列與交通費123；拒絕者無異動且主檔與日數保持原狀。失敗測試的專用資料也在finally清除。
- 測試資料建立曾漏填異質批次的id、把extra_tasks誤作字串，已修正測試fixture後通過。未修改產品程式。新增 --races-only 可只重跑本組；原 --confirm-only 會跑確認UI與並行，預設保留完整角色／新增／確認測試。
- 此為新版HTTP流程的有限並行案例，未涵蓋舊版分段API或大量壓測；預約調店、日期更正及其他組織門市功能仍未完成。正式區未變更。
- 加入來源主檔啟用狀態與來源月天數斷言後再跑通過；第二輪確認／拒絕競爭結果為200/409、最終confirmed，兩輪已實際觀察到兩種勝出方向，均無混合狀態。全部專用資料清除完成。

## 2026-10-29 調店同月份日期更正
- 新增 workspace_transfer_correct 服務端交易與私有 workspace_transfer_corrections 稽核／防重送表。原DEV缺 corrected_at、corrected_by、correction_reason，已按既有正式migration的定義補至DEV；未操作正式庫。
- 更正要求已確認且關聯異動一致、主檔最後調店日一致、當月草稿與調出／調入狀態一致，阻擋其他後續異動及重複月列。版本比對與原授權雙檢查，原子更新異動日／主檔最後異動日／當月工作天數與註記／申請稽核；保留手填欄位。每次保存更正前資料與原因，重送不重複寫入。
- 新增 transfers/correct GET/POST、TransferCorrect Vue對話框與清單「更正日期」。畫面先載入原日期／版本與當月資料，日期及原因改動會清除核對，顯示兩店舊新天數，明確確認才送出。跨月及未來日期尚未開放，跨月手填資料處理規則已詢問使用者、待回覆。
- SQL真實交易測試通過：7/15更正7/20，來源14→19天、目標17→12天；異動與兩端主檔日期同步；備註與交通費321保留；更正前快照、同內容重送、識別改內容拒絕；刻意讓月資料CHECK失敗後，日期／稽核全部撤回。整份SQL測試ROLLBACK。
- 督導帳號API/Playwright實測通過：僅建立權GET/POST403、錯版本409、跨月409、Origin403、日期／原因填寫、天數核對、送出、最新更正人／原因讀回、同內容重送。資料庫讀回月資料19/12天，原確認與並行案例也回歸通過。
- Vue typecheck/build、根 TypeScript 檢查通過並同步public/workspace。Core Value Review：同月更正完整送出及讀回PASS；Craft Floor Review：已檢視1440×1000與390×844截圖，原新日期／三欄天數／原因與確認按鈕完整可讀，無橫向溢出。
- 保留限制：尚未開放跨月份與未來日期、未測更正與其他月編輯的完整並行矩陣；只有最後更正資訊在列表呈現，完整歷次更正檢視仍待。整體目標未完成。

## 2026-10-29 調店歷次更正查閱
- 新增 transfers/history GET 與 TransferHistory：依原申請查看範圍授權，20筆穩定排序分頁，只回原新日期、原因、人員與時間。API不選取before_data或result，完整員工／月資料快照仍為服務端私有。只有建立權而沒有更正權者可讀其有權查看的申請紀錄。
- 舊版最後更正欄位若不對應已保存稽核列，顯示「舊版最後更正資訊」與缺少完整歷程說明；不虛構原日期。清單可直接開啟紀錄，維持原篩選狀態。
- test-workspace-transfer-history.py 真實DEV測試使用1筆實際更正＋24筆專用分頁fixture：20/5筆分頁且ID無重複、最新真實更正排序、人員、多行原因、錯頁碼400、未管理門市404、建立者唯讀成功、舊版資訊fallback、before_data/result/private_marker不回傳、瀏覽器切頁與關閉通過。專用資料及稽核列清除完成。這25筆是測試fixture，不代表執行25次實際調店更正。
- 原確認／同月更正UI與三組並行測試回歸通過；根TypeScript與Vue typecheck/build通過，已同步public/workspace。產品文件舊階段文字同步為目前功能狀態。
- Core Value Review：從申請查閱歷次原新日期／原因PASS，查看權限與快照不外送PASS。Craft Floor Review：已檢視實際1440×1000與390×844截圖；手機底部按鈕原本貼邊，縮短紀錄內捲動區後，以獨立mock資料版面測試驗證關閉按鈕完整位於對話框及視窗內且不用捲外層。test-workspace-transfer-history-layout.py 通過；其mock僅驗證版面，API正確性由前述真實資料測試證明。
- 跨月／未來日期規則仍待使用者回覆；完整新舊並行、其他模組遷移仍未完成，正式區未更動。

## 2026-10-29 跨月更正保留手填資料：影響計畫基礎
- 使用者已選擇保留手填資料、列出影響供人工核對後更正。此項不再待回覆；跨月尚未開放提交是實作未完成，不是規則未定。現有提示文案已同步。
- 新增 transfer-correction-plan.ts 與 correct-preview POST。按原新月份範圍產生更新／必要新增計畫，不產生delete；原列即使該月不在店任職也保留，提議天數0且附保留說明。手填欄位放在preservedManualValues供檢視，不進入patch。僅對已初始化且有任職天數的月份新增；草稿以外及重複列明示衝突。回傳validationOnly:true/canSubmit:false，目前尚未接Vue跨月核對與實際交易提交。
- test-workspace-transfer-correction-plan.cjs 通過日期延後／提前、舊月份保留0天列、交通費／工時／多行備註／extra_tasks保留、無刪除操作、無初始化月份不新增、閏日、結案與重複、輸入不變。
- 真實API整合測試在已更正7/20的專用申請試算8/20：既有7月來源31天／目標0天、無8月初始化不新增；canSubmit=false；建立者403、Origin403；再次讀回申請仍7/20。實際財務手填值的API跨月組合仍待補，本輪手填保留由純函式測試驗證。
- 20261029140000_vue_transfer_snapshot_sources.sql 已套用DEV，快照納入兩端初始化月份，避免來源店新增月份後仍沿用舊計畫。根TypeScript與Vue typecheck/build通過。既有確認、更正、歷程及新版並行回歸通過，專用資料清除完成。
- 下一步是核對畫面與跨月交易整合，不把唯讀試算宣稱為已可跨月更正。商品主檔僅完成舊入口定位，完整遷移仍在總範圍內。正式區未更動。


## 2026-10-29 店長指派視窗與門市總覽
- 改為搜尋人員後就地彈出門市複選，沿用原 API／交易／權限；同一工作頁籤保留 dirty/save。未儲存關閉及 Escape 有放棄確認，解除既有指派保留二次確認。讀取失敗仍能關閉並重試。
- 門市指派總覽僅列已指派店長門市，門市代號 numeric localeCompare 升冪，同店多位店長皆保留，點店長能編輯指派。
- Vue typecheck/build 通過；既有 bundle >500KB 警告仍在。更新 public/workspace，localhost:3002 保持運作。
- scripts/test-workspace-store-managers.py：真實獨立 DEV fixture 通過權限、Origin、重試、衝突、併發、停用門市、複選儲存回讀、解除確認、失敗保留勾選、Escape 放棄、總覽更新／排序及手機測試。交易腳本通過 rollback、其他角色與次要指派保留、私人 RPC 防護。fixture 已清除，未碰正式區。
- 最終補驗：初次讀取 503 可關閉／再開、深色與手機畫面；手機總覽調整為三欄換行，002/003/010 的排序及店長欄可見以 mock layout fixture 驗證（不當作實際資料驗證）。
- Core value review：搜尋→設定指派→勾選→儲存的主要流程完成，總覽資料以 API 回讀，錯誤及取消不遺失選擇。Craft review：已檢視桌機、手機、深色截圖；沿用工作台配色與原生 dialog 焦點機制，無裝飾性指標或多餘卡片，手機店長欄不再需橫向捲動。


### 店長指派同頁搜尋更正
依使用者更正取消人員／門市兩種檢視切換，常駐已指派門市總覽；人員僅在輸入關鍵字時以下拉候選顯示，選取、清空、Escape、失焦即收起。保留門市勾選視窗及原有寫入保護。Vue build/typecheck 通過，public/workspace 已更新。使用 mock 唯讀資料驗證初始無人員名冊、無結果、清空、Escape、失焦、鍵盤選取開窗、總覽排序、手機欄位；已檢視桌機截圖。此次未改 API／資料庫，未重做寫入測試；既有整合測試的搜尋入口選擇器同步更新。


## 2026-10-29 新版經理／督導同頁指派與主責選擇
- 已實作 Supervisors 同頁門市責任總覽、按代號升冪、暫時人員搜尋、彈窗選店；總覽分經理／管理職、主責、代理。保留兼任店長獨立指派權限，不在搜尋前列全部使用者。
- 第二位／更多督導加入同店，列現有督導與本人，必須明確選主責；可維持原主責或改選新增者，其餘為代理。取消不勾選；選擇暫存到儲存才生效。可以只變更主責而不改門市清單。經理不參與主責競選。
- 解除主責且有其他督導時要求指定接任；解除全部亦逐店列出待指定接任項目。無其他督導時確認解除後無督導。尚無主責的舊紀錄不假顯示主責，提供明確指定。
- 新 DEV RPC workspace_set_supervisor_choices：全表版本比對、交易鎖、候選驗證、原子寫入、保存其他指派角色；禁止指派不屬於該店的主責或把經理選成督導主責。service_role 專用，API 維持權限／Origin 驗證。migration 20261029160000 只套用 DEV，未動正式資料庫。舊 workspace_set_supervisor RPC 保留，但新版 API 已切到新交易。
- 實際 DEV API 測試通過：首位主責、第二位維持原主責、第三位改選主責、指定接任、缺少選擇阻擋、經理共存、無效選擇不變更、停用／總部／不合資格、角色權限、Origin、併發 200/409 及其他角色保留。直接匿名 RPC 呼叫被拒。
- 實際 Vue UI 通過：同頁搜尋、取消選擇、選新增者為主責、選擇前後 DB 未提前寫入、僅變更主責、衝突保留選擇並重載、解除主責的取消／指定接任／儲存、關閉草稿確認、手機與無關指派未改動。第一次 UI 測試用 uncheck() 期待立即取消，但設計必須等接任視窗確認才變更 checkbox，已修正測試為 click()，後續完整 UI 路徑通過。
- HTTP 故障注入：初次讀取失敗仍能關閉再開、儲存失敗保留勾選、深色／手機可用。唯讀 mock 額外驗證舊有單一非主責紀錄的明確補選流程，未冒充真實 DB 寫入測試。
- Vue typecheck/build 與 root tsc --noEmit --incremental false 通過。既有 >500KB bundle 警告仍在。public/workspace 已同步最終產物，地端 3002 維持運作。
- Core value review PASS（本次指派操作範圍）：已驗證需求中的主責選擇與交接，確認／取消／失敗／衝突皆有可恢復行為。Craft review PASS：檢視桌機主責視窗與總覽、手機總覽、深色手機錯誤視窗；原生 dialog 焦點、單選必選、按鈕可用、無橫向頁面溢出。
- 六位獨立 fixture 帳號、四間門市及兩個測試權限角色已清除。無 commit/push/正式部署。
- 尚未完成：代理到期日及到期後全站有效範圍、全站門市範圍與操作權限分離、既有職稱／角色直接全店分支統一。這些保留為已確認需求，不能宣稱此次已完成整套權限改造；本次未新增權限授予或更動原始人事、薪資、歷史操作人與簽名。


## 2026-10-29 測試資料清理及 administrator
使用者已授權備份後清除四間測試門市、所有非正式複製帳號與關聯測試資料，並另建 administrator 全權限帳號。
- 先備份 143 表、18,104 筆及 26 份附件，存於 .tmp-check/dev-cleanup-backup（忽略版控且限制本機存取）；資料 SHA-256／附件逐檔 SHA-256 保存於 manifest。
- 新建系統管理員，profile.role=admin、admin RBAC 角色，166 項啟用權限皆允許；Supabase 登入、指定角色操作權、Vue 登入、舊 /login 登入及清理後 API 皆通過。密碼依使用者指定，未寫入原始碼或文件。
- administrator 短帳號由 lib/auth/dev-login.ts 僅在 DEV 專案映射；正式專案及未知環境不映射，原電子郵件登入保持。Vue 帳號輸入支援短名稱，舊版登入僅 DEV 顯示帳號輸入。
- 關聯清理交易先 dry run／ROLLBACK，再正式 COMMIT；循環維修關聯先解除，庫存不可變觸發器及其他使用者觸發器僅在這次已授權測試清理交易內暫停，成功後逐項恢復原啟用狀態。外鍵／CHECK 未停用。預演因庫存 last_transaction_pair 約束失敗時已回滾，改為只解除維修需求單循環關聯後通過。
- 正式清理 47 張 public 表的 1,985 筆測試資料（含門市／profile）；26 個原 Auth 帳號、26 個已備份附件透過管理 API 清除。共享分類、角色、權限等設定保留，已刪測試人員的可空稽核欄位清空，未假填新管理員為原作者。
- 22 張正式來源複製表共 15,141 筆於交易前後 count+hash 完全相同；保留三店原名、七位來源複製身分。最終 stores=3、profiles=8、auth.users=8、storage.objects=0，測試門市=0；啟用權限166=管理員已授權166，無停用中的業務觸發器。
- Vue build/typecheck、root tsc 通過（既有大 bundle 警告）；public/workspace 已更新，localhost:3002 運作。最終重新登入並查詢三店、經理督導候選及使用者管理 API 通過。
- 正式區資料、帳號及部署未更動。備份尚未做還原演練。
- 後續不要重跑 seed-workspace-dev/modules 等持續性假資料種子；原 workspace-accounts.json 的測試帳號已失效。需要自動化測試時使用有清理保證的臨時 fixture，結束即移除，避免再污染使用者驗收資料。

## 2026-10-29 每月人員狀態補齊驗證

實作：Monthly.vue、MonthlyTools.vue、workspace/monthly/tools、monthly-tools.ts；DEV migration 20261029180000_vue_monthly_tools.sql 已套用。PDF 函式抽至 lib/reports/single-item-bonus-pdf.ts，舊 React 匯出保留相同介面；Vue 延遲載入同一函式。匯入業績原處理器補查寫入錯誤，任一父資料更新失敗即回報並保留原明細，不再把失敗當成功。

- npm --prefix vue-workspace run build：PASS；既有大 chunk 警告仍有，PDF／Excel 使用動態載入。
- npx tsc --noEmit --incremental false：PASS。
- scripts/test-workspace-monthly-tools.py：DEV 保留月 2099-11 原始資料為零才測試，使用環境變數 WORKSPACE_TEST_PASSWORD；手動新增、同 request ID 重送、新 ID 重複人員阻擋、統計／支援時數、五種津貼、舊版本衝突、無效資料不改原紀錄、兩種 Excel 匯入、PDF 資料、送審後鎖定、錯誤 Origin／無權門市：PASS。
- SQL 交易驗證 .tmp-check/monthly-rollback.sql：故意第二筆失敗，整批舊資料完整回復；authenticated 無法直接呼叫 private RPC：PASS。以 rollback 結束。
- 實際 0002／2026-09 讀到 13 位人員、毛利 1,025,908、支援時數 0／5；獎金明細確認讀取 entries 欄位，而非將缺欄位誤顯示為零。
- Chromium UI：各獎金／匯入／報表視窗可載入與關閉；活動顯示三店實際排程；PDF 下載並用 PyMuPDF 渲染 1 頁，表格與合計可讀；模擬儲存失敗保留手動新增草稿，關閉必須確認放棄；console 無未處理錯誤。
- 截圖：.tmp-check/monthly-tools-desktop.png、monthly-tools-transport.png、monthly-tools-activity.png、monthly-tools-mobile.png、monthly-tools-mobile-editor.png；PDF：monthly-tools-bonus.pdf、monthly-tools-bonus-preview.png。
- 清理：API 測試 finally 清除 2099-11 資料；2099-10 SQL 回滾；2099-12 UI 只模擬失敗，未寫入。回查 3 stores／8 profiles，測試名冊／摘要／單品獎金零殘留。未新增門市或登入帳號，未寫正式區。

Core Value Review：單店單月作業表具真實統計、可辨識填寫入口、儲存與錯誤回復；本輪上述作業 PASS。已確認月份明確提示先退回／取消確認，避免使用者將停用按鈕理解成缺功能。活動完整頁、全站及所有角色全面授權對等不在此次 PASS 的含義內。
Craft Floor Review：1600×1000 桌機與 390×844 窄螢幕，統計用定義列表、明細表在容器內捲動、對話框提供寬版與 sticky 操作列；修正載入時誤判未儲存、搜尋延遲回應、原生 checkbox 尺寸與手機操作列，未使用假數值／裝飾卡片；本輪 PASS。

限制：Excel 匯入沿用既有逐筆／分批邏輯，可能有部分成功，畫面保留結果與錯誤供核對，未宣稱整份 Excel 的跨表全有全無交易。代理到期與全站角色／門市權限分離仍按既有待辦追蹤。活動檢視此次為清單與排程，未將活動內進階人員／部門／檢查清單標為已完整遷移。

最終補驗：Excel 下載成功，以 xlsx 重新讀取確認 13 筆、21 欄；最終 Vue build、根目錄 tsc 及完整視窗／活動排程／PDF／Excel／失敗草稿 UI 測試均通過。最終已發布至 public/workspace，localhost:3002 維持運行。

## 2026-10-29 送審後工具列與 RBAC 核對
- 統計仍由 monthly.status.view_stats 控制；meta API 僅在有權限時回傳統計欄位，Vue 僅在 viewStats 為真時渲染。統計寫入另需 monthly.status.edit。管理員完整權限沿用 context.has 的 admin bypass，與舊版 hasPermission 的管理員保底相符。
- 待審／已確認月份工具列僅保留該月業績、Excel、各式獎金明細，依各功能權限再過濾；填寫、匯入、活動及 PDF 入口隱藏。審核流程按鈕依狀態分開：submitted 確認／退回，confirmed 取消確認，仍檢查角色權限。
- 月份狀態讀取加入 monthly_store_summary，避免無人員列時漏判月份已鎖定。
- 新版 Excel 支援 submitted／confirmed，新增審核狀態欄；舊版 exportMonthlyStatusForBonus 預設仍僅 confirmed，不改既有呼叫結果。
- 驗證：Vue build、根目錄 tsc PASS；test-workspace-monthly-review-ui.py 以真實 0002／2026-09 驗證工具列恰三項、取消確認入口及 Excel 下載，檔案 13 筆皆標已確認；submitted／draft／無 viewStats 採回應模擬檢查 UI 分支，未更動原資料或角色設定。RBAC 後端本輪為程式核對，未新增受限帳號實測。
- 桌機渲染 .tmp-check/monthly-reviewed-tools.png：無停用填寫工具列，統計與單獨審核入口可辨識；Core Value／Craft Floor 本輪通過。已發布 public/workspace，請重新整理地端工作台。

## 2026-10-29 月明細的季度查詢補齊
- MonthlyTools 內新增查看 Qx 各式獎金總額／該季業績狀況，使用 MonthlyQuarter 第二層原生 Vue 對話框；Escape 或返回月明細只關閉季度，保留原月明細。已送審工具列仍只有原三項。
- quarterBonuses：沿用 bonus-quarter-summary API，workspace 先驗證門市範圍及 monthly.status.bonus_detail.view；整季名冊、其他門市獎金歸集、非零總額欄位與舊版一致。
- quarterPerformance：monthly.status.view_performance＋門市範圍；沿用 bonus-calc 與門市自訂月／季門檻，整季目標、實際只至選取月份。資料庫讀取失敗回報錯誤，不悄悄以預設門檻取代失敗結果。
- 畫面提供逐月獎金與活動日折減、季度目標／實績／達標權重、月獎金合計／季應得／補差額、五檻目標／基本獎金／差距；季度獎金提供逐人各項金額及總計。
- node scripts/test-monthly-quarter.cjs：季度邊界、8 月排除 9 月實際但保留完整季度目標、9 月完整實際、空資料、自訂門檻 PASS。
- scripts/test-workspace-monthly-quarter-ui.py：DEV Q3 獎金回應與舊 API 完全相等；實際季度業績查詢、無權門市 403、兩層視窗開啟／Escape／返回、載入失敗可返回、1500×1000 與390×844 畫面 PASS；無新增測試資料或寫入原資料。
- npm --prefix vue-workspace run build、npx tsc --noEmit --incremental false PASS。已複製 dist 至 public/workspace。
- Core Value／Craft Floor：當前月內可辨識季度入口、清楚揭露統計期間及跨店歸集、真實數據與無資料／失敗狀態、手機明細在表格容器內橫向捲動、返回鍵固定可達，PASS。
- 截圖 .tmp-check/monthly-quarter-bonuses.png、monthly-quarter-performance.png、monthly-quarter-mobile.png。此完成範圍限兩項季度查詢，未宣稱全站對等完成。

## 2026-10-29 審核後保留全門市批次匯入
依使用者補充，移除兩個匯入按鈕的 !locked 顯示條件；送審與已確認月份仍可開啟匯入業績／門市統計。caps 與後端 monthly.import.performance／monthly.import.store_stats、monthly.status.view_all 檢查維持原樣，原 API 已在 editableMonth 前獨立處理批次匯入，因此本輪無須放寬後端。單店填寫／統計編輯仍鎖定。
Vue build PASS，已發布 public/workspace。更新既有 review UI 回歸，驗證已確認月份三個查看工具加兩個批次匯入，匯入視窗選檔可用、範圍說明存在、單店編輯仍隱藏；本輪不實際匯入或更動資料。

## 2026-10-29 活動檢視：送審後入口與活動規劃結果
- 移除 activity 的 !locked 限制；依 activity.management.access，送審／已確認月份仍顯示。工具列現在為四個查看工具與兩個批次匯入，單店編輯仍鎖定。
- 對照 app/monthly-status/page.tsx 活動檢視連到 activity-management、activity-view/[id] 及 CampaignStoreDetailModal；新增 ActivityPlan 原生 Vue 檢視，提供門市排程、促銷／盤點配置、備註、本店人員、支援需求與指派、人力預估、前置工作完成／回報、車次、行銷內容／圖檔與商品部規則／配量檔。
- workspace activityDetail 先經既有 campaignView 發布對象授權，再由 activity-plan helper 並行呼叫舊 GET readers。使用原登入 client 與讀取限制，並將門市資料、支援需求及其人員再次限縮到可見排程的門市；不以 service_role 直接讀全部活動內容。分區失敗顯示錯誤及重試，不當作空規劃。
- npm --prefix vue-workspace run build、npx tsc --noEmit --incremental false PASS，dist 已同步 public/workspace。保留既有大型 bundle 提醒。
- scripts/test-workspace-monthly-activity.py：DEV 真實已確認 0002／2026-09 可開活動；一筆活動三間門市的配置、名冊、預估人數、清單與車次回應逐項比對舊 API PASS。現有真實資料只有盤點配置三筆；人力／清單／車次無資料，因此以純瀏覽器模擬回應補測促銷配置、人力、完成回報、車次、部門內容。未新增或更動資料庫資料。
- 同測試覆蓋年度空清單、門市明細、分區失敗及重試恢復、關閉、桌機1500×1000與390×844。scripts/test-workspace-monthly-review-ui.py：已確認六工具、submitted 六工具、draft 編輯恢復、統計 RBAC UI 分支與 Excel 下載 PASS。未建立受限帳號，後端授權延用舊 API 並做程式檢視，非全角色實測。
- Core Value：從查看活動規劃→查看門市規劃可讀到原活動配置；有明確空／錯誤狀態，選店後聚焦明細，PASS。Craft Floor：真實桌機／窄畫面與有內容的模擬回應截圖已檢視；修正子元件 checkbox 樣式繼承問題，表格容器橫向捲動、關閉固定可達，PASS。
- 截圖 .tmp-check/monthly-activity-desktop.png、monthly-activity-mobile.png、monthly-activity-results.png（後者為明確模擬資料）。本輪是月結入口的唯讀規劃結果，不包含活動管理編輯、舊活動行事曆視覺／督導圖例／活動排程 PDF 或清單勾選寫入；不能標示整個活動模組已全面對等。

## 2026-10-29 員工管理導航去重
- 原生名冊入口統一名稱「員工管理」，移除側欄獨立新增／生日匯入；原生可用時不再另列舊版員工管理連結。保留 feature 不可用時原先受 employee.manage 控制的單一舊版入口。
- Employees 頁標題及工作頁籤名稱一致；新增與生日匯入維持頁內 RBAC 按鈕，新增完成說明改指向員工管理頁內入口。
- Vue build PASS，dist 已同步 public/workspace；DEV session 驗證員工管理路徑只有一項且 kind=employees。Playwright 實際滑過組織與門市→員工管理→頁內新增員工，確認原生表單可用 PASS，無員工寫入。截圖 .tmp-check/employee-navigation.png。

## 2026-10-29 員工人數儀表板
- Employees 名冊上方新增總員工數／在職員工數／離職員工數；以既有 employeeDirectory 回傳的去重名冊與 is_active 計算，未改後端授權或人事狀態判定。搜尋與篩選不影響總覽；載入／失敗不顯示假零，空名冊顯示零。
- Vue build PASS，已同步 public/workspace。DEV Playwright 實測統計與 API 相符：35／28／7，搜尋無結果後統計不變；無資料寫入。桌機與390px截圖已檢視，三欄／直列可讀，Core Value 與 Craft Floor 通過。
- 驗證截圖 .tmp-check/employee-dashboard-desktop.png、employee-dashboard-mobile.png。

## 2026-10-29 員工編輯與異動歷程跳窗
- 名冊列新增受 employee.employee.edit 控制的編輯入口。員編唯讀，姓名／職位／到職日／生日對照舊版；視窗說明姓名與有填寫職位同步歷年月資料（含已送審／確認），日期只更新主檔。既有身分／全域範圍在 API 再次驗證。
- 異動歷程改為同頁原生 Modal，保留類型篩選、分頁、重新整理與空資料狀態，不新增工作頁籤；關閉回原搜尋條件。
- 新增 DEV migration 20261029210000_vue_employee_edit.sql，已由 guarded runner 套用到 mjpdfpxqttbhzeimmtqr。service_role-only RPC 使用完整來源快照防衝突、整批交易更新與 requestId 重送去重；不改正式區。
- DEV SQL 交易測試：既有人員姓名／職位同步、重送一致、舊快照拒絕、anon／authenticated 不可執行 RPC，PASS；ROLLBACK 後不留下人事修改或測試請求紀錄。
- scripts/test-workspace-employee-dialogs.py：真實讀取員工與歷程，確認跳窗不增加工作頁籤、關閉保留搜尋；編輯員編唯讀，模擬409保留草稿、取消放棄確認、模擬成功刷新、直接空姓名API400、桌機與390px畫面 PASS。UI成功回應為模擬，實際DB儲存由上項回滾測試驗證，未持續寫入複製資料。
- Vue build、root tsc PASS；dist 已同步 public/workspace。Core Value／Craft Floor：實際編輯及歷程截圖已檢視，操作入口明確、同頁上下文保留、草稿與錯誤可恢復、無多餘裝飾，PASS。截圖 .tmp-check/employee-edit-desktop.png、employee-edit-mobile.png、employee-history-dialog.png。

## 2026-10-29 人員異動管理同頁整合
- 側欄原調店申請／批次異動驗證／人員異動紀錄及舊版連結整合為單一原生 movement-management。頁內依原 capability 顯示批次輸入異動、查看歷史紀錄、調店登記確認，獨立子狀態延遲掛載並保留，不新增工作頁籤。
- 根工作頁彙總批次及調店的 dirty／busy；切換分區保留草稿，關閉仍提醒。沿用原調店建立／確認／拒絕／更正及歷史查詢 API，沒有放寬授權或啟用未完成的批次提交。
- 批次工具列整合匯入 Excel、下載匯入範例、匯出 Excel。範例含八類異動填寫列、說明、可選任職單位；EXAMPLE-xx 必須換成實際員編才可通過驗證。匯出沿舊版為當前輸入草稿，歷史匯出維持明示本頁。
- Vue build、root tsc PASS；已同步 public/workspace。test-workspace-movement-fields.cjs 與 movement-draft-file.cjs PASS：八類往返、完整員編、文字型儲存防公式、階級與多行備註、八列範例及範例員編阻擋。
- scripts/test-workspace-movement-management.py PASS：實際 session 僅一個原生入口，三區切換後草稿保留且只有一個工作頁籤，範例及草稿下載、實際 Excel 匯入覆蓋確認／驗證錯誤定位、關閉未儲存提示、桌機與390px。無資料庫人事寫入。
- Core Value／Craft Floor：.tmp-check/movement-management-desktop.png、movement-management-mobile.png 已檢視，單一主標題及分區導覽、Excel 操作集中，草稿狀態與驗證限制明示，PASS。
- 限制：批次API仍 validationOnly/canSubmit=false，不代表批次異動寫入已完成；新整合未修改既有調店實際提交及確認能力。

## 2026-10-29 解除調店未來日期限制
- 核對舊版 store-transfer-requests/[id]/confirm：只有共用日期格式驗證，沒有禁止未來日期。移除新版 preview／correct-preview 及 RPC confirm／correct 的額外 future guard，刪除過時錯誤映射，更新頁面與確認視窗文案。
- DEV migration 20261029220000_vue_transfer_future_dates.sql 已經 guarded runner 套用。以 pg_get_functiondef 精準移除 guard，保留現存交易／權限／版本檢查；初次 signature 少一個 text 引數，整個 migration 回滾後修正為六參數重跑成功，沒有部分套用。
- scripts/sql/test-workspace-transfer-confirm.sql 舊日期回歸 PASS；將相同交易案例日期轉為2099年後完整執行也 PASS：未來日期確認、同月份更正、月天數分配、主檔／歷程、重送、版本衝突、已鎖月份阻擋、注入失敗回滾、手填欄位保留及 service-only grants。兩套測試均 BEGIN/ROLLBACK，無持續新增門市／員工／申請。
- 未來日期確認沿現有新版流程立即寫入主檔、異動紀錄及相關草稿月資料，視窗明示不是到期自動排程；不宣稱舊版所有主檔同步細節已完全相同。跨月份更正仍另依人工核對需求處理。
- Vue build、root tsc PASS，dist 已同步 public/workspace；原有限制文案及 API future 檢查搜尋無殘留。正式區未修改。

## 2026-10-29 批次異動實際提交
- 完成八類異動的 native Vue「查核 → 確認視窗 → 整批儲存 → 收據／下一批」。草稿修改會使查核失效；斷線重試沿用原 requestId；成功清除 dirty 並鎖定已儲存內容，避免誤重送。歷史分區再開啟會保留條件並重查。
- DEV migration 20261029230000_vue_movement_batch.sql 透過 guarded runner 套用。新增 service-only snapshot / preview / save、RLS receipt table，補齊 acting_manager CHECK。preview 試跑完整儲存後以子交易回滾；save 在鎖內核對版本／收據並原子寫入，後端要求 employee.promotion.batch、同源及可見門市。總部入職核對 active leaf / ancestors / profile 並同步 membership，無帳號不靜默成功。
- 實際 DEV SQL scripts/sql/test-workspace-movement-batch.sql PASS：八類同批、入職後升職與復職後調店、未來日期、代理保持正式職位、目的月新建保留代理旗標、交通費／備註保留、版本衝突、最後一列注入失敗全部回滾（含巢狀升職收據）、試跑無持續寫入、重試同收據、不允許異內容重用及新請求重複登記、組織任職、private grants。所有 fixtures BEGIN/ROLLBACK。
- 欄位、來源、Excel 解析、範例／草稿往返、employee-directory 測試 PASS。來源驗證支援依日期與列序處理同批連續異動；員工名冊的較新復職／調店不再被舊離職月資料蓋過。
- scripts/test-workspace-movement-submit.py PASS：真實 DEV 查核、Origin／無效提交拒絕，編輯使查核失效；UI 提交使用模擬 503／成功回應測試同 payload/requestId 重試、收據、dirty 清除及下一批。此 UI 測試不宣稱透過瀏覽器實際保存員工；真實寫入由上述交易測試覆蓋。
- scripts/test-workspace-movement-management.py 整合回歸 PASS：單一導航、三分區草稿保留、範例下載／匯入／匯出、關閉未儲存提醒。桌機1500及手機390截圖已查看；手機確認內容改直列呈現，日期與門市不用橫向滑動。任務／狀態／craft 自檢：入口清楚，先查核後寫入，失敗有可恢復草稿，成功有明確收據；沿用既有色彩和密度。
- root tsc --noEmit --incremental false、Vue vue-tsc / vite build PASS（既有大型 chunk 提示）。已發布 public/workspace/index.html，bundle index-DaCH6nw1.js，地端3002持續運行。
- DEV audit：3門市、8使用者，測試員工／異動殘留皆0。正式區無變更，未更動 FK1241 等真實複製員工資料。


## 2026-10-30 活動管理完整操作（DEV）
- 完成活動新增／編輯同頁 Modal；門市設定／特殊日期 Modal；清單刪除版本檢查。長篇活動規劃以單一工作頁分區，包含月曆拖放／手動排程／自動排程／取消／保存、三種發布對象、門市促銷／盤點配置、本店與支援人力、工作清單、設備車次、兩部門發布與附件、預覽總表及列印入口。
- 根目錄 tsc --noEmit --incremental false、Vue vue-tsc / vite build PASS。既有大型 chunk 提示仍存在。dist 已同步至 public/workspace（index-uK9CJieh.js），localhost:3002 持續運行。
- scripts/test-workspace-campaign-scheduling.cjs PASS：活動日期邊界、星期規則、禁止日期、門市限制、同督導同日排除及相鄰日退讓。
- scripts/sql/test-workspace-campaign-operations.sql 真實 DEV BEGIN/ROLLBACK PASS：排程替換／保留ID／移除、版本衝突與重試、無效日期不刪原資料、本店人員替換注入失敗回滾、支援人員範圍與操作人、工作排序與跨活動拒絕、service-only RPC。套用的 migration 為 20261030000000_vue_campaign_operations.sql，guarded runner 限定 DEV。
- scripts/test-workspace-campaign-api.py 真實 API PASS：未登入／錯誤來源拒絕、盤點欄位清空、工作清單排序編修刪除、支援指派重試及需求刪除連動、設備車次編修刪除、特殊日期增刪、私人圖片上傳與 signed URL 實際下載 bytes 比對、商品圖片／配量附件保存與移除。測試區原缺 campaign-department-assets bucket，已建立私人 bucket、5MB 與圖片型別限制。
- scripts/test-workspace-campaign-ui.py 真實 UI／DEV 寫入 PASS：設定／特殊日期跳窗及設定草稿放棄；新增不增加頁籤、未儲存關閉保留、編輯跳窗；自動排程保存及手動變更取消；三對象發布；工作與車次新增；門市配置、月度名單重新載入保存、人數與支援需求、完成回報；行銷及商品文字發布；預覽、列印呼叫。列印測試 stub window.print，確認呼叫及樣式程式碼，未宣稱實體印表機或 PDF 檔渲染驗收。
- 讀取權限失敗不呈現假成功；權限區分門市配置／本店人員／人數、支援需求、支援指派、清單、車次及部門發布；無權限禁用或不顯示寫入操作，API 再驗證。這輪使用管理員真實流程，沒有聲稱逐個真實角色帳號完成瀏覽器驗收。
- 已查看桌機1500x1000新增跳窗、月曆及預覽，以及390x844手機預覽截圖。手機全頁沒有水平溢出；寬總表於區塊內橫滑。修正多根元件 v-show 不生效導致兩部門表單重疊的問題。
- DUI 核心價值自檢：完整操作可保存並重新讀取；新增短流程不增加工作頁；大型規劃分區保留草稿、取消與錯誤可恢復；不以舊版連結替代操作。Craft 自檢：沿用既有工作台色彩／密度，主按鈕與危險確認清楚、載入與錯誤可見，桌機／窄螢幕層級清楚。
- 所有活動測試 fixtures 以 finally 清理活動／收據及私有圖片；SQL fixtures 全回滾。正式區未改，未新增測試門市或使用者，保留原複製門市／人員資料。


## 2026-10-30 每月人員狀態活動檢視：月曆與資訊入口
- 對照 app/activity-view/[id]/page.tsx 及相關總覽：原 ActivityPlan 為長列表，缺月曆、督導圖例、特殊日期、同日設備車次、主題快捷總覽。改為週一起算的各月份月曆，門市含代號／姓名／督導文字；總覽列表保留切換，只顯示目前門市篩選保留。店別明細改同頁 Modal，不改月結頁籤。
- 原資料欄位完整保留：促銷與盤點配置、備註、本店名單、支援需求及已指派人員、人力預估、工作事項／期限／負責人／完成日期／店長回報。增加活動人力總覽、支援來源分配表、全門市前置工作總覽、設備車次及行銷／商品部跳窗；圖片及配量檔保留。此入口仍唯讀，本輪資訊呈現對等，不宣稱加入舊版所有權限下的指派／打勾寫入操作。
- monthly/tools 的 activityDetail 仍先過 module/store/RBAC 及 campaignView 的發布對象檢查；補資料用原 stores-with-supervisors 與 event-dates readers，督導只合併至原授權排程門市，日期限制活動期間。子資料失敗明示，不偽裝無資料。實際 DEV 原有督導 reader 回傳未指派，因此不捏造督導名。
- scripts/test-workspace-monthly-activity.py PASS，從真實月結入口操作：3筆配置、13筆本店人員、1支援需求、1已指派人員、2設備車次與舊 reader 比對一致。驗證每筆門市落在正確日期、星期一首欄、明細跳窗、各總覽及部門跳窗、年度空結果、部分錯誤及重試、手機區塊橫滑不撐破視窗。補充非空督導／特殊日／前置工作／部門內容使用瀏覽器 response 模擬，不寫測試業務資料。
- 加入真實排程 PDF 下載，按月 A3 橫向，保留中文、圖例、日期、門市及車次；只匯出目前授權與篩選範圍。使用 html2canvas/jsPDF，失敗可重試、匯出期間禁重送。測試實際下載 .tmp-check/monthly-calendar.pdf，PyMuPDF確認3頁並渲染首張檢視，無裁切／中文字缺字。圖像PDF不提供文字搜尋。
- Root TypeScript、Vue vue-tsc/Vite build PASS，published bundle index-DzDhj4ra.js；既有大chunk提示。localhost:3002/workspace/index.html持續可用。沒有正式資料庫／既有資料寫入。
- DUI Tier1：PASS，日期是主畫面、門市直接開明細、各主題有清楚快捷入口、錯誤／空值／未設定可區分；Tier2：PASS，沿原 tokens、控制與內容有層級、上方資訊壓縮以顯露月曆、手機明示橫滑。已查看1500x1000桌機、390x844手機及PDF渲染圖；手機保持週曆欄寬以橫滑閱讀，也可切門市日期總覽。


### 2026-10-30 活動人力單一入口與雙分頁
依使用者指定，活動檢視只保留「活動人力查看」入口，同一跳窗內為「人員配置」「支援請求／分配」兩分頁；切換保留各分頁展開狀態，含 tab/tabpanel 關聯、選取樣式及左右鍵/Home/End操作。移除活動檢視獨立設備車次按鈕，保留月曆車次與排程PDF內容；未改活動管理端維護車次功能。
Vue build PASS，已同步 public/workspace，bundle index-DNDosl4l.js。既有 monthly-activity 測試更新後 PASS：單一入口、預設分頁、點擊切換、鍵盤焦點、原獨立按鈕不存在、實際資料比對、行事曆與PDF、各跳窗及手機版回歸。已查看 monthly-people-support.png，選取層級及表格無裁切，核心任務與craft檢查PASS。資料唯讀，無正式區或業務資料修改。


### 2026-10-30 月結工具列分區
跨店活動檢視／兩種匯入移至頁面標題右側；各門市工具（含統計／支援時數編輯）、刷新、初始化及審核流程移至門市月份查詢右側、統計之前。單一 MonthlyTools 狀態透過頁籤專屬 HTMLElement targets 移動按鈕，無額外元件實例或重複載入，保留原權限與鎖定條件。窄螢幕查詢及工具依序換行。
Vue build PASS，已同步 public/workspace（index-Bl1qPI-t.js）。實際地端已確認月份 UI 檢查：右上三個跨店入口、門市工具位置、活動按鈕開窗與關閉、390寬無全頁溢出及無瀏覽器錯誤 PASS；已檢視桌機／手機截圖，核心任務與版面自檢通過。無資料寫入、無權限規則更改。首次測試因未等活動載入完成而命中既有載入與內容兩個關閉按鈕，等待載入結束後驗證通過。


## 2026-10-30 正式周年慶活動複製至DEV
- 使用者指定複製「2026年周年慶」，並選擇沿用002南港／003東湖／004文德三店、共用內容完整複製。來源活動721ca172-56ac-4938-8142-196af89df09c，期間2026-10-01至12-31。Production僅GET／storage download；DEV host/ref/env/CLI guards後才寫入。
- 備份與來源快照：.tmp-check/anniversary-2026-copy/（gitignored）。target-before.json保存所有既有活動表資料、target-actors-before.json保存原身分對應，source.json／selected.json／assets保存本次快照，prepared.json及identity-map.json記錄轉換，verification.json記錄比對。保留正式名稱、來源ID、文字及日期。
- 寫入128筆：活動1、排程3、門市配置3、本店人員24、人數3、三店彼此支援需求4／指派4、設備車次85、部門發布1；來源前置清單0。按三店範圍排除涉及其他門市的12筆支援需求，未新增其他門市；車次為共用內容完整保留。
- 7張行銷圖從正式下載後上傳DEV私人bucket；source/target SHA256一致。商品圖表內嵌資料完整保存。來源沒有配量檔，不建立假附件。保留來源發布旗標，DEV既有觸發器僅timestamp/version，無通知傳送。
- 原操作人9位，6位使用既有複製身分，3位建立正式來源的不可登入snapshot身分（長期ban、隨機密碼、member、無操作權限），保留actor關聯，不複製正式密碼。所有活動表採單一SQL交易新增、同ID/同名存在即拒絕覆蓋；暫存chunks交易後清除。
- scripts/verify-anniversary-copy.cjs PASS：128筆所有複製欄位比對、原有活動資料完全未改、7圖片hash、3門市維持、3新身分確實banned、staging為空。新版實際月結入口只讀驗證PASS：2026年度清單可見周年慶、3月曆／3門市、85車次、24本店人員、7行銷圖片載入、商品圖可見、無瀏覽器錯誤。未修改正式區或原有測試業務資料。


### 2026-10-30 活動部門圖片預覽跳窗
ActivityPlan 圖片縮圖改button，行銷及商品圖片開第二層原生Modal；ActivityImagePreview提供原圖名稱、序號、點圖下一張、前後按鈕、左右鍵循環、單張不顯示切換、載入／錯誤重試。Escape／關閉回原部門縮圖焦點，不新增瀏覽器頁籤；商品配量附件下載不變。修正縮圖過濾時名稱索引對應。
Vue build PASS，已發布index-i26E2mNJ.js。以正式複製的周年慶資料執行地端唯讀UI驗證：七張行銷圖1→2、上一張、左右鍵及7→1循環、Escape回原部門；商品1/1沒有下一張；瀏覽器頁數維持不變，無JS錯誤。已查看390寬預覽截圖，圖片等比縮放、控制列可見且無水平溢出；桌機截圖已產出。核心功能與craft自檢通過，無業務資料修改。


## 2026-10-30 批次匯入員工 Vue
- 原生EmployeeImport頁、navigation/session/WorkTab/App能力檢查接線完成。沿employee.import權限；後端context強制DEV、同源及ctx.auth可讀啟用門市，私有service-only RPC。未變更正式舊API。
- Excel第一工作表五欄：門市代號、員編、姓名、職位、到職日期。支援xls/xlsx、Excel數值日期（含1904）、YYYY-MM-DD／YYYY/M/D、純數字門市對應前置零；最多5MB／10000列。拒絕非首列標題、欄名遺漏或重複、無效日期、無權／停用門市、同檔及既有員編（包含離職）。範本為空白員工表＋說明，不放可誤匯入的假員工。
- DEV migration 20261030010000_vue_employee_import.sql guarded runner套用。原子新增store_employees，正職／在職，position與current_position一致；不建立登入帳號、月資料或額外異動。鎖內再驗證，receipt依actor/request/payload防重送；錯誤全部回滾。
- scripts/sql/test-workspace-employee-import.sql 真實DEV BEGIN/ROLLBACK PASS：新增與預設、未來日期、門市範圍、錯誤日期、同檔／既有重複、最後一列注入失敗前列與receipt回滾、同request重試、不同行為重用拒絕、anon/authenticated不可呼叫。回滾後fixture員工0，門市3／使用者11不變。
- scripts/test-workspace-employee-import.py PASS：真實Excel預覽／日期序號與數字門市／重複檔案與主檔／不存在門市、未登入401及錯誤Origin403；原生側欄入口、範本下載後重讀欄位、錯誤阻擋、替換預覽確認、成功UI。UI提交採模擬503後成功回應驗證同request/payload重試，未宣稱瀏覽器新增真實員工；真實寫入由SQL回滾案例驗證。
- root tsc與Vue vue-tsc/Vite build PASS（原大chunk提示），同步public/workspace index-De4kvZEC.js，地端3002持續運行。桌機1500x1000與手機390x844截圖已查看：預覽主要、確認操作明確、表格區塊橫滑、不撐破整頁。DUI核心任務PASS（選檔→錯誤修正→確認→收據）、craft PASS（原tokens、載入／錯誤／成功／草稿狀態真實）。無殘留測試員工，正式區未修改。

## 2026-10-30 盤點兩套流程 Vue 落地
- Inventory.vue 同工作頁兩分頁；InventoryOffline.vue 使用瀏覽器 XLSX，inventory-files.ts 共用驗證／計算／下載。無 iframe 或舊頁導向。離線入口依既有 inventory.manage/access/view；分析沿原 moduleContext 與 API 授權、門市範圍，門檻依 API can_manage 回應。
- 離線：1F 第二列標題、品號補八碼、外盤重複拒絕、FKS0701 欄名、預盤多檔、外盤修改貨架／棚板數量合併（序號不納入）、複盤與未盤表、無盤差帶入 DPOS 最終結果。檔案替換會使衍生結果失效；每個來源顯示檔名／筆數，可移除；非法數量與庫存不一致／零差重疊不默默加總。
- 分析：原 API 初盤／再盤／整合／爭議數值，批次排序與來源資訊、分類／排除摘要、篩選排序與每頁 200、正負成本 Top10、原因門檻、原因 Excel 匯入預填後明確保存、明細 CSV、刪除確認。匯入顯示部分成功錯誤。原因逐筆儲存失敗保留未完成草稿；未宣稱原 API 寫入為整批原子交易。
- PASS：scripts/test-workspace-inventory-files.cjs（多儲位、無盤差、負庫存、重複／非法數量／重疊、外盤貨架合併）；scripts/test-workspace-inventory.py（真實登入／讀取、三步驟檔案操作／下載、DPOS 檔回讀數值、桌機與手機）。
- PASS：scripts/test-workspace-inventory-analysis.py 真實 DEV report GET；其餘分析 UI 使用明確攔截回應測試原因失敗恢復、原因 Excel 匯出回匯、門檻、篩選、整合與爭議、刪除取消／確認。未向資料庫新增或刪除盤點資料，未聲稱已執行真實資料庫寫入驗收。
- 既有 test-inventory-result-analysis-query-behavior.js 與 merged-summary.js PASS；root tsc、Vue vue-tsc/Vite build PASS（既有大 bundle 提示）。
- DUI Tier1 PASS：來源檔→結果→下載與分析→原因儲存可完成；錯誤與成功是真實狀態。Tier2 PASS：1500px 桌機／390px 手機截圖已檢視，沿工作台樣式，修正過大的核取方塊，明細區內橫捲，無整頁溢出。畫面使用模擬報表截圖只供測試，沒有寫入假資料。正式區未變更；保留原 API 匯入替換與非原子逐筆寫入限制。

### 2026-10-30 盤點匯入入口位置與模式
一般匯入入口移到分析標題右側；已載入所選批次才在原匯入區顯示爭議再次盤點及門市／單號。兩入口開同頁視窗，固定匯入月份、目標批次；失敗訊息留在視窗並保留檔案。移除再次盤點核取方塊。Vue build PASS；分析 UI 測試新增一般匯入不帶 recount_parent_batch_id、爭議再次盤點帶正確 parent id，均採攔截 POST、不寫入資料庫。既有原因、門檻、檢視與刪除流程測試 PASS。同步地端 index-CrPsd-zV.js。

### 2026-10-30 分類卡片與整數顯示
分類統計由表格改為新版風格可選卡片，預設展開、可收折／清除、再次點擊取消。包含總品項、有盤差、盤差量、盤盈／盤虧／淨成本與庫存金額，分類碼排序。摘要、卡片與報表顯示採 Intl 整數四捨五入及千分位，保留原計算、匯出與門檻精度。Vue build PASS；分析 UI 測試驗證 -200.5→-201、1000.5→1,001、選取／取消／收折／展開與既有操作 PASS；桌機／手機無整頁溢出。已檢視截圖，沿原 surface／line／ink 配色與實際選取狀態，無新增資料庫寫入。地端 bundle index-D2l7f7US.js。

### 2026-10-30 摘要筆數、篩選卡片與表頭排序
摘要顯示 API row_count；成本佔比改兩位小數並附「(正負加總成本/庫存額總額)」。分類、成本等其餘顯示仍為整數。三個篩選以 aria-pressed 卡片呈現，名稱為排除 01／97／98／99、只看盤差不等於0、填寫盤差原因。排序下拉與降冪核取移除；普通與爭議明細各欄表頭可切換升降冪，含 aria-sort 與箭頭，合併欄位拆開以明確排序。Vue build PASS；瀏覽器測試驗證統計筆數、-20.04% 精度、成本表頭升降冪、原因卡片篩選與既有功能 PASS。地端已同步 index-B76YgQc1.js，未寫入資料庫。

### 2026-10-30 業績三分頁同工作頁
Performance.vue 改同頁容器，PerformanceGroup.vue 保留團體獎金及既有每月編輯實作，Prescription／Bonus 支援 embedded。三功能首次載入後保留元件；獨立查詢與處方草稿不因切換清空，父工作頁彙總 dirty/busy/save，關閉保護仍有效。每月獎金可見性取原團體獎金 API 的 canViewBonus；API／計算／寫入規則不變。團體 Excel 選檔及匯入入口移至門市／年度查詢右側，保留確認。
Vue build PASS；scripts/test-workspace-performance-sections.py PASS：同一工作頁切換三功能、處方草稿與獎金查詢保留、父頁關閉提醒、匯入按鈕位於查詢右側、桌機／手機無水平溢出及 JS 錯誤。此輪 API 使用攔截資料測 UI，沒有資料庫寫入。已檢視1500px／390px截圖，工作台樣式一致，地端同步 index-DRkm_Zcq.js。舊的單獨處方／獎金工作頁元件仍可處理先前已開頁面；新版業績內入口不再建立它們。

### 2026-10-30 處方箋上方固定橫向捲軸
新增 TopScrollTable，年度與單月處方表皆套用。頂端原生橫向捲軸與表格雙向同步；於 work-page 可視區頂端 sticky，範圍限制在表格容器；ResizeObserver 配合表格／容器大小更新，分頁顯示恢復可量測，無溢出隱藏，支援鍵盤聚焦並卸載 observer。
Vue build PASS；scripts/test-workspace-prescription-scroll.py 使用59店攔截資料，驗證上→下／下→上同步、垂直捲至1800px後捲軸仍在可視區頂端、切回單月與既有草稿／關閉保護／手機無溢出 PASS。已檢視長列表截圖。沒有新增門市或寫入資料庫。同步地端 index-DBvwHf2W.js。
補充：上方捲軸採明確軌道／滑塊樣式；瀏覽器測試停用 headless 預設 hide-scrollbars 後再驗證並查看可見捲軸截圖，PASS。最終地端 index-DU07vPFR.js。

### 2026-10-30 每月獎金頂端篩選
員工代號／姓名與獎金項目移到頂端查詢表單。平均方式依舊版改「每月皆存在員工」「人月平均」卡片，aria-pressed 表示選取，點擊立即重新查詢；保留員工／獎金項目本機篩選及原平均 API。Vue build PASS，整合 UI 測試確認兩欄同屬上方 form、兩模式實際送出對應 average_mode、切換保留員工查詢與既有處方草稿，無資料庫寫入；桌機截圖已檢視。地端同步 index-DnZEQRWy.js。

## 2026-10-30 使用者管理原生 Vue
- 新增 Users.vue、/api/workspace/users，navigation/session/WorkTab/App 接線。名冊、總數與相容角色統計／篩選、姓名帳號員編搜尋、50筆分頁、狀態與RBAC摘要。新增、編輯、相容角色變更、密碼重置、刪除確認、RBAC明細均同頁 Modal，不外開使用者舊版。
- 詳情沿 user-rbac-view：指派角色含啟用／到期、有效權限來源與搜尋複製、門市範圍、權限檢核。角色定義與角色授權編輯仍屬獨立角色權限管理模組，本輪未宣稱完成其移植。
- API 強制 DEV/context、Origin、USER_MANAGEMENT_NAV codes，操作分別用既有 hasPermission create/edit/change_role/delete；reset 沿舊版 profiles.role=admin 限制。自身相容角色／刪除禁止。輸入白名單驗證、員編大寫與重複檢查。變更角色只更新 role，不會將部門／職稱／員編清空。
- 新增用 Auth admin createUser，不覆蓋操作者 session、不寄信；profile建立失敗會嘗試刪除新建 Auth，補償失敗清楚回報。刪除沿舊 deleteUser：有歷史引用時停用登入保留基本資料並撤除關聯；未改成原子交易，不宣稱歷史回退分支已實際刪除驗收。
- scripts/test-workspace-users-api.py 真實DEV PASS：清單／詳情、401、Origin403、自身保護、非法輸入；建立唯一臨時帳號、確認操作者登入不變、編輯、角色變更仍保留其他欄位、一般帳號GET/重置403、重置臨時帳號密碼並登入成功、刪除臨時帳號。結束逐一核對既有使用者 IDs 完全不變，仍11位，未改既有帳號密碼。
- scripts/test-workspace-users-ui.py PASS：原生導航、搜尋、未改資料取消不多問、編輯取消保護、503後保留草稿與重試、角色／重置／新增請求、密碼不一致阻擋、刪除取消、自己角色／刪除禁用、真實有效權限搜尋／門市範圍／檢核。UI寫入全部攔截，真實寫入由上述隔離臨時帳號驗證。
- root tsc PASS；Vue vue-tsc/Vite build PASS（既有chunk提示）。已檢視1600px桌機／390px手機與權限跳窗，表格內橫向捲動、整頁無溢出，回饋與權限狀態實際來源；DUI核心任務與craft檢查通過。正式區無修改。

## 2026-10-30 角色權限管理原生 Vue
- Roles.vue + DEV-only /api/workspace/roles/[[...path]]，navigation/session/WorkTab/App 完整接線；同頁基本資料／權限／使用者跳窗。名冊搜尋、啟用篩選、測試角色顯示、權限／有效人數；新增編輯停用刪除沿原後端。
- 權限按模組／功能收折、搜尋、授予／變更／進階篩選、基本查看／日常操作／清除；查看範圍擇一與入口連動。敏感單項授予確認、儲存前增減清單與影響人數、expectedPermissionIds 衝突保護；草稿與關閉保護保留。使用者員編批次指派、狀態搜尋、撤銷確認。
- DEV 實測發現缺少 replace_role_permissions；先查 pg_proc 確認不存在，再用 DEV guarded runner 套用專案既有 20260926163000_role_permission_optimistic_lock.sql，未觸及 PROD。函式僅 service_role 執行，交易式替換並檢查並行版本。
- scripts/test-workspace-roles-api.py PASS：真實臨時角色新增／編輯／停用、權限儲存、過期快照409且原設定保留、使用者讀取／不存在員編404、系統角色刪除與停用400、Origin403、未登入401；建立獨立臨時帳號，指派／重複跳過／撤銷成功；finally 刪除臨時帳號和角色，核對既有使用者及角色 ID 完全相同。
- scripts/test-workspace-roles-ui.py PASS：真實角色導航／名冊／權限讀取，攔截所有 UI 寫入驗證409保留草稿及重試、變更確認、關閉草稿提示、批次員編payload、新增跳窗；沒有 runtime error、390px整頁無橫向溢出。寫入實測僅以上臨時資料。
- Vue build 與 root tsc 通過；保留既有 bundle 大小警示。最新前端已發佈 public/workspace，地端3002使用中。
- DUI核心任務 review PASS：角色名冊可立即選取／新增、設定在同頁跳窗完成、狀態來自真實資料、失敗可重試且不遺失草稿。Craft review PASS：檢視1600px權限跳窗與390px名冊，既有色彩與表格、無裝飾卡片，欄位標籤／原生details及Modal焦點機制、窄版表格內橫捲。權限繼承沿既有規則；全角色組合尚未逐一人工驗收。

## 2026-10-30 全站功能選單
- App.vue 以點擊式全寬目錄取代左側hover與逐組展開；七組所有可見子項同時呈現，RBAC仍取session.navigation。原生功能沿work.open，舊頁外連保留標示，兩者點擊皆收回；不清除工作頁草稿。
- 搜尋、空結果、開啟時重設搜尋；Escape、按鈕切換、外側點擊、焦點移出可關閉，關閉返回選單按鈕。桌機七欄、較窄多欄、手機單欄且目錄捲動。
- Vue build PASS（既有chunk warning）；scripts/test-workspace-menu-catalog.py PASS：僅點擊開啟、session所有群組與子項數吻合、搜尋／空、角色與使用者原生開啟後關閉、搜尋重設、Escape／再次點擊／backdrop、焦點返回、原工作頁保留、390px無頁面溢出、無runtime error。純UI與讀取，無資料修改。
- 已檢視1600x1000與390x844畫面。DUI核心任務／craft PASS：模組標題與子項有層次、完整目錄可掃描、原生按鈕及鍵盤可達、新版色彩與間距、無裝飾性圖卡。已同步最新使用者／角色UI測試的導航selector。

## 2026-10-30 權限目錄全量對齊
- 唯讀正式 permissions、DEV permissions 做全量比對：正式232啟用、DEV166啟用；缺77、共享定義93筆metadata不同（包含描述、分類、action）。來源僅GET，不修改正式資料。
- 修改前完整定義備份於 .tmp-check/permissions-parity/audit.json。DEV guarded SQL transaction補入77筆、以code對齊共享module/feature/action/description，保留原ID、停用狀態及11筆DEV額外定義；以transaction內role_permissions前後EXCEPT檢查確保未變更任何角色授權。未複製正式role/user assignment。
- verify-workspace-permissions-parity.cjs PASS：正式232啟用代碼及metadata在DEV全部一致、現有IDs不變，DEV共243啟用。
- Vue Roles模組正規化與舊版一致（中文module別名合併）；入口／查看範圍radio擇一／附加查看／日常／進階分段、每功能已選/總數及敏感數、基本快捷名稱依優先範圍（日常處理）、篩選提示及清除。未操作的既有多範圍設定只提示，不自動改授權。
- test-workspace-permissions-parity.py PASS：舊/新DEV API逐筆相同，全部243個代碼都實際render；活動6項、3radio/3checkbox、view_all轉view_own互斥、日常不勾刪除、敏感授予確認、送出精確ID與expected快照、409保留草稿。UI寫入攔截，事後GET與原角色內容完全一致。修正native radio preventDefault與Vue狀態不同步問題；桌機/手機截圖檢視，無整頁overflow/runtime error。
- Vue build PASS（既有chunk警示），已更新public/workspace。DUI核心值與craft review PASS：完整權限目錄可搜尋與分段辨識，操作及失敗保留皆通過。這次驗證範圍是權限目錄與角色設定；不表示已遍測所有業務API的各種角色授權組合。

## 2026-10-30 關係會員新版
- Relationships.vue 與 DEV-only /api/workspace/relationships/[[...path]]、navigation/session/WorkTab/App接線。會員申請與檢視、銷售明細兩分頁同工作頁。新增／編輯／核可／駁回原因／刪除／銷售匯入均Modal，草稿關閉保護及失敗保留；狀態篩選計數、搜尋、FKRS最後號、審核人與日期、50筆前端分頁。
- 沿原API及RBAC：view/edit可新增與銷售讀取，edit編輯/匯入，approve核可/駁回，delete刪除。原編號鎖定與刪除保留銷售史沿用；銷售最多5000筆並標示合計範圍，七欄xlsx範本、格式驗證與匯入回饋。匯入沿舊批次寫入/失敗補償，不宣稱交易式或防重複匯入。
- DEV發現缺少rejected_at等欄位；以guarded runner交易套用專案既有20260818090000_relationship_member_rejection_reason.sql並reload schema。沒有正式區修改。
- scripts/test-workspace-relationships.py PASS：真實隔離會員建立、必填400、駁回原因400、駁回成功、核可清除駁回、編輯填號、改號409、xlsx匯入1筆、銷售品名數量金額與會員姓名查詢、刪除會員仍保留銷售；401／Origin403。finally清除臨時會員與唯一檔名匯入批次，原會員ID集合不變，該臨時銷售清空。
- UI原生導航與雙分頁、編號欄鎖定、編輯草稿關閉/返回、503保留草稿、範本實際下載、匯入失敗保留檔案（瀏覽器寫入均攔截）、桌機手機overflow及runtime檢查通過。真實寫入只測上段唯一臨時資料。
- root tsc及Vue build PASS（既有chunk提示）；1600px名冊及390px銷售頁渲染檢視通過，表內橫捲、可見空/載入/成功/錯誤狀態。DUI核心值與craft review PASS，同頁維護完整，配色沿現有工作台。全組合角色的人工驗收尚未逐一執行。

## 2026-10-30 藥師管理新版
- 原生 Pharmacists.vue：督導區總覽／藥師主檔同工作頁切換，月度統計與門市人員明細、搜尋補入、月度關帳與解除、年度搜尋／狀態／分頁、年度關帳／解除、手動新增及刪除、學校／學歷／負責藥師／執照更新日維護。會費新增／備註及證明修改／刪除、圖片與 PDF 證明跳窗。表單具未儲存保護、失敗保留輸入。
- DEV-only workspace adapter 沿用舊版 handler 與權限；主檔操作加上 master.view/master.edit 與原 management.edit 的交集，月度補入加上已關帳409保護。總覽保留原門市範圍與人事異動同步；會寫同步資料的總覽／年度查詢改以同源 POST 進入。未改正式站。
- DEV 原本缺少 pharmacist-fee-proofs bucket；以既有 migration 的 storage 段補齊 private bucket 與 service_role policy，腳本存於 supabase/workspace-dev/pharmacist-storage.sql。
- 2026-09 總覽讀到9筆；DEV年度主檔目前沒有原始初始化資料。舊版年度同步僅以年度入職異動新增，不把月度名單自動當作年度主檔；本次未推測或補造正式年度名單。
- root tsc、Vue build 通過（既有大 chunk 警示），已發布 public/workspace。
- scripts/test-workspace-pharmacists.py PASS：401／跨來源403／無效月份400；真實隔離年度手動新增、重複409、主檔profile修改讀回、會費新增與備註PATCH、PNG上傳／簽名URL讀取、年度關帳阻擋新增及解除。Vue總覽／主檔切換、編輯跳窗、503保留輸入、390px無整頁溢出及無runtime error。finally刪除臨時年度資料、profile、會費及附件，另外清除首次測試中斷留下的唯一VUEPH測試附件。
- scripts/test-workspace-pharmacists-month.py PASS：獨立2099-12月度補入、關帳、再補入409、解除、finally清除唯一臨時snapshot。正式與原人員紀錄未異動。
- 渲染檢視1600x1000及390x844，修正checkbox受共用input寬度影響而放大。DUI核心任務與craft自我review：同頁雙分頁、門市／督導層次可掃描、維護跳窗、錯誤保留、原生鍵盤操作。各受限角色的所有組合尚未逐一做人工登入驗收。

## 2026-10-30 藥師正式資料複製至 DEV
- 使用者同意下一步後，scripts/copy-workspace-pharmacists-dev.cjs 只讀正式區三間門市（0002／0003／0004）的2026年度主檔與相關profile、2026會費。先將DEV相關三表及鎖定／同步狀態完整備份到 .tmp-check/pharmacist-copy-2026/dev-before.json；來源快照source.json、附件原檔proofs、路徑與SHA256清單proof-manifest.json。
- 依門市代號映射DEV store ID，保留原姓名、狀態、學經歷、來源、日期及紀錄人；未新增使用者。無既有資料覆寫；三表在同一SQL transaction插入，固定DEV project guard。未改正式資料／關帳／同步時間。
- 複製9筆年度主檔（在職8／離職1）、9筆profile、7筆2026會費、7個private bucket附件（獨立prod-copy-2026路徑）。逐欄比對與附件下載SHA256一致，completed.json留存結果。年度主檔已補齊，取代前述空資料限制。
- verify-workspace-pharmacists-copy.py PASS：登入新版API回傳9筆，UI預設在職8筆／全部9筆、會費跳窗、繳費證明圖片實際載入、無runtime error。已檢視主檔渲染；本次不修改功能程式。

## 2026-10-30 員工購物管理新版
- EmployeePurchases.vue 與 DEV-only workspace adapter、navigation/session/WorkTab/App接線。月份查詢、購物總額／筆數／比對統計、最後匯入、職稱金額彙總點選與下拉篩選、員工消費表格欄位三態排序、搜尋／50筆分頁／收合；購物門市與商品明細Modal。查詢已載入月份獨立顯示，職稱篩選沿載入月份，避免輸入尚未查詢的月份混用。
- POS Excel匯入Modal、明確確認覆蓋檔案銷售月份的全門市資料、跨月拒絕、成功切換月份與匯入／跳過／警告回饋、錯誤保留檔案、草稿離開保護、busy防重送。沿用舊API的非交易式刪除後分批插入流程，不宣稱原子回滾。既有view或import可查詢，只有import可匯入；DEV與Origin守門，既有正式頁與API未改。
- DEV缺少三個統計RPC；套用既有基礎schema與最新版20260914112000統計定義，略過permission／role grant異動。保留腳本supabase/workspace-dev/employee-purchases.sql，guarded SQL transaction執行。原函式備份.tmp-check/purchases-functions-before.json為空。2026-09讀取成功、現有資料為空，未自行複製正式員購資料。
- root tsc、Vue build PASS（既有chunk提示）；已更新public/workspace。
- scripts/test-workspace-employee-purchases.py：真實空2099-11測試月份Excel兩筆匯入、跨月份400且無寫入、彙總300／商品200／數量2、職稱過濾、第二次單筆匯入覆蓋成200；401／Origin403／月份400。UI原生導航、三態排序降／升、職稱篩選、商品明細跳窗、覆蓋勾選前不可匯入、503檔案保留、取消草稿提示、390px無整頁溢出／無runtime error。finally清除唯一測試檔名的sales及batch，月份回到0筆且無batch。
- 已檢視桌機名冊／明細及手機畫面。DUI核心價值review：查詢與匯入明確分工、統計來源真實、商品明細維持查詢位置、失敗可重試。Craft review：沿原工作台tokens、表格內捲動、原生控制項、金額與身分欄易讀。未遍測全部受限角色組合；後端直接沿用舊授權規則。
- 第二輪改用DEV既有員編FK0008，確認實際人員比對成功1筆、未比對1筆及職稱篩選；相同整合測試再次PASS並清空2099-11。

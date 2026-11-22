# 復刻計畫決策紀錄

使用者於 2026-11-02 透過規格問卷確認。所有開發、審查、測試子代理都必須遵守。

| ID | 決策 |
|---|---|
| D01 | 測試框架：`@playwright/test`（Node/TS）＋ Vitest。既有 132 支 `scripts/test-workspace-*` 保留，碰到該頁時再逐步遷移。 |
| D02 | 新增 devDependencies 到**根目錄** `package.json`：`vitest`、`@vue/test-utils`、`happy-dom`、`@playwright/test`（含 chromium）。 |
| D03 | 根目錄 `.env.local`（指向 Production 候選）已改名為 `.env.production-candidate.local.bak`。所有測試工具只能載入 `.env.development.local`，並在連線前通過環境守衛；runner 必須明確忽略 `.env.local` 與 `.bak`。`scripts/workspace-q3-snapshot.cjs` 因此無法再讀正式區，這是預期結果。 |
| D04 | 測試帳號密碼集中到單一 gitignored 檔 `.tmp-check/test-credentials.json`，由 seed 隨機產生；其他明碼檔刪除。 |
| D05 | 授權子代理用 service role 在 **DEV** 建立／更新角色矩陣帳號、角色、`role_permissions`、`user_roles`。範圍僅限 `vue_workspace_*` 角色與 `@example.test` 帳號，不得動既有真實使用者與正式角色。 |
| D06 | 角色矩陣完整 13 個：admin、navigation、營業主管、營業助理、督導、店長、代理店長、藥師、盤點組、總務、總務廠商管理、一般員工、無權限，另加各模組 view/edit/delete 細分帳號。 |
| D07 | 舊版已知 bug 或不合理行為：新版修正，差異列入 `tests/parity/allowlist.json` 白名單，每筆由使用者核可後才算通過。 |
| D08 | 已知行為差異（使用者選「逐項決定」，未填補充；暫採建議，施作到時列入白名單請使用者核可）：批次匯入／異動／升遷整批原子 → 接受新版；任務詳情 → 恢復開放 admin/manager 檢視；巡店列表 → 保留分頁，預設區間恢復近 6 個月；任務管理權限 → 依 RBAC 收緊。 |
| D09 | 巡店：草稿可不簽，正式送出才強制門市與督導雙簽名，規則寫在後端 RPC。 |
| D10 | 測試 runner 自動 build、啟動 3002 integrated、測完關閉；偵測到已在執行就沿用（先做 preflight）。**另外**提供使用者一鍵啟動檔。 |
| D11 | 在 `feature/vue-parity` 分支，每完成一個工作項（四層測試綠燈）commit 一次；每個里程碑開一個 PR 合併回 `main`。基準 commit：`24ca410`。 |
| D12 | 施作順序：測試地基 → 月結與獎金 → 人事 → 任務與首頁 → 巡店 → 活動、組織、認證 → 跨部門 → 總務。 |
| D13 | 不復刻：`/inspection/debug`、`/inspection/diagnostic`、`/inspection/test-debug`；`/general-affairs/part-requests(/new)` 只做轉址到 reports。 |
| D14 | QR 掃描永久網址與公開認證頁：Next 保留原路徑，轉址到 Vue hash 頁（例如 `/workspace/#/scan/{token}`）。 |
| D15 | DEV 測試資料：允許長駐基準資料（VW/ZT 測試門市、角色帳號、保留月份 2099、年份 2038 的設定），單次 fixture 每次清除。保留月份 2099 內的資料屬單次 fixture，runner 前後自動清除測試門市資料；非測試門市資料出現時中止。（2026-11-02 主迴圈裁定） |
| D16 | E2E：chromium，桌機 1440 與手機 390；最終回歸 F01 再加跑一次 webkit。 |
| D17 | 外部服務一律 mock（語音走 LOCAL_RULE_FALLBACK，Google 以 `page.route` 攔截），里程碑結束時人工實測一次。 |
| D18 | `.tmp-check` 既有檔案封存到 `.tmp-check/_archive-20261102`，新結果寫到 `tests/reports/<runId>/`。 |

## 模型分工

主迴圈為 Opus，負責拆解、規劃與整合。開發、程式審查、測試資料建立與測試執行一律由 Sonnet 子代理處理；使用者另行要求時才找 Opus 審查。

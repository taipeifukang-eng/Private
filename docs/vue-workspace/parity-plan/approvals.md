# 新舊版差異核可紀錄

使用者在差異核可頁（claude.ai artifact「新舊版差異核可」）逐筆決定。主迴圈依此更新 `tests/parity/allowlist.json`：

- **接受**：該筆的 `approvedBy` 填 `"user (2026-11-02)"`，測試報告視為已核可的差異。
- **改回舊版**：不列入白名單（`approvedBy` 維持 null，加 `"decision": "fix"` 與 `"fixIn"`），差異在報告中標為 must-fix（verdict 不是 PASS），只有執行對應工作項（`npm run test:page -- <fixIn>`，自動設 `PARITY_ENFORCE_FIX=<fixIn>`）或最終回歸 F01（`--enforce-fix all`）時才讓 parity 測試失敗；其他工作項只加 annotation，不被擋住。

| ID | 決定 | 決定時間（UTC） | 後續 |
|---|---|---|---|
| nav-archived-feature-gate | 改回舊版 | 2026-11-02 10:04 | W07 補上「已封存任務」導覽入口與功能開關 |
| inventory-view-implies-import-delete | 改回舊版 → 2026-11-22 盤點權限問卷裁定新舊一起收緊 | 2026-11-02 10:04；2026-11-22 | 匯入、刪除各自權限（見下方補充與 m6-spec.md「盤點權限分開」） |
| nav-home-entry | 接受 | 2026-11-02 10:05 | 首頁提醒卡片在 W11、W12 補進工作台 |
| nav-inspection-compare-native-only | 接受 | 2026-11-02 10:05 | — |
| nav-activity-management-view-only | 接受 | 2026-11-02 10:05 | — |
| nav-stores-view-codes | 接受 | 2026-11-02 10:06 | — |
| nav-supervisors-manager-assign | 接受 | 2026-11-02 10:06 | P02 驗收時確認沒有督導指派權限者看不到督導指派按鈕 |

M6-W25 補充（2026-11-21）：`inventory-view-implies-import-delete` 已用舊 API 與 workspace API 對同樣請求實測，舊版 canImport／canDelete 對任一檢視權限同樣放行，新舊行為相同；因此新版不單獨收緊，白名單不再是 decision=fix，改為待使用者決定是否連舊版一起收緊（另案）。

盤點權限問卷裁定（2026-11-22，docId `inv-perm-ai-cap`，approvedBy `user (2026-11-22 盤點權限問卷)`）：`inventory-view-implies-import-delete` 以 decision=fix 的方向執行完畢——P1 只有 `inventory.result_analysis.import` 能匯入、只有 `inventory.result_analysis.delete` 能刪除，檢視類權限只能看；P2 新版與舊版一起收緊（舊版只改 `canImportInventoryResultAnalysis`／`canDeleteInventoryResultAnalysis` 與按鈕顯示旗標）；P3 `inventory.manage` 不隱含；P4 沒權限者看不到按鈕（隱藏），伺服端回 403。白名單條目因為已執行完畢，記為已核可（approvedBy 填入，不再帶 `decision: fix`，因為驗證規則規定 fix 必須維持 null）。

差異確認頁（M6，2026-11-23，docId `review-2026-11-23`）：M6 第一至第三批的 64 項待核可差異全部同意，approvedBy 為 `user (2026-11-23 差異確認頁)`，明細見 `allowlist-review/decisions-2026-11-23.md`。送出後白名單沒有待核可條目（只剩已排定修正的 `nav-archived-feature-gate`），T02 的 STILL_PENDING 清空。

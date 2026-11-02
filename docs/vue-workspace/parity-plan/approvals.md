# 新舊版差異核可紀錄

使用者在差異核可頁（claude.ai artifact「新舊版差異核可」）逐筆決定。主迴圈依此更新 `tests/parity/allowlist.json`：

- **接受**：該筆的 `approvedBy` 填 `"user (2026-11-02)"`，測試報告視為已核可的差異。
- **改回舊版**：不列入白名單（`approvedBy` 維持 null，加 `"decision": "fix"` 與 `"fixIn"`），差異會持續讓 parity 測試失敗，直到對應工作項修正為止。

| ID | 決定 | 決定時間（UTC） | 後續 |
|---|---|---|---|
| nav-archived-feature-gate | 改回舊版 | 2026-11-02 10:04 | W07 補上「已封存任務」導覽入口與功能開關 |
| inventory-view-implies-import-delete | 改回舊版 | 2026-11-02 10:04 | W25 收緊：匯入、刪除需各自權限，並以舊版 API 實際行為比對 |
| nav-home-entry | 接受 | 2026-11-02 10:05 | 首頁提醒卡片在 W11、W12 補進工作台 |
| nav-inspection-compare-native-only | 接受 | 2026-11-02 10:05 | — |
| nav-activity-management-view-only | 接受 | 2026-11-02 10:05 | — |
| nav-stores-view-codes | 接受 | 2026-11-02 10:06 | — |
| nav-supervisors-manager-assign | 接受 | 2026-11-02 10:06 | P02 驗收時確認沒有督導指派權限者看不到督導指派按鈕 |

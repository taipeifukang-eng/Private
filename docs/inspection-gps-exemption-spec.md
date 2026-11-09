# 巡店定位例外 — 規格（2026-11-09，問卷 gps-exemption）

## 背景
2026-11-05 上線「新增巡店強制定位」（supabase/migrations/20261105180000_inspection_require_gps.sql、lib/inspection/gps-policy.ts）。
只接網路線的桌機定位誤差約 ±25 公里，會被 1000 公尺上限擋下，主管在辦公室補登巡店無法送出。

## 決定
- A1 新增權限 `inspection.gps_exempt`（顯示名稱「巡店定位例外」），由權限管理勾給角色。系統管理員（profiles.role = 'admin'）一律可用（與應用層既有 admin fallback 一致；正式區 has_permission 不檢查 roles.is_active、DB 端沒有 admin bypass，所以 trigger 要自己判斷 admin）。
- B1 使用例外時照樣嘗試定位，定到什麼存什麼（例如 ±25000）；定位完全失敗（拒絕、逾時、不支援）也可以送出，此時 gps 欄位可為空。
- B2 不需要填原因（使用者選擇，與建議不同）。不新增原因欄位。
- B3 不限制日期。
- C1 巡店清單、巡店內容頁顯示「定位例外」標籤；清單可篩選「只看定位例外」。
- D1 先做在舊版（本分支，基於 origin/main），推送前需使用者同意；新版（Vue，feature/vue-parity）之後同步。

## 實作要點
- DB：`inspection_masters.gps_exempt boolean NOT NULL DEFAULT false`。
- trigger `enforce_inspection_gps_on_insert`：gps_exempt = true 時，若無權限（has_permission(auth.uid(), 'inspection.gps_exempt') 或 profiles.role = 'admin'）→ 擋下（'【巡店定位】你沒有「巡店定位例外」權限'）；有權限 → 跳過必填／誤差／時間檢查，但有提供座標時仍檢查範圍。gps_exempt = false → 規則完全不變。
- 新增 BEFORE UPDATE 檢查：gps_exempt 由 false 改 true（或 true 改 false）需要同樣權限，避免事後竄改。
- 以 service_role / 無 auth.uid() 的情況（後台匯入、SQL Editor）照既有行為處理；寫清楚。
- 權限種子：照 origin/main 既有新增權限的 SQL 寫法（permissions 表與相關欄位，查既有 migration 的慣例）。
- 前端（app/inspection/new）：定位失敗或誤差超標時，若使用者有 `inspection.gps_exempt`（或 admin），在定位面板顯示「使用定位例外送出」按鈕（平常隱藏）；按下後表單解鎖，送出帶 gps_exempt = true 與當時的定位結果（若有）。沒有權限者完全看不到。
- 定位教學視窗：誤差 ≥ 5000 公尺時，提示改為「誤差達數公里，這台電腦可能沒有 WiFi（只接網路線無法精準定位），請改用手機；或請有『巡店定位例外』權限的主管使用定位例外」。
- 清單與內容頁：標籤「定位例外」；清單篩選。
- 測試：沿用 tests/unit/I01、tests/integration/I01、tests/e2e/I01 的模式補案例；DEV DB 只用測試門市與保留資料，測完清掉。
- 交付：migration + rollback SQL（正式區由使用者執行）、權限種子 SQL、程式改動、測試結果、1920×1080 截圖。

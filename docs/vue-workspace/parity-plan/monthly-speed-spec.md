# 新版「每月人員狀態」頁加速：規格

使用者於 2026-11-06 透過問卷 survey/monthly-speed 確認（vue_scope = abc、vue_timing = after_m2）。

## 目標
整頁（名冊、門市統計、支援時數、需重新確認、近期調整全部出現）明顯變快。畫面、權限與資料結果不變。

## 項目
- **A 合併請求：** 名冊回應 GET /api/workspace/monthly 直接附上 MonthlyTools 需要的 meta，包括統計、capabilities 和 version。MonthlyTools 開頁時不再另打 op=meta；存檔後的重新讀取與版本衝突檢查維持原行為。統計與支援時數的欄位權限過濾（viewStats/viewSupport）必須保留。
- **B 減少往返：** context() 內 getUser 之後，user_roles 與 moduleStores 改為並行；profiles 只在需要時查。名冊、summary、recheck、adjustments 全部並行。helper 接收已驗證的 user，不再各自呼叫 getUser。新舊共用的 helper（app/store/actions.ts）簽名要向下相容。
- **C 資料庫函式：** 新增一支 RPC，一次回傳名冊頁需要的資料（名冊、支援獎金、加盟店業績扣除、summary、recheck、adjustments）。
  - 放在 supabase/workspace-dev/，附 rollback；權限在 API 端檢查後才以 service 身分呼叫，或 RPC 內自行檢查。不可讓未授權者讀到他店資料。
  - REVOKE public/anon/authenticated 的執行權（比照 W05）。

## 驗收
- 改前改後在 DEV 量整頁時間與往返次數。
- 回傳內容一致性測試：同一組帳號與門市、月份，改前改後 JSON 完全相同；測試帳號要包含店長、督導、管理員、單一權限帳號。
- W01a、W01b、W06、T03、navigation 等相關 test:page 全綠，sweeper 孤兒 0。
- 正式區 SQL 加入 M2 SQL 之後的執行順序清單。

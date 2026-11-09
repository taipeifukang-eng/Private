# 舊版「每月人員狀態」頁加速：規格

使用者於 2026-11-06 透過問卷 survey/monthly-speed 確認（legacy_scope = all4、legacy_release = pr）。

## 原則
- 只改程式，不改資料庫、不需要在正式區執行 SQL。
- 每項修改前後畫面、權限與資料結果必須完全一致，只有速度變快。
- 上線：本分支 perf/monthly-status-speed（從 origin/main 開出）。推上 GitHub 開 PR 前要先問使用者，由使用者按合併。

## 修改項目
1. **A1 名冊查詢並行：** app/store/actions.ts 的 getMonthlyStaffStatus 中彼此不相依的查詢（人員、支援獎金、加盟店、目前門市等）改用 Promise.all，回傳結果不變。
2. **A2 權限檢查合併：** checkMonthlyStatusPermissions、getUserManagedStores 等原本多次呼叫 hasPermission（每次 2–3 次查詢）改為一次載入該使用者的角色、權限與 profile，在記憶體算出全部旗標；保留管理員保底邏輯。
   - 必須附「角色比對測試」：用管理員、店長、督導、一般員工及各單一權限帳號，比對改前與改後每個旗標、每個可管門市清單完全相同。
3. **A3 移除重複的可管門市判斷：** getMonthlyStoreSummaries 不再內部呼叫 getUserManagedStores（改由呼叫端傳入已算好的門市），並以明確欄位取代 store:stores(*)；結果範圍必須與原本一致。
4. **A4 統計與支援時數合併讀取：** app/monthly-status/page.tsx 中 StoreMonthlyStatsForm 與 StoreSupportHoursForm 各自呼叫 getStoreMonthlySummary，改為父層讀一次傳下，存檔後重新整理的行為不變。
5. **地區設定：** 新增 vercel.json，`{"regions": ["bom1"]}`，讓 Vercel 函式跑在孟買（與 Supabase ap-south-1 同區）。使用者確認目前 Vercel 為 iad1（美東）、Supabase 為 ap-south-1（孟買）。

## 驗收
- 在 DEV 量測改前與改後：開頁到名冊、統計、支援時數全部出現的時間，以及資料庫往返次數。
- 既有測試全綠；新增角色比對測試、A1/A3/A4 回傳結果一致性測試。

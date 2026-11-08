# 入職勾是藥師卻沒進藥師名單：修正規格

使用者於 2026-11-08 透過問卷 pharm-onboard 確認，全部採用建議選項（P1 三位都補；P2 2026-05 到 2026-11；P3 主檔改 true、職位文字不動；P4 兩處都修；P5 先修正式網站舊版）。

## 問題
FK1178 黃意文（0060B 建恭）、FK1160 林妤芳（0054B 永華）、FK1179 陳裕庭（0061B 正言）2026-05-01 入職並勾選「是藥師」，但：
1. 員工主檔 `store_employees.is_pharmacist` 仍是 false（入職勾沒有同步到主檔），職位為「專員／新人」。
2. 每月藥師快照（`pharmacist_monthly_snapshot`）從未出現這三人。
   - 督導區總覽 `ensureSnapshotForMonth` 在套用入職異動時，下一次同步的「清理污染資料」步驟會刪掉「由入職異動產生、但主檔不是藥師」的快照列，所以即使一度產生也會被刪。
   - 它只用「前月快照 + 當月異動」，且有 sync_log 增量跳過；新門市（前月沒有任何快照）漏掉的在職藥師永遠不會被補回。

## 修正

### 1. 入職勾是藥師 -> 同步主檔（lib/pharmacist/onboarding-master-sync.ts）
寫入入職異動的路徑只有兩條，都已處理：
- `app/api/employee-movements/batch/route.ts`（人事異動頁新增／匯入）：所有入職異動，勾是藥師就把主檔 `is_pharmacist` 設為 true（原本只有「有填生日」才會更新主檔，沒填生日的就漏了）。
- `app/api/employee-movements/[id]/route.ts`（事後編輯）：入職異動編輯後 `onboarding_is_pharmacist = true`，就同步主檔。
- 只會把主檔改成 true；職位文字不動。
- 入職改回「否」時，不會自動把主檔改成 false：主檔可能已有其他依據（手動維護、復職、職位含藥師），沒有明確依據不自動降級。

### 2. 每月名單自動補漏（lib/pharmacist/onboarding-backfill.ts，接在 app/admin/pharmacist-management/page.tsx）
未關帳月份，補上同時符合下列條件的人：
- 員工主檔在職
- 當時是藥師：該月底前「最近一筆入職異動」勾是藥師（不看主檔現在的身分，避免把後來才取得藥師資格的人補進過去月份，或把刻意改成非藥師的人補回來）
- 該月已入職：該月底前有入職異動（沒有入職異動就沒有依據，不補）
- 從未出現在「該月（含）以前」任何月份的名單（與正式區補正 SQL「從未出現在任何快照」一致）
- 該月所屬門市在目前範圍內。門市依「最近一筆入職或調店異動」推算：入職 movement_date <= 月底、調店 movement_date <= 該月 1 日（調店當月維持原店，次月才生效），與 reconcilePharmacistTransfers 同規則；沒有可用門市才退回主檔 store_id。
補在該月所屬門市，notes 為 `backfilled: onboarding not synced`（後續異動備註會接在後面）。

- 不受 sync_log 影響：「有漏掉的在職藥師」納入跳過判斷（同 hasMissingPharmacistCarry 做法）。
- 效能：每個月固定幾次批次查詢（勾藥師的入職異動、候選人主檔／入職與調店異動／該月以前快照，候選員編每 200 個一批），不是每人一查。
- 已關帳月份：函式開頭就返回，絕不改動。
- 補列查詢出錯時只記錄 console.error、不讓頁面 500。
- 補上的列會因 notes 不含 `generated from movement`，不會被「清理污染資料」步驟刪掉。

### 3. 正式區資料補正（SQL 只寫成檔案，不由程式執行）
- `pharm_onboard_A_preview.sql`：唯讀預覽，預期 3 人 × 2026-05..2026-11 = 21 列；另列出範圍內已關帳月份（預期 0）。
- `pharm_onboard_B_apply.sql`：BEGIN、備份（備份表啟用 RLS 並 REVOKE anon/authenticated）、主檔改 true、為未關帳月份新增快照列（on conflict do nothing）、SELECT 核對；不寫 COMMIT，由使用者看完結果自己 COMMIT。
- `pharm_onboard_C_rollback.sql`：依備份表還原主檔、刪除 B 新增的列；同樣只有 BEGIN。
- 條件通用（入職勾是藥師、在職、主檔非藥師、從未出現在任何快照、缺列、未關帳），不寫死員編。範圍在 params 修改。
- 補正後下一次有人開啟督導區總覽，程式也會自動補齊，兩邊不衝突（`on conflict do nothing`、已有列就不補）。

## 測試
- `npm run test:pharmacist-onboarding-backfill`：純函式單元測試；寫入路徑接線檢查；DEV 整合測試（ZT 門市、2098 保留月份）：新門市、入職勾藥師、主檔 false、無快照 -> 該月與之後月份出現；sync_log 判定無變動時仍補上；已關帳月份不變；不是藥師、已離職、入職日在後的人不補；結束殘留 0。
- `node scripts/test-pharm-onboard-sql-dev.cjs`：在 DEV 以 BEGIN...ROLLBACK 執行 B 與 C，斷言結果與還原，結束殘留 0。
- 既有：`test:pharmacist-sync-trigger`、`scripts/test-pharmacist-snapshot-carry.cjs`、`scripts/test-pharmacist-transfer-reconciliation.cjs`。

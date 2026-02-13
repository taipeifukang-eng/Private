# 🚨 送出失敗修復步驟

## **請按照以下步驟執行 SQL 腳本：**

### 步驟 1：登入 Supabase Dashboard
1. 開啟 https://supabase.com/dashboard
2. 選擇您的專案
3. 點擊左側選單的 **SQL Editor**

### 步驟 2：執行 RLS 修復腳本

**複製以下 SQL 並執行：**

```sql
-- =====================================================
-- 修復 inspection_results 的 RLS 策略
-- =====================================================
-- 問題: WITH CHECK 條件過於嚴格，不允許在 completed 狀態下插入明細
-- 解決: 移除狀態限制，只要是督導本人創建的巡店記錄就可以插入明細
-- =====================================================

-- 刪除舊的策略
DROP POLICY IF EXISTS "督導可以管理自己巡店記錄的結果明細" ON inspection_results;

-- 策略 3.2 (修復版)：督導可以插入/更新/刪除自己巡店記錄的結果明細
CREATE POLICY "督導可以管理自己巡店記錄的結果明細"
ON inspection_results
FOR ALL
TO authenticated
USING (
  -- 查詢/更新/刪除：只能操作自己的巡店記錄，且狀態不是已結案
  EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_results.inspection_id
    AND im.inspector_id = auth.uid()
    AND im.status != 'closed'  -- 除了已結案，其他狀態都可以操作
  )
)
WITH CHECK (
  -- 插入/更新：只要是督導本人創建的巡店記錄就可以
  EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_results.inspection_id
    AND im.inspector_id = auth.uid()
  )
);
```

### 步驟 3：驗證執行結果
- 如果顯示 **"Success. No rows returned"** -> ✅ 成功
- 如果有錯誤訊息 -> ❌ 請複製錯誤訊息告訴我

### 步驟 4：測試送出功能
執行腳本後，**直接重新測試**（不需要重新部署或刷新頁面）：
1. 開啟 https://private-knos.vercel.app/inspection/new
2. 填寫一筆巡店記錄
3. 點擊「送出記錄」

---

## 如果已經執行過腳本，但仍然 404：

### 方法 1：強制刷新頁面
按 **Ctrl + Shift + R** (Windows) 或 **Cmd + Shift + R** (Mac) 清除緩存

### 方法 2：檢查 Console 日誌
1. 按 **F12** 打開開發者工具
2. 切換到 **Console** 標籤
3. 送出記錄後，查看是否有 "✅ 主記錄建立成功: xxx-xxx-xxx" 的訊息
4. 複製完整的 Console 輸出截圖給我

### 方法 3：直接訪問記錄列表
開啟 https://private-knos.vercel.app/inspection 查看是否有剛創建的記錄

---

**請告訴我：**
1. 是否已執行 SQL 腳本？
2. Console 有顯示什麼訊息？
3. 記錄列表有看到剛創建的記錄嗎？

# RBAC 系統全面遷移計劃

## 📋 遷移目標
將所有使用舊的 `profile.role` 權限檢查的功能，全面遷移到新的 RBAC 權限系統。

## 🔍 需要遷移的模組

### 1. 員工管理模組
- [x] ✅ `/api/employees/add` - 新增員工
- [x] ✅ `/api/employees/update` - 更新員工

**權限對應：**
- `employee.employee.create` - 新增員工
- `employee.employee.edit` - 編輯員工

### 2. 人員異動模組
- [x] ✅ `/api/employee-movements/batch` - 批次異動處理
- [x] ✅ `/api/promotions/batch-global` - 全局批次升遷

**權限對應：**
- `employee.promotion.batch` - 批次處理人員異動

### 3. 匯出功能模組
- [x] ✅ `/api/export-monthly-status/download` - 下載每月狀態
- [x] ✅ `/api/export-monthly-status/stores` - 匯出門市清單
- [x] ✅ `/api/export-monthly-status/meal-allowance` - 匯出伙食津貼
- [x] ✅ `/api/export-monthly-status/transport` - 匯出交通費

**權限對應：**
- `monthly.export.download` - 匯出每月狀態

### 4. 活動管理模組
- [x] ✅ `/api/campaigns/published` - 已發布活動

**權限對應：**
- `activity.campaign.view` - 查看活動

## 📝 遷移步驟

### Phase 1: API 後端遷移 ✅
1. 引入 `requirePermission` 函數
2. 替換舊的 role 檢查邏輯
3. 使用對應的權限代碼

### Phase 2: 前端遷移 (待執行)
1. 更新前端權限檢查邏輯
2. 使用 RBAC 權限 API
3. 移除舊的 role 檢查

### Phase 3: 測試與驗證 (待執行)
1. 測試各個角色的權限
2. 驗證權限繼承
3. 確保向下相容性

## 🎯 完成狀態

- [x] ✅ 員工管理模組 API
- [x] ✅ 人員異動模組 API  
- [x] ✅ 匯出功能模組 API
- [x] ✅ 活動管理模組 API
- [x] ✅ 補充缺少的權限點
- [ ] 前端頁面遷移（可選）
- [ ] 全面測試與驗證

**遷移狀態：Phase 1 已完成 ✅**

## 📌 注意事項

1. **向下相容**：在過渡期保留舊的 role 欄位
2. **預設權限**：確保現有角色有對應權限
3. **錯誤處理**：權限不足時給予明確提示
4. **日誌記錄**：記錄權限檢查失敗的情況

## 🔄 回滾計劃

如果遷移出現問題：
1. 保留舊的 role 檢查程式碼（註解）
2. 可以快速切換回舊系統
3. 資料庫保留 profiles.role 欄位

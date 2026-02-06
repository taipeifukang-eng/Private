# 人員異動管理系統使用指南

## 功能概述

人員異動管理系統是原「升遷管理」模組的升級版本，新增支援多種人事異動類型，讓 HR 能更全面地追蹤和管理員工的各種狀態變化。

## 異動類型

系統支援以下五種異動類型：

### 1. 升職 (promotion)
- **說明**: 員工職位晉升
- **必填欄位**: 員編、姓名、生效日期、新職位
- **系統行為**: 
  - 自動更新該員工從生效日期起所有月份的職位資料
  - 更新 `store_employees.current_position` 和 `position`
  - 更新 `store_employees.last_promotion_date`
  - 在 `monthly_staff_status` 中更新該月及之後所有月份的職位

### 2. 留職停薪 (leave_without_pay)
- **說明**: 員工申請留職停薪
- **必填欄位**: 員編、姓名、生效日期
- **系統行為**:
  - 更新 `store_employees.employment_status` 為 'leave_without_pay'
  - 記錄異動日期和類型

### 3. 復職 (return_to_work)
- **說明**: 留職停薪員工恢復工作
- **必填欄位**: 員編、姓名、生效日期
- **系統行為**:
  - 更新 `store_employees.employment_status` 為 'active'
  - 記錄異動日期和類型

### 4. 過試用期 (pass_probation)
- **說明**: 員工通過試用期
- **必填欄位**: 員編、姓名、生效日期
- **系統行為**:
  - 記錄員工通過試用期的日期
  - 更新異動記錄

### 5. 離職 (resignation)
- **說明**: 員工離職
- **必填欄位**: 員編、姓名、生效日期
- **系統行為**:
  - 更新 `store_employees.employment_status` 為 'resigned'
  - 設定 `store_employees.is_active` 為 false
  - 記錄離職日期

## 使用方式

### 網頁介面操作

1. **進入人員異動管理頁面**
   - 導航至「門市管理」→「人員異動管理」

2. **批次輸入異動資料**
   - 填寫員編（必填，會自動轉大寫）
   - 填寫姓名（必填）
   - 選擇異動類型（必填）
   - 如果是升職，選擇新職位（必填）
   - 選擇生效日期（必填）
   - 填寫備註（選填）

3. **Excel 匯入**
   - 點擊「匯入 Excel」按鈕
   - 選擇包含以下欄位的 Excel 檔案：
     - 員編
     - 姓名
     - 異動類型（升職/留職停薪/復職/過試用期/離職）
     - 職位（僅升職需要）
     - 生效日期
     - 備註

4. **查看歷史記錄**
   - 點擊「查看歷史」按鈕
   - 可查看近期所有異動記錄
   - 記錄包含異動類型、舊值、新值等資訊

### Excel 匯入格式範例

| 員編 | 姓名 | 異動類型 | 職位 | 生效日期 | 備註 |
|------|------|----------|------|----------|------|
| FK1234 | 王小明 | 升職 | 店長 | 2026-02-01 | 表現優異 |
| FK5678 | 李小華 | 留職停薪 | | 2026-02-15 | 育嬰假 |
| FK9012 | 張小美 | 復職 | | 2026-03-01 | 育嬰假結束 |
| FK3456 | 陳小強 | 過試用期 | | 2026-02-10 | |
| FK7890 | 林小芳 | 離職 | | 2026-02-20 | 個人因素 |

## 資料庫架構

### 主要資料表

#### employee_movement_history（人員異動歷程記錄表）
```sql
- id: UUID (主鍵)
- employee_code: 員工代號
- employee_name: 員工姓名
- store_id: 所屬門市
- movement_type: 異動類型 (promotion, leave_without_pay, return_to_work, pass_probation, resignation)
- movement_date: 異動生效日期
- new_value: 新值（升職時為新職位）
- old_value: 舊值（升職時為原職位）
- notes: 備註
- created_by: 建立者
- created_at: 建立時間
- updated_at: 更新時間
```

#### store_employees（更新欄位）
```sql
- employment_status: 在職狀態 (active, leave_without_pay, resigned)
- last_movement_date: 最後異動日期
- last_movement_type: 最後異動類型
```

### 自動觸發器

系統使用 PostgreSQL 觸發器 `trigger_auto_handle_movement` 來自動處理異動記錄：

- **升職**: 自動更新 monthly_staff_status 和 store_employees 的職位資料
- **留職停薪**: 更新員工狀態為 leave_without_pay
- **復職**: 恢復員工狀態為 active
- **過試用期**: 記錄日期
- **離職**: 更新員工狀態為 resigned，並設為不在職

## API 端點

### POST /api/employee-movements/batch

批次建立人員異動記錄

**請求格式**:
```json
{
  "movements": [
    {
      "employee_code": "FK1234",
      "employee_name": "王小明",
      "movement_type": "promotion",
      "position": "店長",
      "effective_date": "2026-02-01",
      "notes": "表現優異"
    }
  ]
}
```

**回應格式**:
```json
{
  "success": true,
  "created": 1,
  "message": "成功建立 1 筆異動記錄，已自動更新員工狀態"
}
```

## 權限控制

可存取人員異動管理的角色：
- Admin（系統管理員）
- 營業部門助理（非需指派角色）
- 營業部門主管（非需指派角色）

## 遷移指南

從舊版升遷管理系統升級到人員異動管理系統：

1. **執行資料庫遷移**
   ```bash
   # 在 Supabase SQL Editor 中執行
   supabase/migration_employee_movement.sql
   ```

2. **系統自動處理**
   - 資料表自動重新命名：`employee_promotion_history` → `employee_movement_history`
   - 欄位自動重新命名：
     - `promotion_date` → `movement_date`
     - `new_position` → `new_value`
     - `old_position` → `old_value`
   - 現有升遷記錄自動標記為 'promotion' 類型
   - 索引和 RLS 政策自動更新

3. **前端已更新**
   - 頁面標題和文案已更新
   - 新增異動類型選擇器
   - 職位欄位僅在升職時顯示
   - 歷史記錄顯示異動類型標籤

## 注意事項

1. **升職記錄的影響範圍**
   - 升職會影響該員工從生效日期起所有月份的職位資料
   - 請確保生效日期正確，避免影響歷史資料

2. **離職與在職狀態**
   - 離職會將員工設為不在職（is_active = false）
   - 離職後的員工不會出現在一般的員工列表中

3. **留職停薪與復職**
   - 留職停薪不會影響職位資料
   - 復職後員工恢復為在職狀態

4. **資料驗證**
   - 系統會自動驗證必填欄位
   - 升職必須提供新職位
   - 員編會自動轉換為大寫

## 常見問題

**Q: 如何查詢員工的所有異動歷史？**

A: 在歷史記錄頁面中，可以看到所有員工的異動記錄，包含異動類型、日期、新舊值等完整資訊。

**Q: 升職記錄會影響過去的月份資料嗎？**

A: 升職只會影響生效日期當月及之後的月份，不會修改生效日期之前的資料。

**Q: 離職員工還能復職嗎？**

A: 需要先將員工狀態改回在職，建議透過系統重新建立員工記錄或手動更新資料庫。

**Q: Excel 匯入失敗怎麼辦？**

A: 請確認：
- Excel 檔案格式正確（.xlsx 或 .xls）
- 欄位名稱與範例一致
- 異動類型使用中文（升職/留職停薪/復職/過試用期/離職）
- 日期格式正確

## 更新日期

2026-02-06

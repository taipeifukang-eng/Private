# 藥師主檔權限拆分（2026-04-17）

## 變更內容

### 新增獨立權限
獨立出藥師主檔的檢視與編輯權限，使系統能更精細地控制用戶對主檔資訊的存取。

- **`pharmacist.management.master.view`** - 藥師主檔檢視權限
  - 允許用戶查看藥師基本資料與學位資訊
  
- **`pharmacist.management.master.edit`** - 藥師主檔編輯權限
  - 允許用戶編輯藥師基本資料

### 權限授予規則

| 角色 | master.view | master.edit | 說明 |
|------|------------|------------|------|
| `business_manager` | ✅ | ✅ | 業務經理可完全管理藥師主檔 |
| `supervisor_role` | ✅ | ❌ | 監督員只能查閱藥師主檔，不可修改 |
| `admin_role` | ✅ | ✅ | 系統管理員可完全管理藥師主檔 |

### 代碼變更

#### 1. 新增 Migration
**檔案**: `supabase/migration_pharmacist_master_rbac.sql`
- 定義兩個新的 permission code
- 為各角色授予相應權限
- 驗證查詢確認權限授予成功

#### 2. 前端邏輯更新
**檔案**: `app/admin/pharmacist-management/page.tsx`
- 添加 `canViewMasterTab` 與 `canEditMasterTab` 權限檢查
- 無 `master.view` 權限時隱藏「藥師主檔」Tab 按鈕
- 強制訪問 `tab=master` 時若無權限自動重定向回 overview
- 將 Edit 權限從 `pharmacist.management.edit` 改為 `pharmacist.management.master.edit`

### 使用者影響

**權限檢視時變化**：
- 監督員（`supervisor_role`）現在若無 `master.edit` 權限，會發現藥師主檔無法編輯
- 業務經理與系統管理員功能不變
- 無 `master.view` 權限的用戶將無法看到「藥師主檔」Tab

**推薦配置**：
- 若希望某些角色只能檢視主檔不能編輯，在角色權限中只授予 `pharmacist.management.master.view`
- 若希望某些用戶無法存取主檔，不授予 `pharmacist.management.master.view` 權限

### 本次發佈包含的檔案

1. ✅ `supabase/migration_pharmacist_master_rbac.sql` (新建)
2. ✅ `app/admin/pharmacist-management/page.tsx` (修改)

### 部署步驟

1. 執行 migration: `supabase/migration_pharmacist_master_rbac.sql`
2. 部署代碼更新
3. 驗證各角色在藥師管理頁面的 Tab 可見性與編輯功能

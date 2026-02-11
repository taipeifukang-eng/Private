# 盤點管理權限新增說明

## 變更日期
2026年2月11日

## 變更內容

### 1. 新增權限定義
在 `supabase/migration_add_inventory_permissions.sql` 中新增了盤點管理模組的完整權限定義。

#### 權限模組：inventory（盤點管理）

**主要功能權限：**
- `inventory.inventory.view` - 查看盤點管理
- `inventory.inventory.access` - 存取盤點管理系統

**模組一：產出外盤複盤清單**
- `inventory.module1.upload_external` - 上傳外盤公司盤點檔
- `inventory.module1.upload_fks0701` - 上傳FKS0701盤點記錄
- `inventory.module1.generate` - 產生外盤複盤清單

**模組二：產出內部+外盤公司資料整合之複盤表與未盤表**
- `inventory.module2.upload_pre` - 上傳預盤資料
- `inventory.module2.upload_fks0701` - 上傳FKS0701記錄
- `inventory.module2.upload_external` - 上傳外盤公司盤點檔
- `inventory.module2.generate` - 產生整合複盤表與未盤表

**模組三：產出匯入DPOS檔案**
- `inventory.module3.upload_recount` - 上傳修改後的複盤資料
- `inventory.module3.upload_uninventoried` - 上傳修改後的未盤資料
- `inventory.module3.generate` - 產生DPOS匯入檔案

**基礎功能：**
- `inventory.base_data.upload` - 上傳1F當日商品資料
- `inventory.export.download` - 下載盤點結果檔案

### 2. 角色權限配置

| 角色 | 權限範圍 |
|------|----------|
| 系統管理員 (admin) | 所有權限（自動繼承） |
| 營業部主管 (business_supervisor) | 完整盤點管理權限 |
| 營業部助理 (business_assistant) | 完整盤點管理權限 |
| 店長 (store_manager) | 基本操作權限（所有模組） |
| 督導 (supervisor) | 基本操作權限（所有模組） |
| 主管 (manager) | 查看權限 |
| 一般成員 (member) | 無權限 |

### 3. 前端更新

更新 `components/Navbar.tsx` 中的盤點管理連結，添加對店長和督導的顯示支持：

```typescript
{ 
  href: '/inventory', 
  label: '盤點管理', 
  icon: Package, 
  roles: ['admin'], 
  allowBusinessAssistant: true, 
  allowBusinessSupervisor: true, 
  allowStoreManager: true // 新增
}
```

## 部署步驟

1. **執行資料庫 Migration**
   ```bash
   # 在 Supabase SQL Editor 中執行
   supabase/migration_add_inventory_permissions.sql
   ```

2. **重啟應用**（如果需要）
   ```bash
   npm run dev  # 開發環境
   # 或
   npm run build && npm start  # 生產環境
   ```

3. **驗證權限**
   - 使用不同角色的帳號登入
   - 確認導航欄是否正確顯示「盤點管理」選項
   - 測試各角色是否能正常存取盤點管理頁面

## 測試建議

### 測試案例

1. **系統管理員**
   - ✅ 應該看到「盤點管理」選項
   - ✅ 應該能存取所有模組功能
   - ✅ 應該能上傳所有類型檔案
   - ✅ 應該能產生所有結果檔案

2. **營業部主管/助理**
   - ✅ 應該看到「盤點管理」選項
   - ✅ 應該能存取所有模組功能
   - ✅ 應該能完整操作

3. **店長/督導**
   - ✅ 應該看到「盤點管理」選項
   - ✅ 應該能存取所有模組功能
   - ✅ 應該能上傳檔案和產生結果

4. **一般主管（非營業部）**
   - ✅ 應該看到「盤點管理」選項（僅查看）
   - ❌ 可能無法執行實際操作（依業務需求調整）

5. **一般成員**
   - ❌ 不應該看到「盤點管理」選項
   - ❌ 直接存取 /inventory 應該被拒絕

## 備註

- 權限採取「最小權限原則」，一般成員預設無盤點管理權限
- 店長和督導的權限與其門市管理職責相符
- 如需為特定使用者開啟或關閉權限，可透過「使用者管理」→「角色指派」功能調整
- 未來若需調整權限細節，可直接修改 `role_permissions` 表

## 相關文件

- 盤點管理系統功能說明：`supabase/製作盤點管理模組.ini`
- RBAC 系統設計：`RBAC_SYSTEM_DESIGN.md`
- 權限系統指南：`PERMISSION_SYSTEM_GUIDE.md`

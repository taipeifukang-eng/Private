# 盤點組人員角色與每月狀態權限細分指南

## 概述

本指南說明如何新增「盤點組人員」角色，並將每月狀態的權限細分為：
- 查看門市人員狀態
- 查看門市統計資料
- 查看/編輯支援時數

## 新增內容

### 1. 新增角色

- **盤點組人員** (inventory_staff)
  - 可查看所有門市的人員狀態
  - 不能查看門市統計資料（績效率、營收達成率等）
  - 不能查看支援時數

### 2. 新增權限

| 權限代碼 | 說明 | 用途 |
|---------|------|------|
| `monthly.status.view_stats` | 查看門市統計資料 | 控制是否能查看績效率、營收達成率、來客數等統計數據 |
| `monthly.allowance.view_support_hours` | 查看支援時數 | 控制是否能查看支援分店時數和分店支援時數 |

### 3. 角色權限配置

| 角色 | 查看人員狀態 | 查看統計資料 | 查看支援時數 | 編輯支援時數 |
|------|------------|------------|------------|------------|
| 系統管理員 | ✅ | ✅ | ✅ | ✅ |
| 營業部主管 | ✅ | ✅ | ✅ | ✅ |
| 營業部助理 | ✅ | ✅ | ✅ | ✅ |
| 督導 | ✅ | ✅ | ✅ | ✅ |
| 店長 | ✅ | ❌ | ✅ | ✅ |
| 主管 | ✅ | ❌ | ❌ | ❌ |
| **盤點組人員** | ✅ | ❌ | ❌ | ❌ |
| 一般成員 | ✅ | ❌ | ❌ | ❌ |

## 部署步驟

### 步驟 1：執行資料庫 Migration

在 Supabase SQL Editor 中執行：

```bash
supabase/migration_add_inventory_staff_role.sql
```

此 migration 會：
1. 新增「盤點組人員」角色
2. 新增細分權限
3. 為所有角色配置適當的權限

### 步驟 2：驗證資料庫變更

執行以下查詢確認：

```sql
-- 檢查新角色
SELECT * FROM roles WHERE code = 'inventory_staff';

-- 檢查新權限
SELECT * FROM permissions 
WHERE code IN ('monthly.status.view_stats', 'monthly.allowance.view_support_hours');

-- 檢查盤點組人員的權限配置
SELECT 
  r.name as role_name,
  p.code as permission_code,
  p.description,
  rp.is_allowed
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.code = 'inventory_staff'
ORDER BY p.code;
```

### 步驟 3：前端代碼已自動更新

以下檔案已修改，無需額外操作：

**app/store/actions.ts**
- 新增 `checkMonthlyStatusPermissions()` 函數
- 檢查用戶的細分權限

**app/monthly-status/page.tsx**
- 移除硬編碼的角色檢查
- 改用權限系統控制顯示
- 新增狀態：`canViewStats`, `canViewSupportHours`, `canEditSupportHours`

## 測試清單

### 1. 盤點組人員測試

登入一個「盤點組人員」角色的帳號：

- [ ] 可以進入「每月人員狀態」頁面
- [ ] 可以看到所有門市的人員列表
- [ ] 可以看到員工的職位、在職狀態等資訊
- [ ] **不能**看到門市統計資料區塊（績效率、營收達成率等）
- [ ] **不能**看到支援時數區塊（支援分店時數、分店支援時數）

### 2. 店長權限測試

登入一個「店長」角色的帳號：

- [ ] 可以看到門市人員狀態
- [ ] **不能**看到門市統計資料
- [ ] 可以看到支援時數（唯讀或編輯）

### 3. 主管權限測試

登入一個「主管」角色的帳號：

- [ ] 可以看到門市人員狀態
- [ ] **不能**看到門市統計資料
- [ ] **不能**看到支援時數

### 4. 營業部主管/助理/督導測試

登入這些角色的帳號：

- [ ] 可以看到所有資料（人員狀態、統計資料、支援時數）
- [ ] 可以編輯所有可編輯的欄位

## 如何指派盤點組人員角色

### 方法 1：透過 SQL 手動指派

```sql
-- 為用戶指派盤點組人員角色
INSERT INTO user_roles (user_id, role_id)
SELECT 
  '[用戶的 UUID]',
  id
FROM roles
WHERE code = 'inventory_staff'
ON CONFLICT (user_id, role_id) DO NOTHING;
```

### 方法 2：透過角色管理介面（如已實作）

1. 進入「角色管理」頁面
2. 選擇用戶
3. 指派「盤點組人員」角色

## 權限邏輯說明

### 原有邏輯（硬編碼）

```typescript
const canViewStoreStats = () => {
  if (['admin', 'supervisor', 'area_manager'].includes(userRole)) {
    return true;
  }
  if (userDepartment?.startsWith('營業') && userJobTitle === '助理') {
    return true;
  }
  return false;
};
```

### 新邏輯（權限系統）

```typescript
// 1. 從後端獲取權限
const permissionsResult = await checkMonthlyStatusPermissions();
setCanViewStats(permissionsResult.canViewStats);
setCanViewSupportHours(permissionsResult.canViewSupportHours);

// 2. 直接使用權限狀態
const shouldViewStats = canViewStats;
const shouldViewSupportHours = canViewSupportHours || hasEditPermission;
```

## 問題排查

### 問題：盤點組人員看不到任何門市

**可能原因：**
- 用戶沒有分配到任何門市
- 用戶沒有基本的查看權限

**解決方法：**
```sql
-- 檢查用戶的權限
SELECT 
  p.code, 
  p.description, 
  rp.is_allowed
FROM user_roles ur
JOIN roles r ON r.id = ur.role_id
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
WHERE ur.user_id = '[用戶 UUID]'
  AND p.module = 'monthly'
ORDER BY p.code;
```

### 問題：某角色看到不應該看到的資料

**可能原因：**
- 權限配置錯誤
- 快取未清除

**解決方法：**
1. 檢查資料庫中的 role_permissions 配置
2. 重新登入以清除快取
3. 檢查前端邏輯是否正確使用權限狀態

## 相關檔案

- `supabase/migration_add_inventory_staff_role.sql` - 資料庫 migration
- `app/store/actions.ts` - 權限檢查函數
- `app/monthly-status/page.tsx` - 每月狀態頁面
- `lib/permissions/check.ts` - 權限檢查工具

## 回滾計畫

如需回滾此變更：

```sql
-- 1. 移除盤點組人員角色的權限
DELETE FROM role_permissions 
WHERE role_id = (SELECT id FROM roles WHERE code = 'inventory_staff');

-- 2. 移除盤點組人員角色
DELETE FROM roles WHERE code = 'inventory_staff';

-- 3. 移除新增的細分權限（注意：會影響其他角色）
DELETE FROM permissions 
WHERE code IN ('monthly.status.view_stats', 'monthly.allowance.view_support_hours');
```

**注意：** 回滾後需要恢復前端代碼到使用硬編碼角色檢查的版本。

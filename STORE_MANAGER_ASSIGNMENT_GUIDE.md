# 店長指派與門市存取完整指南

## 概述

本指南說明如何正確指派店長，並確保店長登入後能看到其管理的門市的每月人員狀態。

## 店長存取門市的必要條件

店長要能看到並管理門市，系統需要滿足以下 **5 個條件**：

### ✅ 條件檢查清單

| # | 條件 | 資料表 | 說明 |
|---|------|--------|------|
| 1 | 用戶存在 | `profiles` | 用戶必須在系統中註冊 |
| 2 | 門市存在且啟用 | `stores` | 門市必須存在且 `is_active=true` |
| 3 | 店長指派記錄 | `store_managers` | 記錄用戶與門市的管理關係 |
| 4 | 店長角色 | `user_roles` | 用戶必須被指派 `store_manager_role` |
| 5 | 查看權限 | `role_permissions` | `store_manager_role` 必須有 `monthly.status.view_own` 權限 |

## 完整流程

### 步驟 1：執行診斷檢查

在 Supabase SQL Editor 中執行：

```bash
supabase/complete_store_manager_check.sql
```

此文件會執行 5 個檢查查詢，顯示：
- ✅ = 條件已滿足
- ❌ = 條件缺失
- ⚠️ = 需要注意

### 步驟 2：分析診斷結果

查看 5 個檢查的輸出：

**檢查 1：用戶存在**
- 如果沒有結果 → 用戶尚未註冊，請先建立用戶帳號

**檢查 2：門市存在**
- 如果沒有結果 → 門市不存在，請先建立門市
- 如果 `is_active=false` → 門市已停用，需要啟用

**檢查 3：店長指派記錄**
- 如果沒有結果 → **需要執行修復方案 A**
- 有結果但 `role_type != 'store_manager'` → 指派類型錯誤

**檢查 4：用戶角色**
- 如果沒有 `store_manager_role` → **需要執行修復方案 B**
- 如果 `is_active=false` → 角色已停用

**檢查 5：角色權限**
- 如果 `monthly.status.view_own` 的 `is_allowed=false` → 權限配置錯誤
- 如果找不到權限記錄 → 需要重新執行 RBAC migration

### 步驟 3：執行修復（如有需要）

根據診斷結果，選擇適當的修復方案：

#### 方案 A：新增店長指派記錄

如果檢查 3 沒有結果：

```sql
DO $$
DECLARE
  v_user_id UUID;
  v_store_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM profiles WHERE employee_code = 'FK0791';
  SELECT id INTO v_store_id FROM stores WHERE store_code = '0002';
  
  IF v_user_id IS NOT NULL AND v_store_id IS NOT NULL THEN
    INSERT INTO store_managers (user_id, store_id, role_type, is_primary)
    VALUES (v_user_id, v_store_id, 'store_manager', true)
    ON CONFLICT (store_id, user_id, role_type) 
    DO UPDATE SET is_primary = true;
    
    RAISE NOTICE '✅ 已建立店長指派記錄';
  END IF;
END $$;
```

#### 方案 B：指派店長角色

如果檢查 4 沒有 `store_manager_role`：

```sql
DO $$
DECLARE
  v_user_id UUID;
  v_role_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM profiles WHERE employee_code = 'FK0791';
  SELECT id INTO v_role_id FROM roles WHERE code = 'store_manager_role';
  
  IF v_user_id IS NOT NULL AND v_role_id IS NOT NULL THEN
    INSERT INTO user_roles (user_id, role_id, is_active)
    VALUES (v_user_id, v_role_id, true)
    ON CONFLICT (user_id, role_id) 
    DO UPDATE SET is_active = true;
    
    RAISE NOTICE '✅ 已指派店長角色';
  END IF;
END $$;
```

#### 方案 C：一鍵修復（推薦）

同時建立指派記錄和角色：

```sql
DO $$
DECLARE
  v_user_id UUID;
  v_store_id UUID;
  v_role_id UUID;
BEGIN
  -- 獲取 IDs
  SELECT id INTO v_user_id FROM profiles WHERE employee_code = 'FK0791';
  SELECT id INTO v_store_id FROM stores WHERE store_code = '0002';
  SELECT id INTO v_role_id FROM roles WHERE code = 'store_manager_role';
  
  -- 檢查
  IF v_user_id IS NULL THEN RAISE EXCEPTION '❌ 找不到員工'; END IF;
  IF v_store_id IS NULL THEN RAISE EXCEPTION '❌ 找不到門市'; END IF;
  IF v_role_id IS NULL THEN RAISE EXCEPTION '❌ 找不到角色'; END IF;
  
  -- 建立指派記錄
  INSERT INTO store_managers (user_id, store_id, role_type, is_primary)
  VALUES (v_user_id, v_store_id, 'store_manager', true)
  ON CONFLICT (store_id, user_id, role_type) 
  DO UPDATE SET is_primary = true;
  
  -- 指派角色
  INSERT INTO user_roles (user_id, role_id, is_active)
  VALUES (v_user_id, v_role_id, true)
  ON CONFLICT (user_id, role_id) 
  DO UPDATE SET is_active = true;
  
  RAISE NOTICE '🎉 完成！請店長重新登入';
END $$;
```

### 步驟 4：要求店長重新登入

修復完成後：
1. 店長登出系統
2. 重新登入
3. 進入「每月人員狀態」頁面
4. 應該能看到其管理的門市

## 權限流程說明

### getUserManagedStores 函數邏輯

```typescript
// app/store/actions.ts
export async function getUserManagedStores() {
  // 1. 檢查權限
  const canViewAllStores = await hasPermission(user.id, 'monthly.status.view_all');
  const canViewOwnStores = await hasPermission(user.id, 'monthly.status.view_own');
  
  if (!canViewOwnStores && !canViewAllStores) {
    return { success: false, error: '權限不足' };
  }
  
  // 2. 如果可以查看所有門市（管理員）
  if (canViewAllStores) {
    return await getAllStores();
  }
  
  // 3. 如果只能查看自己管理的門市（店長）
  // 查詢 store_managers 表，找出用戶管理的門市
  const { data } = await supabase
    .from('store_managers')
    .select('store_id, stores(*)')
    .eq('user_id', user.id)
    .eq('is_active', true); // ← 舊版本可能沒有這個欄位
  
  return { success: true, data: stores };
}
```

### hasPermission 函數邏輯

```typescript
// lib/permissions/check.ts
export async function hasPermission(userId: string, permissionCode: string) {
  // 1. 查詢用戶的所有角色
  const userRoles = await getUserRoles(userId);
  
  // 2. 查詢這些角色的所有權限
  const rolePermissions = await getRolePermissions(userRoles);
  
  // 3. 檢查是否有指定權限且 is_allowed=true
  return rolePermissions.some(p => 
    p.code === permissionCode && 
    p.is_allowed === true
  );
}
```

## 資料庫結構

### store_managers 表

```sql
CREATE TABLE store_managers (
  id UUID PRIMARY KEY,
  store_id UUID REFERENCES stores(id),
  user_id UUID REFERENCES profiles(id),
  role_type VARCHAR(20),  -- 'store_manager', 'supervisor', 'area_manager'
  is_primary BOOLEAN,     -- 是否為主要負責人
  created_at TIMESTAMP,
  UNIQUE(store_id, user_id, role_type)
);
```

**重要：** 注意表中沒有 `is_active` 欄位！如果您的代碼中有 `.eq('is_active', true)`，請移除。

### user_roles 表

```sql
CREATE TABLE user_roles (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  role_id UUID REFERENCES roles(id),
  is_active BOOLEAN DEFAULT true,
  assigned_at TIMESTAMP,
  UNIQUE(user_id, role_id)
);
```

### role_permissions 表

```sql
CREATE TABLE role_permissions (
  id UUID PRIMARY KEY,
  role_id UUID REFERENCES roles(id),
  permission_id UUID REFERENCES permissions(id),
  is_allowed BOOLEAN DEFAULT true,
  UNIQUE(role_id, permission_id)
);
```

## 常見問題排查

### 問題 1：店長看不到任何門市

**可能原因：**
- store_managers 記錄不存在
- user_roles 沒有 store_manager_role
- 權限配置錯誤

**解決方法：**
執行 `complete_store_manager_check.sql` 診斷，然後執行對應的修復方案。

### 問題 2：店長看到不應該看到的門市

**可能原因：**
- store_managers 有多條記錄
- 用戶被指派了 `monthly.status.view_all` 權限

**解決方法：**
```sql
-- 檢查用戶的所有門市指派
SELECT 
  p.employee_code,
  p.full_name,
  s.store_code,
  s.store_name,
  sm.role_type
FROM store_managers sm
JOIN profiles p ON p.id = sm.user_id
JOIN stores s ON s.id = sm.store_id
WHERE p.employee_code = 'FK0791';

-- 刪除不應該的指派
DELETE FROM store_managers 
WHERE user_id = '[USER_ID]' AND store_id = '[不應該的門市ID]';
```

### 問題 3：修改後還是看不到

**可能原因：**
- 瀏覽器快取
- Session 未更新

**解決方法：**
1. 要求用戶登出
2. 清除瀏覽器快取（Ctrl+Shift+R）
3. 重新登入

### 問題 4：權限檢查報錯

**可能原因：**
- RBAC migration 未執行
- 權限記錄缺失

**解決方法：**
```sql
-- 檢查 store_manager_role 的權限
SELECT 
  r.code as role_code,
  p.code as permission_code,
  p.description,
  rp.is_allowed
FROM role_permissions rp
JOIN roles r ON r.id = rp.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.code = 'store_manager_role'
  AND p.module = 'monthly'
ORDER BY p.code;

-- 如果缺少權限，重新執行 RBAC migration
-- supabase/migration_rbac_system.sql
```

## 透過介面指派店長

如果您已經實作了店長指派介面（`/admin/store-managers`），應該確保介面執行以下操作：

### 指派店長按鈕應該：

1. 建立 `store_managers` 記錄
2. 指派 `store_manager_role` 到用戶
3. 顯示成功訊息

### 範例代碼：

```typescript
// app/admin/store-managers/page.tsx
async function assignStoreManager(userId: string, storeId: string) {
  // 1. 建立店長指派記錄
  await supabase
    .from('store_managers')
    .insert({
      user_id: userId,
      store_id: storeId,
      role_type: 'store_manager',
      is_primary: true
    });
  
  // 2. 指派店長角色
  const { data: role } = await supabase
    .from('roles')
    .select('id')
    .eq('code', 'store_manager_role')
    .single();
  
  await supabase
    .from('user_roles')
    .insert({
      user_id: userId,
      role_id: role.id,
      is_active: true
    });
  
  alert('✅ 店長指派成功！請要求店長重新登入。');
}
```

## 相關文件

- 診斷檢查 SQL：`supabase/complete_store_manager_check.sql`
- 舊版診斷 SQL：`supabase/diagnose_store_manager_issue.sql`
- RBAC 系統：`supabase/migration_rbac_system.sql`
- 權限系統指南：`PERMISSION_SYSTEM_GUIDE.md`
- RBAC 設計文件：`RBAC_SYSTEM_DESIGN.md`

## 驗證清單

指派完成後，請驗證：

- [ ] 執行 `complete_store_manager_check.sql`，所有檢查都是 ✅
- [ ] 店長重新登入系統
- [ ] 店長可以看到「每月人員狀態」選單
- [ ] 店長可以在下拉選單中看到其管理的門市
- [ ] 店長可以查看門市的人員列表
- [ ] 店長可以編輯人員狀態
- [ ] 店長可以提交審核
- [ ] 店長可以查看/編輯支援時數（如果有此權限）
- [ ] 店長**不能**看到門市統計資料（績效率等）

## 注意事項

1. **重新登入很重要**：權限變更後必須重新登入才會生效
2. **檢查資料表結構**：確認 `store_managers` 表的欄位名稱
3. **權限細分**：店長只能看自己的門市，不能看統計資料
4. **一次指派多個門市**：同一用戶可以有多條 `store_managers` 記錄
5. **督導也是店長**：督導 (supervisor) 使用相同的權限系統

## 批次指派範例

如果需要批次指派多位店長：

```sql
-- 批次指派多位店長到各自的門市
DO $$
DECLARE
  v_role_id UUID;
BEGIN
  -- 獲取店長角色 ID
  SELECT id INTO v_role_id FROM roles WHERE code = 'store_manager_role';
  
  -- 批次建立指派記錄（範例）
  INSERT INTO store_managers (user_id, store_id, role_type, is_primary)
  SELECT 
    p.id as user_id,
    s.id as store_id,
    'store_manager' as role_type,
    true as is_primary
  FROM profiles p
  CROSS JOIN stores s
  WHERE (p.employee_code = 'FK0791' AND s.store_code = '0002')
     OR (p.employee_code = 'FK0792' AND s.store_code = '0003')
  ON CONFLICT (store_id, user_id, role_type) 
  DO UPDATE SET is_primary = EXCLUDED.is_primary;
  
  -- 批次指派角色
  INSERT INTO user_roles (user_id, role_id, is_active)
  SELECT DISTINCT p.id, v_role_id, true
  FROM profiles p
  WHERE p.employee_code IN ('FK0791', 'FK0792')
  ON CONFLICT (user_id, role_id) 
  DO UPDATE SET is_active = true;
  
  RAISE NOTICE '✅ 批次指派完成';
END $$;
```

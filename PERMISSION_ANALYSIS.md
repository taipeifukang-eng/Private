# 系統權限功能分析報告

## 📊 一、基礎權限架構

### 1.1 角色類型 (role)
| 角色代碼 | 中文名稱 | 權限等級 | 說明 |
|---------|---------|---------|------|
| `admin` | 系統管理員 | 最高 | 完整系統控制權限 |
| `manager` | 主管 | 高 | 管理任務流程、審核報表 |
| `member` | 成員 | 基礎 | 執行被指派的任務 |
| `supervisor` | 督導 | 高 | 門市督導職能 |
| `area_manager` | 區經理 | 高 | 區域管理職能 |
| `store_manager` | 店長 | 中 | 單一門市管理 |

### 1.2 部門類型 (department)
- 營業部 (以「營業」開頭，如：營業一部、營業二部)
- 其他部門

### 1.3 職稱類型 (job_title)
| 職稱 | 是否需要門市指派 | 說明 |
|-----|----------------|------|
| 督導 | ✅ | 需要指派管理門市 |
| 店長 | ✅ | 需要指派管理門市 |
| 代理店長 | ✅ | 需要指派管理門市 |
| 督導(代理店長) | ✅ | 需要指派管理門市 |
| 經理 | ❌ | 不需要指派 |
| 主管 | ❌ | 不需要指派 |

### 1.4 組合權限類型
```typescript
// 需要門市指派的職位
needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(job_title)

// 營業部助理
isBusinessAssistant = department.startsWith('營業') && role === 'member' && !needsAssignment

// 營業部主管
isBusinessSupervisor = department.startsWith('營業') && role === 'manager' && !needsAssignment

// 營業部經理
isBusinessManager = department.startsWith('營業') && ['經理', '主管'].includes(job_title)
```

---

## 📋 二、各模組權限矩陣

### 2.1 【首頁 / 系統總覽】
**檔案位置**: `app/page.tsx`

| 功能 | admin | manager | member | 營業助理 | 營業主管 | 備註 |
|------|-------|---------|--------|----------|----------|------|
| 查看首頁 | ✅ | ✅ | ✅ | ✅ | ✅ | 所有人 |
| 查看儀表板入口 | ✅ | ✅ | ❌ | ❌ | ❌ | |
| 查看任務管理入口 | ✅ | ✅ | ❌ | ❌ | ❌ | |
| 查看使用者管理入口 | ✅ | ❌ | ❌ | ❌ | ❌ | |

---

### 2.2 【派發任務模組】

#### 2.2.1 我的任務 (`app/my-tasks/`)
| 功能 | admin | manager | member | 營業助理 | 營業主管 | 備註 |
|------|-------|---------|--------|----------|----------|------|
| 查看我的任務 | ✅ | ✅ | ✅ | ✅ | ✅ | 所有人 |
| 查看任務詳情 | ✅ | ✅ | ✅ | ✅ | ✅ | 協作者或管理員 |
| 提交任務進度 | ✅ | ✅ | ✅ | ✅ | ✅ | 協作者 |

**權限檢查位置**: 
- `app/assignment/[id]/page.tsx` (line 42)
```typescript
const isAdmin = user.profile?.role === 'admin' || user.profile?.role === 'manager';
if (!isCollaborator && !isAdmin) { redirect }
```

#### 2.2.2 儀表板 (`app/dashboard/`)
| 功能 | admin | manager | member | 營業助理 | 營業主管 | 備註 |
|------|-------|---------|--------|----------|----------|------|
| 查看任務統計 | ✅ | ✅ | ❌ | ✅ | ❌ | |
| 查看所有任務 | ✅ | ✅ | ❌ | ✅ | ❌ | |
| 建立新任務 | ✅ | ✅ | ❌ | ✅ | ❌ | |

**權限檢查**: Navbar子選單過濾

#### 2.2.3 任務管理 (`app/admin/templates/`)
| 功能 | admin | manager | member | 營業助理 | 營業主管 | 備註 |
|------|-------|---------|--------|----------|----------|------|
| 查看任務範本 | ✅ | ✅ | ❌ | ✅ | ❌ | |
| 建立任務範本 | ✅ | ✅ | ❌ | ✅ | ❌ | |
| 編輯任務範本 | ✅ | ✅ | ❌ | ✅ | ❌ | |
| 刪除任務範本 | ✅ | ✅ | ❌ | ✅ | ❌ | |

**權限檢查位置**: 
- `app/admin/template/[id]/page.tsx` (line 19)
```typescript
if (user.profile?.role !== 'admin' && user.profile?.role !== 'manager') { redirect }
```

#### 2.2.4 已封存任務 (`app/admin/archived/`)
| 功能 | admin | manager | member | 營業助理 | 營業主管 | 備註 |
|------|-------|---------|--------|----------|----------|------|
| 查看封存任務 | ✅ | ✅ | ❌ | ✅ | ❌ | |
| 還原任務 | ✅ | ✅ | ❌ | ✅ | ❌ | |

---

### 2.3 【門市管理模組】

#### 2.3.1 門市管理 (`app/admin/stores/`)
**檔案位置**: `app/admin/stores/page.tsx`

| 功能 | admin | manager | member | 營業助理 | 營業主管 | 備註 |
|------|-------|---------|--------|----------|----------|------|
| 查看門市列表 | ✅ | ❌ | ❌ | ✅ | ✅ | |
| 新增門市 | ✅ | ❌ | ❌ | ❌ | ✅ | |
| 編輯門市資料 | ✅ | ❌ | ❌ | ❌ | ✅ | |
| 停用/啟用門市 | ✅ | ❌ | ❌ | ❌ | ✅ | |
| 查看已停用門市 | ✅ | ❌ | ❌ | ✅ | ✅ | |

**權限檢查位置**: 
- `app/admin/stores/page.tsx` (lines 29-35)
```typescript
const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
const isBusinessAssistant = profile?.department?.startsWith('營業') && profile?.role === 'member' && !needsAssignment;
const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;

if (!profile || (profile.role !== 'admin' && !isBusinessAssistant && !isBusinessSupervisor)) {
  redirect('/dashboard');
}
```

#### 2.3.2 員工管理 (`app/admin/employee-management/`)
**檔案位置**: `app/admin/employee-management/page.tsx`

| 功能 | admin | manager | member | 營業助理 | 營業主管 | 備註 |
|------|-------|---------|--------|----------|----------|------|
| 查看員工列表 | ✅ | ❌ | ❌ | ✅ | ✅ | |
| 新增員工 | ✅ | ❌ | ❌ | ✅ | ✅ | |
| 編輯員工資料 | ✅ | ❌ | ❌ | ✅ | ✅ | |
| 刪除員工 | ✅ | ❌ | ❌ | ✅ | ✅ | |

**權限檢查位置**: 
- `app/admin/employee-management/page.tsx` (lines 22-28)
- API: `app/api/employees/add/route.ts`, `app/api/employees/update/route.ts`

#### 2.3.3 門市員工管理 (`app/admin/stores/[id]/employee-management/`)
| 功能 | admin | manager | member | 營業助理 | 營業主管 | 備註 |
|------|-------|---------|--------|----------|----------|------|
| 查看門市員工 | ✅ | ❌ | ❌ | ✅ | ✅ | |
| 新增門市員工 | ✅ | ❌ | ❌ | ✅ | ✅ | |
| 移除門市員工 | ✅ | ❌ | ❌ | ✅ | ✅ | |

**權限檢查位置**: 
- `app/admin/stores/[id]/employee-management/page.tsx` (lines 51-58)

#### 2.3.4 人員異動管理 (`app/admin/promotion-management/`)
**檔案位置**: `app/admin/promotion-management/page.tsx`

| 功能 | admin | manager | member | 營業助理 | 營業主管 | 備註 |
|------|-------|---------|--------|----------|----------|------|
| 查看異動記錄 | ✅ | ❌ | ❌ | ✅ | ✅ | |
| 新增異動記錄 | ✅ | ❌ | ❌ | ✅ | ✅ | |
| 批次新增異動 | ✅ | ❌ | ❌ | ✅ | ✅ | |
| 編輯異動記錄 | ✅ | ❌ | ❌ | ✅ | ✅ | |

**權限檢查位置**: 
- `app/admin/promotion-management/page.tsx` (lines 93-97)
- API: `app/api/employee-movements/batch/route.ts`, `app/api/promotions/batch/route.ts`

#### 2.3.5 門市人員異動 (`app/admin/stores/[id]/promotion-management/`)
| 功能 | admin | manager | member | 營業助理 | 營業主管 | 備註 |
|------|-------|---------|--------|----------|----------|------|
| 查看門市異動 | ✅ | ❌ | ❌ | ✅ | ✅ | |
| 新增異動記錄 | ✅ | ❌ | ❌ | ✅ | ✅ | |
| 批次處理異動 | ✅ | ❌ | ❌ | ✅ | ✅ | |

**權限檢查位置**: 
- `app/admin/stores/[id]/promotion-management/page.tsx` (lines 43-50)
- API: `app/api/promotions/batch-global/route.ts`

#### 2.3.6 店長指派 (`app/admin/store-managers/`)
| 功能 | admin | manager | member | 營業助理 | 營業主管 | 備註 |
|------|-------|---------|--------|----------|----------|------|
| 查看店長指派 | ✅ | ❌ | ❌ | ❌ | ✅ | |
| 指派店長 | ✅ | ❌ | ❌ | ❌ | ✅ | |
| 移除店長指派 | ✅ | ❌ | ❌ | ❌ | ✅ | |

**權限檢查位置**: 
- Server Action: `app/store/actions.ts` (lines 76-77, 140-142)
```typescript
const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;
if (!profile || (profile.role !== 'admin' && !isBusinessSupervisor)) {
  return { success: false, error: '權限不足' };
}
```

#### 2.3.7 經理/督導管理 (`app/admin/supervisors/`)
| 功能 | admin | manager | member | 營業助理 | 營業主管 | 備註 |
|------|-------|---------|--------|----------|----------|------|
| 查看督導列表 | ✅ | ❌ | ❌ | ❌ | ❌ | |
| 指派督導門市 | ✅ | ❌ | ❌ | ❌ | ❌ | |

**權限檢查位置**: 
- API: `app/api/supervisors/users/route.ts`, `app/api/supervisors/stores/route.ts`
```typescript
if (profile?.role !== 'admin') {
  return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
}
```

#### 2.3.8 批次匯入員工 (`app/admin/import-employees/`)
| 功能 | admin | manager | member | 營業助理 | 營業主管 | 備註 |
|------|-------|---------|--------|----------|----------|------|
| 批次匯入員工 | ✅ | ❌ | ❌ | ❌ | ✅ | |

#### 2.3.9 活動管理 (`app/admin/activity-management/`)
| 功能 | admin | manager | member | 營業助理 | 營業主管 | 備註 |
|------|-------|---------|--------|----------|----------|------|
| 查看活動列表 | ✅ | ❌ | ❌ | ❌ | ✅ | |
| 建立活動 | ✅ | ❌ | ❌ | ❌ | ✅ | |
| 編輯活動排程 | ✅ | ❌ | ❌ | ❌ | ✅ | |
| 查看活動排程 | ✅ | ❌ | ❌ | ❌ | ✅ | |

**權限檢查位置**: 
- API: `app/api/campaigns/published/route.ts` (複雜邏輯)
```typescript
// Admin 可查看所有
if (profile.role === 'admin') { return all }

// 督導、店長、代理店長
const isJobTitleAllowed = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile.job_title || '');

// 營業部經理/主管
const isBusinessManager = profile.department?.startsWith('營業') && ['經理', '主管'].includes(profile.job_title || '');
```

---

### 2.4 【每月人員狀態模組】

#### 2.4.1 每月人員狀態 (`app/monthly-status/`)
**檔案位置**: `app/monthly-status/page.tsx`

| 功能 | admin | supervisor | area_manager | 營業助理 | 營業主管 | 店長/督導 | 備註 |
|------|-------|-----------|--------------|----------|----------|----------|------|
| 查看所有門市狀態 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | |
| 查看管理門市狀態 | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | 僅管理的門市 |
| 編輯門市人員資料 | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | |
| 匯入績效資料 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | |
| 匯入門市統計 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | |
| 編輯支援時數 | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | |
| 編輯餐費補助 | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | |
| 編輯交通費 | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | |
| 編輯培育金 | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | |
| 編輯支援獎金 | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | |
| 提交確認 | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | |
| 管理員確認/覆核 | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | |
| 前往活動管理 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | needsAssignment |

**權限檢查位置**: 
- `app/monthly-status/page.tsx` (多處複雜判斷)
```typescript
// 判斷能否查看門市 (lines 713-720)
if (['admin', 'supervisor', 'area_manager'].includes(userRole)) { return true; }
if (userDepartment?.startsWith('營業') && (userRole === 'member' || userRole === 'manager') && !needsAssignment) { return true; }

// 判斷能否編輯支援時數 (line 1168)
const canEditSupportHours = ['admin', 'supervisor', 'area_manager'].includes(userRole) || isStoreManager;

// 判斷能否編輯餐費、交通費等 (line 1250)
(['admin', 'manager', 'supervisor', 'area_manager'].includes(userRole) || isStoreManager)

// 活動管理按鈕顯示 (line 322)
{needsAssignment && managedStores.length > 0 && (<Link href="/activity-management">)}
```

#### 2.4.2 資料匯出 (`app/admin/export-monthly-status/`)
| 功能 | admin | supervisor | area_manager | 營業助理 | 營業主管 | 備註 |
|------|-------|-----------|--------------|----------|----------|------|
| 匯出門市資料 | ✅ | ❌ | ❌ | ❌ | ✅ | |
| 匯出支援時數 | ✅ | ✅ | ✅ | ❌ | ✅ | |
| 匯出餐費補助 | ✅ | ✅ | ✅ | ❌ | ✅ | |
| 下載完整報表 | ✅ | ❌ | ❌ | ❌ | ✅ | |

**權限檢查位置**: 
- API: `app/api/export-monthly-status/stores/route.ts` (lines 34-40)
```typescript
const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
const isBusinessManager = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;
if (!profile || (profile.role !== 'admin' && !isBusinessManager)) { return 403 }
```

- API: `app/api/export-monthly-status/support-hours/route.ts` (lines 35-42)
```typescript
const isAdmin = ['admin', 'supervisor', 'area_manager'].includes(profile?.role || '');
const isBusinessManager = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;
if (!profile || (!isAdmin && !isBusinessManager)) { return 403 }
```

- API: `app/api/export-monthly-status/meal-allowance/route.ts` (lines 45-51)
```typescript
const canExport = profile.role === 'admin' || 
                 profile.role === 'supervisor' ||
                 profile.role === 'area_manager' ||
                 (profile.department?.startsWith('營業') && profile.role === 'manager' && !needsAssignment);
```

#### 2.4.3 匯入績效/統計資料 (API)
| 功能 | admin | supervisor | area_manager | 營業助理 | 營業主管 | 備註 |
|------|-------|-----------|--------------|----------|----------|------|
| 匯入門市統計 | ✅ | ✅ | ✅ | ✅ | ✅ | |

**權限檢查位置**: 
- API: `app/api/import-store-stats/route.ts` (lines 33-44)
```typescript
const isAuthorized = 
  ['admin', 'supervisor', 'area_manager'].includes(profile?.role || '') ||
  (profile?.department?.startsWith('營業') && (profile?.role === 'member' || profile?.role === 'manager'));
```

---

### 2.5 【使用者管理模組】

#### 2.5.1 使用者管理 (`app/admin/users/`)
**檔案位置**: `app/admin/users/page.tsx`

| 功能 | admin | manager | member | 營業助理 | 營業主管 | 備註 |
|------|-------|---------|--------|----------|----------|------|
| 查看使用者列表 | ✅ | ❌ | ❌ | ❌ | ❌ | |
| 新增使用者 | ✅ | ❌ | ❌ | ❌ | ❌ | |
| 編輯使用者資料 | ✅ | ❌ | ❌ | ❌ | ❌ | |
| 刪除使用者 | ✅ | ❌ | ❌ | ❌ | ❌ | |
| 變更使用者角色 | ✅ | ❌ | ❌ | ❌ | ❌ | |

---

### 2.6 【活動排程模組】

#### 2.6.1 活動管理入口 (`/activity-management`)
| 功能 | 督導 | 店長 | 代理店長 | 督導(代理店長) | 備註 |
|------|-----|-----|---------|--------------|------|
| 查看我的活動 | ✅ | ✅ | ✅ | ✅ | 僅顯示管理門市的活動 |
| 進行活動排程 | ✅ | ✅ | ✅ | ✅ | |
| 查看排程結果 | ✅ | ✅ | ✅ | ✅ | |

**權限檢查位置**: 
- `app/monthly-status/page.tsx` (line 322) - 按鈕顯示條件
```typescript
{needsAssignment && managedStores.length > 0 && (
  <Link href="/activity-management">活動管理</Link>
)}
```

---

## 📝 三、Server Actions 權限檢查

### 3.1 門市相關 Actions (`app/store/actions.ts`)

#### 3.1.1 建立門市 (`createStore`)
```typescript
// 權限: admin 或營業部主管(manager + 營業部 + job_title='主管')
const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.job_title === '主管';
if (!profile || (profile.role !== 'admin' && !isBusinessSupervisor))
```

#### 3.1.2 更新門市 (`updateStore`)
```typescript
// 權限: admin 或營業部主管(manager + 營業部 + !needsAssignment)
const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;
if (!profile || (profile.role !== 'admin' && !isBusinessSupervisor))
```

#### 3.1.3 檢查門市訪問權限 (`checkStoreAccess`)
```typescript
// admin, supervisor, area_manager: 完整權限
if (['admin', 'supervisor', 'area_manager'].includes(profile.role || ''))

// 營業部人員(member 或 manager + 營業部 + !needsAssignment): 完整權限
if (profile.department?.startsWith('營業') && (profile.role === 'member' || profile.role === 'manager') && !needsAssignment)
```

#### 3.1.4 指派門市管理者 (`assignStoreManager`)
```typescript
// 權限: admin 或營業部主管(manager + 營業部 + !needsAssignment)
const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;
if (!profile || (profile.role !== 'admin' && !isBusinessSupervisor))
```

---

## 🔐 四、API Routes 權限檢查

### 4.1 督導相關 API (`app/api/supervisors/*`)
- **GET** `/api/supervisors/users` - 取得督導使用者列表
  - 權限: `admin`
- **GET** `/api/supervisors/stores` - 取得門市列表
  - 權限: `admin`
- **GET** `/api/supervisors/assignments` - 取得督導指派記錄
  - 權限: `admin`

### 4.2 人員異動 API (`app/api/promotions/*`)
- **POST** `/api/promotions/batch` - 批次新增異動
  - 權限: `admin` 或 `manager` 或 `supervisor` 或 `area_manager`
- **POST** `/api/promotions/batch-global` - 全域批次異動
  - 權限: `admin` 或 `isBusinessAssistant` 或 `isBusinessSupervisor`

### 4.3 員工相關 API (`app/api/employees/*`)
- **POST** `/api/employees/add` - 新增員工
  - 權限: `admin` 或 `isBusinessAssistant` 或 `isBusinessSupervisor`
- **POST** `/api/employees/update` - 更新員工
  - 權限: `admin` 或 `isBusinessAssistant` 或 `isBusinessSupervisor`

### 4.4 人員異動批次 API (`app/api/employee-movements/*`)
- **POST** `/api/employee-movements/batch` - 批次異動處理
  - 權限: `admin` 或 `isBusinessAssistant` 或 `isBusinessSupervisor`

### 4.5 培育金 API (`app/api/talent-cultivation/*`)
- **POST** `/api/talent-cultivation/save` - 儲存培育金資料
  - 權限: `['admin', 'manager', 'supervisor', 'area_manager']` 或 店長職稱

### 4.6 活動相關 API (`app/api/campaigns/*`)
- **GET** `/api/campaigns/published` - 取得已發布活動
  - 權限: 
    - `admin` - 所有活動
    - 督導/店長/代理店長 - 僅管理門市的活動
    - 營業部經理/主管 - 所有活動但僅供檢視
- **GET** `/api/campaigns/[id]/view` - 查看活動詳情
  - 權限: 同上

### 4.7 匯入統計 API (`app/api/import-store-stats`)
- **POST** `/api/import-store-stats` - 匯入門市統計資料
  - 權限: `admin`/`supervisor`/`area_manager` 或 營業部人員(`member`/`manager`)

---

## 🗂️ 五、資料庫 RLS 權限 (Row Level Security)

### 5.1 Store Managers 表
**檔案位置**: `supabase/migration_monthly_staff_status.sql`

```sql
-- 查看: 自己的指派 或 admin/manager
CREATE POLICY "Users can view their store management" ON store_managers FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
);

-- 所有操作: admin
CREATE POLICY "Admins can manage store managers" ON store_managers FOR ALL USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
```

### 5.2 Store Employees 表
```sql
-- 查看: 自己、店長、admin/manager
CREATE POLICY "Users can view store employees" ON store_employees FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = store_employees.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
);

-- 管理: 店長或 admin
CREATE POLICY "Managers can manage store employees" ON store_employees FOR ALL USING (
  EXISTS (SELECT 1 FROM store_managers WHERE user_id = auth.uid() AND store_id = store_employees.store_id) OR
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
```

### 5.3 Monthly Staff Status 表
```sql
-- 查看: 自己、相關門市人員、admin/manager
CREATE POLICY "Users can view monthly staff status" ON monthly_staff_status FOR SELECT USING (
  user_id = auth.uid() OR ...
);
```

---

## 📊 六、導航欄權限 (Navbar)

**檔案位置**: `components/Navbar.tsx`

### 6.1 派發任務選單
```typescript
const taskSubItems = [
  { href: '/my-tasks', roles: ['admin', 'manager', 'member'] },
  { href: '/dashboard', roles: ['admin', 'manager'], allowBusinessAssistant: true },
  { href: '/admin/templates', roles: ['admin', 'manager'], allowBusinessAssistant: true },
  { href: '/admin/archived', roles: ['admin', 'manager'], allowBusinessAssistant: true },
]
```

### 6.2 門市管理選單
```typescript
const storeSubItems = [
  { href: '/admin/store-managers', roles: ['admin'], allowBusinessSupervisor: true },
  { href: '/admin/supervisors', roles: ['admin'], allowBusinessSupervisor: true },
  { href: '/admin/stores', roles: ['admin'], allowBusinessAssistant: true, allowBusinessSupervisor: true },
  { href: '/admin/employee-management', roles: ['admin'], allowBusinessAssistant: true, allowBusinessSupervisor: true },
  { href: '/admin/promotion-management', roles: ['admin'], allowBusinessAssistant: true, allowBusinessSupervisor: true },
  { href: '/admin/import-employees', roles: ['admin'], allowBusinessSupervisor: true },
  { href: '/admin/activity-management', roles: ['admin'], allowBusinessSupervisor: true },
]
```

### 6.3 每月人員狀態選單
```typescript
const monthlyStatusSubItems = [
  { href: '/monthly-status', roles: ['admin', 'manager', 'member'] },
  { href: '/admin/export-monthly-status', roles: ['admin'], allowBusinessSupervisor: true },
]
```

---

## 📋 七、權限模式總結

### 7.1 完整系統權限者
- ✅ `admin` (所有功能)
- ✅ `supervisor` (督導系統權限)
- ✅ `area_manager` (區經理系統權限)

### 7.2 門市管理權限
- ✅ `admin`
- ✅ 營業部主管 (`department.startsWith('營業')` + `role='manager'` + `!needsAssignment`)
- ✅ 營業部助理 (`department.startsWith('營業')` + `role='member'` + `!needsAssignment`) - 僅查看和部分編輯

### 7.3 任務管理權限
- ✅ `admin`
- ✅ `manager`
- ✅ 營業部助理 (僅建立和查看)

### 7.4 每月人員狀態管理權限
- ✅ `admin`, `supervisor`, `area_manager` (完整權限)
- ✅ 營業部主管/助理 (查看和匯入)
- ✅ 店長/督導等 needsAssignment 角色 (僅管理自己的門市)

### 7.5 活動管理權限
- ✅ `admin`
- ✅ 營業部主管
- ✅ 督導/店長/代理店長 (僅自己管理的門市)

---

## 🎯 八、權限檢查位置總覽

### 8.1 頁面層級 (Page Level)
- `app/page.tsx` - 首頁
- `app/dashboard/page.tsx` - 儀表板
- `app/admin/stores/page.tsx` - 門市管理
- `app/admin/employee-management/page.tsx` - 員工管理
- `app/admin/promotion-management/page.tsx` - 人員異動
- `app/admin/users/page.tsx` - 使用者管理
- `app/admin/template/[id]/page.tsx` - 任務範本編輯
- `app/assignment/[id]/page.tsx` - 任務詳情
- `app/monthly-status/page.tsx` - 每月人員狀態

### 8.2 Server Actions
- `app/actions.ts` - 通用 actions
- `app/store/actions.ts` - 門市相關 actions

### 8.3 API Routes
- `app/api/supervisors/*` - 督導管理
- `app/api/promotions/*` - 人員異動
- `app/api/employees/*` - 員工管理
- `app/api/employee-movements/*` - 人員異動批次
- `app/api/campaigns/*` - 活動管理
- `app/api/export-monthly-status/*` - 資料匯出
- `app/api/import-store-stats/*` - 資料匯入
- `app/api/talent-cultivation/*` - 培育金

### 8.4 元件層級
- `components/Navbar.tsx` - 導航欄權限過濾
- `components/admin/UserManagementTable.tsx` - 使用者管理表格

### 8.5 資料庫層級
- `supabase/migration_monthly_staff_status.sql` - RLS policies
- Row Level Security 實現資料層級權限控制

---

## 🔍 九、權限模式分類

### 9.1 簡單角色檢查
```typescript
if (profile.role === 'admin') { /* 允許 */ }
if (profile.role !== 'admin') { /* 拒絕 */ }
if (['admin', 'manager'].includes(profile.role)) { /* 允許 */ }
```

### 9.2 部門+角色組合
```typescript
// 營業部助理
const isBusinessAssistant = 
  profile.department?.startsWith('營業') && 
  profile.role === 'member' && 
  !needsAssignment;

// 營業部主管
const isBusinessSupervisor = 
  profile.department?.startsWith('營業') && 
  profile.role === 'manager' && 
  !needsAssignment;
```

### 9.3 職稱+角色組合
```typescript
// 需要門市指派的職位
const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)']
  .includes(profile.job_title || '');

// 營業部經理/主管
const isBusinessManager = 
  profile.department?.startsWith('營業') && 
  ['經理', '主管'].includes(profile.job_title || '');
```

### 9.4 多重條件判斷
```typescript
// 可查看門市 (admin OR supervisor OR area_manager OR 營業部人員)
if (['admin', 'supervisor', 'area_manager'].includes(userRole)) { return true; }
if (userDepartment?.startsWith('營業') && (userRole === 'member' || userRole === 'manager') && !needsAssignment) { return true; }
```

---

## 📈 十、未來 RBAC 系統建議

根據以上分析,建議實施的 RBAC 系統應包含以下權限點:

### 10.1 模組權限 (Module Permissions)
1. **任務管理模組** (`task_management`)
   - `task.view_all` - 查看所有任務
   - `task.view_own` - 查看自己的任務
   - `task.create` - 建立任務
   - `task.edit` - 編輯任務
   - `task.delete` - 刪除任務
   - `task.assign` - 指派任務
   - `task.archive` - 封存任務

2. **門市管理模組** (`store_management`)
   - `store.view` - 查看門市
   - `store.create` - 建立門市
   - `store.edit` - 編輯門市
   - `store.delete` - 刪除門市
   - `store.assign_manager` - 指派店長
   - `store.view_inactive` - 查看已停用門市

3. **員工管理模組** (`employee_management`)
   - `employee.view` - 查看員工
   - `employee.create` - 新增員工
   - `employee.edit` - 編輯員工
   - `employee.delete` - 刪除員工
   - `employee.import` - 批次匯入員工
   - `employee.promotion` - 人員異動管理

4. **每月狀態模組** (`monthly_status`)
   - `monthly.view_all` - 查看所有門市狀態
   - `monthly.view_own` - 查看管理門市狀態
   - `monthly.edit` - 編輯門市狀態
   - `monthly.import` - 匯入資料
   - `monthly.export` - 匯出資料
   - `monthly.confirm` - 確認/覆核

5. **活動管理模組** (`activity_management`)
   - `activity.view` - 查看活動
   - `activity.create` - 建立活動
   - `activity.edit` - 編輯活動
   - `activity.schedule` - 活動排程
   - `activity.view_schedule` - 查看排程

6. **使用者管理模組** (`user_management`)
   - `user.view` - 查看使用者
   - `user.create` - 新增使用者
   - `user.edit` - 編輯使用者
   - `user.delete` - 刪除使用者
   - `user.change_role` - 變更角色

7. **督導管理模組** (`supervisor_management`)
   - `supervisor.view` - 查看督導
   - `supervisor.assign` - 指派督導門市

---

## 結論

目前系統共有 **7 個主要模組**,包含約 **60+ 個功能權限點**。權限檢查分散在:
- 15+ 個頁面組件
- 20+ 個 API Routes
- 5+ 個 Server Actions
- 1 個導航欄元件
- 資料庫 RLS Policies

建議實施統一的 RBAC 系統以:
1. ✅ 統一權限管理介面
2. ✅ 簡化權限檢查邏輯
3. ✅ 提高權限配置靈活性
4. ✅ 便於權限審計和維護

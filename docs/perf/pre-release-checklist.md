# 每月人員狀態加速：上線前檢查（唯讀）

## 1. 環境變數
正式區 Vercel 需設有 `SUPABASE_SERVICE_ROLE_KEY`（導覽列權限 getUserPermissions 本來就依賴它）。
若缺漏，權限快照會自動退回改前行為（逐項 hasPermission），不會讓整個 action 失敗，只是不加速。

## 2. 正式區 has_permission 函式版本
權限快照依 DEV baseline 的 has_permission 語意計算（要求 roles.is_active；資料庫端只認 role.code = 'admin'）。
repo 內另有 `supabase/fix_has_permission_admin_bypass.sql`（profiles.role 為 system_admin / admin_role 即放行；
不檢查 roles.is_active；system_admin、admin_role 角色放行全部）。若正式區是後者，少數情況新舊會不同。
上線前請在正式區以唯讀方式執行（只讀，不改）：

```sql
SELECT pg_get_functiondef('public.has_permission(uuid, character varying)'::regprocedure);
```

比對結果：
- 與 DEV baseline 相同 -> 可上線。
- 與 fix_has_permission_admin_bypass.sql 相同 -> 先通知開發者調整 lib/permissions/snapshot.ts，再上線。

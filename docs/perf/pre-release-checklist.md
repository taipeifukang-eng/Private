# 每月人員狀態加速：上線前檢查（唯讀）

## 1. 環境變數
正式區 Vercel 需設有 `SUPABASE_SERVICE_ROLE_KEY`（導覽列權限 getUserPermissions 本來就依賴它）。
若缺漏，權限快照會自動退回改前行為（逐項 hasPermission），不會讓整個 action 失敗，只是不加速。

## 2. 正式區 has_permission 函式版本（已確認）
正式區定義已於 2026-11-06 確認（使用者在正式區唯讀查詢取得），權限快照（lib/permissions/snapshot.ts）依此實作。

```sql
CREATE OR REPLACE FUNCTION public.has_permission(p_user_id uuid, p_permission_code character varying)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_has_permission BOOLEAN := false;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM user_roles ur
    INNER JOIN role_permissions rp ON ur.role_id = rp.role_id
    INNER JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = p_user_id
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      AND rp.is_allowed = true
      AND p.code = p_permission_code
      AND p.is_active = true
  ) INTO v_has_permission;
  
  RETURN v_has_permission;
END;
$function$
```

與 DEV baseline、`supabase/fix_has_permission_admin_bypass.sql` 都不同，快照語意如下：
- 不檢查 `roles.is_active`：角色停用但 `user_roles` 有效仍放行。
- 資料庫端沒有 `role.code = 'admin'` 的放行；管理員放行只來自應用層保底（`lib/permissions/check.ts` 的
  `isAdminLikeUser`：`profiles.role = 'admin'` 或有效 `user_roles` 角色 code 在保底名單），快照照舊保留。
- 有效 `user_roles` = `is_active = true` 且（`expires_at` 為空或晚於現在）；另需 `role_permissions.is_allowed = true`、`permissions.is_active = true`、code 完全相符。

測試對照（DEV 的 has_permission 與正式區不同，所以不用它當參考值）：
- `npm run test:permission-snapshot-unit`：離線窮舉，參考模型 = 上面的正式區定義。
- `npm run test:monthly-status-equivalence`：DEV 整合比對，測試期間在 DEV 建立暫時函式 `perf_has_permission_prod`
  （內容同上，只改名）當「改前」參考值，測完 DROP。若測試異常中斷，手動清除：`node scripts/perf/prod-has-permission-fn.cjs drop`。

上線前若正式區函式又被改動，需重新唯讀確認：

```sql
SELECT pg_get_functiondef('public.has_permission(uuid, character varying)'::regprocedure);
```

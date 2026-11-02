# 每月人員登記權限

| 功能 | 權限代碼 |
| --- | --- |
| 手動新增每月人員 | `monthly.status.add_employee` |
| 上個月單品獎金、交通費用、誤餐費、育才獎金、春節出勤獎金 | `monthly.allowance.edit_support_bonus` |

五項登記沿用既有單品獎金權限。原本擁有此權限的人員將可操作全部五項；只有舊交通費、誤餐費、育才權限的人員，需由管理員改勾共用權限。手動新增權限需另外指派，不會因擁有共用登記權限或 `monthly.status.edit` 自動取得。

部署時一併執行 `supabase/migrations/20261102090000_monthly_registration_permissions.sql`，更新權限名稱、新增手動新增權限，並停用三個舊分項開關。保留原角色權限資料供稽核，不自動擴大角色授權。更新後在「權限管理 → 每月人員狀態」分別設定兩項權限。

舊版頁面及 Vue 工作區皆使用上述分組。儲存仍要求可操作該門市，並沿用各版本原有月份鎖定規則。舊版儲存透過已驗證門市範圍的伺服器端資料庫連線，避免舊職稱 RLS 阻擋已獲 RBAC 授權的使用者。

驗證：`node scripts/test-monthly-registration-permissions.cjs`、`node scripts/test-monthly-support-bonus-rbac.js`、`npm run build`。

Vue 工作區目前為尚未納入 Git 的本機開發內容；本次差異保存於 `docs/patches/monthly-registration-workspace.patch`，待工作區納入版本控制時一併套用。本機已套用，不需重複執行。

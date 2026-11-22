# 巡店強制定位：正式區交接（需使用者同意才上線）

## 上線順序（不可顛倒）

1. 先套用新 RPC：`supabase/workspace-dev/20261105190000_inspection_save_gps.sql`
   （新增分支寫入 gps_*；編輯分支不改 gps_* 與 inspection_date）。
   - 此檔不在 supabase/migrations，且 `scripts/apply-workspace-inspection-save-gps-dev.cjs` 只能對 DEV；正式區請由使用者手動執行該 SQL。
2. 再套用 trigger migration：`supabase/migrations/20261105180000_inspection_require_gps.sql`。
3. 最後部署 API（app/api/workspace/inspection-form）與 Vue（public/workspace）。

## 為什麼順序重要

- trigger 或新 API 先於新 RPC：舊 RPC 的 INSERT 不寫 gps_*，所有 Vue 新增都會被 trigger 擋下（誤報「缺少定位座標」）。
- 舊 RPC 的 UPDATE 會用 p_master 的 gps（新 API 編輯不送，為 null）覆蓋 gps_*。

## Rollback

- RPC：`supabase/workspace-dev/20261105190000_inspection_save_gps.rollback.sql`（還原為 20261028040000 版本）。
- trigger：`supabase/rollback_inspection_require_gps.sql`。
- Rollback 順序與上線相反：先部署舊 API/Vue，再移除 trigger，最後還原 RPC。

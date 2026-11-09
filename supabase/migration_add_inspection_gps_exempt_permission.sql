-- 巡店定位例外：權限種子（單獨執行版；20261109120000_inspection_gps_exempt.sql 已包含同一段）。
-- 只建立權限，不授權給任何角色；請到「權限管理」替指定角色勾選「巡店定位例外」。可重複執行。
INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES (
  'inspection', 'inspection_gps', 'inspection.gps_exempt', 'gps_exempt',
  '巡店定位例外 - 定位失敗或誤差超過 1000 公尺時，仍可新增巡店（系統管理員一律可用）', true
)
ON CONFLICT (code) DO UPDATE SET
  description = EXCLUDED.description,
  is_active = true;

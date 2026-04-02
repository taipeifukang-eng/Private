-- 診所自費藥毛利計算 RBAC 細分權限
-- 目標：
-- 1) 店長/督導：僅可使用「毛利計算」流程
-- 2) 經理：可使用 DPOS 對應主檔全部功能，且可刪除門市匯入結果

BEGIN;

-- 1) 權限碼
INSERT INTO public.permissions (module, feature, code, action, description)
VALUES
  ('store', 'clinic_selfpay_margin', 'store.clinic_selfpay.calculator.use', 'use', '診所自費藥毛利計算：使用毛利計算流程'),
  ('store', 'clinic_selfpay_margin', 'store.clinic_selfpay.mapping.manage', 'manage', '診所自費藥毛利計算：管理 DPOS 對應主檔'),
  ('store', 'clinic_selfpay_margin', 'store.clinic_selfpay.batch.delete', 'delete', '診所自費藥毛利計算：刪除門市匯入批次')
ON CONFLICT (code) DO UPDATE
SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  updated_at = NOW();

-- 2) 店長/督導：只給 calculator.use
INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM public.roles r
JOIN public.permissions p ON p.code = 'store.clinic_selfpay.calculator.use'
WHERE r.code IN ('store_manager_role', 'supervisor_role')
ON CONFLICT (role_id, permission_id) DO UPDATE
SET is_allowed = EXCLUDED.is_allowed;

-- 3) 經理層：calculator.use + mapping.manage + batch.delete
INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM public.roles r
JOIN public.permissions p
  ON p.code IN (
    'store.clinic_selfpay.calculator.use',
    'store.clinic_selfpay.mapping.manage',
    'store.clinic_selfpay.batch.delete'
  )
WHERE r.code IN (
  'area_manager_role',
  'business_manager',
  'manager',
  'admin',
  'admin_role',
  'system_admin'
)
ON CONFLICT (role_id, permission_id) DO UPDATE
SET is_allowed = EXCLUDED.is_allowed;

COMMIT;

-- Register the monthly support staff single-item bonus permission in the
-- permission catalogue so role administrators can assign it explicitly.
INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES (
  'monthly',
  'edit_support_bonus',
  'monthly.allowance.edit_support_bonus',
  'edit',
  '編輯每月人員狀態中的單品獎金（支援人員）',
  true
)
ON CONFLICT (code) DO UPDATE
SET module = EXCLUDED.module,
    feature = EXCLUDED.feature,
    action = EXCLUDED.action,
    description = EXCLUDED.description,
    is_active = true;

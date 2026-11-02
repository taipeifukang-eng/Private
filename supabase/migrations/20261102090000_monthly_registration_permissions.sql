BEGIN;

-- Keep existing single-item bonus grants as the authority for the five tools.
INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES
  ('monthly', 'add_employee', 'monthly.status.add_employee', 'create',
   '手動新增每月人員（不含獎金與費用登記）', true),
  ('monthly', 'edit_support_bonus', 'monthly.allowance.edit_support_bonus', 'edit',
   '登記每月獎金與費用（上個月單品獎金、交通費用、誤餐費、育才獎金、春節出勤獎金）', true)
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active;

-- Preserve historical grants for audit; these obsolete switches are no longer
-- evaluated by the five registration tools. Do not broaden existing grants.
UPDATE public.permissions SET is_active = false
WHERE code IN ('monthly.allowance.edit_meal', 'monthly.allowance.edit_transport', 'monthly.allowance.edit_talent');

-- New manual-add permission is deliberately assigned independently by admins.
NOTIFY pgrst, 'reload schema';
COMMIT;

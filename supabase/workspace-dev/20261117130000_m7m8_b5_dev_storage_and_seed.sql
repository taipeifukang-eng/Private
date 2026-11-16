-- M7/M8 第 5 批 E（DEV 專用，不套正式區、沒有對應的正式區草稿）：
--   1. 舊照片測試用私有 bucket maintenance-photos（DEV 原本沒有；正式區 bucket 是否存在由 36 號預覽確認）。測試用 service role 放檔、伺服端簽名網址讀取，不需要 storage.objects 政策。
--   2. DEV 維修分類種子（DEV 的 maintenance_categories 原本是空的）：水電、空調、門窗隔間、電器設備、其他。已有同名者不重複建立。
--   3. DEV 測試角色（只動下面三個 vue_workspace_ga_wo_* 角色；角色矩陣既有的 vue_workspace_ga_works 等角色一律不碰；權限碼不存在會略過）：
--        vue_workspace_ga_wo_works（工務：工單更新與查看全部、庫存交易、料件查看）、
--        vue_workspace_ga_wo_viewer（只有查看全部：Q20 要收緊的對象）、
--        vue_workspace_ga_wo_manager（總務工單管理：管理、更新、查看全部、強制結案）。
--   測試資料的清除擴充（工單、附件、舊照片檔、測試分類）在 tests/support/m7m8-fixtures.ts 的 cleanupM7M8。
-- 還原：20261117130000_m7m8_b5_dev_storage_and_seed.rollback.sql。可重複執行。

INSERT INTO storage.buckets (id, name, public) VALUES ('maintenance-photos', 'maintenance-photos', false) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.maintenance_categories (name, sort_order, is_active)
SELECT v.name, v.sort_order, true FROM (VALUES ('水電', 10), ('空調', 20), ('門窗隔間', 30), ('電器設備', 40), ('其他', 90)) AS v(name, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.maintenance_categories c WHERE c.name = v.name);

DO $$
DECLARE
  v_def jsonb := jsonb_build_object(
    'vue_workspace_ga_wo_works', jsonb_build_object('name', '測試 工務', 'perms', jsonb_build_array(
      'general_affairs.service_center.access', 'general_affairs.work_order.update', 'general_affairs.work_order.view_all', 'general_affairs.inventory_transaction.manage',
      'general_affairs.inventory_transaction.view', 'general_affairs.part.view', 'general_affairs.inventory_location.view', 'general_affairs.inventory_balance.view')),
    'vue_workspace_ga_wo_viewer', jsonb_build_object('name', '測試 工單只能查看全部', 'perms', jsonb_build_array(
      'general_affairs.service_center.access', 'general_affairs.work_order.view_all')),
    'vue_workspace_ga_wo_manager', jsonb_build_object('name', '測試 總務工單管理', 'perms', jsonb_build_array(
      'general_affairs.service_center.access', 'general_affairs.work_order.manage', 'general_affairs.work_order.update', 'general_affairs.work_order.view_all',
      'general_affairs.service_center.force_close', 'cross_dept.maintenance.category.edit')));
  v_code text;
  v_role_id uuid;
BEGIN
  FOR v_code IN SELECT jsonb_object_keys(v_def) LOOP
    INSERT INTO public.roles (code, name, description, is_active, is_system)
    VALUES (v_code, v_def -> v_code ->> 'name', 'M7M8 第 5 批 DEV 測試角色（正式區不建）', true, false)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = true
    RETURNING id INTO v_role_id;
    DELETE FROM public.role_permissions WHERE role_id = v_role_id;
    INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
    SELECT v_role_id, p.id, true FROM public.permissions p WHERE p.code IN (SELECT jsonb_array_elements_text(v_def -> v_code -> 'perms'));
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

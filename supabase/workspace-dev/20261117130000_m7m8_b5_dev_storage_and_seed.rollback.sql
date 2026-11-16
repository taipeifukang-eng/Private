-- 還原 20261117130000_m7m8_b5_dev_storage_and_seed.sql：移除 DEV 測試角色、DEV 維修分類種子（只刪沒有被工單使用的同名分類）與空的 maintenance-photos bucket。
-- bucket：Supabase 的儲存空間保護觸發器（storage.protect_delete）不允許用 SQL 直接刪 bucket，會略過並提示；空的 maintenance-photos bucket 留著無害（要刪請用 service role 的 storage API）。
DELETE FROM public.user_roles WHERE role_id IN (SELECT id FROM public.roles WHERE code IN ('vue_workspace_ga_wo_works', 'vue_workspace_ga_wo_viewer', 'vue_workspace_ga_wo_manager'));
DELETE FROM public.role_permissions WHERE role_id IN (SELECT id FROM public.roles WHERE code IN ('vue_workspace_ga_wo_works', 'vue_workspace_ga_wo_viewer', 'vue_workspace_ga_wo_manager'));
DELETE FROM public.roles WHERE code IN ('vue_workspace_ga_wo_works', 'vue_workspace_ga_wo_viewer', 'vue_workspace_ga_wo_manager');
DELETE FROM public.maintenance_categories c WHERE c.name IN ('水電', '空調', '門窗隔間', '電器設備', '其他')
  AND NOT EXISTS (SELECT 1 FROM public.maintenance_requests m WHERE m.category_id = c.id) AND NOT EXISTS (SELECT 1 FROM public.maintenance_updates u WHERE u.category_id = c.id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'maintenance-photos') THEN
    DELETE FROM storage.buckets WHERE id = 'maintenance-photos';
  ELSE
    RAISE NOTICE 'maintenance-photos bucket 內還有檔案，未刪除';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'maintenance-photos bucket 未刪除：%', SQLERRM;
END $$;
NOTIFY pgrst, 'reload schema';

-- Rollback：活動專案查看權限調整（第一階段）
-- 對應 migration：supabase/migrations/20261103090000_campaign_view_scope.sql
--
-- 還原內容：
-- 1. 刪除 migration 新補的 role_permissions；並依備份表 _campaign_view_scope_backup 還原
--    被正規化移除的 role_permissions（持有 view_all 角色上的 view／view_own）。
-- 2. 還原 view / view_all / view_own 的說明與啟用狀態；view_own 原本不存在則刪除。
-- 3. 還原 RLS read policy 為 20260724040838 migration 的原始定義（只認 view / view_all，不含 view_own）。
-- 4. 刪除輔助函式與備份表。
-- 注意：rollback 會刪除備份表；之後重新套用 migration 會把「rollback 後的狀態」記成新的原本狀態（正確，因為 rollback 已還原）。
--       若 view_own 是 migration 才建立的，rollback 也會移除管理員之後指派的 view_own role_permissions。
-- 注意：還原後持有 view_own 的使用者會失去活動讀取權（RLS 與舊版程式皆只認 view）。
--       程式碼 rollback 請 revert 對應 commit。若備份表不存在，步驟 1、2 會略過。

-- 注意（view_own 殘留）：若 migration 之後管理員把 view_own 指派給其他角色，而 view_own 在 migration 前就存在，rollback 不會移除這些指派（只還原說明文字）；
--       view_own 若是 migration 才建立，則連同這些指派一併刪除。
-- 注意（備份表）：rollback 最後會 DROP 備份表 _campaign_view_scope_backup；rollback 後無法再用備份還原，重跑 migration 會重新備份。

BEGIN;

-- 1 & 2. 依備份表還原
DO $$
BEGIN
  IF to_regclass('public._campaign_view_scope_backup') IS NOT NULL THEN
    DELETE FROM public.role_permissions rp
    USING public._campaign_view_scope_backup b
    WHERE b.kind = 'added_role_permission'
      AND rp.id::text = b.key;

    -- 還原被正規化移除的列（保留原 id、is_allowed、created_at 等完整內容）
    INSERT INTO public.role_permissions
    SELECT (jsonb_populate_record(NULL::public.role_permissions, b.payload)).*
    FROM public._campaign_view_scope_backup b
    WHERE b.kind = 'removed_role_permission'
      AND EXISTS (SELECT 1 FROM public.roles r WHERE r.id = (b.payload ->> 'role_id')::uuid)
      AND EXISTS (SELECT 1 FROM public.permissions pp WHERE pp.id = (b.payload ->> 'permission_id')::uuid)
    ON CONFLICT DO NOTHING;

    UPDATE public.permissions p
    SET description = b.payload ->> 'description',
        is_active = COALESCE((b.payload ->> 'is_active')::boolean, p.is_active)
    FROM public._campaign_view_scope_backup b
    WHERE b.kind = 'permission'
      AND b.key = p.code
      AND COALESCE((b.payload ->> 'existed')::boolean, true) = true;

    -- view_own 若是這次 migration 才建立的（existed=false）：連同 migration 之後管理員另外指派的 role_permissions 一併移除，
    -- 否則外鍵會擋住刪除、權限殘留。這些角色會同時失去 view_own（舊版程式與 RLS 本來就不認 view_own），
    -- 要保留查看權請先確認它們另有 activity.campaign.view / view_all。
    DELETE FROM public.role_permissions rp
    USING public.permissions p, public._campaign_view_scope_backup b
    WHERE rp.permission_id = p.id
      AND p.code = 'activity.campaign.view_own'
      AND b.kind = 'permission' AND b.key = 'activity.campaign.view_own'
      AND COALESCE((b.payload ->> 'existed')::boolean, true) = false;

    DELETE FROM public.permissions p
    USING public._campaign_view_scope_backup b
    WHERE b.kind = 'permission'
      AND b.key = 'activity.campaign.view_own'
      AND p.code = 'activity.campaign.view_own'
      AND COALESCE((b.payload ->> 'existed')::boolean, true) = false;
  END IF;
END;
$$;

-- 3. 還原 RLS read policy（原始定義）
DROP POLICY IF EXISTS p1h_campaigns_read ON public.campaigns;
CREATE POLICY p1h_campaigns_read ON public.campaigns FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.management.access')
  OR public.current_user_has_permission('activity.manage')
  OR public.current_user_has_permission('activity.campaign.view')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.campaign.edit')
);

DROP POLICY IF EXISTS p1h_event_dates_read ON public.event_dates;
CREATE POLICY p1h_event_dates_read ON public.event_dates FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.management.access')
  OR public.current_user_has_permission('activity.campaign.view')
  OR public.current_user_has_permission('activity.campaign.view_all')
);

DROP POLICY IF EXISTS p1h_campaign_checklist_items_read ON public.campaign_checklist_items;
CREATE POLICY p1h_campaign_checklist_items_read ON public.campaign_checklist_items FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.campaign.view')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.checklist.edit')
);

DROP POLICY IF EXISTS p1h_campaign_store_scoped_read ON public.campaign_schedules;
CREATE POLICY p1h_campaign_store_scoped_read ON public.campaign_schedules FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.campaign.edit')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = campaign_schedules.store_id)
);

DROP POLICY IF EXISTS p1h_campaign_store_details_read ON public.campaign_store_details;
CREATE POLICY p1h_campaign_store_details_read ON public.campaign_store_details FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.store_detail.edit')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = campaign_store_details.store_id)
);

DROP POLICY IF EXISTS p1h_campaign_store_headcount_read ON public.campaign_store_headcount;
CREATE POLICY p1h_campaign_store_headcount_read ON public.campaign_store_headcount FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.staff_overview.view')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = campaign_store_headcount.store_id)
);

DROP POLICY IF EXISTS p1h_campaign_store_own_staff_read ON public.campaign_store_own_staff;
CREATE POLICY p1h_campaign_store_own_staff_read ON public.campaign_store_own_staff FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.staff_overview.view')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = campaign_store_own_staff.store_id)
);

DROP POLICY IF EXISTS p1h_campaign_support_requests_read ON public.campaign_support_requests;
CREATE POLICY p1h_campaign_support_requests_read ON public.campaign_support_requests FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.support_request.edit')
  OR public.current_user_has_permission('activity.support_assign.edit')
  OR EXISTS (
    SELECT 1 FROM public.store_managers sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id IN (campaign_support_requests.requesting_store_id, campaign_support_requests.supporting_store_id)
  )
);

DROP POLICY IF EXISTS p1h_campaign_support_staff_read ON public.campaign_support_staff;
CREATE POLICY p1h_campaign_support_staff_read ON public.campaign_support_staff FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.support_assign.edit')
  OR EXISTS (
    SELECT 1 FROM public.store_managers sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id IN (campaign_support_staff.requesting_store_id, campaign_support_staff.supporting_store_id)
  )
);

DROP POLICY IF EXISTS p1h_campaign_checklist_completions_read ON public.campaign_checklist_completions;
CREATE POLICY p1h_campaign_checklist_completions_read ON public.campaign_checklist_completions FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.checklist.edit')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = campaign_checklist_completions.store_id)
);

DROP POLICY IF EXISTS p1h_campaign_checklist_completions_write_insert ON public.campaign_checklist_completions;
DROP POLICY IF EXISTS p1h_campaign_checklist_completions_write_update ON public.campaign_checklist_completions;
DROP POLICY IF EXISTS p1h_campaign_checklist_completions_write_delete ON public.campaign_checklist_completions;
DROP POLICY IF EXISTS p1h_campaign_checklist_completions_write ON public.campaign_checklist_completions;
CREATE POLICY p1h_campaign_checklist_completions_write ON public.campaign_checklist_completions TO authenticated
USING (
  public.current_user_has_permission('activity.manage')
  OR public.current_user_has_permission('activity.checklist.edit')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = campaign_checklist_completions.store_id)
)
WITH CHECK (
  public.current_user_has_permission('activity.manage')
  OR public.current_user_has_permission('activity.checklist.edit')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = campaign_checklist_completions.store_id)
);

DROP POLICY IF EXISTS p1h_campaign_support_requests_write_insert ON public.campaign_support_requests;
DROP POLICY IF EXISTS p1h_campaign_support_requests_write_update ON public.campaign_support_requests;
DROP POLICY IF EXISTS p1h_campaign_support_requests_write_delete ON public.campaign_support_requests;
DROP POLICY IF EXISTS p1h_campaign_support_requests_write ON public.campaign_support_requests;
CREATE POLICY p1h_campaign_support_requests_write ON public.campaign_support_requests TO authenticated
USING (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.support_request.edit'))
WITH CHECK (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.support_request.edit'));

DROP POLICY IF EXISTS p1h_campaign_support_staff_write_insert ON public.campaign_support_staff;
DROP POLICY IF EXISTS p1h_campaign_support_staff_write_update ON public.campaign_support_staff;
DROP POLICY IF EXISTS p1h_campaign_support_staff_write_delete ON public.campaign_support_staff;
DROP POLICY IF EXISTS p1h_campaign_support_staff_write ON public.campaign_support_staff;
CREATE POLICY p1h_campaign_support_staff_write ON public.campaign_support_staff TO authenticated
USING (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.support_assign.edit'))
WITH CHECK (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.support_assign.edit'));

DROP POLICY IF EXISTS p1h_campaign_store_own_staff_write_insert ON public.campaign_store_own_staff;
DROP POLICY IF EXISTS p1h_campaign_store_own_staff_write_update ON public.campaign_store_own_staff;
DROP POLICY IF EXISTS p1h_campaign_store_own_staff_write_delete ON public.campaign_store_own_staff;
DROP POLICY IF EXISTS p1h_campaign_store_own_staff_write ON public.campaign_store_own_staff;
CREATE POLICY p1h_campaign_store_own_staff_write ON public.campaign_store_own_staff TO authenticated
USING (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.support_assign.edit'))
WITH CHECK (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.support_assign.edit'));

DROP POLICY IF EXISTS p1h_campaign_store_headcount_write_insert ON public.campaign_store_headcount;
DROP POLICY IF EXISTS p1h_campaign_store_headcount_write_update ON public.campaign_store_headcount;
DROP POLICY IF EXISTS p1h_campaign_store_headcount_write_delete ON public.campaign_store_headcount;
DROP POLICY IF EXISTS p1h_campaign_store_headcount_write ON public.campaign_store_headcount;
CREATE POLICY p1h_campaign_store_headcount_write ON public.campaign_store_headcount TO authenticated
USING (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.store_detail.edit'))
WITH CHECK (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.store_detail.edit'));

DROP POLICY IF EXISTS p1h_store_activity_settings_read ON public.store_activity_settings;
CREATE POLICY p1h_store_activity_settings_read ON public.store_activity_settings FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.management.access')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = store_activity_settings.store_id)
);

DROP POLICY IF EXISTS p1h_campaign_equipment_trips_read ON public.campaign_equipment_trips;
CREATE POLICY p1h_campaign_equipment_trips_read ON public.campaign_equipment_trips FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.equipment_trip.edit')
);

DROP POLICY IF EXISTS p1h_campaign_department_publish_read ON public.campaign_department_publish;
CREATE POLICY p1h_campaign_department_publish_read ON public.campaign_department_publish FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.marketing.publish')
  OR public.current_user_has_permission('activity.merchandise.publish')
  OR public.current_user_has_permission('activity.campaign.view_all')
);

-- 4. 移除輔助函式與備份表（policy 已不再引用）
DROP FUNCTION IF EXISTS public.campaign_user_can_write_stores(uuid, uuid[], boolean);
DROP FUNCTION IF EXISTS public.campaign_user_manages_store_of_item(uuid, uuid);
DROP FUNCTION IF EXISTS public.campaign_user_manages_store(uuid, uuid);
DROP FUNCTION IF EXISTS public.campaign_user_writes_all_stores_of_item(uuid);
DROP FUNCTION IF EXISTS public.campaign_user_has_view_own_or_all();
DROP FUNCTION IF EXISTS public.campaign_user_sees_all_stores_of_item(uuid);
DROP FUNCTION IF EXISTS public.campaign_user_sees_all_stores_of(uuid);
DROP FUNCTION IF EXISTS public.campaign_id_published_to_viewer(uuid);
DROP FUNCTION IF EXISTS public.campaign_published_to_viewer(boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.campaign_user_is_store_manager();
DROP FUNCTION IF EXISTS public.campaign_user_sees_all_stores();
DROP FUNCTION IF EXISTS public.campaign_user_is_inventory_team();
DROP FUNCTION IF EXISTS public.campaign_user_has_view_own();
DROP FUNCTION IF EXISTS public.campaign_user_is_supervisor();
DROP FUNCTION IF EXISTS public.campaign_user_has_store_appointment();
DROP TABLE IF EXISTS public._campaign_view_scope_backup;

NOTIFY pgrst, 'reload schema';
COMMIT;

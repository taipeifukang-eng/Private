-- 活動專案查看權限調整（第一階段）
-- 規格：docs/campaign-view-scope-spec.md
--
-- 1. activity.campaign.view_own 不存在就建立，已存在就更新說明並啟用；view_all 說明改為「查看全部」語意。
-- 2. 舊 activity.campaign.view 第一階段仍有效（視同 view_own），說明標示「（舊）將停用」，不停用、不刪除。
-- 3. 正規化：已持有 view_all 的角色，移除其 view 與 view_own（完整列備份，供 rollback）；
--    其餘持有 view（is_allowed=true）且沒有 view_all 的角色，補上 view_own（記錄於備份表，供 rollback）。
-- 4. RLS：campaigns / event_dates / campaign_checklist_items 讀取加入 view_own（保留 view）；
--    門市子表加入「督導（有 supervisor 任命）持 view_own 可讀全部門市」，店長維持依 store_managers；
--    equipment_trips / department_publish 對持 view_own 者開放唯讀（API 層再依範圍過濾）；
--    盤點組（部門受眾）持 view_own 在門市子表看全部門市；completions / support_* 讀取補上 view_all。
-- 5. 冪等：可重複執行。不自動授權 view_all。
--
-- activity.management.access 保留（權限本身、角色指派、event_dates / store_activity_settings 讀取 policy 都不動；其他功能與行銷部等部門仍依賴它）。
--   campaigns 讀取 policy 不讓 management.access 單獨放行未發布活動（避免用 JWT 直讀草稿活動；行銷／商品部由 marketing.publish／merchandise.publish 放行，兩者皆保留）。
--   持有 management.access 但沒有 view_own／view_all／manage 的角色與使用者人數見 pre_check 段 H。
--   marketing.publish、merchandise.publish 亦保留。
-- 寫入 policy（支援需求／支援人員／自有人員／檢核完成／人力）與 API authorizeCampaignStoreWrite 一致，見各 policy 註解。
--
-- 第二階段（另開任務）：view 設 is_active=false，並從程式與 RLS 移除。
-- Rollback：supabase/rollback_campaign_view_scope.sql
-- 部署前先在正式區跑唯讀檢查：supabase/pre_check_campaign_view_scope.sql

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.role_permissions') IS NULL
     OR to_regclass('public.store_managers') IS NULL
     OR to_regclass('public.campaigns') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite tables for campaign view scope migration';
  END IF;
  IF to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: public.current_user_has_permission(varchar)';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 備份表：記錄修改前的說明文字與本次新補的 role_permissions，供 rollback
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._campaign_view_scope_backup (
  kind text NOT NULL,
  key text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, key)
);
ALTER TABLE public._campaign_view_scope_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._campaign_view_scope_backup FROM PUBLIC, anon, authenticated;

-- 修改前的 permissions 狀態（只記第一次）
INSERT INTO public._campaign_view_scope_backup (kind, key, payload)
SELECT 'permission', p.code, jsonb_build_object('description', p.description, 'is_active', p.is_active, 'existed', true)
FROM public.permissions p
WHERE p.code IN ('activity.campaign.view', 'activity.campaign.view_own', 'activity.campaign.view_all')
ON CONFLICT (kind, key) DO NOTHING;

-- view_own 原本不存在時，也記下「原本不存在」，rollback 時才知道要刪除
INSERT INTO public._campaign_view_scope_backup (kind, key, payload)
SELECT 'permission', 'activity.campaign.view_own', jsonb_build_object('existed', false)
WHERE NOT EXISTS (SELECT 1 FROM public.permissions WHERE code = 'activity.campaign.view_own')
ON CONFLICT (kind, key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 1. 權限定義
-- ---------------------------------------------------------------------
INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES (
  'activity', 'campaign', 'activity.campaign.view_own', 'view_own',
  '查看自己管理門市的活動（督導於活動檢視可看全部門市）', true
)
ON CONFLICT (code) DO UPDATE SET
  description = EXCLUDED.description,
  is_active = true;

-- permissions 表沒有 name 欄位；權限頁顯示名稱由前端依 code 特判
-- （view_own 顯示「查看自己管理門市」、view_all 顯示「查看全部」），只需更新 description。
UPDATE public.permissions
SET description = '查看所有活動與所有門市資料'
WHERE code = 'activity.campaign.view_all';

UPDATE public.permissions
SET description = '（舊）查看，將停用；第一階段視同「查看自己」'
WHERE code = 'activity.campaign.view';

-- ---------------------------------------------------------------------
-- 2a. 正規化：已持有 view_all 的角色，移除其 view 與 view_own（先備份完整列，供 rollback）
--     避免權限頁出現「重複的資料查看範圍」警告而無法儲存。
-- ---------------------------------------------------------------------
INSERT INTO public._campaign_view_scope_backup (kind, key, payload)
SELECT 'removed_role_permission', rp.id::text, to_jsonb(rp)
FROM public.role_permissions rp
WHERE rp.permission_id IN (
    SELECT id FROM public.permissions
    WHERE code IN ('activity.campaign.view', 'activity.campaign.view_own')
  )
  AND EXISTS (
    SELECT 1 FROM public.role_permissions ra
    JOIN public.permissions pa ON pa.id = ra.permission_id
    WHERE ra.role_id = rp.role_id
      AND pa.code = 'activity.campaign.view_all'
      AND ra.is_allowed = true
  )
ON CONFLICT (kind, key) DO NOTHING;

-- 只刪除已確實備份的列
DELETE FROM public.role_permissions rp
USING public._campaign_view_scope_backup b
WHERE b.kind = 'removed_role_permission'
  AND b.key = rp.id::text;

-- ---------------------------------------------------------------------
-- 2. 資料遷移：持有 view 且沒有 view_all 的角色補上 view_own
-- ---------------------------------------------------------------------
WITH view_perm AS (
  SELECT id FROM public.permissions WHERE code = 'activity.campaign.view'
), view_own_perm AS (
  SELECT id FROM public.permissions WHERE code = 'activity.campaign.view_own'
), view_all_perm AS (
  SELECT id FROM public.permissions WHERE code = 'activity.campaign.view_all'
), inserted AS (
  INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
  SELECT rp.role_id, (SELECT id FROM view_own_perm), true
  FROM public.role_permissions rp
  WHERE rp.permission_id = (SELECT id FROM view_perm)
    AND rp.is_allowed = true
    AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions ra
      WHERE ra.role_id = rp.role_id
        AND ra.permission_id = (SELECT id FROM view_all_perm)
        AND ra.is_allowed = true
    )
  ON CONFLICT (role_id, permission_id) DO NOTHING
  RETURNING id, role_id, permission_id
)
INSERT INTO public._campaign_view_scope_backup (kind, key, payload)
SELECT 'added_role_permission', i.id::text,
       jsonb_build_object('role_id', i.role_id, 'permission_id', i.permission_id)
FROM inserted i
ON CONFLICT (kind, key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------

-- 目前登入者是否有 view_own（第一階段含舊 view）
CREATE OR REPLACE FUNCTION public.campaign_user_has_view_own()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.current_user_has_permission('activity.campaign.view_own')
      OR public.current_user_has_permission('activity.campaign.view');
$$;

-- 目前登入者是否有 supervisor 任命（活動檢視內督導看全部門市）
CREATE OR REPLACE FUNCTION public.campaign_user_is_supervisor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_managers sm
    WHERE sm.user_id = auth.uid() AND sm.role_type = 'supervisor'
  );
$$;

-- 目前登入者是否為盤點組（部門受眾，範圍為全部門市）
CREATE OR REPLACE FUNCTION public.campaign_user_is_inventory_team()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles pr
    WHERE pr.id = auth.uid() AND pr.department = '營業部-盤點組'
  );
$$;

-- 持 view_own 且為督導或盤點組：活動檢視看全部門市
CREATE OR REPLACE FUNCTION public.campaign_user_sees_all_stores()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.campaign_user_has_view_own()
     AND (public.campaign_user_is_supervisor() OR public.campaign_user_is_inventory_team());
$$;

-- 目前登入者是否有任何門市任命（店長或督導）
CREATE OR REPLACE FUNCTION public.campaign_user_has_store_appointment()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid());
$$;

-- 目前登入者是否有 store_manager 任命（店長）
CREATE OR REPLACE FUNCTION public.campaign_user_is_store_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.store_managers sm
    WHERE sm.user_id = auth.uid() AND sm.role_type = 'store_manager'
  );
$$;

-- 發布閘門：持 view_own 者，只看得到已發布給其身分的活動（與 API lib/campaign-access.ts 一致）
CREATE OR REPLACE FUNCTION public.campaign_published_to_viewer(
  p_supervisors boolean,
  p_store_managers boolean,
  p_inventory_team boolean
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.campaign_user_has_view_own()
     AND (
       (COALESCE(p_supervisors, false) AND public.campaign_user_is_supervisor())
       OR (COALESCE(p_store_managers, false) AND public.campaign_user_is_store_manager())
       OR (COALESCE(p_inventory_team, false) AND public.campaign_user_is_inventory_team())
     );
$$;

-- 依 campaign_id 套用發布閘門（子表使用；SECURITY DEFINER 讀 campaigns 不經 RLS）
CREATE OR REPLACE FUNCTION public.campaign_id_published_to_viewer(p_campaign_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaigns c
    WHERE c.id = p_campaign_id
      AND public.campaign_published_to_viewer(
        c.published_to_supervisors, c.published_to_store_managers, c.published_to_inventory_team)
  );
$$;

-- 持 view_own 且為督導或盤點組、且活動已發布給其身分：看全部門市
CREATE OR REPLACE FUNCTION public.campaign_user_sees_all_stores_of(p_campaign_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.campaign_user_sees_all_stores()
     AND public.campaign_id_published_to_viewer(p_campaign_id);
$$;

-- 寫入用：讀權視為 view_own 或 view_all（view_all 角色經 migration 正規化後不再持有 view_own）
CREATE OR REPLACE FUNCTION public.campaign_user_has_view_own_or_all()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.campaign_user_has_view_own()
      OR public.current_user_has_permission('activity.campaign.view_all');
$$;
REVOKE ALL ON FUNCTION public.campaign_user_has_view_own_or_all() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_user_has_view_own_or_all() TO authenticated, service_role;

-- 檢核完成寫入：有 supervisor 任命（或盤點組）、讀權為 view_own/view_all，且活動已發布給該身分 => 可寫任一門市。
-- 與 API authorizeCampaignStoreWrite 一致；店長不走這條，仍只能寫自己任命的門市（見 completions write policy）。
CREATE OR REPLACE FUNCTION public.campaign_user_writes_all_stores_of_item(p_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.campaign_user_has_view_own_or_all()
     AND EXISTS (
       SELECT 1
       FROM public.campaign_checklist_items i
       JOIN public.campaigns c ON c.id = i.campaign_id
       WHERE i.id = p_item_id
         AND (
           (COALESCE(c.published_to_supervisors, false) AND public.campaign_user_is_supervisor())
           OR (COALESCE(c.published_to_inventory_team, false) AND public.campaign_user_is_inventory_team())
         )
     );
$$;
REVOKE ALL ON FUNCTION public.campaign_user_writes_all_stores_of_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_user_writes_all_stores_of_item(uuid) TO authenticated, service_role;

-- 店長讀寫：本人有 store_manager 任命的門市，讀權為 view_own/view_all，且活動已發布給店長。
-- 只認 role_type='store_manager'（督導任命列即使帶 store_id 也不算），並套用發布閘門，與 API canViewAsStoreManager 一致。
CREATE OR REPLACE FUNCTION public.campaign_user_manages_store(p_campaign_id uuid, p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_store_id IS NOT NULL
     AND public.campaign_user_has_view_own_or_all()
     AND EXISTS (
       SELECT 1 FROM public.campaigns c
       WHERE c.id = p_campaign_id AND COALESCE(c.published_to_store_managers, false)
     )
     AND EXISTS (
       SELECT 1 FROM public.store_managers sm
       WHERE sm.user_id = auth.uid() AND sm.role_type = 'store_manager' AND sm.store_id = p_store_id
     );
$$;
REVOKE ALL ON FUNCTION public.campaign_user_manages_store(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_user_manages_store(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.campaign_user_manages_store_of_item(p_item_id uuid, p_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaign_checklist_items i
    WHERE i.id = p_item_id
      AND public.campaign_user_manages_store(i.campaign_id, p_store_id)
  );
$$;
REVOKE ALL ON FUNCTION public.campaign_user_manages_store_of_item(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_user_manages_store_of_item(uuid, uuid) TO authenticated, service_role;

-- 支援需求／支援人員／自有人員寫入：與 API lib/campaign-access.ts authorizeCampaignStoreWrite 完全一致（不含 manage / edit 權檢查，由 policy 另行 AND）。
--   讀權為 view_own／舊 view／view_all，且活動已發布給其任命身分：
--   督導（supervisor 任命）與盤點組可寫全部門市；店長（role_type='store_manager'）只能寫任命門市。
--   p_any=true：p_store_ids 任一間在任命內即可（support_staff：請求門市或支援門市任一端）；
--   p_any=false：所有非 NULL 門市都必須在任命內，且至少一間（own_staff、support_requests 的請求門市）。
CREATE OR REPLACE FUNCTION public.campaign_user_can_write_stores(
  p_campaign_id uuid,
  p_store_ids uuid[],
  p_any boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.campaign_user_has_view_own_or_all()
     AND EXISTS (
       SELECT 1 FROM public.campaigns c
       WHERE c.id = p_campaign_id
         AND (
           (COALESCE(c.published_to_supervisors, false) AND public.campaign_user_is_supervisor())
           OR (COALESCE(c.published_to_inventory_team, false) AND public.campaign_user_is_inventory_team())
           OR (
             COALESCE(c.published_to_store_managers, false)
             AND public.campaign_user_is_store_manager()
             AND EXISTS (SELECT 1 FROM unnest(p_store_ids) AS t(sid) WHERE t.sid IS NOT NULL)
             AND CASE WHEN COALESCE(p_any, false) THEN
                   EXISTS (
                     SELECT 1 FROM unnest(p_store_ids) AS t(sid)
                     JOIN public.store_managers sm ON sm.store_id = t.sid
                     WHERE sm.user_id = auth.uid() AND sm.role_type = 'store_manager')
                 ELSE
                   NOT EXISTS (
                     SELECT 1 FROM unnest(p_store_ids) AS t(sid)
                     WHERE t.sid IS NOT NULL
                       AND NOT EXISTS (
                         SELECT 1 FROM public.store_managers sm
                         WHERE sm.user_id = auth.uid() AND sm.role_type = 'store_manager' AND sm.store_id = t.sid))
                 END
           )
         )
     );
$$;
REVOKE ALL ON FUNCTION public.campaign_user_can_write_stores(uuid, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_user_can_write_stores(uuid, uuid[], boolean) TO authenticated, service_role;

-- 檢核完成表只有 checklist_item_id，經檢核項目回推活動
CREATE OR REPLACE FUNCTION public.campaign_user_sees_all_stores_of_item(p_item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.campaign_checklist_items i
    WHERE i.id = p_item_id
      AND public.campaign_user_sees_all_stores_of(i.campaign_id)
  );
$$;
REVOKE ALL ON FUNCTION public.campaign_user_sees_all_stores_of_item(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_user_sees_all_stores_of_item(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.campaign_user_is_store_manager() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.campaign_published_to_viewer(boolean, boolean, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.campaign_id_published_to_viewer(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.campaign_user_sees_all_stores_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_user_is_store_manager() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.campaign_published_to_viewer(boolean, boolean, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.campaign_id_published_to_viewer(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.campaign_user_sees_all_stores_of(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.campaign_user_has_view_own() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.campaign_user_is_supervisor() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.campaign_user_has_store_appointment() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.campaign_user_is_inventory_team() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.campaign_user_sees_all_stores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_user_has_view_own() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.campaign_user_is_supervisor() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.campaign_user_has_store_appointment() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.campaign_user_is_inventory_team() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.campaign_user_sees_all_stores() TO authenticated, service_role;

-- 活動主表／特殊日期／檢核項目：讀取加入 view_own（保留 view）。
-- campaigns / campaign_checklist_items / campaign_department_publish 對「只有 view_own」者加上發布閘門
-- （只看得到已發布給其身分的活動），避免全員預設角色（如 member）持 view_own 時繞過 API 直接讀草稿。
-- event_dates 為全域特殊日期（無 campaign_id），不適用發布閘門。
-- 排程頁（/api/campaigns）的放行權限也同步放進 campaigns 讀取 policy，但只放「編輯／發布內容」類：
-- store_detail.edit、equipment_trip.edit、checklist.edit（編輯者看全部可編輯的資料）、marketing.publish、merchandise.publish
-- （行銷／商品部要替未發布活動準備發布內容，campaign-department-publish 也放行）。
-- support_request.edit、support_assign.edit、staff_overview.view、activity.management.access 只是權限閘門／入口權限，不單獨放行：
-- 一律回到發布閘門（活動已發布給其身分），避免持有者直接讀到草稿。
-- marketing.publish / merchandise.publish 保留：行銷部、商品部要替「尚未發布」的活動準備發布內容，
-- campaign-department-publish API 與活動明細頁需要讀到該活動；它們不涉及門市子表資料（子表仍走各自 policy）。
DROP POLICY IF EXISTS p1h_campaigns_read ON public.campaigns;
CREATE POLICY p1h_campaigns_read ON public.campaigns FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.manage')
  OR public.campaign_published_to_viewer(
       campaigns.published_to_supervisors, campaigns.published_to_store_managers, campaigns.published_to_inventory_team)
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.campaign.edit')
  OR public.current_user_has_permission('activity.store_detail.edit')
  OR public.current_user_has_permission('activity.equipment_trip.edit')
  OR public.current_user_has_permission('activity.checklist.edit')
  OR public.current_user_has_permission('activity.marketing.publish')
  OR public.current_user_has_permission('activity.merchandise.publish')
);

DROP POLICY IF EXISTS p1h_event_dates_read ON public.event_dates;
CREATE POLICY p1h_event_dates_read ON public.event_dates FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.management.access')
  OR public.campaign_user_has_view_own()
  OR public.current_user_has_permission('activity.campaign.view_all')
);

DROP POLICY IF EXISTS p1h_campaign_checklist_items_read ON public.campaign_checklist_items;
CREATE POLICY p1h_campaign_checklist_items_read ON public.campaign_checklist_items FOR SELECT TO authenticated
USING (
  public.campaign_id_published_to_viewer(campaign_checklist_items.campaign_id)
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.checklist.edit')
);

-- 門市子表：督導（有 supervisor 任命）與盤點組持 view_own 看全部門市；view_all 看全部；店長依 store_managers
DROP POLICY IF EXISTS p1h_campaign_store_scoped_read ON public.campaign_schedules;
CREATE POLICY p1h_campaign_store_scoped_read ON public.campaign_schedules FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.campaign.edit')
  OR public.campaign_user_sees_all_stores_of(campaign_schedules.campaign_id)
  OR public.campaign_user_manages_store(campaign_schedules.campaign_id, campaign_schedules.store_id)
);

DROP POLICY IF EXISTS p1h_campaign_store_details_read ON public.campaign_store_details;
CREATE POLICY p1h_campaign_store_details_read ON public.campaign_store_details FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.store_detail.edit')
  OR public.campaign_user_sees_all_stores_of(campaign_store_details.campaign_id)
  OR public.campaign_user_manages_store(campaign_store_details.campaign_id, campaign_store_details.store_id)
);

DROP POLICY IF EXISTS p1h_campaign_store_headcount_read ON public.campaign_store_headcount;
CREATE POLICY p1h_campaign_store_headcount_read ON public.campaign_store_headcount FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.manage')
  OR public.current_user_has_permission('activity.store_detail.edit')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR public.campaign_user_sees_all_stores_of(campaign_store_headcount.campaign_id)
  OR public.campaign_user_manages_store(campaign_store_headcount.campaign_id, campaign_store_headcount.store_id)
);

DROP POLICY IF EXISTS p1h_campaign_store_own_staff_read ON public.campaign_store_own_staff;
CREATE POLICY p1h_campaign_store_own_staff_read ON public.campaign_store_own_staff FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.manage')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR public.campaign_user_sees_all_stores_of(campaign_store_own_staff.campaign_id)
  OR public.campaign_user_manages_store(campaign_store_own_staff.campaign_id, campaign_store_own_staff.store_id)
);

DROP POLICY IF EXISTS p1h_campaign_support_requests_read ON public.campaign_support_requests;
CREATE POLICY p1h_campaign_support_requests_read ON public.campaign_support_requests FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.manage')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR public.campaign_user_sees_all_stores_of(campaign_support_requests.campaign_id)
  OR public.campaign_user_manages_store(campaign_support_requests.campaign_id, campaign_support_requests.requesting_store_id)
  OR public.campaign_user_manages_store(campaign_support_requests.campaign_id, campaign_support_requests.supporting_store_id)
);

DROP POLICY IF EXISTS p1h_campaign_support_staff_read ON public.campaign_support_staff;
CREATE POLICY p1h_campaign_support_staff_read ON public.campaign_support_staff FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.manage')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR public.campaign_user_sees_all_stores_of(campaign_support_staff.campaign_id)
  OR public.campaign_user_manages_store(campaign_support_staff.campaign_id, campaign_support_staff.requesting_store_id)
  OR public.campaign_user_manages_store(campaign_support_staff.campaign_id, campaign_support_staff.supporting_store_id)
);

DROP POLICY IF EXISTS p1h_campaign_checklist_completions_read ON public.campaign_checklist_completions;
CREATE POLICY p1h_campaign_checklist_completions_read ON public.campaign_checklist_completions FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.manage')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.checklist.edit')
  OR public.campaign_user_sees_all_stores_of_item(campaign_checklist_completions.checklist_item_id)
  OR public.campaign_user_manages_store_of_item(campaign_checklist_completions.checklist_item_id, campaign_checklist_completions.store_id)
);

-- completions read 補上 activity.manage：原本 manage 靠 FOR ALL 寫入 policy 順帶可讀，拆分後 upsert（ON CONFLICT）需要 SELECT 權。
-- 檢核完成寫入：原本只認 manage / checklist.edit / 本人任命門市（FOR ALL，且不檢查角色與發布閘門）。
-- 改為只管 INSERT / UPDATE / DELETE（讀取統一走上面的 read policy，不再順帶放行 SELECT），並：
--   - 督導（與盤點組）：讀權為 view_own/view_all、活動已發布給其身分 => 可寫任一門市（campaign_user_writes_all_stores_of_item）；
--   - 店長：只限 role_type='store_manager' 任命的門市，且活動已發布給店長（campaign_user_manages_store_of_item）；
--   - 只有 activity.manage、activity.checklist.edit 可繞過發布閘門。
-- 與 API authorizeCampaignStoreWrite 一致。
DROP POLICY IF EXISTS p1h_campaign_checklist_completions_write ON public.campaign_checklist_completions;
DROP POLICY IF EXISTS p1h_campaign_checklist_completions_write_insert ON public.campaign_checklist_completions;
DROP POLICY IF EXISTS p1h_campaign_checklist_completions_write_update ON public.campaign_checklist_completions;
DROP POLICY IF EXISTS p1h_campaign_checklist_completions_write_delete ON public.campaign_checklist_completions;
CREATE POLICY p1h_campaign_checklist_completions_write_insert ON public.campaign_checklist_completions FOR INSERT TO authenticated
WITH CHECK (
  public.current_user_has_permission('activity.manage')
  OR public.current_user_has_permission('activity.checklist.edit')
  OR public.campaign_user_manages_store_of_item(campaign_checklist_completions.checklist_item_id, campaign_checklist_completions.store_id)
  OR public.campaign_user_writes_all_stores_of_item(campaign_checklist_completions.checklist_item_id)
);
CREATE POLICY p1h_campaign_checklist_completions_write_update ON public.campaign_checklist_completions FOR UPDATE TO authenticated
USING (
  public.current_user_has_permission('activity.manage')
  OR public.current_user_has_permission('activity.checklist.edit')
  OR public.campaign_user_manages_store_of_item(campaign_checklist_completions.checklist_item_id, campaign_checklist_completions.store_id)
  OR public.campaign_user_writes_all_stores_of_item(campaign_checklist_completions.checklist_item_id)
)
WITH CHECK (
  public.current_user_has_permission('activity.manage')
  OR public.current_user_has_permission('activity.checklist.edit')
  OR public.campaign_user_manages_store_of_item(campaign_checklist_completions.checklist_item_id, campaign_checklist_completions.store_id)
  OR public.campaign_user_writes_all_stores_of_item(campaign_checklist_completions.checklist_item_id)
);
CREATE POLICY p1h_campaign_checklist_completions_write_delete ON public.campaign_checklist_completions FOR DELETE TO authenticated
USING (
  public.current_user_has_permission('activity.manage')
  OR public.current_user_has_permission('activity.checklist.edit')
  OR public.campaign_user_manages_store_of_item(campaign_checklist_completions.checklist_item_id, campaign_checklist_completions.store_id)
  OR public.campaign_user_writes_all_stores_of_item(campaign_checklist_completions.checklist_item_id)
);

-- 支援需求／支援人員／自有人員的「寫入」policy：
--   原本是 FOR ALL（含 SELECT）且只看 activity.manage 或 support_*.edit，持有者可直寫任何門市與草稿活動。
--   改為與 API authorizeCampaignStoreWrite 完全一致，且只管 INSERT / UPDATE / DELETE（UPDATE 同時有 USING 與 WITH CHECK）：
--   activity.manage 可全寫；否則需持對應 edit 權（support_request.edit / support_assign.edit），
--   且 campaign_user_can_write_stores：讀權（view_own／舊 view／view_all）、活動已發布給其任命身分、門市在其範圍內
--   （店長＝任命門市；督導／盤點組＝全部門市）。沒有任命的 support_*.edit 持有者不可寫（與 API 一致）。
--   範圍門市：own_staff = store_id；support_requests = requesting_store_id（與 API 一致，只看請求門市）；
--   support_staff = requesting_store_id 或 supporting_store_id 任一端。
DROP POLICY IF EXISTS p1h_campaign_support_requests_write ON public.campaign_support_requests;
DROP POLICY IF EXISTS p1h_campaign_support_requests_write_insert ON public.campaign_support_requests;
DROP POLICY IF EXISTS p1h_campaign_support_requests_write_update ON public.campaign_support_requests;
DROP POLICY IF EXISTS p1h_campaign_support_requests_write_delete ON public.campaign_support_requests;
CREATE POLICY p1h_campaign_support_requests_write_insert ON public.campaign_support_requests FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_permission('activity.manage') OR (public.current_user_has_permission('activity.support_request.edit') AND public.campaign_user_can_write_stores(campaign_id, ARRAY[requesting_store_id], false)));
CREATE POLICY p1h_campaign_support_requests_write_update ON public.campaign_support_requests FOR UPDATE TO authenticated
USING (public.current_user_has_permission('activity.manage') OR (public.current_user_has_permission('activity.support_request.edit') AND public.campaign_user_can_write_stores(campaign_id, ARRAY[requesting_store_id], false)))
WITH CHECK (public.current_user_has_permission('activity.manage') OR (public.current_user_has_permission('activity.support_request.edit') AND public.campaign_user_can_write_stores(campaign_id, ARRAY[requesting_store_id], false)));
CREATE POLICY p1h_campaign_support_requests_write_delete ON public.campaign_support_requests FOR DELETE TO authenticated
USING (public.current_user_has_permission('activity.manage') OR (public.current_user_has_permission('activity.support_request.edit') AND public.campaign_user_can_write_stores(campaign_id, ARRAY[requesting_store_id], false)));

DROP POLICY IF EXISTS p1h_campaign_support_staff_write ON public.campaign_support_staff;
DROP POLICY IF EXISTS p1h_campaign_support_staff_write_insert ON public.campaign_support_staff;
DROP POLICY IF EXISTS p1h_campaign_support_staff_write_update ON public.campaign_support_staff;
DROP POLICY IF EXISTS p1h_campaign_support_staff_write_delete ON public.campaign_support_staff;
CREATE POLICY p1h_campaign_support_staff_write_insert ON public.campaign_support_staff FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_permission('activity.manage') OR (public.current_user_has_permission('activity.support_assign.edit') AND public.campaign_user_can_write_stores(campaign_id, ARRAY[requesting_store_id, supporting_store_id], true)));
CREATE POLICY p1h_campaign_support_staff_write_update ON public.campaign_support_staff FOR UPDATE TO authenticated
USING (public.current_user_has_permission('activity.manage') OR (public.current_user_has_permission('activity.support_assign.edit') AND public.campaign_user_can_write_stores(campaign_id, ARRAY[requesting_store_id, supporting_store_id], true)))
WITH CHECK (public.current_user_has_permission('activity.manage') OR (public.current_user_has_permission('activity.support_assign.edit') AND public.campaign_user_can_write_stores(campaign_id, ARRAY[requesting_store_id, supporting_store_id], true)));
CREATE POLICY p1h_campaign_support_staff_write_delete ON public.campaign_support_staff FOR DELETE TO authenticated
USING (public.current_user_has_permission('activity.manage') OR (public.current_user_has_permission('activity.support_assign.edit') AND public.campaign_user_can_write_stores(campaign_id, ARRAY[requesting_store_id, supporting_store_id], true)));

DROP POLICY IF EXISTS p1h_campaign_store_own_staff_write ON public.campaign_store_own_staff;
DROP POLICY IF EXISTS p1h_campaign_store_own_staff_write_insert ON public.campaign_store_own_staff;
DROP POLICY IF EXISTS p1h_campaign_store_own_staff_write_update ON public.campaign_store_own_staff;
DROP POLICY IF EXISTS p1h_campaign_store_own_staff_write_delete ON public.campaign_store_own_staff;
CREATE POLICY p1h_campaign_store_own_staff_write_insert ON public.campaign_store_own_staff FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_permission('activity.manage') OR (public.current_user_has_permission('activity.support_assign.edit') AND public.campaign_user_can_write_stores(campaign_id, ARRAY[store_id], false)));
CREATE POLICY p1h_campaign_store_own_staff_write_update ON public.campaign_store_own_staff FOR UPDATE TO authenticated
USING (public.current_user_has_permission('activity.manage') OR (public.current_user_has_permission('activity.support_assign.edit') AND public.campaign_user_can_write_stores(campaign_id, ARRAY[store_id], false)))
WITH CHECK (public.current_user_has_permission('activity.manage') OR (public.current_user_has_permission('activity.support_assign.edit') AND public.campaign_user_can_write_stores(campaign_id, ARRAY[store_id], false)));
CREATE POLICY p1h_campaign_store_own_staff_write_delete ON public.campaign_store_own_staff FOR DELETE TO authenticated
USING (public.current_user_has_permission('activity.manage') OR (public.current_user_has_permission('activity.support_assign.edit') AND public.campaign_user_can_write_stores(campaign_id, ARRAY[store_id], false)));

-- headcount 寫入：原本是 FOR ALL（會順帶放行 SELECT），API 只允許 activity.manage / store_detail.edit（可寫全部，無任命路徑）。
-- 拆成 INSERT / UPDATE / DELETE，讀取統一走 read policy（read 已含 manage 與 store_detail.edit）。
DROP POLICY IF EXISTS p1h_campaign_store_headcount_write ON public.campaign_store_headcount;
DROP POLICY IF EXISTS p1h_campaign_store_headcount_write_insert ON public.campaign_store_headcount;
DROP POLICY IF EXISTS p1h_campaign_store_headcount_write_update ON public.campaign_store_headcount;
DROP POLICY IF EXISTS p1h_campaign_store_headcount_write_delete ON public.campaign_store_headcount;
CREATE POLICY p1h_campaign_store_headcount_write_insert ON public.campaign_store_headcount FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.store_detail.edit'));
CREATE POLICY p1h_campaign_store_headcount_write_update ON public.campaign_store_headcount FOR UPDATE TO authenticated
USING (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.store_detail.edit'))
WITH CHECK (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.store_detail.edit'));
CREATE POLICY p1h_campaign_store_headcount_write_delete ON public.campaign_store_headcount FOR DELETE TO authenticated
USING (public.current_user_has_permission('activity.manage') OR public.current_user_has_permission('activity.store_detail.edit'));

DROP POLICY IF EXISTS p1h_store_activity_settings_read ON public.store_activity_settings;
CREATE POLICY p1h_store_activity_settings_read ON public.store_activity_settings FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.management.access')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR public.campaign_user_sees_all_stores()
  OR EXISTS (SELECT 1 FROM public.store_managers sm WHERE sm.user_id = auth.uid() AND sm.store_id = store_activity_settings.store_id)
);

-- 設備車次：車次以門市名稱記錄，RLS 無法逐門市判斷。RLS 只放行督導／盤點組（看全部門市，且活動已發布給其身分）；
-- 店長的讀取由 API 改走 service-role 並依任命門市名稱過濾，避免用自己的 JWT 直接讀到別店車次。
DROP POLICY IF EXISTS p1h_campaign_equipment_trips_read ON public.campaign_equipment_trips;
CREATE POLICY p1h_campaign_equipment_trips_read ON public.campaign_equipment_trips FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.campaign.view_all')
  OR public.current_user_has_permission('activity.equipment_trip.edit')
  OR public.campaign_user_sees_all_stores_of(campaign_equipment_trips.campaign_id)
);

-- 行銷／商品部發布內容：活動明細頁會讀取，持 view_own 者在已發布的活動上開放唯讀
DROP POLICY IF EXISTS p1h_campaign_department_publish_read ON public.campaign_department_publish;
CREATE POLICY p1h_campaign_department_publish_read ON public.campaign_department_publish FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('activity.marketing.publish')
  OR public.current_user_has_permission('activity.merchandise.publish')
  OR public.current_user_has_permission('activity.campaign.view_all')
  OR public.campaign_id_published_to_viewer(campaign_department_publish.campaign_id)
);

NOTIFY pgrst, 'reload schema';
COMMIT;

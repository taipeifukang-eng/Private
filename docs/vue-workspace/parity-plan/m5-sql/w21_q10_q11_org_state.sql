-- M5 W21 Q10、Q11：只讀。看停用單位與人員資料部門文字的現況。不改任何資料；請在正式區 SQL editor 由使用者自行執行。
-- 兩段查詢各自獨立，貼上一段單獨執行（SQL editor 只顯示最後一段的結果）。
--
-- 第一段（Q10）：停用單位。M5 之後停用單位底下的成員與主管仍可調整（含移出），不必先重新啟用；
-- 停用單位仍不能新增子單位、不能被當成上層，也不能維護工作職掌。
SELECT u.code, u.name, u.type, u.status,
       (SELECT count(*) FROM organization_memberships m WHERE m.organization_unit_id = u.id AND m.status = 'active' AND m.effective_to IS NULL) AS active_members,
       (SELECT count(*) FROM organization_manager_assignments a WHERE a.organization_unit_id = u.id AND a.status = 'active' AND a.effective_to IS NULL) AS active_managers
FROM organization_units u
WHERE u.status = 'inactive'
ORDER BY u.code;

-- 第二段（Q11）：人員資料的部門文字（profiles.department）和目前主要部門名稱不一致的人。
-- 正式區規則是「只有成員異動才同步」，所以部門改名後，舊名稱會殘留到下次該成員異動；M5 維持這個規則（新版不再因改名或停用而整批改寫）。
-- reason：
--   'STALE_NAME'            主要部門已改名，人員資料仍是舊名稱
--   'INACTIVE_DEPARTMENT'   主要部門已停用，但人員資料仍留著部門文字（停用不會清空）
--   'NO_PRIMARY_DEPARTMENT' 沒有主要部門，人員資料卻有部門文字（可能是舊資料或手動填寫）
SELECT CASE WHEN ou.id IS NULL THEN 'NO_PRIMARY_DEPARTMENT'
            WHEN ou.status = 'inactive' THEN 'INACTIVE_DEPARTMENT'
            ELSE 'STALE_NAME' END AS reason,
       pr.employee_code, pr.full_name, pr.email, pr.department AS profile_department, ou.name AS primary_department_name, ou.status AS primary_department_status
FROM profiles pr
LEFT JOIN LATERAL (
  SELECT u.id, u.name, u.status
  FROM organization_memberships m JOIN organization_units u ON u.id = m.organization_unit_id
  WHERE m.user_id = pr.id AND m.is_primary AND m.status = 'active' AND m.effective_to IS NULL AND u.type = 'department'
  ORDER BY m.effective_from DESC, m.created_at DESC LIMIT 1
) ou ON true
WHERE pr.department IS NOT NULL AND btrim(pr.department) <> ''
  AND (ou.id IS NULL OR ou.status = 'inactive' OR pr.department IS DISTINCT FROM ou.name)
ORDER BY reason, pr.department, pr.employee_code NULLS LAST;

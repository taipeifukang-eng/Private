-- 關係會員：新增獨立刪除權限。

INSERT INTO permissions (module, feature, code, action, description)
VALUES ('store', 'relationship_member', 'relationship_member.delete', 'delete', '關係會員刪除：刪除既有關係會員資料')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('admin', 'system_admin', 'admin_role')
  AND p.code = 'relationship_member.delete'
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

DROP POLICY IF EXISTS "relationship_members_select" ON relationship_members;
CREATE POLICY "relationship_members_select" ON relationship_members
  FOR SELECT TO authenticated
  USING (
    has_permission(auth.uid(), 'relationship_member.view')
    OR has_permission(auth.uid(), 'relationship_member.edit')
    OR has_permission(auth.uid(), 'relationship_member.delete')
  );

DROP POLICY IF EXISTS "relationship_members_delete" ON relationship_members;
CREATE POLICY "relationship_members_delete" ON relationship_members
  FOR DELETE TO authenticated
  USING (has_permission(auth.uid(), 'relationship_member.delete'));

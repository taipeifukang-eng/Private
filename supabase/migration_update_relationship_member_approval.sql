-- 關係會員：新增核可欄位與獨立核可權限。

INSERT INTO permissions (module, feature, code, action, description)
VALUES ('store', 'relationship_member', 'relationship_member.approve', 'approve', '關係會員核可：可核可關係會員申請')
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
  AND p.code = 'relationship_member.approve'
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

ALTER TABLE relationship_members
  ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_relationship_members_is_approved
  ON relationship_members(is_approved);

DROP POLICY IF EXISTS "relationship_members_select" ON relationship_members;
CREATE POLICY "relationship_members_select" ON relationship_members
  FOR SELECT TO authenticated
  USING (
    has_permission(auth.uid(), 'relationship_member.view')
    OR has_permission(auth.uid(), 'relationship_member.edit')
    OR has_permission(auth.uid(), 'relationship_member.delete')
    OR has_permission(auth.uid(), 'relationship_member.approve')
  );

DROP POLICY IF EXISTS "relationship_members_update" ON relationship_members;
CREATE POLICY "relationship_members_update" ON relationship_members
  FOR UPDATE TO authenticated
  USING (
    has_permission(auth.uid(), 'relationship_member.edit')
    OR has_permission(auth.uid(), 'relationship_member.approve')
  )
  WITH CHECK (
    has_permission(auth.uid(), 'relationship_member.edit')
    OR has_permission(auth.uid(), 'relationship_member.approve')
  );

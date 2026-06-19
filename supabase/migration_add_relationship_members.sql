-- =====================================================
-- 關係會員模組
-- 權限、申請資料、銷售明細與 RLS
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

INSERT INTO permissions (module, feature, code, action, description)
VALUES
  ('store', 'relationship_member', 'relationship_member.view', 'view', '關係會員檢視：查看資料、填寫新申請與查看銷售明細報表'),
  ('store', 'relationship_member', 'relationship_member.edit', 'edit', '關係會員編輯：編輯既有會員、補會員編號與匯入銷售明細'),
  ('store', 'relationship_member', 'relationship_member.delete', 'delete', '關係會員刪除：刪除既有關係會員資料')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

-- 系統管理員預設擁有完整權限，其他角色由角色權限管理頁指派。
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('admin', 'system_admin', 'admin_role')
  AND p.code IN ('relationship_member.view', 'relationship_member.edit', 'relationship_member.delete')
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

CREATE TABLE IF NOT EXISTS relationship_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_name VARCHAR(100) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  relationship VARCHAR(100) NOT NULL,
  member_number VARCHAR(50),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT relationship_members_name_not_blank CHECK (btrim(member_name) <> ''),
  CONSTRAINT relationship_members_phone_not_blank CHECK (btrim(phone) <> ''),
  CONSTRAINT relationship_members_relationship_not_blank CHECK (btrim(relationship) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_relationship_members_member_number
  ON relationship_members(member_number)
  WHERE member_number IS NOT NULL AND btrim(member_number) <> '';
CREATE INDEX IF NOT EXISTS idx_relationship_members_name ON relationship_members(member_name);
CREATE INDEX IF NOT EXISTS idx_relationship_members_created_at ON relationship_members(created_at DESC);

CREATE TABLE IF NOT EXISTS relationship_sales_imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_name TEXT NOT NULL,
  row_count INT NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  imported_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS relationship_sales_details (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_id UUID NOT NULL REFERENCES relationship_sales_imports(id) ON DELETE CASCADE,
  store_code VARCHAR(50) NOT NULL,
  sale_datetime TIMESTAMPTZ NOT NULL,
  member_number VARCHAR(50) NOT NULL,
  product_code VARCHAR(100) NOT NULL,
  product_name VARCHAR(300) NOT NULL,
  quantity NUMERIC(12,2) NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  imported_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT relationship_sales_member_number_not_blank CHECK (btrim(member_number) <> ''),
  CONSTRAINT relationship_sales_store_code_not_blank CHECK (btrim(store_code) <> ''),
  CONSTRAINT relationship_sales_product_code_not_blank CHECK (btrim(product_code) <> ''),
  CONSTRAINT relationship_sales_product_name_not_blank CHECK (btrim(product_name) <> '')
);

CREATE INDEX IF NOT EXISTS idx_relationship_sales_member_number
  ON relationship_sales_details(member_number);
CREATE INDEX IF NOT EXISTS idx_relationship_sales_sale_datetime
  ON relationship_sales_details(sale_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_relationship_sales_imported_at
  ON relationship_sales_details(imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_relationship_sales_import_id
  ON relationship_sales_details(import_id);

DROP TRIGGER IF EXISTS trigger_update_relationship_members_updated_at ON relationship_members;
CREATE TRIGGER trigger_update_relationship_members_updated_at
  BEFORE UPDATE ON relationship_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE relationship_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_sales_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_sales_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "relationship_members_select" ON relationship_members;
CREATE POLICY "relationship_members_select" ON relationship_members
  FOR SELECT TO authenticated
  USING (
    has_permission(auth.uid(), 'relationship_member.view')
    OR has_permission(auth.uid(), 'relationship_member.edit')
    OR has_permission(auth.uid(), 'relationship_member.delete')
  );

DROP POLICY IF EXISTS "relationship_members_insert" ON relationship_members;
CREATE POLICY "relationship_members_insert" ON relationship_members
  FOR INSERT TO authenticated
  WITH CHECK (
    (has_permission(auth.uid(), 'relationship_member.view')
      OR has_permission(auth.uid(), 'relationship_member.edit'))
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "relationship_members_update" ON relationship_members;
CREATE POLICY "relationship_members_update" ON relationship_members
  FOR UPDATE TO authenticated
  USING (has_permission(auth.uid(), 'relationship_member.edit'))
  WITH CHECK (has_permission(auth.uid(), 'relationship_member.edit'));

DROP POLICY IF EXISTS "relationship_members_delete" ON relationship_members;
CREATE POLICY "relationship_members_delete" ON relationship_members
  FOR DELETE TO authenticated
  USING (has_permission(auth.uid(), 'relationship_member.delete'));

DROP POLICY IF EXISTS "relationship_sales_imports_select" ON relationship_sales_imports;
CREATE POLICY "relationship_sales_imports_select" ON relationship_sales_imports
  FOR SELECT TO authenticated
  USING (
    has_permission(auth.uid(), 'relationship_member.view')
    OR has_permission(auth.uid(), 'relationship_member.edit')
  );

DROP POLICY IF EXISTS "relationship_sales_imports_insert" ON relationship_sales_imports;
CREATE POLICY "relationship_sales_imports_insert" ON relationship_sales_imports
  FOR INSERT TO authenticated
  WITH CHECK (
    has_permission(auth.uid(), 'relationship_member.edit')
    AND imported_by = auth.uid()
  );

DROP POLICY IF EXISTS "relationship_sales_details_select" ON relationship_sales_details;
CREATE POLICY "relationship_sales_details_select" ON relationship_sales_details
  FOR SELECT TO authenticated
  USING (
    has_permission(auth.uid(), 'relationship_member.view')
    OR has_permission(auth.uid(), 'relationship_member.edit')
  );

DROP POLICY IF EXISTS "relationship_sales_details_insert" ON relationship_sales_details;
CREATE POLICY "relationship_sales_details_insert" ON relationship_sales_details
  FOR INSERT TO authenticated
  WITH CHECK (
    has_permission(auth.uid(), 'relationship_member.edit')
    AND imported_by = auth.uid()
  );

COMMENT ON TABLE relationship_members IS '關係會員申請與會員編號資料';
COMMENT ON TABLE relationship_sales_imports IS '關係會員銷售明細 Excel 匯入批次';
COMMENT ON TABLE relationship_sales_details IS '關係會員銷售明細，欄位來源為 Excel 匯入';

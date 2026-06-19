-- 關係會員：檢視權限可填寫申請，銷售明細增加門市與銷售日期。

UPDATE permissions
SET description = '關係會員檢視：查看資料、填寫新申請與查看銷售明細報表'
WHERE code = 'relationship_member.view';

UPDATE permissions
SET description = '關係會員編輯：編輯既有會員、補會員編號與匯入銷售明細'
WHERE code = 'relationship_member.edit';

ALTER TABLE relationship_sales_details
  ADD COLUMN IF NOT EXISTS store_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS sale_datetime TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_relationship_sales_sale_datetime
  ON relationship_sales_details(sale_datetime DESC);

DROP POLICY IF EXISTS "relationship_members_insert" ON relationship_members;
CREATE POLICY "relationship_members_insert" ON relationship_members
  FOR INSERT TO authenticated
  WITH CHECK (
    (has_permission(auth.uid(), 'relationship_member.view')
      OR has_permission(auth.uid(), 'relationship_member.edit'))
    AND created_by = auth.uid()
  );

COMMENT ON COLUMN relationship_sales_details.store_code IS 'Excel 第一欄：門市代號';
COMMENT ON COLUMN relationship_sales_details.sale_datetime IS 'Excel 第二欄：銷售日期時間，格式 YYYY/MM/DD HH:MM';

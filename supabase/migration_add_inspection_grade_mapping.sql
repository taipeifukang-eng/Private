-- 建立巡店評分對照表
CREATE TABLE IF NOT EXISTS inspection_grade_mapping (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  grade INTEGER NOT NULL CHECK (grade >= 0 AND grade <= 10),
  min_score DECIMAL(6,1) NOT NULL CHECK (min_score >= 0),
  updated_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(grade)
);

-- RLS
ALTER TABLE inspection_grade_mapping ENABLE ROW LEVEL SECURITY;

-- 所有已登入使用者可讀取
CREATE POLICY "inspection_grade_mapping_select" ON inspection_grade_mapping
  FOR SELECT TO authenticated USING (true);

-- 只有 admin 可寫入
CREATE POLICY "inspection_grade_mapping_insert" ON inspection_grade_mapping
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "inspection_grade_mapping_update" ON inspection_grade_mapping
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "inspection_grade_mapping_delete" ON inspection_grade_mapping
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 插入預設對照表
INSERT INTO inspection_grade_mapping (grade, min_score) VALUES
  (10, 220),
  (9, 215),
  (8, 191),
  (7, 181),
  (6, 171),
  (5, 161),
  (4, 151),
  (3, 141),
  (2, 131),
  (1, 121),
  (0, 0)
ON CONFLICT (grade) DO NOTHING;

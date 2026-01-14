-- Migration: Add support for collaborative assignments
-- This allows multiple users to work on the same assignment

-- 1. Create assignment_collaborators junction table
CREATE TABLE IF NOT EXISTS assignment_collaborators (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(assignment_id, user_id)
);

-- 2. Add index for performance
CREATE INDEX IF NOT EXISTS idx_assignment_collaborators_assignment 
  ON assignment_collaborators(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_collaborators_user 
  ON assignment_collaborators(user_id);

-- 3. Migrate existing assignments to collaborators table
INSERT INTO assignment_collaborators (assignment_id, user_id)
SELECT id, assigned_to 
FROM assignments 
WHERE assigned_to IS NOT NULL
ON CONFLICT (assignment_id, user_id) DO NOTHING;

-- 4. Enable RLS
ALTER TABLE assignment_collaborators ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- Users can view their own collaborations
CREATE POLICY "Users can view their collaborations" 
  ON assignment_collaborators
  FOR SELECT 
  USING (auth.uid() = user_id);

-- Admins can view all collaborations
CREATE POLICY "Admins can view all collaborations" 
  ON assignment_collaborators
  FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- Admins can insert collaborations
CREATE POLICY "Admins can insert collaborations" 
  ON assignment_collaborators
  FOR INSERT 
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

-- Admins can delete collaborations
CREATE POLICY "Admins can delete collaborations" 
  ON assignment_collaborators
  FOR DELETE 
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
  );

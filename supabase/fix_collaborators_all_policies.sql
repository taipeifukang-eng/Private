-- Fix: Complete RLS policies for assignment_collaborators table
-- Allow task creators and admins to SELECT, INSERT, UPDATE, DELETE collaborators

-- Drop all existing policies
DROP POLICY IF EXISTS "Admins can insert collaborations" ON assignment_collaborators;
DROP POLICY IF EXISTS "Task creators and admins can insert collaborations" ON assignment_collaborators;
DROP POLICY IF EXISTS "Users can view assignment collaborations" ON assignment_collaborators;
DROP POLICY IF EXISTS "Task creators and admins can delete collaborations" ON assignment_collaborators;
DROP POLICY IF EXISTS "Task creators and admins can update collaborations" ON assignment_collaborators;

-- SELECT policy: Allow users to view collaborations for their own assignments or if they are admin/manager
CREATE POLICY "Users can view assignment collaborations" 
  ON assignment_collaborators
  FOR SELECT 
  USING (
    -- User is admin or manager
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
    OR
    -- User is the creator of the assignment
    EXISTS (
      SELECT 1 FROM assignments
      WHERE id = assignment_collaborators.assignment_id 
        AND created_by = auth.uid()
    )
    OR
    -- User is a collaborator on this assignment
    user_id = auth.uid()
  );

-- INSERT policy: Allow task creators and admins to add collaborators
CREATE POLICY "Task creators and admins can insert collaborations" 
  ON assignment_collaborators
  FOR INSERT 
  WITH CHECK (
    -- User is admin or manager
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
    OR
    -- User is the creator of the assignment
    EXISTS (
      SELECT 1 FROM assignments
      WHERE id = assignment_collaborators.assignment_id 
        AND created_by = auth.uid()
    )
  );

-- DELETE policy: Allow task creators and admins to remove collaborators
CREATE POLICY "Task creators and admins can delete collaborations" 
  ON assignment_collaborators
  FOR DELETE 
  USING (
    -- User is admin or manager
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
    OR
    -- User is the creator of the assignment
    EXISTS (
      SELECT 1 FROM assignments
      WHERE id = assignment_collaborators.assignment_id 
        AND created_by = auth.uid()
    )
  );

-- UPDATE policy: Allow task creators and admins to update collaborators
CREATE POLICY "Task creators and admins can update collaborations" 
  ON assignment_collaborators
  FOR UPDATE 
  USING (
    -- User is admin or manager
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
    OR
    -- User is the creator of the assignment
    EXISTS (
      SELECT 1 FROM assignments
      WHERE id = assignment_collaborators.assignment_id 
        AND created_by = auth.uid()
    )
  );

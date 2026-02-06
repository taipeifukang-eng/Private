-- Fix: Allow task creators to add collaborators to their own assignments
-- This allows members to create assignments and add collaborators

-- Drop existing insert policy
DROP POLICY IF EXISTS "Admins can insert collaborations" ON assignment_collaborators;

-- Create new policy that allows:
-- 1. Admins and managers to insert any collaborations
-- 2. Task creators to insert collaborations for their own assignments
CREATE POLICY "Task creators and admins can insert collaborations" 
  ON assignment_collaborators
  FOR INSERT 
  WITH CHECK (
    -- Check if user is admin/manager
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role IN ('admin', 'manager')
    )
    OR
    -- Check if user is the creator of the assignment
    EXISTS (
      SELECT 1 FROM assignments
      WHERE id = assignment_collaborators.assignment_id 
        AND created_by = auth.uid()
    )
  );

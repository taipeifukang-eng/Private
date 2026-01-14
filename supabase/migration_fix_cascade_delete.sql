-- Migration to fix foreign key constraints for cascade delete
-- This allows deleting assignments along with their related logs and collaborators

-- Drop existing foreign key constraints and recreate them with CASCADE
ALTER TABLE logs
DROP CONSTRAINT IF EXISTS logs_assignment_id_fkey,
ADD CONSTRAINT logs_assignment_id_fkey 
  FOREIGN KEY (assignment_id) 
  REFERENCES assignments(id) 
  ON DELETE CASCADE;

ALTER TABLE assignment_collaborators
DROP CONSTRAINT IF EXISTS assignment_collaborators_assignment_id_fkey,
ADD CONSTRAINT assignment_collaborators_assignment_id_fkey 
  FOREIGN KEY (assignment_id) 
  REFERENCES assignments(id) 
  ON DELETE CASCADE;

-- Also ensure assignments cascade from templates if needed (optional)
ALTER TABLE assignments
DROP CONSTRAINT IF EXISTS assignments_template_id_fkey,
ADD CONSTRAINT assignments_template_id_fkey 
  FOREIGN KEY (template_id) 
  REFERENCES templates(id) 
  ON DELETE CASCADE;

-- Verify the changes
SELECT 
  tc.table_name, 
  tc.constraint_name, 
  tc.constraint_type,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  rc.delete_rule
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
LEFT JOIN information_schema.referential_constraints AS rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name IN ('logs', 'assignments', 'assignment_collaborators')
ORDER BY tc.table_name;

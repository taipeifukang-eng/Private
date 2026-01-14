-- Migration: Add section_id to assignment_collaborators
-- This allows tracking which department section each collaborator is assigned to

-- Add section_id column to track which section a collaborator is assigned to
ALTER TABLE assignment_collaborators 
ADD COLUMN IF NOT EXISTS section_id TEXT;

-- Add index for section_id lookups
CREATE INDEX IF NOT EXISTS idx_assignment_collaborators_section 
  ON assignment_collaborators(section_id);

-- Verify the column was added
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'assignment_collaborators'
ORDER BY ordinal_position;

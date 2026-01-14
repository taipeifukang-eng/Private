-- Add created_by column to assignments table
-- This stores who created/initiated the assignment

ALTER TABLE assignments 
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);

-- Update existing records to set created_by from template creator or assigned_to as fallback
-- Note: You may want to set this to a specific user ID instead
UPDATE assignments 
SET created_by = assigned_to 
WHERE created_by IS NULL;

-- Add comment
COMMENT ON COLUMN assignments.created_by IS 'User who created/initiated this assignment';

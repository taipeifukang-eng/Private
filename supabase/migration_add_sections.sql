-- Add sections column to templates table for department-based workflow
-- This allows each department to have their own set of steps and assigned users

ALTER TABLE templates 
ADD COLUMN IF NOT EXISTS sections JSONB DEFAULT '[]'::jsonb;

-- Add comment explaining the structure
COMMENT ON COLUMN templates.sections IS 'Department-based sections: [{ id: "sec-1", department: "營業部", assigned_users: ["user-id"], steps: [{ id: "1", label: "步驟1" }] }]';

-- Update existing templates to have empty sections array if null
UPDATE templates 
SET sections = '[]'::jsonb 
WHERE sections IS NULL;

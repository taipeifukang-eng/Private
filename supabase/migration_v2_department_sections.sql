-- ================================================
-- Migration: V2 Department-based Sections System
-- ================================================
-- Run this script in Supabase SQL Editor to enable the new department-based workflow system.
-- This migration adds:
-- 1. sections column to templates table (JSONB for department sections)
-- 2. section_id column to assignment_collaborators table (track which section each user is assigned to)

-- ================================================
-- Part 1: Add sections column to templates table
-- ================================================
ALTER TABLE templates 
ADD COLUMN IF NOT EXISTS sections JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN templates.sections IS 'Department-based sections: [{ id: "sec-1", department: "營業部", assigned_users: ["user-id"], steps: [{ id: "1", label: "step", required: true }] }]';

-- ================================================
-- Part 2: Add section_id to assignment_collaborators
-- ================================================
ALTER TABLE assignment_collaborators 
ADD COLUMN IF NOT EXISTS section_id TEXT;

-- Add index for section_id lookups
CREATE INDEX IF NOT EXISTS idx_assignment_collaborators_section 
  ON assignment_collaborators(section_id);

COMMENT ON COLUMN assignment_collaborators.section_id IS 'Which section this collaborator is assigned to (links to template.sections[].id)';

-- ================================================
-- Verification queries
-- ================================================
-- Check templates table structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'templates'
ORDER BY ordinal_position;

-- Check assignment_collaborators table structure
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'assignment_collaborators'
ORDER BY ordinal_position;

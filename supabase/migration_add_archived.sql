-- Migration: Add archived fields to assignments table
-- Date: 2026-01-14
-- Purpose: Enable archiving completed tasks for historical reference

-- Add archived column (default FALSE)
ALTER TABLE assignments
ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;

-- Add archived_at column (timestamp when archived)
ALTER TABLE assignments
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Add archived_by column (user who archived the task)
ALTER TABLE assignments
ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES auth.users(id);

-- Add comments
COMMENT ON COLUMN assignments.archived IS 'Whether the task has been archived';
COMMENT ON COLUMN assignments.archived_at IS 'Timestamp when the task was archived';
COMMENT ON COLUMN assignments.archived_by IS 'User ID who archived the task';

-- Create index for faster queries on archived tasks
CREATE INDEX IF NOT EXISTS idx_assignments_archived ON assignments(archived);
CREATE INDEX IF NOT EXISTS idx_assignments_archived_at ON assignments(archived_at);

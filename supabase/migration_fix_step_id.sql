-- Migration: Change step_id from INT to TEXT to support UUID step IDs
-- Date: 2026-01-14
-- Purpose: Fix checkbox disappearing issue caused by UUID step IDs being converted to INT

-- Step 1: Add new TEXT column
ALTER TABLE logs
ADD COLUMN IF NOT EXISTS step_id_text TEXT;

-- Step 2: Copy existing data (convert INT to TEXT)
UPDATE logs
SET step_id_text = step_id::TEXT
WHERE step_id IS NOT NULL;

-- Step 3: Drop old column and rename new one
ALTER TABLE logs DROP COLUMN IF EXISTS step_id;
ALTER TABLE logs RENAME COLUMN step_id_text TO step_id;

-- Add comment
COMMENT ON COLUMN logs.step_id IS 'Step ID from template steps_schema (supports both INT and UUID strings)';

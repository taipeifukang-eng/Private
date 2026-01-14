-- Migration: Add department field to profiles and assignments tables
-- Date: 2026-01-14
-- Purpose: Enable department-based task categorization

-- Add department column to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS department TEXT;

-- Add department column to assignments table
ALTER TABLE assignments
ADD COLUMN IF NOT EXISTS department TEXT;

-- Add comment to explain the purpose
COMMENT ON COLUMN profiles.department IS 'User department for task categorization';
COMMENT ON COLUMN assignments.department IS 'Department of the task creator, copied from their profile when task is created';

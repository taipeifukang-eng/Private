-- Migration: Add job_title field to profiles table
-- Date: 2026-01-14
-- Purpose: Add job title/position field for users

-- Add job_title column
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS job_title TEXT;

-- Add comment
COMMENT ON COLUMN profiles.job_title IS 'User job title or position';

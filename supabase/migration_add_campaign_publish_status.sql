-- Migration: Add publish status to campaigns
-- Description: Track if campaign schedule is published to supervisors and store managers
-- Date: 2026-02-09

-- Add publish status columns to campaigns table
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS published_to_supervisors BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS published_to_store_managers BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_campaigns_published ON campaigns(published_to_supervisors, published_to_store_managers);

COMMENT ON COLUMN campaigns.published_to_supervisors IS '是否已發布給督導';
COMMENT ON COLUMN campaigns.published_to_store_managers IS '是否已發布給店長';
COMMENT ON COLUMN campaigns.published_at IS '最後發布時間';

-- Migration: Add Activity Management tables
-- Description: Support for Store Activities (Mother's Day, Anniversary) scheduling
-- Date: 2026-02-08

-- 1. Campaigns Table (活動檔期)
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, -- e.g., "2026 母親節活動"
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- 2. Store Activity Settings (門市活動設定)
-- Defines constraints for each store (e.g., only allowed on specific days)
CREATE TABLE IF NOT EXISTS store_activity_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  allowed_days INTEGER[], -- 1=Mon, ..., 7=Sun. If NULL or Empty, standard rules apply.
  forbidden_days INTEGER[], -- Days strictly not allowed.
  notes TEXT, -- Notes like "Only Tuesdays"
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id)
);

-- 3. Event Dates (重要日期/國定假日)
-- Used to block days or mark them visually
CREATE TABLE IF NOT EXISTS event_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date DATE NOT NULL UNIQUE,
  description TEXT,
  event_type TEXT CHECK (event_type IN ('holiday', 'company_event', 'other')),
  is_blocked BOOLEAN DEFAULT false, -- If true, no activities can be scheduled warning
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Campaign Schedules (活動排程)
-- The actual assignment of a store to a date for a campaign
CREATE TABLE IF NOT EXISTS campaign_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, store_id) -- Each store has only one activity date per campaign
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaign_schedules_campaign_id ON campaign_schedules(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_schedules_date ON campaign_schedules(activity_date);
CREATE INDEX IF NOT EXISTS idx_event_dates_date ON event_dates(event_date);
CREATE INDEX IF NOT EXISTS idx_store_activity_settings_store_id ON store_activity_settings(store_id);

-- RLS Policies
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_activity_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_schedules ENABLE ROW LEVEL SECURITY;

-- Grant access to authenticated users
DO $$ 
BEGIN
    -- Campaigns policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaigns' AND policyname = 'Authenticated users can read campaigns') THEN
        CREATE POLICY "Authenticated users can read campaigns" ON campaigns FOR SELECT USING (auth.role() = 'authenticated');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaigns' AND policyname = 'Admins/Managers can manage campaigns') THEN
        CREATE POLICY "Admins/Managers can manage campaigns" ON campaigns FOR ALL USING (
            EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
        );
    END IF;

    -- Settings policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'store_activity_settings' AND policyname = 'Authenticated users can read settings') THEN
        CREATE POLICY "Authenticated users can read settings" ON store_activity_settings FOR SELECT USING (auth.role() = 'authenticated');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'store_activity_settings' AND policyname = 'Admins/Managers can manage settings') THEN
        CREATE POLICY "Admins/Managers can manage settings" ON store_activity_settings FOR ALL USING (
            EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
        );
    END IF;

    -- Events policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_dates' AND policyname = 'Authenticated users can read events') THEN
        CREATE POLICY "Authenticated users can read events" ON event_dates FOR SELECT USING (auth.role() = 'authenticated');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'event_dates' AND policyname = 'Admins/Managers can manage events') THEN
        CREATE POLICY "Admins/Managers can manage events" ON event_dates FOR ALL USING (
            EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
        );
    END IF;

    -- Schedules policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaign_schedules' AND policyname = 'Authenticated users can read schedules') THEN
        CREATE POLICY "Authenticated users can read schedules" ON campaign_schedules FOR SELECT USING (auth.role() = 'authenticated');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaign_schedules' AND policyname = 'Admins/Managers can manage schedules') THEN
        CREATE POLICY "Admins/Managers can manage schedules" ON campaign_schedules FOR ALL USING (
            EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
        );
    END IF;
END $$;

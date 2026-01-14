-- 1. Templates Table (Stores the flow design)
CREATE TABLE templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id),
  -- The dynamic steps structure: [{ id: 1, label: "Step Name", required: true }]
  steps_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Assignments Table (An instance of a template assigned to a user)
CREATE TABLE assignments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID REFERENCES templates(id),
  assigned_to UUID REFERENCES auth.users(id),
  status TEXT DEFAULT 'pending', -- pending, in_progress, completed
  department TEXT, -- Department of the task creator
  archived BOOLEAN DEFAULT FALSE, -- Whether the task is archived
  archived_at TIMESTAMPTZ, -- When the task was archived
  archived_by UUID REFERENCES auth.users(id), -- Who archived the task
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Logs Table (The audit trail)
CREATE TABLE logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id UUID REFERENCES assignments(id),
  user_id UUID REFERENCES auth.users(id),
  step_id INT, -- Corresponds to the ID inside the JSONB steps
  action TEXT, -- e.g., "checked", "unchecked"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Profiles Table (Extended user information)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'manager', 'member')),
  department TEXT, -- User's department
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Policies for profiles table
-- Users can view their own profile
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Admins can update all profiles
CREATE POLICY "Admins can update all profiles" ON profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Function to automatically create profile when user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_count INTEGER;
BEGIN
  -- Check if this is the first user
  SELECT COUNT(*) INTO user_count FROM public.profiles;
  
  -- First user becomes admin, others are members by default
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    CASE WHEN user_count = 0 THEN 'admin' ELSE 'member' END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to call the function
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canEnterCampaignView } from '@/lib/campaign-access';

// GET /api/campaigns/entry-access
// 活動檢視入口：view_all，或 view_own（第一階段含舊 view）且至少有一筆 store_managers 任命
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
  }
  const canEnter = await canEnterCampaignView(supabase, user.id);
  return NextResponse.json({ success: true, canEnter });
}

import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

// PATCH: Update campaign publish status
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const body = await request.json();
    const { campaignId, publishType, status } = body;

    if (!campaignId || !publishType) {
      return NextResponse.json({ success: false, error: '缺少必要參數' }, { status: 400 });
    }

    // Validate publishType
    if (!['supervisors', 'store_managers'].includes(publishType)) {
      return NextResponse.json({ success: false, error: '無效的發布類型' }, { status: 400 });
    }

    const columnName = publishType === 'supervisors' 
      ? 'published_to_supervisors' 
      : 'published_to_store_managers';

    const updateData: any = {
      [columnName]: status,
      updated_at: new Date().toISOString()
    };

    // If publishing, update published_at timestamp
    if (status) {
      updateData.published_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('campaigns')
      .update(updateData)
      .eq('id', campaignId)
      .select()
      .single();

    if (error) {
      console.error('Error updating campaign publish status:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, campaign: data });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

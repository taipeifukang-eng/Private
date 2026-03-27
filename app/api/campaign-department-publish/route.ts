import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

const STORAGE_BUCKET = 'campaign-department-assets';

function parseStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
      return value ? [value] : [];
    } catch {
      return value ? [value] : [];
    }
  }
  return [];
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const adminClient = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaign_id');
    if (!campaignId) {
      return NextResponse.json({ success: false, error: '缺少 campaign_id' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('campaign_department_publish')
      .select('*')
      .eq('campaign_id', campaignId)
      .maybeSingle();

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ success: true, data: null });
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ success: true, data: null });
    }

    const marketingImagePaths = parseStringArray((data as any).marketing_image_paths);
    let marketingImageUrls: string[] = [];
    if (marketingImagePaths.length > 0) {
      const { data: signedData, error: signedError } = await adminClient.storage
        .from(STORAGE_BUCKET)
        .createSignedUrls(marketingImagePaths, 60 * 60 * 24 * 7);
      if (!signedError) {
        marketingImageUrls = (signedData || []).map((item) => item.signedUrl || '').filter(Boolean);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        ...data,
        marketing_image_urls: marketingImageUrls,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const body = await request.json();
    const {
      campaign_id,
      department,
      marketing_content,
      marketing_rules,
      marketing_image_name,
      marketing_image_data,
      marketing_image_names,
      marketing_image_paths,
      merchandise_gift_rules_name,
      merchandise_gift_rules_data,
      merchandise_supply_content,
      merchandise_allocation_file_name,
      merchandise_allocation_file_data,
    } = body;

    if (!campaign_id || !department) {
      return NextResponse.json({ success: false, error: '缺少必要欄位' }, { status: 400 });
    }

    const canMarketing = await hasPermission(user.id, 'activity.marketing.publish');
    const canMerchandise = await hasPermission(user.id, 'activity.merchandise.publish');
    const canChecklistEdit = await hasPermission(user.id, 'activity.checklist.edit');

    if (department === 'marketing' && !canMarketing && !canChecklistEdit) {
      return NextResponse.json({ success: false, error: '沒有發布行銷內容權限' }, { status: 403 });
    }
    if (department === 'merchandise' && !canMerchandise && !canChecklistEdit) {
      return NextResponse.json({ success: false, error: '沒有發布商品部內容權限' }, { status: 403 });
    }

    const updateData: Record<string, any> = {
      campaign_id,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };

    if (department === 'marketing') {
      updateData.marketing_content = marketing_content ?? '';
      updateData.marketing_rules = marketing_rules ?? '';
      updateData.marketing_image_name = marketing_image_name ?? null;
      updateData.marketing_image_data = marketing_image_data ?? null;
      updateData.marketing_image_names = parseStringArray(marketing_image_names);
      updateData.marketing_image_paths = parseStringArray(marketing_image_paths);
    }

    if (department === 'merchandise') {
      updateData.merchandise_gift_rules_name = merchandise_gift_rules_name ?? null;
      updateData.merchandise_gift_rules_data = merchandise_gift_rules_data ?? null;
      updateData.merchandise_supply_content = merchandise_supply_content ?? '';
      updateData.merchandise_allocation_file_name = merchandise_allocation_file_name ?? null;
      updateData.merchandise_allocation_file_data = merchandise_allocation_file_data ?? null;
    }

    const { data, error } = await supabase
      .from('campaign_department_publish')
      .upsert(
        {
          ...updateData,
          created_by: user.id,
        },
        { onConflict: 'campaign_id' }
      )
      .select('*')
      .single();

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ success: false, error: '資料表尚未建立，請先執行 migration_campaign_department_publish.sql' }, { status: 500 });
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

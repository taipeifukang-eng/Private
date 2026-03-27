import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

const STORAGE_BUCKET = 'campaign-department-assets';
const MAX_FILE_COUNT_PER_REQUEST = 8;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const formData = await request.formData();
    const campaignId = String(formData.get('campaign_id') || '');
    const department = String(formData.get('department') || '');
    const files = formData
      .getAll('files')
      .filter((item): item is File => item instanceof File);

    if (!campaignId || !department) {
      return NextResponse.json({ success: false, error: '缺少必要欄位' }, { status: 400 });
    }

    if (department !== 'marketing') {
      return NextResponse.json({ success: false, error: '目前僅支援行銷部圖檔上傳' }, { status: 400 });
    }

    if (files.length === 0) {
      return NextResponse.json({ success: false, error: '未提供檔案' }, { status: 400 });
    }

    if (files.length > MAX_FILE_COUNT_PER_REQUEST) {
      return NextResponse.json({ success: false, error: `單次最多上傳 ${MAX_FILE_COUNT_PER_REQUEST} 張` }, { status: 400 });
    }

    const canMarketing = await hasPermission(user.id, 'activity.marketing.publish');
    const canChecklistEdit = await hasPermission(user.id, 'activity.checklist.edit');
    if (!canMarketing && !canChecklistEdit) {
      return NextResponse.json({ success: false, error: '沒有上傳行銷圖檔權限' }, { status: 403 });
    }

    const uploadedPaths: string[] = [];
    const uploadedNames: string[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json({ success: false, error: `${file.name} 超過 5MB 限制` }, { status: 400 });
      }

      const ext = file.type.includes('webp')
        ? 'webp'
        : file.type.includes('png')
          ? 'png'
          : 'jpg';
      const objectPath = `campaign/${campaignId}/${department}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const fileBuffer = await file.arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(objectPath, fileBuffer, {
          contentType: file.type || 'image/webp',
          upsert: false,
        });

      if (uploadError) {
        return NextResponse.json({ success: false, error: `上傳失敗: ${uploadError.message}` }, { status: 500 });
      }

      uploadedPaths.push(objectPath);
      uploadedNames.push(file.name);
    }

    const { data: signedUrlData, error: signedError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrls(uploadedPaths, 60 * 60 * 24 * 7);

    if (signedError) {
      return NextResponse.json({ success: false, error: `產生預覽網址失敗: ${signedError.message}` }, { status: 500 });
    }

    const uploadedUrls = (signedUrlData || []).map((item) => item.signedUrl || '').filter(Boolean);

    return NextResponse.json({
      success: true,
      data: {
        names: uploadedNames,
        paths: uploadedPaths,
        urls: uploadedUrls,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || '上傳失敗' }, { status: 500 });
  }
}

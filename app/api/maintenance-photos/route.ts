import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

const STORAGE_BUCKET = 'maintenance-photos';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB per photo
const MAX_FILES_PER_REQUEST = 5;

function normalizeMaintenanceError(err: any) {
  const msg = String(err?.message || '');
  if (
    msg.includes("Could not find the table 'public.maintenance_") ||
    msg.includes('schema cache')
  ) {
    return '維修模組資料表尚未建置到目前環境，請先在該環境執行 migration_general_affairs_maintenance.sql';
  }
  return msg || '維修模組操作失敗';
}

// ──────────────────────────────────────────
// POST /api/maintenance-photos
//   上傳維修照片
// ──────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const adminClient = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const canSubmit = await hasAnyPermission(user.id, [
      'cross_dept.maintenance.submit',
      'cross_dept.maintenance.view_all',
    ]);
    if (!canSubmit) {
      return NextResponse.json({ success: false, error: '沒有上傳照片的權限' }, { status: 403 });
    }

    const formData = await request.formData();
    const requestId = String(formData.get('request_id') || '');
    const photoType = String(formData.get('photo_type') || 'other');
    const files = formData
      .getAll('files')
      .filter((item): item is File => item instanceof File);

    if (!requestId || files.length === 0) {
      return NextResponse.json({ success: false, error: '缺少必要欄位或檔案' }, { status: 400 });
    }

    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json(
        { success: false, error: `單次最多上傳 ${MAX_FILES_PER_REQUEST} 張照片` },
        { status: 400 }
      );
    }

    // 驗證 request_id 存在
    const { data: req } = await supabase
      .from('maintenance_requests')
      .select('id')
      .eq('id', requestId)
      .single();

    if (!req) {
      return NextResponse.json({ success: false, error: '維修回報不存在' }, { status: 404 });
    }

    const uploadedRecords: Array<{ id: string; file_name: string; storage_path: string }> = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json(
          { success: false, error: `${file.name} 超過 10MB 限制` },
          { status: 400 }
        );
      }

      const ext = file.type.includes('webp')
        ? 'webp'
        : file.type.includes('png')
          ? 'png'
          : 'jpg';

      const objectPath = `maintenance/${requestId}/${photoType}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const fileBuffer = await file.arrayBuffer();

      const { error: uploadError } = await adminClient.storage
        .from(STORAGE_BUCKET)
        .upload(objectPath, fileBuffer, {
          contentType: file.type || 'image/jpeg',
          upsert: false,
        });

      if (uploadError) {
        return NextResponse.json(
          { success: false, error: `上傳失敗: ${uploadError.message}` },
          { status: 500 }
        );
      }

      // 新增照片紀錄
      const { data: photoRecord, error: dbError } = await supabase
        .from('maintenance_photos')
        .insert({
          request_id: requestId,
          storage_path: objectPath,
          file_name: file.name,
          uploaded_by: user.id,
          photo_type: photoType || 'other',
        })
        .select('id, file_name, storage_path')
        .single();

      if (dbError) throw dbError;

      uploadedRecords.push({
        id: photoRecord.id,
        file_name: photoRecord.file_name,
        storage_path: photoRecord.storage_path,
      });
    }

    return NextResponse.json({
      success: true,
      data: uploadedRecords,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(error) }, { status: 500 });
  }
}

// ──────────────────────────────────────────
// GET /api/maintenance-photos?request_id=xxx
//   取得維修照片列表
// ──────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get('request_id');

    if (!requestId) {
      return NextResponse.json({ success: false, error: '缺少 request_id' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('maintenance_photos')
      .select('*')
      .eq('request_id', requestId)
      .order('photo_type')
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(err) }, { status: 500 });
  }
}

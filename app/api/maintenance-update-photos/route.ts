import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

const STORAGE_BUCKET = 'maintenance-photos';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 5;

export const dynamic = 'force-dynamic';

function normalizeMaintenanceError(err: any) {
  const msg = String(err?.message || '');
  if (
    msg.includes("Could not find the table 'public.maintenance_") ||
    msg.includes('schema cache')
  ) {
    return '維修模組資料表尚未建置到目前環境，請先在該環境執行 migration_general_affairs_maintenance.sql 與 migration_maintenance_update_photos.sql';
  }
  return msg || '維修模組操作失敗';
}

// POST /api/maintenance-update-photos
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const adminClient = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const canUpdate = await hasAnyPermission(user.id, [
      'cross_dept.maintenance.update',
      'cross_dept.maintenance.view_all',
    ]);
    if (!canUpdate) {
      return NextResponse.json({ success: false, error: '沒有上傳進度照片的權限' }, { status: 403 });
    }

    const formData = await request.formData();
    const updateId = String(formData.get('update_id') || '');
    const files = formData.getAll('files').filter((item): item is File => item instanceof File);

    if (!updateId || files.length === 0) {
      return NextResponse.json({ success: false, error: '缺少必要欄位或檔案' }, { status: 400 });
    }

    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json({ success: false, error: `單次最多上傳 ${MAX_FILES_PER_REQUEST} 張照片` }, { status: 400 });
    }

    const { data: updateRow } = await supabase
      .from('maintenance_updates')
      .select('id, request_id')
      .eq('id', updateId)
      .single();

    if (!updateRow) {
      return NextResponse.json({ success: false, error: '維修進度更新不存在' }, { status: 404 });
    }

    const insertedRows: any[] = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json({ success: false, error: `${file.name} 超過 10MB 限制` }, { status: 400 });
      }

      const ext = file.type.includes('webp')
        ? 'webp'
        : file.type.includes('png')
          ? 'png'
          : 'jpg';

      const objectPath = `maintenance-updates/${updateRow.request_id}/${updateId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const fileBuffer = await file.arrayBuffer();

      const { error: uploadErr } = await adminClient.storage
        .from(STORAGE_BUCKET)
        .upload(objectPath, fileBuffer, {
          contentType: file.type || 'image/jpeg',
          upsert: false,
        });
      if (uploadErr) throw uploadErr;

      const { data: inserted, error: dbErr } = await supabase
        .from('maintenance_update_photos')
        .insert({
          update_id: updateId,
          storage_path: objectPath,
          file_name: file.name,
          uploaded_by: user.id,
        })
        .select('*')
        .single();

      if (dbErr) throw dbErr;
      insertedRows.push(inserted);
    }

    return NextResponse.json({ success: true, data: insertedRows });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: normalizeMaintenanceError(err) }, { status: 500 });
  }
}

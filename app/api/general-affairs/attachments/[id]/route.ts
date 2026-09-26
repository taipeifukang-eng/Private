import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { canManageUtilityBills } from '@/lib/general-affairs/utility-bills/access';

const STORAGE_BUCKET = 'general-affairs-attachments';

export const dynamic = 'force-dynamic';

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error || '附件操作失敗');
  let safeMessage = message;
  if (message.includes('schema cache') || message.includes('Could not find the table')) {
    safeMessage = '總務附件模組資料表尚未建置到目前環境，請先套用 general_affairs_resource_attachments migration';
  } else if (message.includes('Bucket not found') || message.includes('bucket not found')) {
    safeMessage = '總務附件儲存空間尚未建置到目前環境，請先完成附件基礎 Storage 設定。';
  }
  return NextResponse.json({ success: false, error: safeMessage }, { status });
}

function statusFromError(message: string) {
  if (message.includes('NOT_FOUND')) return 404;
  if (message.includes('ALREADY_DELETED')) return 409;
  if (message.includes('PERMISSION_DENIED')) return 403;
  if (message.includes('REASON_REQUIRED')) return 400;
  return 500;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const body = await request.json().catch(() => ({}));
    const reason = String(body.deletion_reason || '').trim();
    if (!reason) return jsonError('請輸入刪除原因', 400);

    const adminClient = createAdminClient();
    const { data: attachment } = await adminClient
      .from('ga_resource_attachments')
      .select('id, resource_type, resource_id, storage_path, deleted_at')
      .eq('id', params.id)
      .maybeSingle();

    if (attachment?.resource_type === 'UTILITY_BILL') {
      if (!await canManageUtilityBills()) return jsonError('PERMISSION_DENIED: 沒有費用附件管理權限', 403);
      if (attachment.deleted_at) return jsonError('ALREADY_DELETED: 附件已刪除', 409);
      const { error: deleteError } = await adminClient
        .from('ga_resource_attachments')
        .update({ deleted_at: new Date().toISOString(), deleted_by: user.id, deletion_reason: reason })
        .eq('id', params.id)
        .is('deleted_at', null);
      if (deleteError) throw deleteError;
      if (attachment.storage_path) await adminClient.storage.from(STORAGE_BUCKET).remove([attachment.storage_path]);
      return NextResponse.json({ success: true, data: { id: attachment.id, storage_path: attachment.storage_path } });
    }

    const { data, error } = await supabase.rpc('ga_soft_delete_resource_attachment', {
      p_attachment_id: params.id,
      p_reason: reason,
    });

    if (error) return jsonError(error.message, statusFromError(error.message));

    const storagePath = typeof data?.storage_path === 'string' ? data.storage_path : '';
    if (storagePath) {
      const { error: storageError } = await createAdminClient().storage
        .from(STORAGE_BUCKET)
        .remove([storagePath]);
      if (storageError) {
        return NextResponse.json({
          success: true,
          data,
          warning: '附件紀錄已刪除，但 Storage 檔案清理失敗，請由管理者稍後清理。',
        });
      }
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return jsonError(error);
  }
}

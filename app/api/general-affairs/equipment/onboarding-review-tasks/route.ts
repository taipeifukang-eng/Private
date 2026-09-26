import { NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'general-affairs-attachments';
const REVIEW_ACCESS_PERMISSIONS = [
  'general_affairs.equipment.manage',
  'general_affairs.equipment.view',
  'general_affairs.request.manage',
  'general_affairs.request.view_all',
];

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message || '設備複核任務載入失敗')
      : String(error || '設備複核任務載入失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

async function buildSignedImages(adminSupabase: ReturnType<typeof createAdminClient>, equipmentIds: string[]) {
  const byEquipmentId = new Map<string, Record<string, any>>();
  if (!equipmentIds.length) return byEquipmentId;

  const { data, error } = await adminSupabase
    .from('ga_resource_attachments')
    .select('id, resource_id, purpose, file_name, content_type, storage_path, size_bytes, uploaded_at, is_primary')
    .eq('resource_type', 'EQUIPMENT')
    .in('resource_id', equipmentIds)
    .in('purpose', ['PRIMARY_IMAGE', 'LABEL_POSITION_IMAGE'])
    .is('deleted_at', null)
    .order('is_primary', { ascending: false })
    .order('uploaded_at', { ascending: false });
  if (error) throw error;

  const imageRows = (data || []).filter((row: any) => row.content_type?.startsWith('image/') && row.storage_path);
  const { data: signedData, error: signedError } = imageRows.length
    ? await adminSupabase.storage.from(STORAGE_BUCKET).createSignedUrls(imageRows.map((row: any) => row.storage_path), 60 * 10)
    : { data: [], error: null };
  if (signedError) throw signedError;

  const signedMap = new Map<string, string | null>();
  (signedData || []).forEach((item: any) => signedMap.set(item.path, item.signedUrl || null));

  imageRows.forEach((row: any) => {
    const images = byEquipmentId.get(row.resource_id) || {};
    if (images[row.purpose]) return;
    images[row.purpose] = {
      id: row.id,
      purpose: row.purpose,
      file_name: row.file_name,
      content_type: row.content_type,
      size_bytes: row.size_bytes,
      signed_url: signedMap.get(row.storage_path) || null,
      uploaded_at: row.uploaded_at,
    };
    byEquipmentId.set(row.resource_id, images);
  });

  return byEquipmentId;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const canView = await hasAnyPermission(user.id, REVIEW_ACCESS_PERMISSIONS);
    if (!canView) return jsonError('沒有設備建檔複核查看權限', 403);

    const adminSupabase = createAdminClient();
    const { data, error } = await adminSupabase
      .from('ga_equipment')
      .select(`
        id,
        store_id,
        name,
        asset_code,
        area,
        location_detail,
        onboarding_status,
        onboarding_requires_primary_photo,
        onboarding_requires_label_photo,
        onboarding_review_note,
        updated_at,
        store:stores(id, store_code, store_name, short_name),
        category:ga_equipment_categories(id, name, code)
      `)
      .eq('onboarding_status', 'PENDING_GA_REVIEW')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (error) throw error;

    const rows = data || [];
    const imagesByEquipmentId = await buildSignedImages(adminSupabase, rows.map((row: any) => row.id).filter(Boolean));

    return NextResponse.json({
      success: true,
      data: rows.map((row: any) => ({
        id: row.id,
        title: '設備貼標照片待複核',
        status: 'PENDING_GA_REVIEW',
        updated_at: row.updated_at,
        store: row.store,
        category: row.category,
        equipment: {
          id: row.id,
          name: row.name,
          asset_code: row.asset_code,
          area: row.area,
          location_detail: row.location_detail,
          onboarding_status: row.onboarding_status,
          onboarding_requires_primary_photo: row.onboarding_requires_primary_photo,
          onboarding_requires_label_photo: row.onboarding_requires_label_photo,
          onboarding_review_note: row.onboarding_review_note,
          primary_image: imagesByEquipmentId.get(row.id)?.PRIMARY_IMAGE || null,
          label_position_image: imagesByEquipmentId.get(row.id)?.LABEL_POSITION_IMAGE || null,
        },
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'general-affairs-attachments';
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const FULL_ACCESS_PERMISSIONS = [
  'general_affairs.equipment.manage',
  'general_affairs.equipment.view',
  'general_affairs.request.manage',
  'general_affairs.request.view_all',
  'store.manage',
];

function isMissingEquipmentOnboardingSchema(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const message = error.message || '';
  return (
    (error.code === '42703' || error.code === 'PGRST204')
      && message.includes('onboarding_')
  ) || (
    (error.code === '42P01' || error.code === 'PGRST205')
      && message.includes('ga_equipment')
  );
}

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message || '設備待辦操作失敗')
      : String(error || '設備待辦操作失敗');
  console.error('[GA store onboarding task]', message, error);
  return NextResponse.json({ success: false, error: message }, { status });
}

function getExtension(file: File) {
  const fromName = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (fromName && fromName.length <= 8) return fromName;
  if (file.type.includes('webp')) return 'webp';
  if (file.type.includes('png')) return 'png';
  if (file.type.includes('heic')) return 'heic';
  if (file.type.includes('heif')) return 'heif';
  return 'jpg';
}

async function getStoreScope(adminSupabase: ReturnType<typeof createAdminClient>, userId: string) {
  const canViewAll = await hasAnyPermission(userId, FULL_ACCESS_PERMISSIONS);
  if (canViewAll) {
    const { data, error } = await adminSupabase
      .from('stores')
      .select('id')
      .eq('is_active', true);
    if (error) throw error;
    return { canViewAll, storeIds: (data || []).map((store: any) => store.id).filter(Boolean) as string[] };
  }

  const { data, error } = await adminSupabase
    .from('store_managers')
    .select('store_id')
    .eq('user_id', userId);
  if (error) throw error;
  return { canViewAll, storeIds: (data || []).map((row: any) => row.store_id).filter(Boolean) as string[] };
}

async function buildTasks(adminSupabase: ReturnType<typeof createAdminClient>, storeIds: string[]) {
  if (storeIds.length === 0) return [];

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
      store:stores(id, store_code, store_name, short_name)
    `)
    .in('store_id', storeIds)
    .in('onboarding_status', ['NEEDS_EQUIPMENT_PHOTO', 'NEEDS_LABEL_PHOTO'])
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(100);
  if (isMissingEquipmentOnboardingSchema(error)) {
    console.warn('[GA store onboarding task] onboarding schema is not deployed; skipping equipment tasks');
    return [];
  }
  if (error) throw error;

  const equipmentIds = (data || []).map((item: any) => item.id);
  const primaryImageByEquipment = new Map<string, any>();

  if (equipmentIds.length > 0) {
    const { data: attachments, error: attachmentError } = await adminSupabase
      .from('ga_resource_attachments')
      .select('resource_id, file_name, content_type, storage_path, uploaded_at, is_primary')
      .eq('resource_type', 'EQUIPMENT')
      .in('resource_id', equipmentIds)
      .eq('purpose', 'PRIMARY_IMAGE')
      .is('deleted_at', null)
      .order('is_primary', { ascending: false })
      .order('uploaded_at', { ascending: false });
    if (attachmentError) throw attachmentError;

    const imagePaths = (attachments || [])
      .filter((attachment: any) => attachment.content_type?.startsWith('image/') && attachment.storage_path)
      .map((attachment: any) => attachment.storage_path);
    const signedUrls = new Map<string, string | null>();
    if (imagePaths.length > 0) {
      const { data: signedData } = await adminSupabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrls(imagePaths, 60 * 10);
      (signedData || []).forEach((item: any) => signedUrls.set(item.path, item.signedUrl || null));
    }

    (attachments || []).forEach((attachment: any) => {
      if (primaryImageByEquipment.has(attachment.resource_id)) return;
      primaryImageByEquipment.set(attachment.resource_id, {
        file_name: attachment.file_name,
        content_type: attachment.content_type,
        signed_url: attachment.storage_path ? signedUrls.get(attachment.storage_path) || null : null,
      });
    });
  }

  return (data || []).map((item: any) => ({
    id: item.id,
    task_type: item.onboarding_status === 'NEEDS_EQUIPMENT_PHOTO' ? 'EQUIPMENT_PHOTO' : 'LABEL_POSITION_PHOTO',
    title: item.onboarding_status === 'NEEDS_EQUIPMENT_PHOTO' ? '待上傳設備照片' : '待上傳貼標照片',
    action_label: item.onboarding_status === 'NEEDS_EQUIPMENT_PHOTO' ? '上傳設備照片' : '上傳貼標位置照片',
    equipment: {
      id: item.id,
      name: item.name,
      asset_code: item.asset_code,
      area: item.area,
      location_detail: item.location_detail,
      onboarding_status: item.onboarding_status,
      onboarding_requires_primary_photo: item.onboarding_requires_primary_photo,
      onboarding_requires_label_photo: item.onboarding_requires_label_photo,
      onboarding_review_note: item.onboarding_review_note,
      image: primaryImageByEquipment.get(item.id) || null,
    },
    store: item.store,
    updated_at: item.updated_at,
  }));
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const adminSupabase = createAdminClient();
    const { storeIds } = await getStoreScope(adminSupabase, user.id);
    const tasks = await buildTasks(adminSupabase, storeIds);

    return NextResponse.json({ success: true, data: tasks });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const formData = await request.formData();
    const equipmentId = String(formData.get('equipment_id') || '').trim();
    const purpose = String(formData.get('purpose') || '').trim().toUpperCase();
    const file = formData.get('file');

    if (!equipmentId) return jsonError('缺少設備資料', 400);
    if (!['PRIMARY_IMAGE', 'LABEL_POSITION_IMAGE'].includes(purpose)) return jsonError('照片用途錯誤', 400);
    if (!(file instanceof File)) return jsonError('請選擇要上傳的照片', 400);
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) return jsonError('僅支援 JPG、PNG、WebP、HEIC 圖片', 400);
    if (file.size > MAX_FILE_SIZE_BYTES) return jsonError('單檔不可超過 20MB', 400);

    const adminSupabase = createAdminClient();
    const { storeIds } = await getStoreScope(adminSupabase, user.id);
    if (storeIds.length === 0) return jsonError('目前帳號沒有可處理的門市範圍', 403);

    const { data: equipment, error: equipmentError } = await adminSupabase
      .from('ga_equipment')
      .select('id, store_id, onboarding_status')
      .eq('id', equipmentId)
      .is('deleted_at', null)
      .maybeSingle();
    if (equipmentError) throw equipmentError;
    if (!equipment) return jsonError('找不到設備資料', 404);
    if (!storeIds.includes(equipment.store_id)) return jsonError('只能處理自己管理門市的設備照片任務', 403);
    if (purpose === 'PRIMARY_IMAGE' && equipment.onboarding_status !== 'NEEDS_EQUIPMENT_PHOTO') {
      return jsonError('此設備目前不需要補設備照片', 409);
    }
    if (purpose === 'LABEL_POSITION_IMAGE' && equipment.onboarding_status !== 'NEEDS_LABEL_PHOTO') {
      return jsonError('此設備目前不需要補貼標位置照片', 409);
    }

    const extension = getExtension(file);
    const storagePath = `equipment/${equipmentId}/${purpose.toLowerCase()}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const arrayBuffer = await file.arrayBuffer();
    const upload = await adminSupabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, Buffer.from(arrayBuffer), {
        contentType: file.type,
        upsert: false,
      });
    if (upload.error) throw upload.error;

    const { error: insertError } = await supabase
      .from('ga_resource_attachments')
      .insert({
        resource_type: 'EQUIPMENT',
        resource_id: equipmentId,
        purpose,
        storage_bucket: STORAGE_BUCKET,
        storage_path: storagePath,
        file_name: file.name,
        content_type: file.type,
        size_bytes: file.size,
        is_primary: purpose === 'PRIMARY_IMAGE',
        metadata: { source: 'store_onboarding_task' },
      });

    if (insertError) {
      await adminSupabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => undefined);
      throw insertError;
    }

    const clearRequirement = purpose === 'PRIMARY_IMAGE'
      ? { onboarding_requires_primary_photo: false }
      : { onboarding_requires_label_photo: false };
    const { error: clearRequirementError } = await adminSupabase
      .from('ga_equipment')
      .update(clearRequirement)
      .eq('id', equipmentId)
      .is('deleted_at', null);
    if (clearRequirementError) throw clearRequirementError;

    const { error: syncError } = await adminSupabase.rpc('ga_sync_equipment_onboarding_status', {
      p_equipment_id: equipmentId,
    });
    if (syncError) throw syncError;

    const { storeIds: refreshedStoreIds } = await getStoreScope(adminSupabase, user.id);
    const tasks = await buildTasks(adminSupabase, refreshedStoreIds);

    return NextResponse.json({ success: true, data: tasks });
  } catch (error) {
    return jsonError(error);
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { canManageUtilityBills, canViewUtilityBills } from '@/lib/general-affairs/utility-bills/access';

const STORAGE_BUCKET = 'general-affairs-attachments';
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_FILES_PER_REQUEST = 10;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);
const RESOURCE_TYPES = new Set(['EQUIPMENT', 'FACILITY', 'PART', 'MAINTENANCE_REQUEST', 'MAINTENANCE_UPDATE', 'SERVICE_REQUEST', 'SERVICE_REQUEST_COMMENT', 'UTILITY_BILL']);

export const dynamic = 'force-dynamic';

function safeErrorMessage(error: unknown, fallback = '附件操作失敗') {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string') return error || fallback;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    for (const key of ['message', 'error', 'details', 'hint', 'code']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    try {
      return JSON.stringify(error);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function jsonError(error: unknown, status = 500) {
  const message = safeErrorMessage(error);
  let safeMessage = message;
  if (message.includes('schema cache') || message.includes('Could not find the table')) {
    safeMessage = '總務附件模組資料表尚未建置到目前環境，請先套用 general_affairs_resource_attachments migration';
  } else if (message.includes('Bucket not found') || message.includes('bucket not found')) {
    safeMessage = '總務附件儲存空間尚未建置到目前環境，請先完成附件基礎 Storage 設定。';
  }
  return NextResponse.json({ success: false, error: safeMessage }, { status });
}

function statusFromError(error: unknown) {
  const message = safeErrorMessage(error, '');
  if (message.includes('Bucket not found') || message.includes('bucket not found')) return 503;
  if (message.includes('PERMISSION_DENIED') || message.includes('row-level security')) return 403;
  if (message.includes('duplicate key') || message.includes('violates unique constraint')) return 409;
  if (message.includes('invalid input syntax for type uuid')) return 400;
  return 500;
}

function normalizeResourceType(value: FormDataEntryValue | string | null) {
  const resourceType = String(value || '').trim().toUpperCase();
  if (!RESOURCE_TYPES.has(resourceType)) throw new Error('附件資源類型錯誤');
  return resourceType;
}

function normalizePurpose(value: FormDataEntryValue | string | null) {
  const purpose = String(value || 'GENERAL').trim().toUpperCase();
  if (!purpose || !/^[A-Z0-9_]{1,40}$/.test(purpose)) throw new Error('附件用途格式錯誤');
  return purpose;
}

function getExtension(file: File) {
  const fromName = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (fromName && fromName.length <= 8) return fromName;
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type.includes('webp')) return 'webp';
  if (file.type.includes('png')) return 'png';
  if (file.type.includes('heic')) return 'heic';
  if (file.type.includes('heif')) return 'heif';
  return 'jpg';
}

function maskStoragePath(path: string) {
  const parts = path.split('/');
  if (parts.length <= 2) return path;
  return `${parts[0]}/.../${parts[parts.length - 1]}`;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const adminClient = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const { searchParams } = new URL(request.url);
    const resourceType = normalizeResourceType(searchParams.get('resourceType'));
    const resourceId = searchParams.get('resourceId');
    const purpose = searchParams.get('purpose') ? normalizePurpose(searchParams.get('purpose')) : null;
    if (!resourceId) return jsonError('缺少 resourceId', 400);
    if (resourceType === 'UTILITY_BILL') {
      if (!await canViewUtilityBills()) return jsonError('PERMISSION_DENIED: 沒有費用附件查看權限', 403);
      const { data: bill } = await adminClient.from('ga_utility_bills').select('id').eq('id', resourceId).is('deleted_at', null).maybeSingle();
      if (!bill) return jsonError('找不到費用紀錄', 404);
    }

    const attachmentClient = resourceType === 'UTILITY_BILL' ? adminClient : supabase;
    let query = attachmentClient
      .from('ga_resource_attachments')
      .select('id, resource_type, resource_id, purpose, storage_bucket, storage_path, file_name, content_type, size_bytes, is_primary, sort_order, metadata, uploaded_at, uploaded_by')
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .is('deleted_at', null);

    if (purpose) query = query.eq('purpose', purpose);

    const { data, error } = await query
      .order('sort_order')
      .order('uploaded_at', { ascending: false });

    if (error) throw error;

    const rows = data || [];
    const paths = rows.map((row) => row.storage_path).filter(Boolean);
    const signedMap = new Map<string, string>();

    if (paths.length) {
      const { data: signedData, error: signedError } = await adminClient.storage
        .from(STORAGE_BUCKET)
        .createSignedUrls(paths, 60 * 60 * 24);
      if (signedError) throw signedError;

      (signedData || []).forEach((item, index) => {
        const path = paths[index];
        if (path && item?.signedUrl) signedMap.set(path, item.signedUrl);
      });
    }

    return NextResponse.json({
      success: true,
      data: rows.map((row) => ({
        ...row,
        signed_url: signedMap.get(row.storage_path) || null,
        storage_path_display: maskStoragePath(row.storage_path),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  const uploadedPaths: string[] = [];
  try {
    const supabase = await createClient();
    const adminClient = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const formData = await request.formData();
    const resourceType = normalizeResourceType(formData.get('resource_type'));
    const resourceId = String(formData.get('resource_id') || '').trim();
    const purpose = normalizePurpose(formData.get('purpose'));
    const isPrimary = String(formData.get('is_primary') || '').toLowerCase() === 'true';
    const files = formData.getAll('files').filter((item): item is File => item instanceof File);

    if (!resourceId) return jsonError('缺少 resource_id', 400);
    if (resourceType === 'UTILITY_BILL') {
      if (!await canManageUtilityBills()) return jsonError('PERMISSION_DENIED: 沒有費用附件管理權限', 403);
      const { data: bill } = await adminClient.from('ga_utility_bills').select('id').eq('id', resourceId).is('deleted_at', null).maybeSingle();
      if (!bill) return jsonError('找不到費用紀錄', 404);
    }
    if (!files.length) return jsonError('請選擇要上傳的附件', 400);
    if (files.length > MAX_FILES_PER_REQUEST) return jsonError(`單次最多上傳 ${MAX_FILES_PER_REQUEST} 個附件`, 400);

    const insertedRows: Array<Record<string, unknown>> = [];

    for (const file of files) {
      const contentType = file.type || 'application/octet-stream';
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) return jsonError(`${file.name} 檔案格式不支援`, 400);
      if (file.size <= 0) return jsonError(`${file.name} 是空檔案`, 400);
      if (file.size > MAX_FILE_SIZE_BYTES) return jsonError(`${file.name} 超過 20MB 限制`, 400);

      const extension = getExtension(file);
      const objectPath = `${resourceType.toLowerCase()}/${resourceId}/${purpose.toLowerCase()}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
      const buffer = await file.arrayBuffer();

      const { error: uploadError } = await adminClient.storage
        .from(STORAGE_BUCKET)
        .upload(objectPath, buffer, {
          contentType,
          upsert: false,
        });
      if (uploadError) throw uploadError;
      uploadedPaths.push(objectPath);

      const attachmentClient = resourceType === 'UTILITY_BILL' ? adminClient : supabase;
      const { data: insertedAttachment, error } = await attachmentClient
        .from('ga_resource_attachments')
        .insert({
          resource_type: resourceType,
          resource_id: resourceId,
          purpose,
          storage_bucket: STORAGE_BUCKET,
          storage_path: objectPath,
          file_name: file.name,
          content_type: contentType,
          size_bytes: file.size,
          is_primary: isPrimary && insertedRows.length === 0,
          metadata: {},
        })
        .select('id, resource_type, resource_id, purpose, storage_path, file_name, content_type, size_bytes, is_primary, uploaded_at')
        .single();

      if (error) throw error;
      insertedRows.push(insertedAttachment as Record<string, unknown>);
    }

    return NextResponse.json({ success: true, data: insertedRows }, { status: 201 });
  } catch (error) {
    if (uploadedPaths.length) {
      await createAdminClient().storage.from(STORAGE_BUCKET).remove(uploadedPaths).catch(() => undefined);
    }
    return jsonError(error, statusFromError(error));
  }
}

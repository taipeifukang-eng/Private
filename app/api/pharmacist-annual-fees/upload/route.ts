import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

const BUCKET = 'pharmacist-fee-proofs';
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
];
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf'];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// POST - 上傳繳費證明
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canEdit = await hasPermission(user.id, 'pharmacist.management.edit');
  if (!canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: '無效的表單資料' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  const rawCode = formData.get('employee_code') as string | null;

  if (!file || !rawCode) {
    return NextResponse.json({ error: '缺少 file 或 employee_code' }, { status: 400 });
  }

  const employeeCode = rawCode.trim().toUpperCase();

  const rawType = String(file.type || '').toLowerCase();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isAllowedByType = rawType ? ALLOWED_TYPES.includes(rawType) : false;
  const isAllowedByExtension = ALLOWED_EXTENSIONS.includes(ext);

  if (!isAllowedByType && !isAllowedByExtension) {
    return NextResponse.json(
      { error: '不支援的檔案格式（僅接受 JPG / PNG / WEBP / HEIC / HEIF / PDF）' },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: '檔案大小超過 10 MB 限制' }, { status: 400 });
  }

  // Storage key 不允許中文，須轉成 ASCII 或底線
  const baseName = file.name.replace(/\.[^.]*$/, '');
  const extension = ext || 'bin';
  const safeName = `${baseName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_')}.${extension}`;
  const path = `${employeeCode}/${Date.now()}_${safeName}`;

  const buffer = await file.arrayBuffer();
  const adminSupabase = createAdminClient();

  const { error } = await adminSupabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: rawType || 'application/octet-stream', upsert: false });

  if (error) {
    if (error.message?.includes('Bucket not found') || error.message?.includes('bucket')) {
      return NextResponse.json(
        { error: 'Storage Bucket 尚未建立，請執行 migration_pharmacist_annual_fees.sql' },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ path });
}

// GET ?path=xxx - 取得 signed URL（1 小時有效）
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canView = await hasPermission(user.id, 'pharmacist.management.view');
  if (!canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const path = req.nextUrl.searchParams.get('path');
  if (!path) return NextResponse.json({ error: 'path 為必填' }, { status: 400 });

  const adminSupabase = createAdminClient();
  const { data, error } = await adminSupabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600); // 1 hour

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canManageFacilities, canReadFacilities } from '@/lib/general-affairs/facilities/access';
import { findDuplicateFacilityTemplate } from '@/lib/general-affairs/catalog-identity';

export const dynamic = 'force-dynamic';

function fail(error: unknown, status = 500) {
  return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error || '架型操作失敗') }, { status });
}

function text(value: unknown, label: string, required = false) {
  const normalized = String(value || '').trim();
  if (required && !normalized) throw new Error(`請輸入${label}`);
  return normalized || null;
}

function dimension(value: unknown, label: string) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}必須大於 0`);
  return number;
}

function payload(body: Record<string, unknown>) {
  const categoryId = text(body.categoryId, '設施分類');
  if (categoryId && !/^[0-9a-f-]{36}$/i.test(categoryId)) throw new Error('設施分類格式錯誤');
  return {
    code: String(text(body.code, '架型代碼', true)).toUpperCase(),
    name: text(body.name, '架型名稱', true),
    category_id: categoryId,
    brand: text(body.brand, '品牌'),
    model: text(body.model, '型號'),
    width_cm: dimension(body.widthCm, '寬度'),
    height_cm: dimension(body.heightCm, '高度'),
    depth_cm: dimension(body.depthCm, '深度'),
    description: text(body.description, '說明'),
    is_active: body.isActive !== false,
  };
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail('未登入', 401);
    if (!await canReadFacilities()) return fail('沒有設施查看權限', 403);
    const { data, error } = await supabase.from('ga_facility_templates').select('*, category:ga_facility_categories(id, name, code)').is('deleted_at', null).order('code');
    if (error) throw error;
    const templateIds = (data || []).map((item) => item.id);
    const usageByTemplate = new Map<string, { assetCount: number; storeIds: Set<string> }>();
    if (templateIds.length) {
      const { data: usageRows, error: usageError } = await supabase
        .from('ga_facilities')
        .select('facility_template_id, store_id')
        .in('facility_template_id', templateIds)
        .is('deleted_at', null);
      if (usageError) throw usageError;
      (usageRows || []).forEach((row) => {
        if (!row.facility_template_id) return;
        const usage = usageByTemplate.get(row.facility_template_id) || { assetCount: 0, storeIds: new Set<string>() };
        usage.assetCount += 1;
        if (row.store_id) usage.storeIds.add(row.store_id);
        usageByTemplate.set(row.facility_template_id, usage);
      });
    }
    const rows = (data || []).map((item) => {
      const usage = usageByTemplate.get(item.id);
      return { ...item, asset_count: usage?.assetCount || 0, site_count: usage?.storeIds.size || 0 };
    });
    return NextResponse.json({ success: true, data: rows });
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail('未登入', 401);
    if (!await canManageFacilities()) return fail('沒有設施管理權限', 403);
    const row = payload(await request.json());
    const { data: existingRows, error: duplicateLookupError } = await supabase
      .from('ga_facility_templates')
      .select('id, code, name, brand, model, is_active')
      .is('deleted_at', null);
    if (duplicateLookupError) throw duplicateLookupError;
    const duplicate = findDuplicateFacilityTemplate(existingRows || [], row);
    if (duplicate) {
      return NextResponse.json({
        success: false,
        error: `公司設施主檔已存在：${duplicate.code} / ${duplicate.name}`,
        duplicate,
      }, { status: 409 });
    }
    const { data, error } = await supabase.from('ga_facility_templates').insert({ ...row, created_by: user.id, updated_by: user.id }).select('*').single();
    if (error) throw error;
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) { return fail(error, 400); }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail('未登入', 401);
    if (!await canManageFacilities()) return fail('沒有設施管理權限', 403);
    const body = await request.json();
    const id = String(body.id || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('架型 id 格式錯誤', 400);
    const row = payload(body);
    const { data: existingRows, error: duplicateLookupError } = await supabase
      .from('ga_facility_templates')
      .select('id, code, name, brand, model, is_active')
      .is('deleted_at', null);
    if (duplicateLookupError) throw duplicateLookupError;
    const duplicate = findDuplicateFacilityTemplate(existingRows || [], row, id);
    if (duplicate) {
      return NextResponse.json({
        success: false,
        error: `公司設施主檔已存在：${duplicate.code} / ${duplicate.name}`,
        duplicate,
      }, { status: 409 });
    }
    const { data, error } = await supabase.from('ga_facility_templates').update({ ...row, updated_by: user.id }).eq('id', id).is('deleted_at', null).select('*').single();
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) { return fail(error, 400); }
}

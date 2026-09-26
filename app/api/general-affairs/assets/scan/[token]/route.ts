import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'general-affairs-attachments';

const FULL_SCAN_PERMISSIONS = [
  'general_affairs.equipment.manage',
  'general_affairs.facility.manage',
  'general_affairs.request.manage',
  'general_affairs.work_order.manage',
  'store.manage',
] as const;

const VIEW_ALL_SCAN_PERMISSIONS = [
  ...FULL_SCAN_PERMISSIONS,
  'general_affairs.equipment.view',
  'general_affairs.facility.view',
  'general_affairs.request.view_all',
  'general_affairs.maintenance_request.view_all',
  'general_affairs.work_order.view_all',
  'cross_dept.maintenance.view_all',
] as const;

const REPAIR_REQUEST_PERMISSIONS = [
  'general_affairs.request.create',
  'general_affairs.maintenance_request.create',
  'cross_dept.maintenance.submit',
] as const;

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error || '資產掃描資料載入失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

function normalizeToken(value: string) {
  const token = String(value || '').trim().toLowerCase();
  return /^[a-z0-9]{24,64}$/.test(token) ? token : '';
}

function warrantyStatus(asset: any, type: 'EQUIPMENT' | 'FACILITY') {
  if (type === 'EQUIPMENT') {
    if (!asset.has_warranty) return { label: '無保固', end_date: null, active: false };
    const endDate = asset.warranty_end_date || null;
    const active = endDate ? new Date(`${endDate}T23:59:59`).getTime() >= Date.now() : null;
    return { label: active === false ? '保固已到期' : '保固中', end_date: endDate, active };
  }

  const specs = asset.specs || {};
  const hasWarranty = Boolean(specs.facility_has_warranty);
  if (!hasWarranty) return { label: '無保固', end_date: null, active: false };
  const endDate = specs.facility_warranty_end_date || null;
  const active = endDate ? new Date(`${endDate}T23:59:59`).getTime() >= Date.now() : null;
  return { label: active === false ? '保固已到期' : '保固中', end_date: endDate, active };
}

async function signAttachments(adminSupabase: any, resourceType: 'EQUIPMENT' | 'FACILITY', resourceId: string) {
  const { data: rows, error } = await adminSupabase
    .from('ga_resource_attachments')
    .select('id, purpose, storage_path, file_name, content_type, is_primary, uploaded_at')
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId)
    .is('deleted_at', null)
    .order('is_primary', { ascending: false })
    .order('sort_order')
    .order('uploaded_at', { ascending: false })
    .limit(8);
  if (error) throw error;

  const paths = (rows || []).map((row: any) => row.storage_path).filter(Boolean);
  const signedMap = new Map<string, string>();
  if (paths.length) {
    const { data: signed, error: signedError } = await adminSupabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrls(paths, 60 * 60);
    if (signedError) throw signedError;
    (signed || []).forEach((item: any, index: number) => {
      const path = paths[index];
      if (path && item?.signedUrl) signedMap.set(path, item.signedUrl);
    });
  }

  return (rows || []).map((row: any) => ({
    id: row.id,
    purpose: row.purpose,
    file_name: row.file_name,
    content_type: row.content_type,
    is_primary: row.is_primary,
    uploaded_at: row.uploaded_at,
    signed_url: signedMap.get(row.storage_path) || null,
  }));
}

async function fetchMaintenanceRecords(adminSupabase: any, resourceType: 'equipment' | 'facility', resourceId: string) {
  const { data, error } = await adminSupabase
    .from('maintenance_requests')
    .select('id, title, status, priority, reported_at, completed_at, updated_at')
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId)
    .order('reported_at', { ascending: false })
    .limit(10);

  if (error) {
    const message = String(error.message || '');
    if (message.includes('resource_id') || message.includes('resource_type')) return [];
    throw error;
  }

  return data || [];
}

async function isStoreManagerForStore(adminSupabase: any, userId: string, storeId?: string | null) {
  if (!storeId) return false;
  const { data, error } = await adminSupabase
    .from('store_managers')
    .select('id')
    .eq('user_id', userId)
    .eq('store_id', storeId)
    .limit(1);
  if (error) throw error;
  return (data || []).length > 0;
}

function publicAttachments(attachments: any[]) {
  return attachments
    .filter((attachment) => attachment.content_type?.startsWith('image/'))
    .map((attachment) => ({
      id: attachment.id,
      purpose: attachment.purpose,
      file_name: attachment.file_name,
      content_type: attachment.content_type,
      is_primary: attachment.is_primary,
      uploaded_at: attachment.uploaded_at,
      signed_url: attachment.signed_url,
    }));
}

async function fetchEquipment(adminSupabase: any, token: string) {
  const { data, error } = await adminSupabase
    .from('ga_equipment')
    .select(`
      id,
      store_id,
      category_id,
      name,
      asset_code,
      barcode,
      brand,
      model,
      serial_number,
      status,
      area,
      location_detail,
      purpose,
      installed_at,
      purchased_at,
      has_warranty,
      warranty_end_date,
      qr_token,
      store:stores(id, store_code, store_name, short_name),
      category:ga_equipment_categories(id, name, code)
    `)
    .eq('qr_token', token)
    .is('qr_token_revoked_at', null)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchFacility(adminSupabase: any, token: string) {
  const { data, error } = await adminSupabase
    .from('ga_facilities')
    .select(`
      id,
      store_id,
      category_id,
      name,
      facility_code,
      status,
      area,
      location_detail,
      installed_at,
      last_renovated_at,
      description,
      specs,
      qr_token,
      store:stores(id, store_code, store_name, short_name),
      category:ga_facility_categories(id, name, code)
    `)
    .eq('qr_token', token)
    .is('qr_token_revoked_at', null)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function GET(_: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('請先登入後再查看 QR Code 資產資訊', 401);

    const token = normalizeToken(params.token);
    if (!token) return jsonError('QR Code 格式錯誤', 400);

    const adminSupabase = createAdminClient();
    const equipment = await fetchEquipment(adminSupabase, token);
    const type = equipment ? 'EQUIPMENT' as const : 'FACILITY' as const;
    const asset = equipment || await fetchFacility(adminSupabase, token);
    if (!asset) return jsonError('找不到此 QR Code 對應的設備或設施，可能已作廢或資料不存在', 404);

    const [canViewAll, canOpenAssetDetail, canCreateRepairRequest, isOwnStoreAsset] = await Promise.all([
      hasAnyPermission(user.id, VIEW_ALL_SCAN_PERMISSIONS),
      hasAnyPermission(user.id, FULL_SCAN_PERMISSIONS),
      hasAnyPermission(user.id, REPAIR_REQUEST_PERMISSIONS),
      isStoreManagerForStore(adminSupabase, user.id, asset.store_id),
    ]);

    if (!canViewAll && !isOwnStoreAsset) {
      return jsonError(
        '沒有查看此資產 QR Code 的權限。此設備 / 設施可能屬於其他門市，或不在你目前帳號可查看的門市範圍內；請聯絡總務或系統管理員確認門市指派與權限設定。',
        403,
      );
    }

    const attachments = await signAttachments(adminSupabase, type, asset.id);
    const visibleAttachments = canOpenAssetDetail ? attachments : publicAttachments(attachments);
    const maintenanceRecords = await fetchMaintenanceRecords(
      adminSupabase,
      type === 'EQUIPMENT' ? 'equipment' : 'facility',
      asset.id,
    );
    const code = type === 'EQUIPMENT' ? asset.asset_code : asset.facility_code;
    const managementPath = type === 'EQUIPMENT'
      ? `/general-affairs/equipment?id=${asset.id}`
      : `/general-affairs/facilities?id=${asset.id}`;

    return NextResponse.json({
      success: true,
      data: {
        access: {
          scope: canOpenAssetDetail ? 'MANAGE' : canViewAll ? 'VIEW_ALL' : 'OWN_STORE',
          can_open_asset_detail: canOpenAssetDetail,
          can_create_repair_request: canCreateRepairRequest,
          can_view_full_attachments: canOpenAssetDetail,
        },
        type,
        id: asset.id,
        token,
        code,
        name: asset.name,
        status: asset.status,
        store: asset.store,
        category: asset.category,
        area: asset.area,
        location_detail: asset.location_detail,
        brand: type === 'EQUIPMENT' ? asset.brand : asset.specs?.facility_brand || null,
        model: type === 'EQUIPMENT' ? asset.model : asset.specs?.facility_model || null,
        photo: visibleAttachments.find((attachment: any) => attachment.is_primary && attachment.content_type?.startsWith('image/')) || visibleAttachments.find((attachment: any) => attachment.content_type?.startsWith('image/')) || null,
        attachments: visibleAttachments,
        warranty: warrantyStatus(asset, type),
        maintenance_records: maintenanceRecords,
        repair_request_path: canCreateRepairRequest ? `/general-affairs/reports/new?assetToken=${token}` : null,
        management_path: canOpenAssetDetail ? managementPath : null,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

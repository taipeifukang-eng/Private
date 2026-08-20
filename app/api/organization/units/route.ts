import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';
import {
  ORGANIZATION_DEPARTMENT_CREATE_PERMISSION_CODES,
  ORGANIZATION_DEPARTMENT_EDIT_PERMISSION_CODES,
  ORGANIZATION_MANAGER_MANAGE_PERMISSION_CODES,
  ORGANIZATION_MEMBER_MANAGE_PERMISSION_CODES,
  ORGANIZATION_NAV_PERMISSION_CODES,
  type OrganizationManagerRole,
  type OrganizationStatus,
  type OrganizationUnitType,
} from '@/lib/admin/organization-management';

export const dynamic = 'force-dynamic';

const UNIT_TYPES = new Set<OrganizationUnitType>(['company', 'headquarters', 'department', 'team']);
const STATUSES = new Set<OrganizationStatus>(['active', 'inactive']);
const MANAGER_ROLES = new Set<OrganizationManagerRole>(['manager', 'deputy_manager', 'acting_manager']);

async function requireCurrentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function formatUnits(adminSupabase: ReturnType<typeof createAdminClient>, showInactive: boolean) {
  let unitsQuery = adminSupabase
    .from('organization_units')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('code', { ascending: true });

  if (!showInactive) {
    unitsQuery = unitsQuery.eq('status', 'active');
  }

  const { data: units, error: unitsError } = await unitsQuery;
  if (unitsError) throw unitsError;

  const unitIds = (units || []).map((unit: any) => unit.id);

  const [membershipsResult, managersResult] = await Promise.all([
    unitIds.length
      ? adminSupabase
          .from('organization_memberships')
          .select('*, user:profiles(id, email, full_name, employee_code, job_title)')
          .in('organization_unit_id', unitIds)
          .eq('status', 'active')
          .is('effective_to', null)
      : Promise.resolve({ data: [], error: null } as any),
    unitIds.length
      ? adminSupabase
          .from('organization_manager_assignments')
          .select('*, user:profiles(id, email, full_name, employee_code, job_title)')
          .in('organization_unit_id', unitIds)
          .eq('status', 'active')
          .is('effective_to', null)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (membershipsResult.error) throw membershipsResult.error;
  if (managersResult.error) throw managersResult.error;

  const membersByUnit = new Map<string, any[]>();
  (membershipsResult.data || []).forEach((row: any) => {
    const list = membersByUnit.get(row.organization_unit_id) || [];
    list.push(row);
    membersByUnit.set(row.organization_unit_id, list);
  });

  const managersByUnit = new Map<string, any[]>();
  (managersResult.data || []).forEach((row: any) => {
    const list = managersByUnit.get(row.organization_unit_id) || [];
    list.push(row);
    managersByUnit.set(row.organization_unit_id, list);
  });

  return (units || []).map((unit: any) => ({
    ...unit,
    members: (membersByUnit.get(unit.id) || []).sort((a, b) => {
      const aKey = a.user?.employee_code || a.user?.full_name || a.user?.email || '';
      const bKey = b.user?.employee_code || b.user?.full_name || b.user?.email || '';
      return aKey.localeCompare(bKey);
    }),
    managers: (managersByUnit.get(unit.id) || []).sort((a, b) => Number(b.is_primary) - Number(a.is_primary)),
  }));
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireCurrentUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const canView = await hasAnyPermission(user.id, ORGANIZATION_NAV_PERMISSION_CODES);
    if (!canView) return NextResponse.json({ error: '權限不足' }, { status: 403 });

    const adminSupabase = createAdminClient();
    const showInactive = request.nextUrl.searchParams.get('showInactive') === 'true';
    const units = await formatUnits(adminSupabase, showInactive);

    return NextResponse.json({ units }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('取得組織資料失敗:', error);
    return NextResponse.json({ error: error.message || '取得組織資料失敗' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireCurrentUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const canCreate = await hasAnyPermission(user.id, ORGANIZATION_DEPARTMENT_CREATE_PERMISSION_CODES);
    if (!canCreate) return NextResponse.json({ error: '權限不足' }, { status: 403 });

    const body = await request.json();
    const code = normalizeText(body.code).toUpperCase();
    const name = normalizeText(body.name);
    const shortName = normalizeText(body.short_name);
    const type = (body.type || 'department') as OrganizationUnitType;
    const parentId = normalizeText(body.parent_id) || null;
    const description = normalizeText(body.description);
    const sortOrder = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0;

    if (!code || !name) {
      return NextResponse.json({ error: '代碼與部門名稱為必填' }, { status: 400 });
    }
    if (!/^[A-Z0-9_-]{2,30}$/.test(code)) {
      return NextResponse.json({ error: '代碼只能包含英文大寫、數字、底線或連字號，長度 2-30' }, { status: 400 });
    }
    if (!UNIT_TYPES.has(type)) {
      return NextResponse.json({ error: '組織類型格式錯誤' }, { status: 400 });
    }

    const adminSupabase = createAdminClient();
    const { data, error } = await adminSupabase
      .from('organization_units')
      .insert({
        code,
        name,
        short_name: shortName || null,
        type,
        parent_id: parentId,
        status: 'active',
        description: description || null,
        sort_order: sortOrder,
        created_by: user.id,
        updated_by: user.id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: '組織代碼已存在' }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ unit: data }, { status: 201 });
  } catch (error: any) {
    console.error('建立組織單位失敗:', error);
    return NextResponse.json({ error: error.message || '建立組織單位失敗' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireCurrentUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const body = await request.json();
    const action = normalizeText(body.action) || 'update_unit';
    const adminSupabase = createAdminClient();

    if (action === 'set_members') {
      const canManageMembers = await hasAnyPermission(user.id, ORGANIZATION_MEMBER_MANAGE_PERMISSION_CODES);
      if (!canManageMembers) return NextResponse.json({ error: '權限不足' }, { status: 403 });

      const unitId = normalizeText(body.organization_unit_id);
      const userIds = Array.isArray(body.user_ids)
        ? Array.from(new Set(body.user_ids.map((id: unknown) => normalizeText(id)).filter(Boolean)))
        : [];
      if (!unitId) return NextResponse.json({ error: '缺少部門 ID' }, { status: 400 });

      const { error: deactivateError } = await adminSupabase
        .from('organization_memberships')
        .update({ status: 'inactive', effective_to: new Date().toISOString().slice(0, 10), updated_by: user.id })
        .eq('organization_unit_id', unitId)
        .eq('status', 'active')
        .is('effective_to', null);
      if (deactivateError) return NextResponse.json({ error: deactivateError.message }, { status: 500 });

      if (userIds.length > 0) {
        const rows = userIds.map(userId => ({
          organization_unit_id: unitId,
          user_id: userId,
          membership_role: 'member',
          membership_type: 'primary_department',
          is_primary: true,
          status: 'active',
          created_by: user.id,
          updated_by: user.id,
        }));
        const { error: insertError } = await adminSupabase.from('organization_memberships').insert(rows);
        if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    if (action === 'set_managers') {
      const canManageManagers = await hasAnyPermission(user.id, ORGANIZATION_MANAGER_MANAGE_PERMISSION_CODES);
      if (!canManageManagers) return NextResponse.json({ error: '權限不足' }, { status: 403 });

      const unitId = normalizeText(body.organization_unit_id);
      const assignments = Array.isArray(body.assignments) ? body.assignments : [];
      if (!unitId) return NextResponse.json({ error: '缺少部門 ID' }, { status: 400 });

      const { error: deactivateError } = await adminSupabase
        .from('organization_manager_assignments')
        .update({ status: 'inactive', effective_to: new Date().toISOString().slice(0, 10), updated_by: user.id })
        .eq('organization_unit_id', unitId)
        .eq('status', 'active')
        .is('effective_to', null);
      if (deactivateError) return NextResponse.json({ error: deactivateError.message }, { status: 500 });

      const rows = assignments
        .map((assignment: any, index: number) => {
          const userId = normalizeText(assignment.user_id);
          const managerRole = (normalizeText(assignment.manager_role) || 'manager') as OrganizationManagerRole;
          if (!userId || !MANAGER_ROLES.has(managerRole)) return null;
          return {
            organization_unit_id: unitId,
            user_id: userId,
            manager_role: managerRole,
            is_primary: Boolean(assignment.is_primary) || index === 0,
            status: 'active',
            created_by: user.id,
            updated_by: user.id,
          };
        })
        .filter(Boolean);

      if (rows.length > 0) {
        const { error: insertError } = await adminSupabase.from('organization_manager_assignments').insert(rows);
        if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    const canEdit = await hasAnyPermission(user.id, ORGANIZATION_DEPARTMENT_EDIT_PERMISSION_CODES);
    if (!canEdit) return NextResponse.json({ error: '權限不足' }, { status: 403 });

    const id = normalizeText(body.id);
    const name = normalizeText(body.name);
    const shortName = normalizeText(body.short_name);
    const parentId = normalizeText(body.parent_id) || null;
    const status = (body.status || 'active') as OrganizationStatus;
    const description = normalizeText(body.description);
    const sortOrder = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0;

    if (!id || !name) return NextResponse.json({ error: '缺少部門 ID 或名稱' }, { status: 400 });
    if (!STATUSES.has(status)) return NextResponse.json({ error: '狀態格式錯誤' }, { status: 400 });

    const { data, error } = await adminSupabase
      .from('organization_units')
      .update({
        name,
        short_name: shortName || null,
        parent_id: parentId,
        status,
        description: description || null,
        sort_order: sortOrder,
        updated_by: user.id,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ unit: data });
  } catch (error: any) {
    console.error('更新組織資料失敗:', error);
    return NextResponse.json({ error: error.message || '更新組織資料失敗' }, { status: 500 });
  }
}

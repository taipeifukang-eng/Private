import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';
import {
  ORGANIZATION_DEPARTMENT_WORKSPACE_MANAGE_PERMISSION_CODES,
  ORGANIZATION_DEPARTMENT_WORKSPACE_VIEW_PERMISSION_CODES,
  ORGANIZATION_NAV_PERMISSION_CODES,
} from '@/lib/admin/organization-management';

export const dynamic = 'force-dynamic';

const WORK_TYPES = new Set(['fixed', 'recurring', 'project']);
const IMPORTANCE = new Set(['normal', 'important', 'critical']);
const ASSIGNMENT_TYPES = new Set(['PRIMARY', 'COLLABORATOR', 'BACKUP']);

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function requireCurrentUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function verifyDepartment(adminSupabase: ReturnType<typeof createAdminClient>, departmentId: string) {
  const { data, error } = await adminSupabase
    .from('organization_units')
    .select('id, type, status')
    .eq('id', departmentId)
    .maybeSingle();
  if (error) throw error;
  return data?.type === 'department' && data?.status === 'active';
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireCurrentUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const canView = await hasAnyPermission(user.id, [
      ...ORGANIZATION_DEPARTMENT_WORKSPACE_VIEW_PERMISSION_CODES,
      ...ORGANIZATION_NAV_PERMISSION_CODES,
    ]);
    if (!canView) return NextResponse.json({ error: '權限不足' }, { status: 403 });

    const departmentId = normalizeText(request.nextUrl.searchParams.get('department_id'));
    if (!departmentId) return NextResponse.json({ error: '缺少部門 ID' }, { status: 400 });

    const adminSupabase = createAdminClient();
    const [categoriesResult, itemsResult] = await Promise.all([
      adminSupabase
        .from('work_categories')
        .select('id, name, status')
        .eq('organization_unit_id', departmentId)
        .eq('status', 'active')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      adminSupabase
        .from('work_items')
        .select(`
          *,
          category:work_categories(id, name, status),
          assignments:work_assignments(
            id,
            user_id,
            assignment_type,
            effective_from,
            effective_to,
            status,
            user:profiles!work_assignments_user_id_fkey(id, email, full_name, employee_code, department, job_title)
          )
        `)
        .eq('organization_unit_id', departmentId)
        .eq('status', 'active')
        .order('created_at', { ascending: false }),
    ]);

    if (categoriesResult.error) throw categoriesResult.error;
    if (itemsResult.error) throw itemsResult.error;

    return NextResponse.json({
      categories: categoriesResult.data || [],
      items: itemsResult.data || [],
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('取得部門工作職掌失敗:', error);
    return NextResponse.json({ error: error.message || '取得部門工作職掌失敗' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireCurrentUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const canManage = await hasAnyPermission(user.id, ORGANIZATION_DEPARTMENT_WORKSPACE_MANAGE_PERMISSION_CODES);
    if (!canManage) return NextResponse.json({ error: '權限不足' }, { status: 403 });

    const body = await request.json();
    const departmentId = normalizeText(body.organization_unit_id);
    const title = normalizeText(body.title);
    const categoryIdInput = normalizeText(body.category_id) || null;
    const categoryName = normalizeText(body.category_name);
    const workType = normalizeText(body.work_type) || 'fixed';
    const importance = normalizeText(body.importance) || 'normal';

    if (!departmentId || !title) return NextResponse.json({ error: '部門與工作名稱為必填' }, { status: 400 });
    if (!WORK_TYPES.has(workType)) return NextResponse.json({ error: '工作性質格式錯誤' }, { status: 400 });
    if (!IMPORTANCE.has(importance)) return NextResponse.json({ error: '重要程度格式錯誤' }, { status: 400 });

    const adminSupabase = createAdminClient();
    const isDepartment = await verifyDepartment(adminSupabase, departmentId);
    if (!isDepartment) return NextResponse.json({ error: '只能在啟用中的部門建立工作職掌' }, { status: 400 });

    let categoryId = categoryIdInput;
    if (!categoryId && categoryName) {
      const { data: category, error: categoryError } = await adminSupabase
        .from('work_categories')
        .upsert({
          organization_unit_id: departmentId,
          name: categoryName,
          status: 'active',
          created_by: user.id,
          updated_by: user.id,
        }, { onConflict: 'organization_unit_id,name' })
        .select('id')
        .single();
      if (categoryError) throw categoryError;
      categoryId = category.id;
    }

    if (!categoryId) return NextResponse.json({ error: '請選擇或新增工作分類' }, { status: 400 });

    const { data: item, error: itemError } = await adminSupabase
      .from('work_items')
      .insert({
        organization_unit_id: departmentId,
        category_id: categoryId,
        title,
        work_type: workType,
        importance,
        purpose: normalizeText(body.purpose) || null,
        execution_context: normalizeText(body.execution_context) || null,
        completion_standard: normalizeText(body.completion_standard) || null,
        notes: normalizeText(body.notes) || null,
        related_resources: normalizeText(body.related_resources) || null,
        handover_focus: normalizeText(body.handover_focus) || null,
        required_systems: normalizeText(body.required_systems) || null,
        important_contacts: normalizeText(body.important_contacts) || null,
        handover_notes: normalizeText(body.handover_notes) || null,
        status: 'active',
        created_by: user.id,
        updated_by: user.id,
      })
      .select('id')
      .single();

    if (itemError) throw itemError;

    const assignments = Array.isArray(body.assignments) ? body.assignments : [];
    const assignmentRows = assignments
      .map((assignment: any) => ({
        work_item_id: item.id,
        user_id: normalizeText(assignment.user_id),
        assignment_type: normalizeText(assignment.assignment_type),
        status: 'active',
        created_by: user.id,
        updated_by: user.id,
      }))
      .filter((assignment: any) => assignment.user_id && ASSIGNMENT_TYPES.has(assignment.assignment_type));

    if (assignmentRows.length > 0) {
      const { error: assignmentError } = await adminSupabase
        .from('work_assignments')
        .insert(assignmentRows);
      if (assignmentError) throw assignmentError;
    }

    return NextResponse.json({ success: true, item_id: item.id }, { status: 201 });
  } catch (error: any) {
    console.error('建立部門工作職掌失敗:', error);
    return NextResponse.json({ error: error.message || '建立部門工作職掌失敗' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireCurrentUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const canManage = await hasAnyPermission(user.id, ORGANIZATION_DEPARTMENT_WORKSPACE_MANAGE_PERMISSION_CODES);
    if (!canManage) return NextResponse.json({ error: '權限不足' }, { status: 403 });

    const body = await request.json();
    const itemId = normalizeText(body.id);
    const departmentId = normalizeText(body.organization_unit_id);
    const title = normalizeText(body.title);
    const categoryIdInput = normalizeText(body.category_id) || null;
    const categoryName = normalizeText(body.category_name);
    const workType = normalizeText(body.work_type) || 'fixed';
    const importance = normalizeText(body.importance) || 'normal';

    if (!itemId || !departmentId || !title) {
      return NextResponse.json({ error: '工作職掌 ID、部門與工作名稱為必填' }, { status: 400 });
    }
    if (!WORK_TYPES.has(workType)) return NextResponse.json({ error: '工作性質格式錯誤' }, { status: 400 });
    if (!IMPORTANCE.has(importance)) return NextResponse.json({ error: '重要程度格式錯誤' }, { status: 400 });

    const adminSupabase = createAdminClient();
    const isDepartment = await verifyDepartment(adminSupabase, departmentId);
    if (!isDepartment) return NextResponse.json({ error: '只能編輯啟用中部門的工作職掌' }, { status: 400 });

    const { data: existingItem, error: existingError } = await adminSupabase
      .from('work_items')
      .select('id, organization_unit_id')
      .eq('id', itemId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existingItem || existingItem.organization_unit_id !== departmentId) {
      return NextResponse.json({ error: '找不到此部門的工作職掌' }, { status: 404 });
    }

    let categoryId = categoryIdInput;
    if (!categoryId && categoryName) {
      const { data: category, error: categoryError } = await adminSupabase
        .from('work_categories')
        .upsert({
          organization_unit_id: departmentId,
          name: categoryName,
          status: 'active',
          created_by: user.id,
          updated_by: user.id,
        }, { onConflict: 'organization_unit_id,name' })
        .select('id')
        .single();
      if (categoryError) throw categoryError;
      categoryId = category.id;
    }

    if (!categoryId) return NextResponse.json({ error: '請選擇或新增工作分類' }, { status: 400 });

    const { error: itemError } = await adminSupabase
      .from('work_items')
      .update({
        category_id: categoryId,
        title,
        work_type: workType,
        importance,
        purpose: normalizeText(body.purpose) || null,
        execution_context: normalizeText(body.execution_context) || null,
        completion_standard: normalizeText(body.completion_standard) || null,
        notes: normalizeText(body.notes) || null,
        related_resources: normalizeText(body.related_resources) || null,
        handover_focus: normalizeText(body.handover_focus) || null,
        required_systems: normalizeText(body.required_systems) || null,
        important_contacts: normalizeText(body.important_contacts) || null,
        handover_notes: normalizeText(body.handover_notes) || null,
        updated_by: user.id,
      })
      .eq('id', itemId);

    if (itemError) throw itemError;

    const today = new Date().toISOString().slice(0, 10);
    const assignments = Array.isArray(body.assignments) ? body.assignments : [];
    const assignmentRows = assignments
      .map((assignment: any) => ({
        work_item_id: itemId,
        user_id: normalizeText(assignment.user_id),
        assignment_type: normalizeText(assignment.assignment_type),
        effective_from: today,
        status: 'active',
        created_by: user.id,
        updated_by: user.id,
      }))
      .filter((assignment: any) => assignment.user_id && ASSIGNMENT_TYPES.has(assignment.assignment_type));

    const { error: closeError } = await adminSupabase
      .from('work_assignments')
      .update({ status: 'inactive', effective_to: today, updated_by: user.id })
      .eq('work_item_id', itemId)
      .eq('status', 'active')
      .is('effective_to', null);
    if (closeError) throw closeError;

    if (assignmentRows.length > 0) {
      const { error: assignmentError } = await adminSupabase
        .from('work_assignments')
        .insert(assignmentRows);
      if (assignmentError) throw assignmentError;
    }

    return NextResponse.json({ success: true, item_id: itemId });
  } catch (error: any) {
    console.error('更新部門工作職掌失敗:', error);
    return NextResponse.json({ error: error.message || '更新部門工作職掌失敗' }, { status: 500 });
  }
}

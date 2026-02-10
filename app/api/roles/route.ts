// ============================================
// 角色管理 API - 列表與建立
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

// 取得角色列表
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 檢查查看權限
    const permission = await requirePermission(user.id, 'role.role.view');
    if (!permission.allowed) {
      return NextResponse.json(
        { error: permission.message },
        { status: 403 }
      );
    }

    // 取得角色列表，包含權限數量和使用者數量
    const { data: roles, error } = await supabase
      .from('roles')
      .select(`
        *,
        permission_count:role_permissions(count),
        user_count:user_roles(count)
      `)
      .order('is_system', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('取得角色列表錯誤:', error);
      return NextResponse.json(
        { error: '取得角色列表失敗' },
        { status: 500 }
      );
    }

    // 格式化數量
    const formattedRoles = roles.map(role => ({
      ...role,
      permission_count: role.permission_count?.[0]?.count || 0,
      user_count: role.user_count?.[0]?.count || 0
    }));

    return NextResponse.json({ roles: formattedRoles });
  } catch (error) {
    console.error('取得角色列表異常:', error);
    return NextResponse.json(
      { error: '取得角色列表失敗' },
      { status: 500 }
    );
  }
}

// 建立新角色
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 檢查建立權限
    const permission = await requirePermission(user.id, 'role.role.create');
    if (!permission.allowed) {
      return NextResponse.json(
        { error: permission.message },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, code, description } = body;

    // 驗證必填欄位
    if (!name || !code) {
      return NextResponse.json(
        { error: '角色名稱和代碼為必填' },
        { status: 400 }
      );
    }

    // 驗證代碼格式 (只允許英文、數字、底線)
    if (!/^[a-z0-9_]+$/.test(code)) {
      return NextResponse.json(
        { error: '角色代碼只能包含小寫英文、數字和底線' },
        { status: 400 }
      );
    }

    // 建立角色
    const { data: newRole, error } = await supabase
      .from('roles')
      .insert({
        name,
        code,
        description,
        is_system: false,
        is_active: true,
        created_by: user.id
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: '角色代碼已存在' },
          { status: 409 }
        );
      }
      console.error('建立角色錯誤:', error);
      return NextResponse.json(
        { error: '建立角色失敗' },
        { status: 500 }
      );
    }

    return NextResponse.json({ role: newRole }, { status: 201 });
  } catch (error) {
    console.error('建立角色異常:', error);
    return NextResponse.json(
      { error: '建立角色失敗' },
      { status: 500 }
    );
  }
}

// ============================================
// 單一角色 API - 查詢、更新、刪除
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

// 取得單一角色詳情
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { id } = params;

    // 取得角色資料
    const { data: role, error } = await supabase
      .from('roles')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !role) {
      return NextResponse.json(
        { error: '角色不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({ role });
  } catch (error) {
    console.error('取得角色詳情異常:', error);
    return NextResponse.json(
      { error: '取得角色詳情失敗' },
      { status: 500 }
    );
  }
}

// 更新角色
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 檢查編輯權限
    const permission = await requirePermission(user.id, 'role.role.edit');
    if (!permission.allowed) {
      return NextResponse.json(
        { error: permission.message },
        { status: 403 }
      );
    }

    const { id } = params;
    const body = await request.json();
    const { name, description, is_active } = body;

    // 檢查角色是否存在
    const { data: existingRole, error: fetchError } = await supabase
      .from('roles')
      .select('is_system')
      .eq('id', id)
      .single();

    if (fetchError || !existingRole) {
      return NextResponse.json(
        { error: '角色不存在' },
        { status: 404 }
      );
    }

    // 系統角色不允許停用
    if (existingRole.is_system && is_active === false) {
      return NextResponse.json(
        { error: '系統預設角色不可停用' },
        { status: 400 }
      );
    }

    // 更新角色
    const updateData: any = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (is_active !== undefined) updateData.is_active = is_active;

    const { data: updatedRole, error } = await supabase
      .from('roles')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('更新角色錯誤:', error);
      return NextResponse.json(
        { error: '更新角色失敗' },
        { status: 500 }
      );
    }

    return NextResponse.json({ role: updatedRole });
  } catch (error) {
    console.error('更新角色異常:', error);
    return NextResponse.json(
      { error: '更新角色失敗' },
      { status: 500 }
    );
  }
}

// 刪除角色
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 檢查刪除權限
    const permission = await requirePermission(user.id, 'role.role.delete');
    if (!permission.allowed) {
      return NextResponse.json(
        { error: permission.message },
        { status: 403 }
      );
    }

    const { id } = params;

    // 檢查角色是否存在且是否為系統角色
    const { data: existingRole, error: fetchError } = await supabase
      .from('roles')
      .select('is_system, code')
      .eq('id', id)
      .single();

    if (fetchError || !existingRole) {
      return NextResponse.json(
        { error: '角色不存在' },
        { status: 404 }
      );
    }

    if (existingRole.is_system) {
      return NextResponse.json(
        { error: '系統預設角色不可刪除' },
        { status: 400 }
      );
    }

    // 刪除角色
    const { error } = await supabase
      .from('roles')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('刪除角色錯誤:', error);
      return NextResponse.json(
        { error: '刪除角色失敗' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('刪除角色異常:', error);
    return NextResponse.json(
      { error: '刪除角色失敗' },
      { status: 500 }
    );
  }
}

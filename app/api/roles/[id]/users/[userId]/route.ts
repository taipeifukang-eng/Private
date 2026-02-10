// ============================================
// 移除使用者角色 API
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

// 移除使用者的角色
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 檢查撤銷權限
    const permission = await requirePermission(user.id, 'role.user_role.revoke');
    if (!permission.allowed) {
      return NextResponse.json(
        { error: permission.message },
        { status: 403 }
      );
    }

    const { id: roleId, userId } = params;

    // 檢查 user_role 是否存在
    const { data: existingUserRole, error: fetchError } = await supabase
      .from('user_roles')
      .select('id, role:roles(name)')
      .eq('role_id', roleId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !existingUserRole) {
      return NextResponse.json(
        { error: '使用者角色不存在' },
        { status: 404 }
      );
    }

    // 刪除角色指派
    const { error: deleteError } = await supabase
      .from('user_roles')
      .delete()
      .eq('role_id', roleId)
      .eq('user_id', userId);

    if (deleteError) {
      console.error('移除角色錯誤:', deleteError);
      return NextResponse.json(
        { error: '移除角色失敗' },
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true,
      message: '成功移除角色'
    });
  } catch (error) {
    console.error('移除角色異常:', error);
    return NextResponse.json(
      { error: '移除角色失敗' },
      { status: 500 }
    );
  }
}

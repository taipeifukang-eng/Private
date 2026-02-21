import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';

// 使用 Service Role Key 創建管理員客戶端
function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  
  if (!supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not found');
  }
  
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export async function POST(request: Request) {
  try {
    // 驗證當前用戶是否為管理員
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: '未登入' },
        { status: 401 }
      );
    }

    // 檢查是否為管理員
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: '權限不足，只有管理員可以重置密碼' },
        { status: 403 }
      );
    }

    // 取得要重置的用戶 ID 和新密碼
    const { userId, newPassword } = await request.json();

    if (!userId || !newPassword) {
      return NextResponse.json(
        { success: false, error: '缺少必要參數' },
        { status: 400 }
      );
    }

    // 驗證密碼長度
    if (newPassword.length < 6) {
      return NextResponse.json(
        { success: false, error: '密碼長度至少需要 6 個字元' },
        { status: 400 }
      );
    }

    // 使用管理員客戶端更新用戶密碼
    const adminClient = createAdminClient();
    
    const { data, error } = await adminClient.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    );

    if (error) {
      console.error('Admin reset password error:', error);
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: '密碼已成功重置',
      data: {
        userId: data.user.id,
        email: data.user.email
      }
    });

  } catch (error: any) {
    console.error('Admin reset password error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '重置密碼失敗' },
      { status: 500 }
    );
  }
}

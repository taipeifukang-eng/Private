// ============================================
// 巡店定位例外：目前登入者是否可使用
// 直接問資料庫的 can_use_inspection_gps_exempt()，與寫入時的 trigger 判斷同一來源，
// 避免前端顯示按鈕、送出時卻被資料庫擋下（不走通用 hasPermission 的管理員角色保底）。
// ============================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const { data, error } = await supabase.rpc('can_use_inspection_gps_exempt');
    if (error) {
      console.error('巡店定位例外資格檢查錯誤:', error);
      return NextResponse.json({ allowed: false });
    }
    return NextResponse.json({ allowed: data === true });
  } catch (error) {
    console.error('巡店定位例外資格檢查異常:', error);
    return NextResponse.json({ allowed: false });
  }
}

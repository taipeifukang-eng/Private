import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

/**
 * workspace 的關係會員編輯（M6 P07）。欄位驗證、權限與訊息與舊 PATCH /api/relationship-members/[id] 相同，
 * 差別只有一處：寫入會員編號時加上「目前仍是空的」條件（單一 UPDATE 的比對與寫入，由資料庫保證原子性）。
 * 舊 handler 先讀後寫、沒有此條件，兩個人同時填不同的會員編號時兩邊都回 200、後寫的蓋掉先寫的；
 * 新版第二個請求會拿到 409「會員編號已建立，不可清空或再次修改」。舊 route 不動。
 */
export async function updateRelationshipMember(request: NextRequest, id: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

  const permission = await requirePermission(user.id, 'relationship_member.edit');
  if (!permission.allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 });

  const body = await request.json();
  const memberName = String(body.member_name || '').trim();
  const phone = String(body.phone || '').trim();
  const relationship = String(body.relationship || '').trim();
  const memberNumber = String(body.member_number || '').trim() || null;
  if (!memberName || !phone || !relationship) {
    return NextResponse.json({ error: '姓名、電話與關係皆為必填' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: currentMember, error: currentError } = await admin
    .from('relationship_members')
    .select('id, member_number')
    .eq('id', id)
    .maybeSingle();
  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
  if (!currentMember) return NextResponse.json({ error: '找不到關係會員資料' }, { status: 404 });

  const existingMemberNumber = String(currentMember.member_number || '').trim();
  const locked = '會員編號已建立，不可清空或再次修改';
  if (existingMemberNumber && memberNumber !== existingMemberNumber) {
    return NextResponse.json({ error: locked }, { status: 409 });
  }

  const fields = { member_name: memberName, phone, relationship, updated_by: user.id };
  // 這次要「新設定」會員編號：只有目前仍為空時才寫入（並行填寫時第二個請求不會覆蓋第一個）。
  const settingNew = !existingMemberNumber && !!memberNumber;
  let query = admin.from('relationship_members').update({ ...fields, member_number: existingMemberNumber || memberNumber }).eq('id', id);
  if (settingNew) query = query.or('member_number.is.null,member_number.eq.');
  const { data: updated, error } = await query.select('id');

  if (error?.code === '23505') {
    return NextResponse.json({ error: '此會員編號已被其他關係會員使用' }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated?.length) {
    // 沒有更新到任何列：被並行請求搶先填了會員編號（或資料剛被刪除）。
    const { data: after, error: afterError } = await admin.from('relationship_members').select('id, member_number').eq('id', id).maybeSingle();
    if (afterError) return NextResponse.json({ error: afterError.message }, { status: 500 });
    if (!after) return NextResponse.json({ error: '找不到關係會員資料' }, { status: 404 });
    if (String(after.member_number || '').trim() === memberNumber) {
      // 對方填的就是同一個編號：視為成功，只補寫其他欄位。
      const { error: sameError } = await admin.from('relationship_members').update({ ...fields, member_number: memberNumber }).eq('id', id);
      if (sameError) return NextResponse.json({ error: sameError.message }, { status: 500 });
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: locked }, { status: 409 });
  }
  return NextResponse.json({ success: true });
}

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

  const allowed = await hasAnyPermission(user.id, [
    'relationship_member.view',
    'relationship_member.edit',
  ]);
  if (!allowed) return NextResponse.json({ error: '權限不足' }, { status: 403 });

  const memberName = request.nextUrl.searchParams.get('member_name')?.trim() || '';
  const memberNumber = request.nextUrl.searchParams.get('member_number')?.trim() || '';
  const admin = createAdminClient();

  let matchedNumbers: string[] | null = null;
  if (memberName) {
    const { data: matchedMembers, error } = await admin
      .from('relationship_members')
      .select('member_number')
      .ilike('member_name', `%${memberName}%`)
      .not('member_number', 'is', null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    matchedNumbers = (matchedMembers || []).map((item) => item.member_number).filter(Boolean) as string[];
    if (!matchedNumbers.length) return NextResponse.json({ sales: [] });
  }

  let query = admin
    .from('relationship_sales_details')
    .select('id, store_code, sale_datetime, member_number, product_code, product_name, quantity, amount, imported_at, import:relationship_sales_imports(file_name)')
    .order('sale_datetime', { ascending: false, nullsFirst: false })
    .order('imported_at', { ascending: false })
    .limit(5000);
  if (memberNumber) query = query.ilike('member_number', `%${memberNumber}%`);
  if (matchedNumbers) query = query.in('member_number', matchedNumbers);

  const { data: sales, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const numbers = Array.from(new Set((sales || []).map((item) => item.member_number)));
  const { data: members } = numbers.length
    ? await admin.from('relationship_members').select('member_number, member_name').in('member_number', numbers)
    : { data: [] as Array<{ member_number: string; member_name: string }> };
  const nameMap = new Map((members || []).map((item) => [item.member_number, item.member_name]));

  return NextResponse.json({
    sales: (sales || []).map((item) => ({ ...item, member_name: nameMap.get(item.member_number) || null })),
  });
}
